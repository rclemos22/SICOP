import { inject, Injectable, signal, computed } from '@angular/core';
import { ContractStatus, Contract } from '../../../shared/models/contract.model';
import { Transaction, TransactionType } from '../../../shared/models/transaction.model';
import { BudgetService } from '../../budget/services/budget.service';
import { ContractService } from '../../contracts/services/contract.service';
import { FinancialService } from '../../financial/services/financial.service';
import { AppContextService } from '../../../core/services/app-context.service';
import { SigefSyncService } from '../../../core/services/sigef-sync.service';
import { SupabaseService } from '../../../core/services/supabase.service';

export interface OverdueAlert {
  contractId: string;
  contractName: string;
  supplier: string;
  reference: string;
  monthLabel: string;
  dueDate: Date;
  amount: number;
}

export interface LowBudgetAlert {
  contractId: string;
  contractNumber: string;
  dotacao: string;
  nunotaempenho: string;
  totalEmpenhado: number;
  saldoEmpenho: number;
  valorMensal: number;
  percentage: number;
}

export interface ContractStatusData {
  vigentes: number;
  finalizando: number;
  rescindidos: number;
  encerrados: number;
  total: number;
}

export interface MonthlyPayment {
  month: string;
  total: number;
}

export interface PaymentComparisonMonth {
  month: string;
  expected: number;
  paid: number;
}

export interface PaymentComparisonContract {
  contract: string;
  contratada: string;
  expected: number;
  paid: number;
  diff: number;
}

export interface ExpensesByType {
  materialCount: number;
  serviceCount: number;
  materialPlanejado: number;
  servicePlanejado: number;
  materialPago: number;
  servicePago: number;
  materialPercent: number;
  servicePercent: number;
  totalCount: number;
}

export interface BudgetMetrics {
  totalBudget: number;
  totalUsed: number;
  available: number;
  percentageUsed: number;
}

export interface RecentPayment {
  id: string;
  contrato: string;
  contratada: string;
  nuordembancaria: string;
  data_pagamento: string;
  vltotal: number;
  situacao: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private contractService = inject(ContractService);
  private budgetService = inject(BudgetService);
  private financialService = inject(FinancialService);
  private appContext = inject(AppContextService);
  private sigefSync = inject(SigefSyncService);
  private supabaseService = inject(SupabaseService);

  // ── Signals ────────────────────────────────────────────────────────────

  readonly lastSyncTimestamp = signal<Date | null>(null);
  readonly recentPaymentsList = signal<RecentPayment[]>([]);

  /** Totais agregados do cache SIGEF (fallback quando contratos ainda não foram sincronizados) */
  private _cacheTotals = signal<{ totalEmpenhado: number; totalPago: number }>({ totalEmpenhado: 0, totalPago: 0 });

  // ── Loading & Error ────────────────────────────────────────────────────

  private _isFirstLoad = true;

  /** Exibe loading apenas na primeira carga. Refreshes silenciosos não piscam a tela. */
  readonly isLoading = computed(() => this._isFirstLoad && (this.contractService.loading() || this.budgetService.loading()));

  readonly hasError = computed(() => this.contractService.error() || this.budgetService.error());

  // ── Sync Status ────────────────────────────────────────────────────────

  readonly syncProgress = computed(() => this.sigefSync.progress());
  readonly isSyncing = computed(() => this.sigefSync.isSyncing());

  // ── Helpers ────────────────────────────────────────────────────────────

  private isFromCurrentBudget(t: Transaction, year: number): boolean {
    return t.commitment_id
      ? t.commitment_id.startsWith(year.toString())
      : new Date(t.date).getFullYear() === year;
  }

  private monthLabel(m: number): string {
    const labels = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return labels[m - 1] || '';
  }

  private pagamentoEmAtraso(
    c: Contract,
    year: number,
    month: number,
    reference: string
  ): boolean {
    if (!c.valor_mensal || !c.data_pagamento || !c.data_inicio) return false;
    const paymentDay = Number(c.data_pagamento);
    const dueMonth = month + 1;
    const dueYear = dueMonth > 12 ? year + 1 : year;
    const dueAdjusted = dueMonth > 12 ? 1 : dueMonth;
    const lastDay = new Date(dueYear, dueAdjusted - 1, 0).getDate();
    const actualDay = Math.min(paymentDay, lastDay);
    const installmentDate = new Date(dueYear, dueAdjusted - 1, actualDay);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return installmentDate < today;
  }

  // ── Computed: Contracts filtered by selected year ──────────────────────

  readonly filteredContracts = computed(() => {
    const year = this.appContext.anoExercicio();
    const transactions = this.financialService.transactions();
    const inicioAno = new Date(year, 0, 1);
    const fimAno = new Date(year, 11, 31);

    const paidThisYear = new Set(
      transactions
        .filter(t => this.isFromCurrentBudget(t, year) && t.type === TransactionType.LIQUIDATION)
        .map(t => t.contract_id)
    );

    return this.contractService.contracts().filter(c => {
      const start = c.data_inicio;
      const end = c.data_fim_efetiva || c.data_fim;
      return (start <= fimAno && end >= inicioAno) || paidThisYear.has(c.id);
    });
  });

  readonly activeContractsCount = computed(() =>
    this.filteredContracts().filter(c => c.status === ContractStatus.VIGENTE).length
  );

  // ── Contract Status Distribution ───────────────────────────────────────

  readonly contractsByStatus = computed<ContractStatusData>(() => {
    const contracts = this.filteredContracts();
    return {
      vigentes: contracts.filter(c => c.status_efetivo === ContractStatus.VIGENTE).length,
      finalizando: contracts.filter(c => c.status_efetivo === ContractStatus.FINALIZANDO).length,
      rescindidos: contracts.filter(c => c.status_efetivo === ContractStatus.RESCINDIDO).length,
      encerrados: contracts.filter(c => c.status_efetivo === ContractStatus.ENCERRADO).length,
      total: contracts.length,
    };
  });

  // ── Monthly Execution (last 12 months) ─────────────────────────────────

  readonly monthlyExecution = computed<MonthlyPayment[]>(() => {
    const transactions = this.financialService.transactions();
    const monthly: Record<string, number> = {};

    transactions.forEach(t => {
      if (t.type !== TransactionType.LIQUIDATION) return;
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthly[key] = (monthly[key] || 0) + t.amount;
    });

    return Object.keys(monthly).sort().slice(-12).map(month => ({
      month,
      total: monthly[month],
    }));
  });

  // ── Payment Comparison: Expected vs Paid by Month ──────────────────────

  readonly paymentComparisonByMonth = computed<PaymentComparisonMonth[]>(() => {
    const year = this.appContext.anoExercicio();
    const contracts = this.filteredContracts();
    const transactions = this.financialService.transactions();
    const monthly: Record<string, { expected: number; paid: number }> = {};

    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      monthly[key] = { expected: 0, paid: 0 };
    }

    contracts.forEach(c => {
      if (!c.valor_mensal || !c.data_inicio) return;
      const start = new Date(c.data_inicio);
      const end = c.data_fim_efetiva ? new Date(c.data_fim_efetiva) : new Date(c.data_fim);
      const cur = new Date(start);
      cur.setDate(1);
      while (cur <= end && cur.getFullYear() <= year) {
        if (cur.getFullYear() === year) {
          const key = `${year}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
          if (monthly[key]) monthly[key].expected += c.valor_mensal;
        }
        cur.setMonth(cur.getMonth() + 1);
      }
    });

    transactions.forEach(t => {
      if (t.type !== TransactionType.LIQUIDATION) return;
      const d = new Date(t.date);
      if (d.getFullYear() === year) {
        const key = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthly[key]) monthly[key].paid += t.amount;
      }
    });

    return Object.keys(monthly).sort().map(m => ({ month: m, ...monthly[m] }));
  });

  // ── Payment Comparison: Expected vs Paid by Contract ───────────────────

  readonly paymentComparisonByContract = computed<PaymentComparisonContract[]>(() => {
    const year = this.appContext.anoExercicio();
    const contracts = this.filteredContracts();
    const transactions = this.financialService.transactions();

    return contracts
      .map(c => {
        let expected = 0;
        if (c.valor_mensal && c.data_inicio) {
          const start = new Date(c.data_inicio);
          const end = c.data_fim_efetiva ? new Date(c.data_fim_efetiva) : new Date(c.data_fim);
          const cur = new Date(start);
          cur.setDate(1);
          while (cur <= end && cur.getFullYear() <= year) {
            if (cur.getFullYear() === year) expected += c.valor_mensal;
            cur.setMonth(cur.getMonth() + 1);
          }
        }
        const paid = transactions
          .filter(t => t.contract_id === c.id && t.type === TransactionType.LIQUIDATION)
          .filter(t => this.isFromCurrentBudget(t, year))
          .reduce((s, t) => s + t.amount, 0);
        return { contract: c.contrato, contratada: c.contratada, expected, paid, diff: expected - paid };
      })
      .filter(d => d.expected > 0 || d.paid > 0)
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 10);
  });

  // ── Totals ─────────────────────────────────────────────────────────────

  readonly totalContractValue = computed(() =>
    this.filteredContracts()
      .filter(c => c.status === ContractStatus.VIGENTE || c.status === ContractStatus.FINALIZANDO)
      .reduce((acc, c) => acc + (c.valor_anual || 0), 0)
  );

  readonly totalCommittedValue = computed(() => {
    const year = this.appContext.anoExercicio();
    const fromContracts = this.contractService.contracts()
      .filter(c => c.data_inicio && new Date(c.data_inicio).getFullYear() <= year)
      .reduce((acc, c) => acc + (Number(c.total_empenhado) || 0), 0);
    if (fromContracts > 0) return fromContracts;
    return this._cacheTotals().totalEmpenhado;
  });

  readonly totalPaidValue = computed(() => {
    const year = this.appContext.anoExercicio();
    const fromContracts = this.contractService.contracts()
      .filter(c => c.data_inicio && new Date(c.data_inicio).getFullYear() <= year)
      .reduce((acc, c) => acc + (Number(c.total_pago) || 0), 0);
    if (fromContracts > 0) return fromContracts;
    return this._cacheTotals().totalPago;
  });

  readonly totalBalanceToPay = computed(() => Math.max(0, this.totalCommittedValue() - this.totalPaidValue()));

  // ── Expenses by Type (Material vs Service) ─────────────────────────────

  readonly expensesByType = computed<ExpensesByType>(() => {
    const contracts = this.filteredContracts();

    const result: ExpensesByType = {
      materialCount: 0, serviceCount: 0,
      materialPlanejado: 0, servicePlanejado: 0,
      materialPago: 0, servicePago: 0,
      materialPercent: 0, servicePercent: 0, totalCount: 0,
    };

    contracts.forEach(c => {
      const tipo = (c.tipo || '').toLowerCase();
      const isMaterial = tipo === 'material';
      const isServico = tipo === 'serviço' || tipo === 'servico';
      const isVigente = c.status === ContractStatus.VIGENTE || c.status === ContractStatus.FINALIZANDO;
      // total_pago do contrato (populado via syncSigefTransactions → dotacoes → trigger → contratos)
      const paid = Number(c.total_pago) || 0;

      if (isMaterial) {
        result.materialCount++;
        if (isVigente) result.materialPlanejado += (c.valor_anual || 0);
        result.materialPago += paid;
      } else if (isServico) {
        result.serviceCount++;
        if (isVigente) result.servicePlanejado += (c.valor_anual || 0);
        result.servicePago += paid;
      }
    });

    result.totalCount = result.materialCount + result.serviceCount;
    result.materialPercent = result.materialPlanejado > 0 ? (result.materialPago / result.materialPlanejado) * 100 : 0;
    result.servicePercent = result.servicePlanejado > 0 ? (result.servicePago / result.servicePlanejado) * 100 : 0;
    return result;
  });

  // ── Expiring Contracts (≤ 90 days) ────────────────────────────────────

  readonly expiringContracts = computed(() =>
    this.filteredContracts()
      .filter(c => c.status_efetivo === ContractStatus.FINALIZANDO)
      .sort((a, b) => (a.dias_restantes || 0) - (b.dias_restantes || 0))
  );

  // ── Low Budget Alerts ─────────────────────────────────────────────────

  readonly lowBudgetAlerts = computed<LowBudgetAlert[]>(() =>
    this.contractService.contracts()
      .filter(c => {
        const vigente = c.status === ContractStatus.VIGENTE || c.status === ContractStatus.FINALIZANDO;
        return vigente && !!c.valor_mensal && c.valor_mensal > 0;
      })
      .map(c => {
        const totalEmpenhado = Number(c.total_empenhado) || 0;
        const totalPago = Number(c.total_pago) || 0;
        const saldoEmpenho = totalEmpenhado - totalPago;
        const valorMensal = Number(c.valor_mensal) || 0;
        return {
          contractId: c.id, contractNumber: c.contrato, dotacao: c.objeto || '',
          nunotaempenho: '', totalEmpenhado, saldoEmpenho, valorMensal,
          percentage: valorMensal > 0 ? (saldoEmpenho / valorMensal) * 100 : 0,
        };
      })
      .filter(a => a.saldoEmpenho > 0 && a.saldoEmpenho <= a.valorMensal)
      .sort((a, b) => a.percentage - b.percentage)
      .slice(0, 10)
  );

  // ── Overdue Installments ──────────────────────────────────────────────

  readonly overdueInstallments = computed<OverdueAlert[]>(() => {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const contracts = this.contractService.contracts().filter(
      c => c.status === ContractStatus.VIGENTE || c.status === ContractStatus.FINALIZANDO
    );
    const allTransactions = this.financialService.transactions();
    const alerts: OverdueAlert[] = [];

    contracts.forEach(c => {
      if (!c.valor_mensal || !c.data_pagamento || !c.data_inicio) return;
      const start = new Date(c.data_inicio);
      const end = c.data_fim_efetiva ? new Date(c.data_fim_efetiva) : new Date(c.data_fim);
      const cur = new Date(start);
      cur.setDate(1);

      while (cur <= end) {
        if (cur.getFullYear() !== year) { cur.setMonth(cur.getMonth() + 1); continue; }
        const m = cur.getMonth() + 1;
        const ref = `${year}-${String(m).padStart(2, '0')}`;
        const overdue = this.pagamentoEmAtraso(c, year, m, ref);
        if (overdue) {
          const isPaid = allTransactions.some(
            t => t.contract_id === c.id && t.type === TransactionType.LIQUIDATION && t.parcela_referencia === ref
          ) || (c.parcelas_pagas_manual?.includes(ref) || false);
          if (!isPaid) {
            alerts.push({
              contractId: c.id, contractName: c.contrato, supplier: c.contratada,
              reference: ref,
              monthLabel: new Date(year, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
              dueDate: new Date(), amount: c.valor_mensal,
            });
          }
        }
        cur.setMonth(cur.getMonth() + 1);
      }
    });
    return alerts.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  });

  // ── Budget Metrics ────────────────────────────────────────────────────

  readonly budgetMetrics = computed<BudgetMetrics>(() => {
    const year = this.appContext.anoExercicio();
    const totalBudget = this.budgetService.dotacoes().reduce((acc, b) => acc + b.valor_dotacao, 0);
    const totalUsed = this.totalCommittedValue();
    return {
      totalBudget,
      totalUsed,
      available: Math.max(0, totalBudget - totalUsed),
      percentageUsed: totalBudget > 0 ? Math.min(100, (totalUsed / totalBudget) * 100) : 0,
    };
  });

  // ── Recent Payments ───────────────────────────────────────────────────

  readonly recentPayments = computed(() => this.recentPaymentsList().slice(0, 8));

  // ── Linked OBs for Installment ────────────────────────────────────────

  getLinkedObsForInstallment(contractId: string, reference: string): Transaction[] {
    return this.financialService.transactions().filter(
      t => t.contract_id === contractId && t.type === TransactionType.LIQUIDATION && t.parcela_referencia === reference
    );
  }

  // ── Data Loading ──────────────────────────────────────────────────────

  async loadAllData(): Promise<void> {
    this._isFirstLoad = true;
    const year = this.appContext.anoExercicio();
    await Promise.all([
      this.contractService.loadContracts(),
      this.budgetService.loadDotacoes(),
      this.financialService.loadAllTransactions(),
      this.loadRecentPayments(year),
      this.loadCacheTotals(),
    ]);
    this._isFirstLoad = false;
  }

  /** Refresh silencioso: atualiza dados sem piscar a tela (não toca loading state) */
  async refreshAllData(): Promise<void> {
    const year = this.appContext.anoExercicio();
    await Promise.all([
      this.contractService.loadContracts(undefined, true),
      this.budgetService.loadDotacoes(true),
      this.financialService.loadAllTransactions(true),
      this.loadRecentPayments(year),
      this.loadCacheTotals(),
    ]);
  }

  /** Carrega totais agregados diretamente do cache SIGEF (fallback pré-sincronização) */
  private async loadCacheTotals(): Promise<void> {
    try {
      const year = this.appContext.anoExercicio();
      const [movResult, obResult] = await Promise.all([
        this.supabaseService.client
          .from('sigef_ne_movimentos')
          .select('vlnotaempenho, cdevento')
          .gte('dtlancamento', `${year}-01-01`)
          .lte('dtlancamento', `${year}-12-31`),
        this.supabaseService.client
          .from('sigef_ordens_bancarias')
          .select('vltotal, dtpagamento')
          .gte('dtpagamento', `${year}-01-01`)
          .lte('dtpagamento', `${year}-12-31`),
      ]);

      const totalEmpenhado = (movResult.data || [])
        .filter(m => m.cdevento === 400010 || m.cdevento === 400011)
        .reduce((s, m) => s + Math.abs(Number(m.vlnotaempenho) || 0), 0);

      const totalPago = (obResult.data || [])
        .reduce((s, o) => s + Math.abs(Number(o.vltotal) || 0), 0);

      this._cacheTotals.set({ totalEmpenhado, totalPago });
    } catch (err) {
      console.error('[DashboardService] Erro ao carregar totais do cache:', err);
    }
  }

  async loadRecentPayments(year: number): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('vw_recent_payments')
      .select('*')
      .gte('data_pagamento', `${year}-01-01`)
      .lte('data_pagamento', `${year}-12-31`)
      .order('data_pagamento', { ascending: false })
      .limit(10);
    if (!error) this.recentPaymentsList.set((data || []) as RecentPayment[]);
  }

  // ── Sync ──────────────────────────────────────────────────────────────

  async syncAllSigef(): Promise<void> {
    const dots = this.budgetService.dotacoes().filter(d => d.nunotaempenho);
    if (dots.length === 0) return;

    const tasks = dots.map(d => ({
      ne: d.nunotaempenho!,
      ano: d.nunotaempenho!.substring(0, 4),
      ug: d.unid_gestora || '080901',
    }));

    try {
      await this.sigefSync.syncBatch(tasks);
      this.lastSyncTimestamp.set(new Date());
      await this.refreshAllData();
    } catch (err) {
      console.error('[DashboardService] Falha na sincronização global:', err);
    }
  }
}
