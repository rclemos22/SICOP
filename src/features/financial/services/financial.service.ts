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
      .select('*')
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
      
      // Load from local cache only (no API calls)
      const sigefTransactions = await this.loadSigefFromCache();
      
      // Combine local transactions with SIGEF transactions
      const allTransactions = [...transactions, ...sigefTransactions];
      
      // Sort by date descending
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
        // Only read from local cache - NO API calls
        const movimentosCache = await this.sigefCacheService.getNeMovimentos(ugNum, neValue);
        const obsCache = await this.sigefCacheService.getOrdensBancariasPorNe(ugNum, neValue);

        // Add movement transactions
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
            id: `sigef-mov-${m.nunotaempenho}-${m.cdevento}-${idx}`,
            contract_id: budget.numero_contrato || '',
            description: description,
            commitment_id: m.nunotaempenho || '',
            date: m.dtlancamento ? new Date(m.dtlancamento) : new Date(),
            type: type,
            amount: Math.abs(Number(m.vlnotaempenho) || 0),
            department: budget.dotacao || '',
            budget_description: budget.dotacao || '',
            nunotaempenho: m.nunotaempenho,
            dotacao_id: budget.id
          });
        });

        // Add OB (payment) transactions
        obsCache.forEach((ob) => {
          transactions.push({
            id: `sigef-ob-${ob.nuordembancaria}-${ob.cdunidadegestora}`,
            contract_id: budget.numero_contrato || '',
            description: `Pagamento - OB ${ob.nuordembancaria}`,
            commitment_id: ob.nunotaempenho || '',
            date: ob.dtpagamento ? new Date(ob.dtpagamento) : (ob.dtlancamento ? new Date(ob.dtlancamento) : new Date()),
            type: TransactionType.LIQUIDATION,
            amount: Math.abs(Number(ob.vltotal) || 0),
            department: budget.dotacao || '',
            budget_description: budget.dotacao || '',
            nunotaempenho: ob.nunotaempenho,
            dotacao_id: budget.id
          });
        });
      } catch (err) {
        console.warn('[FinancialService] Error loading from cache for NE:', neValue, err);
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
    };
  }
}