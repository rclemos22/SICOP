import { CommonModule } from '@angular/common';
import { Component, inject, viewChild, ElementRef, effect, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardService } from '../../services/dashboard.service';
import { AppContextService } from '../../../../core/services/app-context.service';
import { SigefSyncService } from '../../../../core/services/sigef-sync.service';
import { DashboardRefreshSchedulerService } from '../../../../core/services/dashboard-refresh-scheduler.service';
import { AtaService } from '../../../atas/services/ata.service';
import { SaldoAtaService } from '../../../atas/services/saldo-ata.service';
import { OverdueAlertsCardComponent } from '../../components/overdue-alerts-card.component';
import { LowBudgetCardComponent } from '../../components/low-budget-card.component';
import { ExpiringContractsComponent } from '../../components/expiring-contracts.component';
import { RecentPaymentsTableComponent } from '../../components/recent-payments-table.component';
import { AtaAlertsCardComponent, AtaAlertMetric } from '../../components/ata-alerts-card.component';
import { StatusChart } from '../../charts/status-chart';
import { MonthlyExecutionChart } from '../../charts/monthly-execution-chart';
import { PaymentComparisonChart } from '../../charts/payment-comparison-chart';
import { ContractComparisonChart } from '../../charts/contract-comparison-chart';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, OverdueAlertsCardComponent, LowBudgetCardComponent, ExpiringContractsComponent, RecentPaymentsTableComponent, AtaAlertsCardComponent],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent implements OnInit {
  private router = inject(Router);
  readonly dashboardService = inject(DashboardService);
  readonly appContext = inject(AppContextService);
  readonly sigefSync = inject(SigefSyncService);
  readonly dashboardRefreshScheduler = inject(DashboardRefreshSchedulerService);
  private ataService = inject(AtaService);
  private saldoAtaService = inject(SaldoAtaService);

  // D3 Chart Instances
  private statusChart = new StatusChart();
  private monthlyChart = new MonthlyExecutionChart();
  private paymentComparisonChart = new PaymentComparisonChart();
  private contractComparisonChart = new ContractComparisonChart();

  // D3 Containers
  statusChartContainer = viewChild<ElementRef>('statusChart');
  monthlyExecutionChartContainer = viewChild<ElementRef>('monthlyExecutionChart');
  paymentComparisonChartContainer = viewChild<ElementRef>('paymentComparisonChart');
  contractComparisonChartContainer = viewChild<ElementRef>('contractComparisonChart');

  // Ano-base watcher
  private anoBase = signal(this.appContext.anoExercicio());

  // Re-expor signals do service para o template
  readonly isLoading = this.dashboardService.isLoading;
  readonly hasError = this.dashboardService.hasError;
  readonly filteredContracts = this.dashboardService.filteredContracts;
  readonly activeContractsCount = this.dashboardService.activeContractsCount;
  readonly contractsByStatus = this.dashboardService.contractsByStatus;
  readonly monthlyExecution = this.dashboardService.monthlyExecution;
  readonly paymentComparisonByMonth = this.dashboardService.paymentComparisonByMonth;
  readonly paymentComparisonByContract = this.dashboardService.paymentComparisonByContract;
  readonly totalContractValue = this.dashboardService.totalContractValue;
  readonly totalCommittedValue = this.dashboardService.totalCommittedValue;
  readonly totalPaidValue = this.dashboardService.totalPaidValue;
  readonly totalBalanceToPay = this.dashboardService.totalBalanceToPay;
  readonly expensesByType = this.dashboardService.expensesByType;
  readonly expiringContracts = this.dashboardService.expiringContracts;
  readonly lowBudgetAlerts = this.dashboardService.lowBudgetAlerts;
  readonly overdueInstallments = this.dashboardService.overdueInstallments;
  readonly budgetMetrics = this.dashboardService.budgetMetrics;
  readonly recentPayments = this.dashboardService.recentPayments;
  readonly syncProgress = this.dashboardService.syncProgress;
  readonly isSyncing = this.dashboardService.isSyncing;
  readonly lastSyncTimestamp = this.dashboardService.lastSyncTimestamp;

  private ataPendingCounts = signal<Record<string, number>>({});
  private ataCriticalCount = signal(0);

  readonly ataAlertMetrics = computed<AtaAlertMetric>(() => {
    const atas = this.ataService.atas();
    const now = new Date();
    const expiring = atas.filter(a => {
      if (a.status !== 'ATIVA' || !a.vigencia_fim) return false;
      const dias = Math.ceil((new Date(a.vigencia_fim).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return dias >= 0 && dias <= 60;
    });
    const totalActive = atas.filter(a => a.status === 'ATIVA').length;
    return {
      expiringCount: expiring.length,
      pendingAdesoesCount: Object.values(this.ataPendingCounts()).reduce((s, c) => s + c, 0),
      criticalSaldoCount: this.ataCriticalCount(),
      totalActive,
    };
  });

  constructor() {
    effect(() => {
      const newYear = this.appContext.anoExercicio();
      if (newYear !== this.anoBase()) {
        this.anoBase.set(newYear);
        // Troca de ano = refresh silencioso (não pisca)
        this.dashboardService.refreshAllData();
      }
    });

    effect(() => {
      const el = this.statusChartContainer()?.nativeElement;
      if (el) this.statusChart.render(el, this.contractsByStatus());
    });

    effect(() => {
      const el = this.monthlyExecutionChartContainer()?.nativeElement;
      if (el) this.monthlyChart.render(el, this.monthlyExecution());
    });

    effect(() => {
      const el = this.paymentComparisonChartContainer()?.nativeElement;
      if (el) this.paymentComparisonChart.render(el, this.paymentComparisonByMonth());
    });

    effect(() => {
      const el = this.contractComparisonChartContainer()?.nativeElement;
      if (el) this.contractComparisonChart.render(el, this.paymentComparisonByContract(), (c) => this.handleViewContract(c));
    });
  }

  ngOnInit() {
    this.dashboardService.loadAllData();
    this.loadAtaAlerts();
  }

  private async loadAtaAlerts() {
    await this.ataService.loadAtas(true);
    const pendResult = await this.saldoAtaService.contarPendentesPorAta();
    if (!pendResult.error && pendResult.data) {
      this.ataPendingCounts.set(pendResult.data);
    }
  }

  retry() { this.dashboardService.loadAllData(); }

  getLinkedObsForInstallment(contractId: string, reference: string) {
    return this.dashboardService.getLinkedObsForInstallment(contractId, reference);
  }

  goToContracts() { this.router.navigate(['/contracts']); }
  goToFinancial() { this.router.navigate(['/financial']); }
  goToBudget() { this.router.navigate(['/budget']); }
  goToAtas() { this.router.navigate(['/atas']); }
  handleViewContract(contractNumber: string) { this.router.navigate(['/contracts', contractNumber]); }

  async syncAllSigef() { await this.dashboardService.syncAllSigef(); }

  // ── D3 Charts ─────────────────────────────────────────────────────────
  // Renderização delegada às classes em src/features/dashboard/charts/
}
