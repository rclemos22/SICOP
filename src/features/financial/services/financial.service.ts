import { inject, Injectable, signal } from '@angular/core';
import { DebugService } from '../../../core/services/debug.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { SigefCacheService, SigefNeMovimento, SigefOrdemBancaria, SIGEF_PAID_STATUSES } from '../../../core/services/sigef-cache.service';
import { Transaction, TransactionType } from '../../../shared/models/transaction.model';

export interface NesPagamentoRow {
  tipo: 'EMPENHO' | 'ANULACAO' | 'PAGAMENTO';
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
      // 1. Buscar apenas transações vinculadas a contratos cadastrados E que possuem Nota de Empenho (NE)
      const { data, error } = await this.supabaseService.client
        .from('transacoes')
        .select('*, contratos!contract_id!inner(id, contrato)')
        .not('commitment_id', 'is', null)
        .neq('commitment_id', '')
        .order('date', { ascending: false });

      if (error) {
        throw error;
      }

      // 2. Mapear e filtrar dados inválidos
      const transactions = (data || [])
        .filter(raw => {
          // Remover transações sem contrato válido ou com dados essenciais faltando
          if (!raw.contract_id) return false;
          if (!raw.contratos?.contrato) return false;
          if (!raw.date || isNaN(new Date(raw.date).getTime())) return false;
          if (isNaN(Number(raw.amount)) || Number(raw.amount) <= 0) return false;
          return true;
        })
        .map(this.mapRawToTransaction);

      // 3. Ordenar por data decrescente
      transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      if (transactions.length === 0) {
        await this._loadTransactionsFromCache(transactions);
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
  private async _loadTransactionsFromCache(transactions: Transaction[]): Promise<void> {
    try {
      const year = new Date().getFullYear();
      const [movData, obData] = await Promise.all([
        this.supabaseService.client
          .from('sigef_ne_movimentos')
          .select('nunotaempenho, cdevento, vlnotaempenho, dtlancamento'),
        this.supabaseService.client
          .from('sigef_ordens_bancarias')
          .select('nunotaempenho, nuordembancaria, nudocumento, vltotal, dtpagamento, dtlancamento, cdsituacaoordembancaria'),
      ]);

      (movData.data || []).forEach((m: any) => {
        if (!m.vlnotaempenho) return;
        let type = TransactionType.COMMITMENT;
        if (m.cdevento === 400012) type = TransactionType.CANCELLATION;
        else if (m.cdevento === 400011) type = TransactionType.REINFORCEMENT;
        transactions.push({
          id: `cache-mov-${m.nunotaempenho}-${m.cdevento}`,
          contract_id: '', description: `Movimento NE ${m.nunotaempenho}`,
          commitment_id: m.nunotaempenho || '',
          date: m.dtlancamento ? new Date(m.dtlancamento) : new Date(),
          type, amount: Math.abs(Number(m.vlnotaempenho) || 0),
          department: '', budget_description: '',
          contract_number: 'N/A',
        } as Transaction);
      });

      (obData.data || []).forEach((o: any) => {
        if (!o.vltotal) return;
        const obNum = o.nuordembancaria || 'S/N';
        const docNum = o.nudocumento || obNum;
        transactions.push({
          id: `cache-ob-${obNum}-${docNum}`,
          contract_id: '', description: `PAGAMENTO OB ${obNum}`,
          commitment_id: o.nunotaempenho || '',
          date: o.dtpagamento ? new Date(o.dtpagamento) : (o.dtlancamento ? new Date(o.dtlancamento) : new Date()),
          type: TransactionType.LIQUIDATION,
          amount: Math.abs(Number(o.vltotal) || 0),
          department: '', budget_description: '',
          contract_number: 'N/A',
          ob_number: obNum, document_number: docNum,
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

      return (data || []).map(this.mapRawToTransaction);
    } catch (err: any) {
      this.errorHandler.handle(err, 'FinancialService.getTransactionsByContractId');
      throw err;
    }
  }

  private mapRawToTransaction(raw: any): Transaction {
    if (!raw) return {} as Transaction;

    const parsedDate = new Date(raw.date);
    const isValidDate = !isNaN(parsedDate.getTime());

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
      contract_number: raw.contratos?.contrato || 'N/A',
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

    // ── 2. Pré-carrega OBs de TODOS os NEs (enriquecimento; não é fonte de verdade) ──
    const allObs: SigefOrdemBancaria[] = [];
    for (const ne of allContractNes) {
      const obs = await this.sigefCacheService.getOrdensBancariasPorNeGlobal(ne);
      this.debug.sync(`NE ${ne}: ${obs.length} OB(s) no cache`);
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
        const movimentosCache = await this.sigefCacheService.getNeMovimentos(ugNum, neValue);

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
        // A. COMMITMENT (Empenho) — dos movimentos do cache
        // ═══════════════════════════════════════════
        const empenhoMovs = movimentosCache.filter(m => m.cdevento === 400010 || m.cdevento === 400011);
        const totalEmpenhadoMov = empenhoMovs.reduce((s, m) => s + Math.abs(Number(m.vlnotaempenho) || 0), 0);
        if (totalEmpenhadoMov > 0) {
          const primaryMov = empenhoMovs.find(m => m.cdevento === 400010) || empenhoMovs[0];
          transactionsToUpsert.push({
            contract_id: contractId,
            sigef_id: `cache-mov-com-${neValue}`,
            description: `Empenho - NE Ref ${neValue}`,
            commitment_id: neValue,
            date: fmtDate(primaryMov?.dtlancamento || budget.data_disponibilidade),
            type: TransactionType.COMMITMENT,
            amount: totalEmpenhadoMov,
            department: budget.dotacao,
            budget_description: budget.dotacao,
            unidade_gestora_label: getUnidadeLabel(ug),
            document_number: neValue,
            ob_number: 'N/A'
          });
        }

        // ═══════════════════════════════════════════
        // B. CANCELLATION (Anulação) — dos movimentos do cache
        // ═══════════════════════════════════════════
        const cancelMovs = movimentosCache.filter(m => m.cdevento === 400012);
        const totalCanceladoMov = cancelMovs.reduce((s, m) => s + Math.abs(Number(m.vlnotaempenho) || 0), 0);
        if (totalCanceladoMov > 0) {
          const cancelMov = cancelMovs[0];
          transactionsToUpsert.push({
            contract_id: contractId,
            sigef_id: `cache-mov-can-${neValue}`,
            description: `Anulação de Empenho - NE Ref ${neValue}`,
            commitment_id: neValue,
            date: fmtDate(cancelMov?.dtlancamento || budget.data_disponibilidade),
            type: TransactionType.CANCELLATION,
            amount: totalCanceladoMov,
            department: budget.dotacao,
            budget_description: budget.dotacao,
            unidade_gestora_label: getUnidadeLabel(ug),
            document_number: neValue,
            ob_number: 'N/A'
          });
        }

        // ═══════════════════════════════════════════
        // C. LIQUIDATION(s) (Pagamento) — das OBs do cache
        // ═══════════════════════════════════════════
        const budgetPaidObs = allObs.filter(ob => {
          const obNe = (ob.nunotaempenho || '').trim().toUpperCase();
          const situacao = ob.cdsituacaoordembancaria?.toLowerCase() || '';
          return obNe === neValue && SIGEF_PAID_STATUSES.some(s => situacao.includes(s));
        });

        if (budgetPaidObs.length > 0) {
          const groupedObs = new Map<string, SigefOrdemBancaria[]>();
          budgetPaidObs.forEach(ob => {
            const docKey = ob.nudocumento || ob.nuordembancaria || `unknown_${ob.id}`;
            const key = `${neValue}-${docKey}`;
            const list = groupedObs.get(key) || [];
            list.push(ob);
            groupedObs.set(key, list);
          });

          for (const [, group] of groupedObs) {
            const totalAmount = group.reduce((s, o) => s + Math.abs(Number(o.vltotal) || 0), 0);

            const validDates = group.map(o => o.dtpagamento || o.dtlancamento).filter(Boolean).sort().reverse();
            const maxDate = validDates[0] || '';

            const allDocs = [...new Set(group.map(o => o.nudocumento).filter(Boolean))].join(', ');
            const allObsStr = [...new Set(group.map(o => o.nuordembancaria).filter(Boolean))].join(', ');
            const ppDoc = group[0].nudocumento || group[0].nuordembancaria || 'UNKNOWN';
            const sigefId = `cache-aggr-${neValue}-${ppDoc}`;

            let linkedParcela: string | null = null;
            if (group[0].nudocumento && docToParcelaMap.has(group[0].nudocumento)) {
              linkedParcela = docToParcelaMap.get(group[0].nudocumento)!;
            }

            transactionsToUpsert.push({
              contract_id: contractId,
              sigef_id: sigefId,
              description: `PAGAMENTO (PP ${ppDoc}) - OBs: ${allObsStr}`.toUpperCase(),
              commitment_id: neValue,
              date: maxDate || fmtDate(budget.data_disponibilidade),
              type: TransactionType.LIQUIDATION,
              amount: totalAmount,
              department: budget.dotacao,
              budget_description: budget.dotacao,
              unidade_gestora_label: getUnidadeLabel(ug),
              document_number: allDocs,
              ob_number: allObsStr,
              payment_month: maxDate ? maxDate.substring(0, 7) : undefined,
              parcela_pago_em: group[0].dtpagamento || null,
              ...(linkedParcela ? { parcela_referencia: linkedParcela } : {})
            });
          }
        }

        // ═══════════════════════════════════════════
        // D. Limpeza de registros antigos + Upsert
        // ═══════════════════════════════════════════

        // Deleta transações legadas do cache para esta NE (serão substituídas)
        if (transactionsToUpsert.length > 0) {
          await this.supabaseService.client
            .from('transacoes')
            .delete()
            .eq('contract_id', contractId)
            .eq('commitment_id', neValue)
            .like('sigef_id', 'cache-%');

          const { error } = await this.supabaseService.client
            .from('transacoes')
            .upsert(transactionsToUpsert, { onConflict: 'sigef_id' });
          if (error) throw error;
          this.debug.sync(`[${neValue}] upsert OK (${transactionsToUpsert.length} registro(s))`);

          // Atualiza a dotação com totais calculados (alimenta vw_saldo_dotacoes e o SQL trigger)
          const totalCom = transactionsToUpsert
            .filter(t => t.type === TransactionType.COMMITMENT || t.type === TransactionType.REINFORCEMENT)
            .reduce((s: number, t: any) => s + (t.amount || 0), 0);
          const totalCan = transactionsToUpsert
            .filter(t => t.type === TransactionType.CANCELLATION)
            .reduce((s: number, t: any) => s + (t.amount || 0), 0);
          const totalPag = transactionsToUpsert
            .filter(t => t.type === TransactionType.LIQUIDATION)
            .reduce((s: number, t: any) => s + (t.amount || 0), 0);

          await this.supabaseService.client
            .from('dotacoes')
            .update({
              total_empenhado: totalCom,
              total_cancelado: totalCan,
              total_pago: totalPag,
              saldo_disponivel: Math.max(0, (budget.valor_dotacao || 0) - totalCom + totalCan)
            })
            .eq('id', budget.id);
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
  }

  async getContractNesPagamentosDetalhados(contractId: string): Promise<NesPagamentoRow[]> {
    const budgetResult = await this.budgetService.getBudgetsByContractId(contractId);
    const budgets = budgetResult.data || [];
    const result: NesPagamentoRow[] = [];

    const allNes = [...new Set(
      budgets.map(b => b.nunotaempenho?.trim()).filter(Boolean) as string[]
    )];

    // Pré-carrega OBs e movimentos de todos os NEs
    const allObs: SigefOrdemBancaria[] = [];
    const neMovimentosMap = new Map<string, SigefNeMovimento[]>();
    for (const ne of allNes) {
      const obs = await this.sigefCacheService.getOrdensBancariasPorNeGlobal(ne);
      allObs.push(...obs);
    }
    for (const budget of budgets) {
      if (!budget.nunotaempenho) continue;
      const ne = budget.nunotaempenho.trim();
      if (!neMovimentosMap.has(ne)) {
        const ugNum = parseInt(budget.unid_gestora || '080101', 10);
        const movs = await this.sigefCacheService.getNeMovimentos(ugNum, ne);
        neMovimentosMap.set(ne, movs);
      }
    }

    const fmtDate = (d: any): string => {
      if (!d) return '';
      if (typeof d === 'string') return d.substring(0, 10);
      if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString().split('T')[0];
      return String(d).substring(0, 10);
    };

    for (const budget of budgets) {
      if (!budget.nunotaempenho) continue;
      const ne = budget.nunotaempenho.trim();
      const ug = budget.unid_gestora || '080101';
      const ugLabel = getUnidadeLabel(ug);
      const movimentos = neMovimentosMap.get(ne) || [];

      // EMPENHO — dos movimentos (400010=inicial, 400011=reforço)
      const empenhoMovs = movimentos.filter(m => m.cdevento === 400010 || m.cdevento === 400011);
      const totalEmpenhado = empenhoMovs.reduce((s, m) => s + Math.abs(Number(m.vlnotaempenho) || 0), 0);
      if (totalEmpenhado > 0) {
        const primaryMov = empenhoMovs.find(m => m.cdevento === 400010) || empenhoMovs[0];
        result.push({
          tipo: 'EMPENHO', ne, ug, ugLabel,
          dotacao: budget.dotacao,
          amount: totalEmpenhado,
          date: fmtDate(primaryMov?.dtlancamento || budget.data_disponibilidade),
        });
      }

      // ANULAÇÃO — dos movimentos (400012)
      const cancelMovs = movimentos.filter(m => m.cdevento === 400012);
      const totalCancelado = cancelMovs.reduce((s, m) => s + Math.abs(Number(m.vlnotaempenho) || 0), 0);
      if (totalCancelado > 0) {
        const cancelMov = cancelMovs[0];
        result.push({
          tipo: 'ANULACAO', ne, ug, ugLabel,
          dotacao: budget.dotacao,
          amount: totalCancelado,
          date: fmtDate(cancelMov?.dtlancamento || budget.data_disponibilidade),
        });
      }

      // PAGAMENTOS — das OBs do cache
      const paidObs = allObs.filter(ob => {
        const obNe = (ob.nunotaempenho || '').trim().toUpperCase();
        const situacao = ob.cdsituacaoordembancaria?.toLowerCase() || '';
        return obNe === ne && SIGEF_PAID_STATUSES.some(s => situacao.includes(s));
      });

      if (paidObs.length > 0) {
        for (const ob of paidObs) {
          result.push({
            tipo: 'PAGAMENTO', ne, ug, ugLabel,
            dotacao: budget.dotacao,
            pp: ob.nudocumento,
            obNumber: ob.nuordembancaria,
            obStatus: ob.cdsituacaoordembancaria,
            amount: Math.abs(Number(ob.vltotal) || 0),
            date: ob.dtpagamento || ob.dtlancamento || fmtDate(budget.data_disponibilidade),
          });
        }
      }
    }

    return result.sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      const tipoOrder: Record<string, number> = { 'EMPENHO': 0, 'PAGAMENTO': 1, 'ANULACAO': 2 };
      return (tipoOrder[a.tipo] ?? 0) - (tipoOrder[b.tipo] ?? 0);
    });
  }

  private async updateContractTotals(contractId: string): Promise<void> {
    try {
      // Lê da tabela transacoes (fonte de verdade para os lançamentos)
      const { data: trans } = await this.supabaseService.client
        .from('transacoes')
        .select('type, amount, date')
        .eq('contract_id', contractId);

      let totalEmpenhado = 0;
      let totalPago = 0;

      for (const t of trans || []) {
        const amt = Math.abs(Number(t.amount) || 0);
        if (t.type === 'COMMITMENT' || t.type === 'REINFORCEMENT') {
          totalEmpenhado += amt;
        } else if (t.type === 'CANCELLATION') {
          totalEmpenhado = Math.max(0, totalEmpenhado - amt);
        } else if (t.type === 'LIQUIDATION') {
          totalPago += amt;
        }
      }

      const saldoAPagar = Math.max(0, totalEmpenhado - totalPago);

      const lastPay = (trans || [])
        .filter(t => t.type === 'LIQUIDATION')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

      await this.supabaseService.client
        .from('contratos')
        .update({
          total_empenhado: totalEmpenhado,
          total_pago: totalPago,
          saldo_a_pagar: saldoAPagar,
          data_ultimo_pagamento: lastPay?.date || null
        })
        .eq('id', contractId);

      this.contractService.loadContracts();
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

    // Recarregar transações na UI após o backfill
    await this.loadAllTransactions();

    console.log('[FinancialService] Backfill concluído.');
  }
}