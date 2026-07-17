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
import { getUnidadeLabel } from '../../../shared/models/budget.model';
import { BudgetService } from '../../budget/services/budget.service';
import { ContractService } from '../../contracts/services/contract.service';

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

  private _transactions = signal<Transaction[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _backfillDone = false;

  public transactions = this._transactions.asReadonly();
  public loading = this._loading.asReadonly();
  public error = this._error.asReadonly();

  constructor() {
    this.loadAllTransactions();
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

      (movData.data || []).forEach((m: any) => {
        const rd = m.raw_data || {};
        const vl = rd.vlnotaempenho;
        if (!vl) return;
        let type = TransactionType.COMMITMENT;
        if (rd.cdevento === 400012) type = TransactionType.CANCELLATION;
        else if (rd.cdevento === 400011) type = TransactionType.REINFORCEMENT;
        const ne = m.nunotaempenho || '';
        const amount = Math.abs(Number(vl) || 0);
        const dedupKey = `${ne}|${type}|${ne}|${amount}`;
        if (existingKeys?.has(dedupKey)) return;
        existingKeys?.add(dedupKey);

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
      400012: 'Anulação de Empenho'
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
      payment_month: raw.payment_month,
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
      const obs = await this.sigefCacheService.getOrdensBancariasPorNe(ugNum, ne);
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
        // A1. COMMITMENT (Empenho Original 400010)
        // ═══════════════════════════════════════════
        const originalMovs = movimentosCache.filter(m => m.cdevento === 400010);
        for (const mov of originalMovs) {
          const vl = Math.abs(Number(mov.vlnotaempenho) || 0);
          if (vl > 0) {
            transactionsToUpsert.push({
              contract_id: contractId,
              sigef_id: `cache-com-${neValue}`,
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
          return obNe === neValue && parseInt(String(obUg), 10) === ugNum && SIGEF_PAID_STATUSES.some(s => situacao.includes(s));
        });

        for (const ob of budgetPaidObs) {
          const vl = Math.abs(Number(ob.vltotal) || 0);
          if (vl === 0) continue;
          const obNum = ob.nuordembancaria || `unknown_${ob.id}`;
          const ppDoc = ob.nudocumento || '';
          const pagDate = ob.dtpagamento || ob.dtlancamento || '';

          let linkedParcela: string | null = null;
          if (ob.nudocumento && docToParcelaMap.has(ob.nudocumento)) {
            linkedParcela = docToParcelaMap.get(ob.nudocumento)!;
          }

          transactionsToUpsert.push({
            contract_id: contractId,
            sigef_id: `cache-liq-${obNum}`,
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
            payment_month: pagDate ? pagDate.substring(0, 7) : undefined,
            parcela_pago_em: ob.dtpagamento || null,
            ...(linkedParcela ? { parcela_referencia: linkedParcela } : {})
          });
        }

        // ═══════════════════════════════════════════
        // D. Upsert + Limpeza de registros legados
        // ═══════════════════════════════════════════

        if (transactionsToUpsert.length > 0) {
          const { error } = await this.supabaseService.client
            .from('transacoes')
            .upsert(transactionsToUpsert, { onConflict: 'sigef_id' });
          if (error) throw error;
          this.debug.sync(`[${neValue}] upsert OK (${transactionsToUpsert.length} registro(s))`);

          // Limpa formatos legados APENAS se houver registros NOVOS do mesmo tipo
          // para substituí-los. Caso contrário, preserva os existentes.
          const hasNewComRef = transactionsToUpsert.some(
            t => t.type === TransactionType.COMMITMENT || t.type === TransactionType.REINFORCEMENT
          );
          const hasNewLiq = transactionsToUpsert.some(t => t.type === TransactionType.LIQUIDATION);

          if (hasNewComRef) {
            await this.supabaseService.client
              .from('transacoes')
              .delete()
              .eq('contract_id', contractId)
              .eq('commitment_id', neValue)
              .like('sigef_id', 'cache-mov-%');
          }
          if (hasNewLiq) {
            await this.supabaseService.client
              .from('transacoes')
              .delete()
              .eq('contract_id', contractId)
              .eq('commitment_id', neValue)
              .or('sigef_id.like.cache-aggr-%,sigef_id.like.cache-ob-%');
          }

        }
      } catch (err: any) {
        const msg = `NE ${neValue}: ${err.message || 'Erro desconhecido'}`;
        console.error('[FinancialService] Erro ao sincronizar transacoes para contrato:', contractId, msg);
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

      for (const t of trans || []) {
        const amt = Math.abs(Number(t.amount) || 0);
        const dotacaoId = neToDotacaoId.get((t.commitment_id || '').trim()) || undefined;
        if (t.type === 'COMMITMENT' || t.type === 'REINFORCEMENT') {
          totalEmpenhado += amt;
          if (dotacaoId) {
            const curr = dotacaoTotals.get(dotacaoId) || { empenhado: 0, cancelado: 0, pago: 0 };
            curr.empenhado += amt;
            dotacaoTotals.set(dotacaoId, curr);
          }
        } else if (t.type === 'CANCELLATION') {
          totalEmpenhado = Math.max(0, totalEmpenhado - amt);
          if (dotacaoId) {
            const curr = dotacaoTotals.get(dotacaoId) || { empenhado: 0, cancelado: 0, pago: 0 };
            curr.cancelado += amt;
            dotacaoTotals.set(dotacaoId, curr);
          }
        } else if (t.type === 'LIQUIDATION') {
          totalPago += amt;
          if (dotacaoId) {
            const curr = dotacaoTotals.get(dotacaoId) || { empenhado: 0, cancelado: 0, pago: 0 };
            curr.pago += amt;
            dotacaoTotals.set(dotacaoId, curr);
          }
        }
      }

      const saldoAPagar = Math.max(0, totalEmpenhado - totalPago);

      const lastPay = (trans || [])
        .filter(t => t.type === 'LIQUIDATION')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

      // Atualizar contratos
      await this.supabaseService.client
        .from('contratos')
        .update({
          total_empenhado: totalEmpenhado,
          total_pago: totalPago,
          saldo_a_pagar: saldoAPagar,
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