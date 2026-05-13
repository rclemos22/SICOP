import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, viewChild, ElementRef, effect, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardService } from '../../services/dashboard.service';
import { AppContextService } from '../../../../core/services/app-context.service';
import { SigefSyncService } from '../../../../core/services/sigef-sync.service';
import { OverdueAlertsCardComponent } from '../../components/overdue-alerts-card.component';
import { LowBudgetCardComponent } from '../../components/low-budget-card.component';
import { ExpiringContractsComponent } from '../../components/expiring-contracts.component';
import { RecentPaymentsTableComponent } from '../../components/recent-payments-table.component';
import { StatusChart } from '../../charts/status-chart';
import { MonthlyExecutionChart } from '../../charts/monthly-execution-chart';
import { PaymentComparisonChart } from '../../charts/payment-comparison-chart';
import { ContractComparisonChart } from '../../charts/contract-comparison-chart';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, DecimalPipe, OverdueAlertsCardComponent, LowBudgetCardComponent, ExpiringContractsComponent, RecentPaymentsTableComponent],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent {
  private router = inject(Router);
  readonly dashboardService = inject(DashboardService);
  readonly appContext = inject(AppContextService);
  readonly sigefSync = inject(SigefSyncService);

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
  }

  retry() { this.dashboardService.loadAllData(); }

  getLinkedObsForInstallment(contractId: string, reference: string) {
    return this.dashboardService.getLinkedObsForInstallment(contractId, reference);
  }

  goToContracts() { this.router.navigate(['/contracts']); }
  goToFinancial() { this.router.navigate(['/financial']); }
  goToBudget() { this.router.navigate(['/budget']); }
  handleViewContract(contractNumber: string) { this.router.navigate(['/contracts', contractNumber]); }

  async syncAllSigef() { await this.dashboardService.syncAllSigef(); }

  // ── D3 Charts ─────────────────────────────────────────────────────────
  // Renderização delegada às classes em src/features/dashboard/charts/
}
