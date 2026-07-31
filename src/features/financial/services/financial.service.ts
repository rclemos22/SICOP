import { inject, Injectable, signal } from '@angular/core';
import { DebugService } from '../../../core/services/debug.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { SigefCacheService, SigefNeMovimento, SigefOrdemBancaria, SIGEF_PAID_STATUSES } from '../../../core/services/sigef-cache.service';
import { Transaction, TransactionType } from '../../../shared/models/transaction.model';

export interface NesPagamentoRow {
  tipo: 'EMPENHO' | 'REFORCO' | 'ANULACAO' | 'PAGAMENTO';
  ne: string;
  ug: string;
  ugLabel: string;
  dotacao: string;
  pp?: string;
  obNumber?: string;
  obStatus?: string;
  amount: number;
  date: string;
}

/**
 * Resumo financeiro de um contrato calculado a partir da tabela `transacoes`
 * (fonte canônica), em vez dos totais persistidos em `contratos`, que podem
 * estar desatualizados (ex.: anulação aplicada 2x, OB carregada após o último sync).
 */
export interface ContractFinanceSummary {
  contractId: string;
  contract: string;
  contratada: string;
  status: string;
  tipo?: string;
  /** Empenho líquido = COMMITMENT + REINFORCEMENT - CANCELLATION (nunca negativo) */
  empenhado: number;
  /** Soma das LIQUIDATION */
  pago: number;
  /** max(0, empenhado - pago) */
  saldo: number;
  /** true quando os totais persistidos divergem do calculado (dados desatualizados) */
  divergencia: boolean;
  storedEmpenhado?: number;
  storedPago?: number;
}
import { getUnidadeLabel } from '../../../shared/models/budget.model';
import { BudgetService } from '../../budget/services/budget.service';
import { ContractService } from '../../contracts/services/contract.service';
import { SyncAuditService } from '../../../core/services/sync-audit.service';

@Injectable({
  providedIn: 'root'
})
export class FinancialService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);
  private sigefCacheService = inject(SigefCacheService);
  private budgetService = inject(BudgetService);
  private contractService = inject(ContractService);
  private debug = inject(DebugService);
  private auditService = inject(SyncAuditService);

  private _transactions = signal<Transaction[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _backfillDone = false;
  private _financeSummaries = signal<Map<string, ContractFinanceSummary>>(new Map());

  public transactions = this._transactions.asReadonly();
  public loading = this._loading.asReadonly();
  public error = this._error.asReadonly();
  public financeSummaries = this._financeSummaries.asReadonly();

  constructor() {
    this.loadAllTransactions();
    this.loadContractFinanceSummaries();
  }

  private async withRetry<T>(fn: () => PromiseLike<T>, maxRetries = 3, delayMs = 500): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const isNetworkErr = err?.message?.includes('Failed to fetch') || err?.name === 'TypeError' || err?.status === 0;
        if (isNetworkErr && attempt < maxRetries) {
          await new Promise(res => setTimeout(res, delayMs * attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  async loadAllTransactions(silent?: boolean): Promise<void> {
    if (!silent) {
      this._loading.set(true);
      this._error.set(null);
    }

    try {
      // 0. Carregar dotações e contratos em paralelo para enriquecer transações
      const [transacoesResult, dotacoesResult, contratosResult] = await Promise.all([
        this.supabaseService.client
          .from('transacoes')
          .select('*, contratos!contract_id(id, contrato)')
          .order('date', { ascending: false }),
        this.supabaseService.client
          .from('vw_saldo_dotacoes')
          .select('contract_id, nunotaempenho, dotacao, numero_contrato'),
        this.supabaseService.client
          .from('contratos')
          .select('id, contrato, contratada, cnpj_contratada, processo_sei, unid_gestora')
      ]);

      const { data, error } = transacoesResult;

      if (error) {
        throw error;
      }

      // 0.1 Construir mapa de enriquecimento: (contract_id|NE) -> { dotacao, contrato }
      const dotacaoMap = new Map<string, { dotacao: string; contrato: string }>();
      // Indexar também só por NE para fallback (quando contract_id é vazio)
      const neLookup = new Map<string, { dotacao: string; contrato: string; contract_id: string }>();
      for (const d of dotacoesResult.data || []) {
        if (d.contract_id && d.nunotaempenho) {
          const key = `${d.contract_id}|${d.nunotaempenho}`;
          if (!dotacaoMap.has(key)) {
            dotacaoMap.set(key, { dotacao: d.dotacao, contrato: d.numero_contrato || '' });
          }
        }
        if (d.nunotaempenho && !neLookup.has(d.nunotaempenho)) {
          neLookup.set(d.nunotaempenho, {
            dotacao: d.dotacao,
            contrato: d.numero_contrato || '',
            contract_id: d.contract_id || ''
          });
        }
      }

      // 1. Mapear e filtrar dados inválidos
      let transactions = (data || [])
        .filter(raw => {
          if (!raw.date || isNaN(new Date(raw.date).getTime())) return false;
          if (isNaN(Number(raw.amount)) || Number(raw.amount) <= 0) return false;
          return true;
        })
        .map(raw => {
          const t = this.mapRawToTransaction(raw);
          // Enriquecer com dotação se estiver faltando
          if (!t.budget_description && !t.department) {
            const key = `${raw.contract_id}|${raw.commitment_id}`;
            const info = dotacaoMap.get(key);
            if (info) {
              t.budget_description = info.dotacao;
              t.department = info.dotacao;
            }
          }
          // Se ainda não tem contrato mas tem NE, buscar no neLookup
          if ((!t.contract_number || t.contract_number === 'N/A') && raw.commitment_id) {
            const neInfo = neLookup.get(raw.commitment_id);
            if (neInfo) {
              t.contract_number = neInfo.contrato;
              t.budget_description = t.budget_description || neInfo.dotacao;
              t.department = t.department || neInfo.dotacao;
              t.contract_id = t.contract_id || neInfo.contract_id;
            }
          }
          return t;
        });

      // 2. Ordenar por data decrescente
      transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // 3. Complementar com cache SIGEF (garante dados do mês atual mesmo se transacoes estiver desatualizada)
      const existingKeys = new Set(transactions.map(t => `${t.commitment_id}|${t.type}|${t.document_number || ''}|${t.amount}`));
      await this._loadTransactionsFromCache(transactions, neLookup, undefined, existingKeys, contratosResult.data || []);

      // 4. Enriquecer transações com contrato/dotação
      for (const t of transactions) {
        if ((!t.contract_number || t.contract_number === 'N/A' || !t.budget_description) && t.commitment_id) {
          const neInfo = neLookup.get(t.commitment_id);
          if (neInfo) {
            if (!t.contract_number || t.contract_number === 'N/A') t.contract_number = neInfo.contrato;
            if (!t.budget_description) t.budget_description = neInfo.dotacao;
            if (!t.department || t.department === 'Não informado') t.department = neInfo.dotacao;
            if (!t.contract_id) t.contract_id = neInfo.contract_id;
          }
        }
        // Fallback: tenta encontrar contrato via tabela contratos se ainda estiver sem número
        if ((!t.contract_number || t.contract_number === 'N/A') && t.contract_id) {
          const contratoInfo = contratosResult.data?.find((c: any) => c.id === t.contract_id);
          if (contratoInfo) {
            t.contract_number = contratoInfo.contrato;
          }
        }
      }

      // 5. Filtrar apenas transações vinculadas a contratos cadastrados
      const validContractIds = new Set((contratosResult.data || []).map((c: any) => c.id));
      const before = transactions.length;
      transactions = transactions.filter(t => t.contract_id && validContractIds.has(t.contract_id));
      if (before !== transactions.length) {
        this.debug.sync(`[loadAllTransactions] Removidas ${before - transactions.length} transações sem vínculo contratual`);
      }

      this._transactions.set(transactions);

      // Recalcular resumo financeiro (fonte canônica para KPIs do dashboard)
      await this.loadContractFinanceSummaries(true);

      // Backfill único: preenche campos faltantes nas transações existentes
      if (!this._backfillDone) {
        this._backfillDone = true;
        this.backfillTransacoes();
      }
    } catch (err: any) {
      if (!silent) {
        this.errorHandler.handle(err, 'FinancialService.loadAllTransactions');
        this._error.set(err.message || 'Erro desconhecido');
      }
    } finally {
      if (!silent) this._loading.set(false);
    }
  }

  /**
   * Calcula o resumo financeiro de cada contrato diretamente da tabela `transacoes`
   * (fonte canônica), em vez de depender dos totais persistidos em `contratos`
   * que podem estar desatualizados (anulação aplicada 2x, OB carregada após o último sync).
   *
   * - empenhado = COMMITMENT + REINFORCEMENT - CANCELLATION (nunca negativo)
   * - pago      = soma das LIQUIDATION
   * - saldo     = max(0, empenhado - pago)
   *
   * Marca `divergencia=true` quando o total persistido difere do calculado,
   * permitindo que o dashboard valide e exiba o valor correto.
   */
  async loadContractFinanceSummaries(silent?: boolean): Promise<void> {
    try {
      const [transacoesResult, contratosResult] = await Promise.all([
        this.supabaseService.client
          .from('transacoes')
          .select('contract_id, type, amount'),
        this.supabaseService.client
          .from('contratos')
          .select('id, contrato, contratada, status, tipo, total_empenhado, total_pago')
          .neq('status', 'EXCLUIDO'),
      ]);

      if (transacoesResult.error) throw transacoesResult.error;

      const totals = new Map<string, { empenhado: number; pago: number }>();
      for (const t of transacoesResult.data || []) {
        const cid = t.contract_id;
        if (!cid) continue;
        const amt = Math.abs(Number(t.amount) || 0);
        let cur = totals.get(cid);
        if (!cur) { cur = { empenhado: 0, pago: 0 }; totals.set(cid, cur); }
        if (t.type === 'COMMITMENT' || t.type === 'REINFORCEMENT') cur.empenhado += amt;
        else if (t.type === 'CANCELLATION') cur.empenhado = Math.max(0, cur.empenhado - amt);
        else if (t.type === 'LIQUIDATION') cur.pago += amt;
      }

      const map = new Map<string, ContractFinanceSummary>();
      const divergentes: string[] = [];
      for (const c of contratosResult.data || []) {
        const t = totals.get(c.id) || { empenhado: 0, pago: 0 };
        const empenhado = t.empenhado;
        const pago = t.pago;
        const saldo = Math.max(0, empenhado - pago);
        const storedEmpenhado = Number(c.total_empenhado) || 0;
        const storedPago = Number(c.total_pago) || 0;
        const divergencia =
          Math.abs(storedEmpenhado - empenhado) > 0.01 ||
          Math.abs(storedPago - pago) > 0.01;
        if (divergencia) divergentes.push(c.contrato);
        map.set(c.id, {
          contractId: c.id,
          contract: c.contrato,
          contratada: c.contratada,
          status: c.status,
          tipo: c.tipo,
          empenhado,
          pago,
          saldo,
          divergencia,
          storedEmpenhado,
          storedPago,
        });
      }

      this._financeSummaries.set(map);

      if (divergentes.length > 0) {
        console.warn(
          `[FinancialService] Validação financeira: ${divergentes.length} contrato(s) com totais persistidos divergentes das transações (o dashboard usa o valor calculado): ${divergentes.join(', ')}`
        );
      }
    } catch (err: any) {
      console.error('[FinancialService] Erro ao calcular resumo financeiro:', err);
      if (!silent) this.errorHandler.handle(err, 'FinancialService.loadContractFinanceSummaries');
    }
  }

  getFinanceSummary(contractId: string): ContractFinanceSummary | undefined {
    return this._financeSummaries().get(contractId);
  }

  /** Carrega dados do cache SIGEF como fallback quando transacoes está vazio */
  private async _loadTransactionsFromCache(
    transactions: Transaction[],
    neLookup?: Map<string, { dotacao: string; contrato: string; contract_id: string }>,
    year?: number,
    existingKeys?: Set<string>,
    contratosList?: any[]
  ): Promise<void> {
    try {
      const targetYear = year ?? new Date().getFullYear();
      const [movData, obData] = await Promise.all([
        this.supabaseService.client
          .from('import_sigef_ne')
          .select('nunotaempenho, cdunidadegestora, dtlancamento, raw_data')
          .not('raw_data', 'is', null)
          .gte('dtlancamento', `${targetYear}-01-01`)
          .lte('dtlancamento', `${targetYear}-12-31`),
        this.supabaseService.client
          .from('import_sigef_ob')
          .select('nunotaempenho, nuordembancaria, cdunidadegestora, nudocumento, vltotal, dtpagamento, dtlancamento, cdsituacaoordembancaria, raw_data')
          .not('vltotal', 'is', null)
          .gte('dtpagamento', `${targetYear}-01-01`)
          .lte('dtpagamento', `${targetYear}-12-31`),
      ]);

      const contracts = contratosList || [];
      const cleanNumber = (val: string): string => val ? val.replace(/\D/g, '') : '';
      const extractProcesso = (text: string): string => {
        if (!text) return '';
        const match = text.match(/\d{7}\.\d{7}\.\d\.\d{4}/) || text.match(/\d{7}\.\d{7}/);
        return match ? match[0] : '';
      };

      const findContractFallback = (neNum: string, rawNe?: any, rawOb?: any): any => {
        let processNum = '';
        let credorNum = '';
        
        if (rawNe) {
          processNum = rawNe.nuprocesso || extractProcesso(rawNe.dehistorico);
          credorNum = rawNe.cdcredor || '';
        }
        if (rawOb) {
          if (!processNum) processNum = extractProcesso(rawOb.deobservacao);
          if (!credorNum) credorNum = rawOb.cdcredor || '';
        }

        const cleanProc = cleanNumber(processNum);
        const cleanCred = cleanNumber(credorNum);

        // 1. Tentar por processo
        if (cleanProc) {
          for (const c of contracts) {
            const cleanCProc = cleanNumber(c.processo_sei);
            if (cleanCProc && (cleanCProc.includes(cleanProc) || cleanProc.includes(cleanCProc))) {
              return c;
            }
          }
        }

        // 2. Tentar por CNPJ do credor
        if (cleanCred) {
          const matches = contracts.filter((c: any) => cleanNumber(c.cnpj_contratada) === cleanCred);
          if (matches.length === 1) {
            return matches[0];
          } else if (matches.length > 1) {
            const rawUg = cleanNumber(rawNe?.cdunidadegestora || rawOb?.cdunidadegestora);
            const ugMatch = matches.find((c: any) => cleanNumber(c.unid_gestora) === rawUg);
            if (ugMatch) return ugMatch;
            return matches[0];
          }
        }

        return null;
      };

      const enrichByNe = (
        ne: string,
        rawNe?: any,
        rawOb?: any
      ): { contract_id: string; contract_number: string; department: string; budget_description: string } => {
        const info = neLookup?.get(ne);
        if (info) {
          return {
            contract_id: info.contract_id,
            contract_number: info.contrato,
            department: info.dotacao,
            budget_description: info.dotacao,
          };
        }

        // Fallback inteligente
        const fallbackContract = findContractFallback(ne, rawNe, rawOb);
        let fallbackDot = '';
        const rd = rawNe || rawOb;
        if (rd) {
          if (rd.cdacao && rd.cdfonte) {
            fallbackDot = `Ação ${rd.cdacao} / Fonte ${rd.cdfonte}`;
          } else if (rd.cdnaturezadespesa) {
            fallbackDot = `Nat. Desp. ${rd.cdnaturezadespesa}`;
          }
        }
        if (!fallbackDot) fallbackDot = '---';

        if (fallbackContract) {
          return {
            contract_id: fallbackContract.id,
            contract_number: fallbackContract.contrato,
            department: fallbackDot,
            budget_description: fallbackDot,
          };
        }

        return {
          contract_id: '',
          contract_number: 'N/A',
          department: fallbackDot,
          budget_description: fallbackDot,
        };
      };

      // NEs de empenho/reforço/anulação já persistidos no banco (fonte canônica).
      // Evita que o fallback do espelho duplique movimentos já sincronizados,
      // já que a chave do DB usa o NE como document_number (sem cdevento).
      const existingNonLiq = new Set(
        transactions
          .filter(t => t.type !== TransactionType.LIQUIDATION)
          .map(t => `${t.commitment_id}|${t.type}|${Math.round(t.amount * 100)}`)
      );

      (movData.data || []).forEach((m: any) => {
        const rd = m.raw_data || {};
        const vl = rd.vlnotaempenho;
        if (!vl) return;
        let type = TransactionType.COMMITMENT;
        if (rd.cdevento === 400012) type = TransactionType.CANCELLATION;
        else if (rd.cdevento === 400011) type = TransactionType.REINFORCEMENT;
        const ne = m.nunotaempenho || '';
        const amount = Math.abs(Number(vl) || 0);
        const dedupKey = `${ne}|${type}|${rd.cdevento || ''}|${amount}`;
        if (existingKeys?.has(dedupKey)) return;
        existingKeys?.add(dedupKey);
        // Movimento já existe no banco para esta NE/tipo/valor -> não duplicar
        if (existingNonLiq.has(`${ne}|${type}|${Math.round(amount * 100)}`)) return;

        const enriched = enrichByNe(ne, rd, null);
        const ugCode = m.cdunidadegestora || rd.cdunidadegestora || '';

        transactions.push({
          id: `cache-mov-${ne}-${rd.cdevento}`,
          contract_id: enriched.contract_id,
          description: `Movimento NE ${ne}`,
          commitment_id: ne,
          date: m.dtlancamento ? new Date(m.dtlancamento) : new Date(),
          type, amount,
          department: enriched.department,
          budget_description: enriched.budget_description,
          contract_number: enriched.contract_number,
          document_number: ne,
          unidade_gestora_label: ugCode ? getUnidadeLabel(String(ugCode)) : undefined
        } as Transaction);
      });

      (obData.data || []).forEach((o: any) => {
        if (!o.vltotal) return;
        const obNum = o.nuordembancaria || 'S/N';
        const docNum = o.nudocumento || obNum;
        const obDate = o.dtpagamento || o.dtlancamento || '';
        const ne = o.nunotaempenho || '';
        const amount = Math.abs(Number(o.vltotal) || 0);
        const dedupKey = `${ne}|${TransactionType.LIQUIDATION}|${docNum}|${amount}`;
        if (existingKeys?.has(dedupKey)) return;
        existingKeys?.add(dedupKey);

        const rd = o.raw_data || {};
        const enriched = enrichByNe(ne, null, rd);
        const ugCode = o.cdunidadegestora || rd.cdunidadegestora || '';

        transactions.push({
          id: `cache-ob-${obNum}-${docNum}`,
          contract_id: enriched.contract_id,
          description: `PAGAMENTO OB ${obNum}`,
          commitment_id: ne,
          date: obDate ? new Date(obDate) : new Date(),
          type: TransactionType.LIQUIDATION,
          amount,
          department: enriched.department,
          budget_description: enriched.budget_description,
          contract_number: enriched.contract_number,
          ob_number: obNum, document_number: docNum,
          payment_month: obDate ? obDate.substring(0, 7) : undefined,
          unidade_gestora_label: ugCode ? getUnidadeLabel(String(ugCode)) : undefined
        } as Transaction);
      });

      transactions.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (err) {
      console.error('[FinancialService] Erro ao carregar fallback do cache:', err);
    }
  }

  private async loadSigefFromCache(): Promise<Transaction[]> {
    const transactions: Transaction[] = [];
    // Acessa o signal de dotações do BudgetService
    const budgets = this.budgetService.dotacoes();
    
    // Filtrar apenas dotações vinculadas a contratos cadastrados
    const validBudgets = budgets.filter(b => b.contract_id && b.nunotaempenho);
    
    const EVENTO_LABELS: Record<number, string> = {
      400010: 'Empenho Inicial',
      400011: 'Reforço de Empenho',
      400012: 'Anulação de Empenho',
      400013: 'Empenho Original'
    };

    for (const budget of validBudgets) {

      const neValue = budget.nunotaempenho.trim();
      const ug = budget.unid_gestora || '080101';
      const ugNum = parseInt(ug, 10);

      try {
        // Busca apenas no cache local - sem chamadas de API do SIGEF aqui
        const movimentosCache = await this.sigefCacheService.getNeMovimentos(ugNum, neValue);
        const obsCache = await this.sigefCacheService.getOrdensBancariasPorNe(ugNum, neValue);

        // Adiciona movimentações de empenho
        movimentosCache.forEach((m, idx) => {
          let type = TransactionType.COMMITMENT;
          let description = EVENTO_LABELS[m.cdevento] || 'Movimento';

          if (m.cdevento === 400012) {
            type = TransactionType.CANCELLATION;
            description = 'Anulação de Empenho';
          } else if (m.cdevento === 400011) {
            type = TransactionType.REINFORCEMENT;
            description = 'Reforço de Empenho';
          }

          transactions.push({
            id: `cache-mov-${m.nunotaempenho}-${m.cdevento}-${idx}`,
            contract_id: budget.contract_id || '',
            description: description,
            commitment_id: m.nunotaempenho || '',
            date: m.dtlancamento ? new Date(m.dtlancamento) : new Date(),
            type: type,
            amount: Math.abs(Number(m.vlnotaempenho) || 0),
            department: budget.dotacao || '',
            budget_description: budget.dotacao || '',
            nunotaempenho: m.nunotaempenho,
            dotacao_id: budget.id,
            contract_number: budget.numero_contrato
          });
        });

        // Adiciona Ordens Bancárias (pagamentos)
        obsCache.forEach((ob) => {
          const obNumero = ob.nuordembancaria || 'S/N';
          const docNumero = ob.nudocumento || obNumero;
          
          transactions.push({
            id: `cache-ob-${obNumero}-${docNumero}`,
            contract_id: budget.contract_id || '',
            description: `PAGAMENTO OB ${obNumero}`,
            commitment_id: ob.nunotaempenho || '',
            date: ob.dtpagamento ? new Date(ob.dtpagamento) : (ob.dtlancamento ? new Date(ob.dtlancamento) : new Date()),
            type: TransactionType.LIQUIDATION,
            amount: Math.abs(Number(ob.vltotal) || 0),
            department: budget.dotacao || '',
            budget_description: budget.dotacao || '',
            nunotaempenho: ob.nunotaempenho,
            dotacao_id: budget.id,
            contract_number: budget.numero_contrato,
            ob_number: obNumero,
            document_number: docNumero
          });
        });
      } catch (err) {
        console.warn('[FinancialService] Erro ao carregar cache para NE:', neValue, err);
      }
    }

    return transactions;
  }

  async getTransactionsByContractId(contractId: string): Promise<Transaction[]> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('transacoes')
        .select('*')
        .eq('contract_id', contractId)
        .order('date', { ascending: false });

      if (error) {
        throw error;
      }

      const mapped = (data || []).map(this.mapRawToTransaction);
      if (mapped.length > 0) return mapped;

      // Fallback: busca dados do cache SIGEF para este contrato
      return await this._loadSigefForContract(contractId);
    } catch (err: any) {
      this.errorHandler.handle(err, 'FinancialService.getTransactionsByContractId');
      throw err;
    }
  }

  /** Carrega transações do cache SIGEF para um contrato específico (fallback) */
  private async _loadSigefForContract(contractId: string): Promise<Transaction[]> {
    try {
      const budgetResult = await this.budgetService.getBudgetsByContractId(contractId);
      const budgets = budgetResult.data || [];
      const allNes = [...new Set(
        budgets.map(b => b.nunotaempenho?.trim()).filter(Boolean) as string[]
      )];

      // Construir lookup de dotação por NE
      const neBudgetMap = new Map<string, { dotacao: string; numero_contrato: string }>();
      for (const b of budgets) {
        if (b.nunotaempenho && !neBudgetMap.has(b.nunotaempenho)) {
          neBudgetMap.set(b.nunotaempenho, {
            dotacao: b.dotacao || '',
            numero_contrato: b.numero_contrato || '',
          });
        }
      }

      const transactions: Transaction[] = [];
      for (const ne of allNes) {
        const [movimentos, obs] = await Promise.all([
          this.supabaseService.client
            .from('import_sigef_ne')
            .select('nunotaempenho, nuneoriginal, dtlancamento, raw_data')
            .eq('nunotaempenho', ne)
            .order('dtlancamento', { ascending: true, nullsFirst: false }),
          this.supabaseService.client
            .from('import_sigef_ob')
            .select('*')
            .eq('nunotaempenho', ne)
            .order('dtlancamento', { ascending: true, nullsFirst: false }),
        ]);

        const budgetInfo = neBudgetMap.get(ne);

        (movimentos.data || []).forEach((m: any, idx: number) => {
          const rd = m.raw_data || {};
          const vl = rd.vlnotaempenho;
          if (!vl) return;
          let type = TransactionType.COMMITMENT;
          if (rd.cdevento === 400012) type = TransactionType.CANCELLATION;
          else if (rd.cdevento === 400011) type = TransactionType.REINFORCEMENT;
          transactions.push({
            id: `cache-mov-${m.nunotaempenho}-${(rd.cdevento || '')}-${idx}`,
            contract_id: contractId,
            description: `Movimento NE ${m.nunotaempenho}`,
            commitment_id: m.nunotaempenho || '',
            date: m.dtlancamento ? new Date(m.dtlancamento) : new Date(),
            type, amount: Math.abs(Number(vl) || 0),
            department: budgetInfo?.dotacao || '',
            budget_description: budgetInfo?.dotacao || '',
            contract_number: budgetInfo?.numero_contrato || 'N/A',
          } as Transaction);
        });

        (obs.data || []).forEach((o: any) => {
          if (!o.vltotal) return;
          const obNum = o.nuordembancaria || 'S/N';
          const docNum = o.nudocumento || obNum;
          const obDate = o.dtpagamento || o.dtlancamento || '';
          transactions.push({
            id: `cache-ob-${obNum}-${docNum}`,
            contract_id: contractId,
            description: `PAGAMENTO OB ${obNum}`,
            commitment_id: o.nunotaempenho || '',
            date: obDate ? new Date(obDate) : new Date(),
            type: TransactionType.LIQUIDATION,
            amount: Math.abs(Number(o.vltotal) || 0),
            department: budgetInfo?.dotacao || '',
            budget_description: budgetInfo?.dotacao || '',
            contract_number: budgetInfo?.numero_contrato || 'N/A',
            ob_number: obNum, document_number: docNum,
            payment_month: obDate ? obDate.substring(0, 7) : undefined,
          } as Transaction);
        });
      }

      return transactions.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (err) {
      console.error('[FinancialService] Erro no fallback SIGEF para contrato:', contractId, err);
      return [];
    }
  }

  private mapRawToTransaction(raw: any): Transaction {
    if (!raw) return {} as Transaction;

    const parsedDate = new Date(raw.date);
    const isValidDate = !isNaN(parsedDate.getTime());

    // Extrair número do contrato do relacionamento (left join pode retornar objeto ou array)
    let contractNumber = 'N/A';
    if (raw.contratos) {
      if (Array.isArray(raw.contratos)) {
        contractNumber = raw.contratos[0]?.contrato || 'N/A';
      } else if (typeof raw.contratos === 'object') {
        contractNumber = raw.contratos.contrato || 'N/A';
      }
    }

    return {
      id: raw.id || '',
      contract_id: raw.contract_id || '',
      description: raw.description || 'Sem descrição',
      commitment_id: raw.commitment_id || '',
      date: isValidDate ? parsedDate : new Date(),
      type: (raw.type as TransactionType) || TransactionType.COMMITMENT,
      amount: Number(raw.amount) || 0,
      department: raw.department || 'Não informado',
      budget_description: raw.budget_description || '',
      parcela_referencia: raw.parcela_referencia,
      sigef_id: raw.sigef_id,
      contract_number: contractNumber,
      payment_month: raw.payment_month || (raw.date ? String(raw.date).substring(0, 7) : undefined),
      unidade_gestora_label: raw.unidade_gestora_label,
      document_number: raw.document_number,
      ob_number: raw.ob_number,
      parcela_valor: raw.parcela_valor != null ? Number(raw.parcela_valor) : undefined,
      parcela_pago_em: raw.parcela_pago_em ? new Date(raw.parcela_pago_em) : undefined,
      manual_payment: raw.manual_payment === true || raw.manual_payment === 'true'
    };
  }

  /**
   * Sincroniza e persiste transações do SIGEF no banco de dados para um contrato específico.
   * Transforma registros do cache (OBs e Movimentos) em transações permanentes.
   */
  async syncSigefTransactions(contractId: string): Promise<void> {
    this.debug.sync(`syncSigefTransactions: contrato ${contractId}`);
    const budgetResult = await this.budgetService.getBudgetsByContractId(contractId);
    const contractBudgets = budgetResult.data || [];
    if (contractBudgets.length === 0) {
      this.debug.warn(`syncSigefTransactions: nenhuma dotação para contrato ${contractId}`);
      return;
    }

    const syncErrors: string[] = [];

    // ── 1. Coleta TODOS os NEs de TODAS as dotações do contrato ──
    const allContractNes = new Set<string>();
    for (const b of contractBudgets) {
      if (b.nunotaempenho) allContractNes.add(b.nunotaempenho.trim());
    }
    this.debug.sync(`${allContractNes.size} NE(s) no contrato: ${[...allContractNes].join(', ')}`);

    // ── 2. Pré-carrega OBs de TODOS os NEs filtrando por UG ──
    const allObs: SigefOrdemBancaria[] = [];
    const loadedKeys = new Set<string>();
    for (const budget of contractBudgets) {
      if (!budget.nunotaempenho) continue;
      const ne = budget.nunotaempenho.trim();
      const ug = budget.unid_gestora || '080101';
      const key = `${ug}|${ne}`;
      if (loadedKeys.has(key)) continue;
      loadedKeys.add(key);

      const ugNum = parseInt(ug, 10);
      let obs = await this.sigefCacheService.getOrdensBancariasPorNe(ugNum, ne);
      if (obs.length === 0) {
        this.debug.sync(`NE ${ne} (UG ${ugNum}): 0 OBs via UG; buscando globalmente...`);
        const globalObs = await this.sigefCacheService.getOrdensBancariasPorNeGlobal(ne);
        obs = globalObs.filter(o => !o.cdunidadegestora || parseInt(String(o.cdunidadegestora), 10) === ugNum || ugNum === 80101 || ugNum === 80901);
        if (obs.length === 0) obs = globalObs; // Fallback definitivo pela NE
      }
      this.debug.sync(`NE ${ne} (UG ${ugNum}): ${obs.length} OB(s) no cache`);
      allObs.push(...obs);
    }

    const fmtDate = (d: any): string => {
      if (!d) return new Date().toISOString().split('T')[0];
      if (typeof d === 'string') return d.substring(0, 10);
      if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString().split('T')[0];
      return new Date().toISOString().split('T')[0];
    };

    for (const budget of contractBudgets) {
      if (!budget.nunotaempenho) continue;

      const neValue = budget.nunotaempenho.trim();
      const ug = budget.unid_gestora || '080101';
      const ugNum = parseInt(ug, 10);

      this.debug.sync(`[${neValue}] dotação ${budget.dotacao}...`);

      try {
        let movimentosCache = await this.sigefCacheService.getNeMovimentos(ugNum, neValue);
        if (movimentosCache.length === 0) {
          this.debug.sync(`[${neValue}] sem movimentos para UG ${ugNum}; tentando global com filtro de UG...`);
          const globalMovs = await this.sigefCacheService.getNeMovimentosGlobal(neValue);
          movimentosCache = globalMovs.filter(m => parseInt(String(m.cdunidadegestora), 10) === ugNum);
        }

        const { data: existingDbLiq } = await this.supabaseService.client
          .from('transacoes')
          .select('sigef_id, parcela_referencia, document_number')
          .eq('contract_id', contractId)
          .eq('commitment_id', neValue)
          .in('type', ['LIQUIDATION']);
        const docToParcelaMap = new Map((existingDbLiq || [])
          .filter(t => t.parcela_referencia)
          .map(t => [t.document_number, t.parcela_referencia])
        );

        const transactionsToUpsert: any[] = [];

        // ═══════════════════════════════════════════
        // A1. COMMITMENT (Empenho Original 400010 / 400013)
        // ═══════════════════════════════════════════
        const originalMovs = movimentosCache.filter(m => m.cdevento === 400010 || m.cdevento === 400013);
        for (let oi = 0; oi < originalMovs.length; oi++) {
          const mov = originalMovs[oi];
          const vl = Math.abs(Number(mov.vlnotaempenho) || 0);
          if (vl > 0) {
            transactionsToUpsert.push({
              contract_id: contractId,
              sigef_id: `cache-com-${neValue}-${oi}`,
              description: `EMPENHO ORIGINAL - NE ${neValue}`,
              commitment_id: neValue,
              date: fmtDate(mov.dtlancamento || budget.data_disponibilidade),
              type: TransactionType.COMMITMENT,
              amount: vl,
              department: budget.dotacao,
              budget_description: budget.dotacao,
              unidade_gestora_label: getUnidadeLabel(ug),
              document_number: neValue,
              ob_number: 'N/A'
            });
          }
        }

        // ═══════════════════════════════════════════
        // A2. REINFORCEMENT (Reforço 400011)
        // ═══════════════════════════════════════════
        const reforcoMovs = movimentosCache.filter(m => m.cdevento === 400011);
        for (let ri = 0; ri < reforcoMovs.length; ri++) {
          const mov = reforcoMovs[ri];
          const vl = Math.abs(Number(mov.vlnotaempenho) || 0);
          if (vl > 0) {
            transactionsToUpsert.push({
              contract_id: contractId,
              sigef_id: `cache-ref-${neValue}-${ri}`,
              description: `REFORÇO - NE ${neValue}`,
              commitment_id: neValue,
              date: fmtDate(mov.dtlancamento || budget.data_disponibilidade),
              type: TransactionType.REINFORCEMENT,
              amount: vl,
              department: budget.dotacao,
              budget_description: budget.dotacao,
              unidade_gestora_label: getUnidadeLabel(ug),
              document_number: neValue,
              ob_number: 'N/A'
            });
          }
        }

        // ═══════════════════════════════════════════
        // B. CANCELLATION (Anulação 400012)
        // ═══════════════════════════════════════════
        const cancelMovs = movimentosCache.filter(m => m.cdevento === 400012);
        for (let ci = 0; ci < cancelMovs.length; ci++) {
          const mov = cancelMovs[ci];
          const vl = Math.abs(Number(mov.vlnotaempenho) || 0);
          if (vl > 0) {
            transactionsToUpsert.push({
              contract_id: contractId,
              sigef_id: `cache-can-${neValue}-${ci}`,
              description: `ANULAÇÃO - NE ${neValue}`,
              commitment_id: neValue,
              date: fmtDate(mov.dtlancamento || budget.data_disponibilidade),
              type: TransactionType.CANCELLATION,
              amount: vl,
              department: budget.dotacao,
              budget_description: budget.dotacao,
              unidade_gestora_label: getUnidadeLabel(ug),
              document_number: neValue,
              ob_number: 'N/A'
            });
          }
        }

        // ═══════════════════════════════════════════
        // C. LIQUIDATION (Pagamento) — uma por OB
        // ═══════════════════════════════════════════
        const budgetPaidObs = allObs.filter(ob => {
          const obNe = (ob.nunotaempenho || '').trim().toUpperCase();
          const situacao = ob.cdsituacaoordembancaria?.toLowerCase() || '';
          const obUg = ob.cdunidadegestora || 0;
          
          // Normaliza ex: "2025NE003683" -> "2025NE3683" para evitar falhas por digitação sem zero
          const normObNe = obNe.replace(/(NE)0+/i, '$1');
          const normNeValue = neValue.replace(/(NE)0+/i, '$1');

          const matchNe = obNe === neValue || normObNe === normNeValue || obNe.startsWith(neValue) || neValue.startsWith(obNe);
          const matchUg = !obUg || parseInt(String(obUg), 10) === ugNum || ugNum === 80101 || ugNum === 80901;
          const isPaid = SIGEF_PAID_STATUSES.some(s => situacao.includes(s)) || situacao === '' || situacao.includes('paga');
          return matchNe && (matchUg || allContractNes.size === 1) && isPaid;
        });

        for (let obi = 0; obi < budgetPaidObs.length; obi++) {
          const ob = budgetPaidObs[obi];
          const vl = Math.abs(Number(ob.vltotal) || 0);
          if (vl === 0) continue;
          const obNum = ob.nuordembancaria || `unknown_${ob.id}`;
          const ppDoc = ob.nudocumento || '';
          const pagDate = ob.dtpagamento || ob.dtlancamento || '';

          let linkedParcela: string | null = null;
          if (ob.nudocumento && docToParcelaMap.has(ob.nudocumento)) {
            linkedParcela = docToParcelaMap.get(ob.nudocumento)!;
          }

          const uniqueObKey = ppDoc ? `${obNum}-${ppDoc}` : (budgetPaidObs.length > 1 ? `${obNum}-${obi}` : obNum);

          transactionsToUpsert.push({
            contract_id: contractId,
            sigef_id: `cache-liq-${uniqueObKey}`,
            description: `PAGAMENTO OB ${obNum}${ppDoc ? ` (PP ${ppDoc})` : ''}`.toUpperCase(),
            commitment_id: neValue,
            date: pagDate || fmtDate(budget.data_disponibilidade),
            type: TransactionType.LIQUIDATION,
            amount: vl,
            department: budget.dotacao,
            budget_description: budget.dotacao,
            unidade_gestora_label: getUnidadeLabel(ug),
            document_number: ppDoc,
            ob_number: obNum,
            parcela_pago_em: ob.dtpagamento || null,
            ...(linkedParcela ? { parcela_referencia: linkedParcela } : {})
          });
        }

      // ═══════════════════════════════════════════
      // D. Upsert + Limpeza de registros legados
      // ═══════════════════════════════════════════

      if (transactionsToUpsert.length > 0) {
        // Garantir unicidade estrita de sigef_id no payload
        const seenSigef = new Set<string>();
        const uniquePayload = transactionsToUpsert.filter(t => {
          if (!t.sigef_id || seenSigef.has(t.sigef_id)) return false;
          seenSigef.add(t.sigef_id);
          return true;
        });

        // Persistência segura sem depender de sintaxe de upsert no PostgREST
        for (const item of uniquePayload) {
          const { data: exist } = await this.withRetry(() =>
            this.supabaseService.client
              .from('transacoes')
              .select('id')
              .eq('sigef_id', item.sigef_id)
              .maybeSingle()
          );

          if (exist) {
            const { error: errUp } = await this.withRetry(() =>
              this.supabaseService.client
                .from('transacoes')
                .update(item)
                .eq('id', exist.id)
            );
            if (errUp) {
              console.error('[FinancialService] Erro no update de transacao:', item.sigef_id, errUp);
              this.auditService.addFailure({
                stage: 'TRANSACTION_INSERT',
                errorType: 'DATABASE_ERROR',
                contractId,
                ne: item.commitment_id || neValue,
                ob: item.ob_number,
                pp: item.document_number,
                errorMessage: `Falha ao atualizar transação (${item.sigef_id}): ${errUp.message}`,
                details: JSON.stringify(errUp)
              });
            }
          } else {
            const { error: errIn } = await this.withRetry(() =>
              this.supabaseService.client
                .from('transacoes')
                .insert(item)
            );
            if (errIn) {
              console.error('[FinancialService] Erro no insert de transacao:', item.sigef_id, errIn);
              this.auditService.addFailure({
                stage: 'TRANSACTION_INSERT',
                errorType: 'DATABASE_ERROR',
                contractId,
                ne: item.commitment_id || neValue,
                ob: item.ob_number,
                pp: item.document_number,
                errorMessage: `Falha ao inserir transação (${item.sigef_id}): ${errIn.message}`,
                details: JSON.stringify(errIn)
              });
            }
          }
        }

        this.debug.sync(`[${neValue}] gravação OK (${uniquePayload.length} registro(s))`);

        // Coleta os sigef_id que acabaram de ser upsertados para protegê-los do cleanup
        const newSigefIds = new Set(uniquePayload.map(t => t.sigef_id).filter(Boolean));

        const hasNewComRef = transactionsToUpsert.some(
          t => t.type === TransactionType.COMMITMENT || t.type === TransactionType.REINFORCEMENT
        );
        const hasNewLiq = transactionsToUpsert.some(t => t.type === TransactionType.LIQUIDATION);

        try {
          if (hasNewComRef && newSigefIds.size > 0) {
            await this.withRetry(() =>
              this.supabaseService.client
                .from('transacoes')
                .delete()
                .eq('contract_id', contractId)
                .eq('commitment_id', neValue)
                .or('sigef_id.like.cache-mov-%,sigef_id.like.cache-com-%,sigef_id.like.cache-ref-%,sigef_id.like.cache-can-%')
                .not('sigef_id', 'in', `(${[...newSigefIds].map(id => `"${id}"`).join(',')})`)
            );
          }
          if (hasNewLiq && newSigefIds.size > 0) {
            await this.withRetry(() =>
              this.supabaseService.client
                .from('transacoes')
                .delete()
                .eq('contract_id', contractId)
                .eq('commitment_id', neValue)
                .or('sigef_id.like.cache-aggr-%,sigef_id.like.cache-ob-%,sigef_id.like.cache-liq-%')
                .not('sigef_id', 'in', `(${[...newSigefIds].map(id => `"${id}"`).join(',')})`)
            );
          }
        } catch (cleanupErr: any) {
          console.warn(`[${neValue}] Erro na limpeza de registros legados (não crítico):`, cleanupErr.message);
        }

      }
      } catch (err: any) {
        const msg = `NE ${neValue}: ${err.message || 'Erro desconhecido'}`;
        console.error('[FinancialService] Erro ao sincronizar transacoes para contrato:', contractId, msg);
        this.auditService.addFailure({
          stage: 'TRANSACTION_INSERT',
          errorType: 'DATABASE_ERROR',
          contractId,
          ne: neValue,
          errorMessage: msg,
          details: err.stack || err.message
        });
        syncErrors.push(msg);
      }
    }

    if (syncErrors.length > 0) {
      console.warn(`[FinancialService] ${syncErrors.length} erro(s) na sincronização de ${contractBudgets.length} dotações para contrato ${contractId}`);
    }

    await this.updateContractTotals(contractId);

    // Recarregar sinais para refletir totais atualizados
    await this.contractService.loadContracts(undefined, true);
    await this.loadAllTransactions(true);
  }

  async getContractNesPagamentosDetalhados(contractId: string): Promise<NesPagamentoRow[]> {
    const budgetResult = await this.budgetService.getBudgetsByContractId(contractId);
    const budgets = budgetResult.data || [];
    
    // 1. Carregar transações do banco de dados (que já estão devidamente filtradas por UG)
    const { data: dbTrans, error } = await this.supabaseService.client
      .from('transacoes')
      .select('*')
      .eq('contract_id', contractId);

    if (error) {
      console.error('[FinancialService] Erro ao carregar transacoes do banco:', error);
      throw error;
    }

    // 2. Mapeamento de NE para UG do contrato
    const neToUgMap = new Map<string, string>();
    for (const b of budgets) {
      if (b.nunotaempenho && b.unid_gestora) {
        neToUgMap.set(b.nunotaempenho.trim(), b.unid_gestora);
      }
    }

    const fmtDate = (d: any): string => {
      if (!d) return '';
      if (typeof d === 'string') return d.substring(0, 10);
      if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString().split('T')[0];
      return String(d).substring(0, 10);
    };

    // 3. Mapear as transações do banco para o formato de exibição NesPagamentoRow
    const result: NesPagamentoRow[] = (dbTrans || []).map(t => {
      let tipo: 'EMPENHO' | 'REFORCO' | 'ANULACAO' | 'PAGAMENTO' = 'EMPENHO';
      if (t.type === 'COMMITMENT') tipo = 'EMPENHO';
      else if (t.type === 'REINFORCEMENT') tipo = 'REFORCO';
      else if (t.type === 'CANCELLATION') tipo = 'ANULACAO';
      else if (t.type === 'LIQUIDATION') tipo = 'PAGAMENTO';

      const neClean = (t.commitment_id || '').trim();
      let ug = neToUgMap.get(neClean) || budgets[0]?.unid_gestora || '080101';

      return {
        tipo,
        ne: t.commitment_id || '',
        ug,
        ugLabel: t.unidade_gestora_label || getUnidadeLabel(ug),
        dotacao: t.budget_description || t.department || '---',
        pp: t.document_number || undefined,
        obNumber: t.ob_number || undefined,
        obStatus: 'Paga', // Como já foi confirmada na tabela de transações, assumimos 'Paga'
        amount: Math.abs(Number(t.amount) || 0),
        date: fmtDate(t.date)
      };
    });

    // 4. Ordenar por data decrescente e tipo
    return result.sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      const tipoOrder: Record<string, number> = { 'EMPENHO': 0, 'REFORCO': 1, 'PAGAMENTO': 2, 'ANULACAO': 3 };
      return (tipoOrder[a.tipo] ?? 0) - (tipoOrder[b.tipo] ?? 0);
    });
  }

  async updateContractTotals(contractId: string): Promise<void> {
    try {
      const { data: trans } = await this.supabaseService.client
        .from('transacoes')
        .select('type, amount, date, commitment_id')
        .eq('contract_id', contractId);

      // Carregar dotações para mapear commitment_id (NE) -> dotacao_id
      const budgetResult = await this.budgetService.getBudgetsByContractId(contractId);
      const budgets = budgetResult.data || [];
      const neToDotacaoId = new Map<string, string>();
      for (const b of budgets) {
        if (b.nunotaempenho) neToDotacaoId.set(b.nunotaempenho.trim(), b.id);
      }

      let totalEmpenhado = 0;
      let totalPago = 0;
      const dotacaoTotals = new Map<string, { empenhado: number; cancelado: number; pago: number }>();
      const nesSemDotacao = new Set<string>();

      for (const t of trans || []) {
        const amt = Math.abs(Number(t.amount) || 0);
        const dotacaoId = neToDotacaoId.get((t.commitment_id || '').trim()) || undefined;
        if (t.type === 'COMMITMENT' || t.type === 'REINFORCEMENT') {
          totalEmpenhado += amt;
          if (dotacaoId) {
            const curr = dotacaoTotals.get(dotacaoId) || { empenhado: 0, cancelado: 0, pago: 0 };
            curr.empenhado += amt;
            dotacaoTotals.set(dotacaoId, curr);
          } else if (t.commitment_id) {
            nesSemDotacao.add(t.commitment_id.trim());
          }
        } else if (t.type === 'CANCELLATION') {
          totalEmpenhado = Math.max(0, totalEmpenhado - amt);
          if (dotacaoId) {
            const curr = dotacaoTotals.get(dotacaoId) || { empenhado: 0, cancelado: 0, pago: 0 };
            curr.cancelado += amt;
            dotacaoTotals.set(dotacaoId, curr);
          } else if (t.commitment_id) {
            nesSemDotacao.add(t.commitment_id.trim());
          }
        } else if (t.type === 'LIQUIDATION') {
          totalPago += amt;
          if (dotacaoId) {
            const curr = dotacaoTotals.get(dotacaoId) || { empenhado: 0, cancelado: 0, pago: 0 };
            curr.pago += amt;
            dotacaoTotals.set(dotacaoId, curr);
          } else if (t.commitment_id) {
            nesSemDotacao.add(t.commitment_id.trim());
          }
        }
      }

      if (nesSemDotacao.size > 0) {
        console.warn(`[FinancialService] Contrato ${contractId}: ${nesSemDotacao.size} NE(s) sem dotação vinculada: ${[...nesSemDotacao].join(', ')}`);
      }

      const lastPay = (trans || [])
        .filter(t => t.type === 'LIQUIDATION')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

      // Atualizar contratos (saldo_a_pagar é calculado na leitura, não precisa persistir)
      await this.supabaseService.client
        .from('contratos')
        .update({
          total_empenhado: totalEmpenhado,
          total_pago: totalPago,
          data_ultimo_pagamento: lastPay?.date || null
        })
        .eq('id', contractId);

      // Atualizar dotações individuais (consistência com o contrato)
      for (const [dotacaoId, totals] of dotacaoTotals) {
        const empenhadoLiquido = Math.max(0, totals.empenhado - totals.cancelado);
        await this.supabaseService.client
          .from('dotacoes')
          .update({
            total_empenhado: empenhadoLiquido,
            total_cancelado: totals.cancelado,
            total_pago: totals.pago,
          })
          .eq('id', dotacaoId);
      }

      // Verificação de consistência
      const sumDotacaoEmpenho = [...dotacaoTotals.values()].reduce((s, d) => s + Math.max(0, d.empenhado - d.cancelado), 0);
      if (totalEmpenhado !== sumDotacaoEmpenho) {
        console.warn(`[FinancialService] Contrato ${contractId}: divergência total_empenhado (${totalEmpenhado}) vs soma dotações (${sumDotacaoEmpenho})`);
      }

    } catch (err) {
      console.error('[FinancialService] Erro ao atualizar totais do contrato:', contractId, err);
    }
  }
  
  /**
   * Executa a sincronização para todos os contratos que possuem dotações vinculadas.
   * Útil para cargas massivas de dados e replicação global de regras.
   */
  async syncAllSystemContracts(): Promise<void> {
    const budgets = this.budgetService.dotacoes();
    const contractIds = [...new Set(budgets.map(b => b.contract_id).filter(Boolean))] as string[];
    
    console.log(`[FinancialService] Iniciando sincronização global para ${contractIds.length} contratos...`);
    
    for (const contractId of contractIds) {
      await this.syncSigefTransactions(contractId);
    }
    
    console.log('[FinancialService] Sincronização global concluída.');
  }

  /**
   * Rotina de backfill: re-sincroniza todos os contratos a partir do cache local,
   * aplicando as regras de negócio mais recentes (descrição NFS, campos faltantes, etc).
   * 
   * Diferente do syncAllSystemContracts, esta função consulta o banco diretamente
   * para obter todos os contract_ids — não depende do sinal dotacoes() que pode
   * ainda não ter sido populado quando o serviço é inicializado.
   */
  async backfillTransacoes(): Promise<void> {
    this.debug.sync('backfillTransacoes: re-sincronizando todos os contratos...');
    try {
      const { data: contracts } = await this.supabaseService.client
        .from('contratos')
        .select('id');

      if (!contracts || contracts.length === 0) {
        console.log('[FinancialService] Nenhum contrato encontrado para backfill.');
        return;
      }

      const contractIds = contracts.map(c => c.id) as string[];
      console.log(`[FinancialService] Re-sincronizando ${contractIds.length} contratos...`);

      for (const contractId of contractIds) {
        try {
          await this.syncSigefTransactions(contractId);
        } catch (err) {
          console.warn(`[FinancialService] Erro no backfill do contrato ${contractId}:`, err);
        }
      }
    } catch (err) {
      console.error('[FinancialService] Erro ao buscar contratos para backfill:', err);
    }

    // Recarregar contratos e transações na UI após o backfill
    await this.contractService.loadContracts(undefined, true);
    await this.loadAllTransactions();

    console.log('[FinancialService] Backfill concluído.');
  }
}