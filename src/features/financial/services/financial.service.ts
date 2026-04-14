import { inject, Injectable, signal } from '@angular/core';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { SigefCacheService } from '../../../core/services/sigef-cache.service';
import { Transaction, TransactionType } from '../../../shared/models/transaction.model';
import { BudgetService } from '../../budget/services/budget.service';

@Injectable({
  providedIn: 'root'
})
export class FinancialService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);
  private sigefCacheService = inject(SigefCacheService);
  private budgetService = inject(BudgetService);

  private _transactions = signal<Transaction[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  public transactions = this._transactions.asReadonly();
  public loading = this._loading.asReadonly();
  public error = this._error.asReadonly();

  constructor() {
    this.loadAllTransactions();
  }

  private async fetchFromProvider() {
    return this.supabaseService.client
      .from('transacoes')
      .select('*, contratos(contrato, tipo)')
      .order('date', { ascending: false });
  }

  async loadAllTransactions(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const { data, error } = await this.fetchFromProvider();

      if (error) {
        throw error;
      }

      const transactions = (data || []).map(this.mapRawToTransaction);
      
      // Carregar do cache local (sem chamadas de API externas)
      const sigefTransactions = await this.loadSigefFromCache();
      
      // Filtrar transações do SIGEF que já foram persistidas no banco local
      // Evita duplicidade quando o usuário vincula uma OB e ela passa a existir no banco e no cache
      const persistedSigefIds = new Set(transactions.filter(t => t.sigef_id).map(t => t.sigef_id));
      const newSigefTransactions = sigefTransactions.filter(st => !persistedSigefIds.has(st.id));
      
      // Combinar transações locais com as do SIGEF (que ainda não foram persistidas)
      const allTransactions = [...transactions, ...newSigefTransactions];
      
      // Ordenar por data decrescente
      allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      this._transactions.set(allTransactions);
    } catch (err: any) {
      this.errorHandler.handle(err, 'FinancialService.loadAllTransactions');
      this._error.set(err.message || 'Erro desconhecido');
    } finally {
      this._loading.set(false);
    }
  }

  private async loadSigefFromCache(): Promise<Transaction[]> {
    const transactions: Transaction[] = [];
    // Acessa o signal de dotações do BudgetService
    const budgets = this.budgetService.dotacoes();
    
    const EVENTO_LABELS: Record<number, string> = {
      400010: 'Empenho Inicial',
      400011: 'Reforço de Empenho',
      400012: 'Anulação de Empenho'
    };

    for (const budget of budgets) {
      if (!budget.nunotaempenho) continue;

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
            contract_number: budget.numero_contrato,
            contract_type: budget.contract_type
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
            contract_type: budget.contract_type,
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
      contract_type: raw.contratos?.tipo,
      document_number: raw.document_number,
      ob_number: raw.ob_number
    };
  }

  /**
   * Sincroniza e persiste transações do SIGEF no banco de dados para um contrato específico.
   * Transforma registros do cache (OBs e Movimentos) em transações permanentes.
   */
  async syncSigefTransactions(contractId: string): Promise<void> {
    // Busca dotações diretamente (ignora filtros de ano do contexto)
    const budgetResult = await this.budgetService.getBudgetsByContractId(contractId);
    const contractBudgets = budgetResult.data || [];
    
    if (contractBudgets.length === 0) return;

    for (const budget of contractBudgets) {
      if (!budget.nunotaempenho) continue;

      const neValue = budget.nunotaempenho.trim();
      const ug = budget.unid_gestora || '080101';
      const ugNum = parseInt(ug, 10);

      try {
        const obsCache = await this.sigefCacheService.getOrdensBancariasPorNe(ugNum, neValue);
        const movimentosCache = await this.sigefCacheService.getNeMovimentos(ugNum, neValue);

        const EVENTO_LABELS: Record<number, string> = {
          400010: 'Empenho Inicial',
          400011: 'Reforço de Empenho',
          400012: 'Anulação de Empenho'
        };

        const transactionsToUpsert: any[] = [];
        const oldSigefIdsToDelete = new Set<string>();

        // 1. Processar e Aglomerar Movimentos de Empenho (COMMITMENTS)
        movimentosCache.forEach((m, idx) => {
          let type = TransactionType.COMMITMENT;
          let description = EVENTO_LABELS[m.cdevento] || 'Movimento de Empenho';

          if (m.cdevento === 400012) {
            type = TransactionType.CANCELLATION;
          } else if (m.cdevento === 400011) {
            type = TransactionType.REINFORCEMENT;
          }

          transactionsToUpsert.push({
            contract_id: contractId,
            sigef_id: `cache-mov-${neValue}-${m.cdevento}-${idx}`,
            description: `${description} - NE ${neValue}`,
            commitment_id: neValue,
            date: m.dtlancamento || new Date().toISOString().split('T')[0],
            type: type,
            amount: Math.abs(Number(m.vlnotaempenho) || 0),
            department: budget.dotacao,
            budget_description: budget.dotacao,
            document_number: neValue,
            ob_number: 'N/A',
            unidade_gestora_label: budget.unid_gestora || ug
          });
        });

        // 2. Agrupar OBs da mesma NE por 'deobservacao' para unificar Pagamento Líquido e Impostos
        const groupedObs = new Map<string, typeof obsCache>();
        obsCache.forEach(ob => {
          const key = ob.deobservacao || ob.nudocumento || `unknown_${ob.id}`;
          const list = groupedObs.get(key) || [];
          list.push(ob);
          groupedObs.set(key, list);
        });

        // Buscar transações de liquidação no banco para resgatar vínculos manuais de 'parcela_referencia' 
        const { data: dbTrans } = await this.supabaseService.client
          .from('transacoes')
          .select('sigef_id, parcela_referencia, document_number')
          .eq('contract_id', contractId)
          .eq('commitment_id', neValue)
          .in('type', ['LIQUIDATION']);

        const existingMap = new Map((dbTrans || []).map(t => [t.sigef_id, t]));
        const docToParcelaMap = new Map((dbTrans || [])
          .filter(t => t.parcela_referencia)
          .map(t => [t.document_number, t.parcela_referencia])
        );

        for (const [groupKey, groupObs] of groupedObs.entries()) {
          groupObs.sort((a, b) => (a.nudocumento || '').localeCompare(b.nudocumento || ''));
          
          const totalAmount = groupObs.reduce((sum, o) => sum + Math.abs(Number(o.vltotal) || 0), 0);
          const allDocs = [...new Set(groupObs.map(o => o.nudocumento).filter(Boolean))].join(', ');
          const allObs = [...new Set(groupObs.map(o => o.nuordembancaria).filter(Boolean))].join(', ');
          
          const paymentMonth = groupObs[0].dtpagamento ? groupObs[0].dtpagamento.substring(0, 7) : (groupObs[0].dtlancamento ? groupObs[0].dtlancamento.substring(0, 7) : undefined);
          const maxDate = groupObs.map(o => o.dtpagamento || o.dtlancamento || '').sort().reverse()[0] || new Date().toISOString().split('T')[0];

          // Formular o novo ID consolidado baseado na NE e no primeiro documento (agregador)
          const firstDoc = groupObs[0].nudocumento || groupObs[0].nuordembancaria || 'UNKNOWN';
          const sigefId = `cache-aggr-${neValue}-${firstDoc}`;

          // Migrar vinculação pregressa se ela existia nas partições individuais
          let linkedParcela = null;
          if (existingMap.has(sigefId) && existingMap.get(sigefId)?.parcela_referencia) {
             linkedParcela = existingMap.get(sigefId)?.parcela_referencia;
          } else {
             for (const ob of groupObs) {
               if (ob.nudocumento && docToParcelaMap.has(ob.nudocumento)) {
                 linkedParcela = docToParcelaMap.get(ob.nudocumento);
                 break;
               }
             }
          }

          // Montar descrição amigável.
          const description = groupObs.length > 1 
            ? (`PAGAMENTO (NFs) - OBs: ${allObs} | DOCs: ${allDocs}`).toUpperCase()
            : (`PAGAMENTO OB ${allObs} - DOC ${allDocs}`).toUpperCase();

          transactionsToUpsert.push({
            contract_id: contractId,
            sigef_id: sigefId,
            description,
            commitment_id: neValue,
            date: maxDate,
            type: TransactionType.LIQUIDATION,
            amount: totalAmount,
            department: budget.dotacao,
            budget_description: budget.dotacao,
            document_number: allDocs,
            ob_number: allObs,
            payment_month: paymentMonth,
            unidade_gestora_label: budget.unid_gestora || ug,
            ...(linkedParcela ? { parcela_referencia: linkedParcela } : {})
          });

          // Enfileirar as antigas instâncias descentralizadas para limpeza
          groupObs.forEach(ob => {
            const obNumero = ob.nuordembancaria || 'S/N';
            const docNumero = ob.nudocumento || obNumero;
            const singleId = `cache-ob-${obNumero}-${docNumero}`;
            // Remove o antigo e também remove se for igual ao novo id, exceto que o novo ID começa com 'aggr' então nunca vai ser igual
            oldSigefIdsToDelete.add(singleId);
          });
        }

        // Limpar transações legadas parciais (Ex: exclusões de impostos que foram fundidos)
        if (oldSigefIdsToDelete.size > 0) {
          const idsToDelete = Array.from(oldSigefIdsToDelete);
          await this.supabaseService.client
            .from('transacoes')
            .delete()
            .in('sigef_id', idsToDelete);
        }

        // Fazer Upsert da carga super-agregada
        if (transactionsToUpsert.length > 0) {
          const { error } = await this.supabaseService.client
            .from('transacoes')
            .upsert(transactionsToUpsert, { onConflict: 'sigef_id' });

          if (error) throw error;
        }
      } catch (err) {
        console.error('[FinancialService] Erro ao sincronizar transações para contrato:', contractId, err);
      }
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
}