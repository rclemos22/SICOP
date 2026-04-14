import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, computed, output, viewChild, ElementRef, effect, signal, OnInit } from '@angular/core';
import * as d3 from 'd3';
import { ContractStatus } from '../../../../shared/models/contract.model';

import { BudgetService } from '../../../budget/services/budget.service';
import { ContractService } from '../../../contracts/services/contract.service';
import { FinancialService } from '../../../financial/services/financial.service';
import { AppContextService } from '../../../../core/services/app-context.service';
import { SigefSyncService } from '../../../../core/services/sigef-sync.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { TransactionType } from '../../../../shared/models/transaction.model';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent implements OnInit {
  public contractService = inject(ContractService);
  public budgetService = inject(BudgetService);
  public financialService = inject(FinancialService);
  public appContext = inject(AppContextService);
  private supabaseService = inject(SupabaseService);
  public sigefSync = inject(SigefSyncService);

  // D3 Container for Status Chart
  statusChartContainer = viewChild<ElementRef>('statusChart');
  
  // D3 Container for Contract Type Chart
  contractTypeChartContainer = viewChild<ElementRef>('contractTypeChart');

  // D3 Container for Monthly Execution Chart
  monthlyExecutionChartContainer = viewChild<ElementRef>('monthlyExecutionChart');

  // D3 Container for Payment Comparison Chart
  paymentComparisonChartContainer = viewChild<ElementRef>('paymentComparisonChart');

  // D3 Container for Contract Comparison Chart
  contractComparisonChartContainer = viewChild<ElementRef>('contractComparisonChart');

  // Outputs for Navigation
  navigate = output<'contracts' | 'financial' | 'budget'>();
  viewContract = output<string>();

  // States
  isLoading = computed(() => 
    this.contractService.loading() || 
    this.budgetService.loading()
  );

  hasError = computed(() => 
    this.contractService.error() || 
    this.budgetService.error()
  );

  retry() {
    this.loadAllData();
  }

  // D3 Container
  chartContainer = viewChild<ElementRef>('chart');

  ngOnInit() {
    this.loadAllData();
  }

  async loadAllData() {
    await Promise.all([
      this.contractService.loadContracts(),
      this.budgetService.loadDotacoes(),
      this.financialService.loadAllTransactions(),
      (async () => {
        const { data: payments, error: paymentsError } = await this.supabaseService.client
          .from('vw_recent_payments')
          .select('*')
          .order('data_pagamento', { ascending: false })
          .limit(10);
        
        if (!paymentsError) {
          this.recentPaymentsList.set(payments || []);
        }
      })()
    ]);
  }

  // --- Metrics Calculation ---

  // --- Sync State ---
  syncProgress = computed(() => this.sigefSync.progress());
  isSyncing = computed(() => this.sigefSync.isSyncing());
  lastSyncTimestamp = signal<Date | null>(null);

  /**
   * Sincroniza todos os empenhos e pagamentos das dotações do exercício selecionado.
   */
  async syncAllSigef() {
    const dots = this.budgetService.dotacoes();
    const dotacoesComNE = dots.filter(d => d.nunotaempenho);
    
    if (dotacoesComNE.length === 0) return;

    console.log('[DASHBOARD] Iniciando sincronização em lote para', dotacoesComNE.length, 'NEs');

    const tasks = dotacoesComNE.map(dot => ({
      ne: dot.nunotaempenho!,
      ano: dot.nunotaempenho!.substring(0, 4),
      ug: dot.unid_gestora || '080901'
    }));

    try {
      await this.sigefSync.syncBatch(tasks);
      
      this.lastSyncTimestamp.set(new Date());
      // Recarregar os caches locais após a sincronização
      await Promise.all([
        this.financialService.loadAllTransactions(),
        this.contractService.loadContracts()
      ]);
    } catch (err) {
      console.error('[DASHBOARD] Falha na sincronização global:', err);
    }
  }

  // 1. Contracts Filtered by Selected Year
  filteredContracts = computed(() => {
    const selectedYear = this.appContext.anoExercicio();
    const inicioAno = new Date(selectedYear, 0, 1);
    const fimAno = new Date(selectedYear, 11, 31);

    return this.contractService.contracts().filter(c => {
      const start = c.data_inicio;
      const end = c.data_fim_efetiva || c.data_fim;
      return (start <= fimAno) && (end >= inicioAno);
    });
  });

  activeContractsCount = computed(() => {
    return this.filteredContracts()
      .filter(c => c.status === ContractStatus.VIGENTE).length;
  });

  // Contracts by status metrics
  contractsByStatus = computed(() => {
    const contracts = this.filteredContracts();
    return {
      vigentes: contracts.filter(c => c.status === ContractStatus.VIGENTE).length,
      finalizando: contracts.filter(c => c.status === ContractStatus.FINALIZANDO).length,
      rescindidos: contracts.filter(c => c.status === ContractStatus.RESCINDIDO).length,
      total: contracts.length
    };
  });

  // Contracts by type (serviço vs material)
  contractsByType = computed(() => {
    const contracts = this.filteredContracts();
    return {
      servico: contracts.filter(c => c.tipo === 'serviço').length,
      material: contracts.filter(c => c.tipo === 'material').length,
      total: contracts.length
    };
  });

  // Monthly execution by contract type
  monthlyExecutionByType = computed(() => {
    const transactions = this.financialService.transactions();
    const monthlyData: Record<string, { servico: number; material: number }> = {};

    transactions.forEach(t => {
      if (t.type !== TransactionType.LIQUIDATION) return;
      
      const date = new Date(t.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { servico: 0, material: 0 };
      }
      
      const type = t.contract_type || 'material';
      monthlyData[monthKey][type] += t.amount;
    });

    // Sort months and get last 12
    const sortedMonths = Object.keys(monthlyData).sort().slice(-12);
    
    return sortedMonths.map(month => ({
      month,
      servico: monthlyData[month].servico,
      material: monthlyData[month].material
    }));
  });

  // Payment Comparison: Expected (valor_mensal) vs Actual Paid
  paymentComparisonByMonth = computed(() => {
    const contracts = this.filteredContracts();
    const transactions = this.financialService.transactions();
    const selectedYear = this.appContext.anoExercicio();
    
    const monthlyData: Record<string, { expected: number; paid: number }> = {};

    // Initialize months of current year
    for (let month = 1; month <= 12; month++) {
      const monthKey = `${selectedYear}-${String(month).padStart(2, '0')}`;
      monthlyData[monthKey] = { expected: 0, paid: 0 };
    }

    contracts.forEach(c => {
      if (!c.valor_mensal || !c.data_inicio) return;

      const startDate = new Date(c.data_inicio);
      const endDate = c.data_fim_efetiva ? new Date(c.data_fim_efetiva) : new Date(c.data_fim);

      let currentDate = new Date(startDate);
      currentDate.setDate(1);

      while (currentDate <= endDate && currentDate.getFullYear() <= selectedYear) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        
        if (year === selectedYear && month <= 12) {
          const monthKey = `${year}-${String(month).padStart(2, '0')}`;
          if (monthlyData[monthKey]) {
            monthlyData[monthKey].expected += c.valor_mensal;
          }
        }
        
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    });

    transactions.forEach(t => {
      if (t.type !== TransactionType.LIQUIDATION) return;
      
      const date = new Date(t.date);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      
      if (year === selectedYear && month <= 12) {
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        if (monthlyData[monthKey]) {
          monthlyData[monthKey].paid += t.amount;
        }
      }
    });

    const sortedMonths = Object.keys(monthlyData).sort();
    return sortedMonths.map(month => ({
      month,
      expected: monthlyData[month].expected,
      paid: monthlyData[month].paid
    }));
  });

  // Payment Comparison by Contract: Expected (valor_mensal sum for year) vs Actual Paid (current year)
  paymentComparisonByContract = computed(() => {
    const contracts = this.filteredContracts();
    const transactions = this.financialService.transactions();
    const selectedYear = this.appContext.anoExercicio();
    
    // Process each contract
    const data = contracts.map(c => {
      // 1. Calculate Expected for current year
      let expectedTotal = 0;
      if (c.valor_mensal && c.data_inicio) {
        const startDate = new Date(c.data_inicio);
        const endDate = c.data_fim_efetiva ? new Date(c.data_fim_efetiva) : new Date(c.data_fim);
        
        let currentDate = new Date(startDate);
        currentDate.setDate(1);

        while (currentDate <= endDate && currentDate.getFullYear() <= selectedYear) {
          if (currentDate.getFullYear() === selectedYear) {
            expectedTotal += c.valor_mensal;
          }
          currentDate.setMonth(currentDate.getMonth() + 1);
        }
      }

      // 2. Calculate Paid for current year
      const paidTotal = transactions
        .filter(t => t.contract_id === c.id && t.type === TransactionType.LIQUIDATION)
        .filter(t => new Date(t.date).getFullYear() === selectedYear)
        .reduce((sum, t) => sum + t.amount, 0);

      return {
        contract: c.contrato,
        contratada: c.contratada,
        expected: expectedTotal,
        paid: paidTotal,
        diff: expectedTotal - paidTotal
      };
    });

    // Sort by expected value descending and take top 10
    return data
      .filter(d => d.expected > 0 || d.paid > 0)
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 10);
  });

  // Total value of active contracts
  totalContractValue = computed(() => {
    return this.filteredContracts()
      .filter(c => c.status === ContractStatus.VIGENTE || c.status === ContractStatus.FINALIZANDO)
      .reduce((acc, c) => acc + (c.valor_anual || 0), 0);
  });

  // Total Committed (Empenhado Real do SIGEF)
  totalCommittedValue = computed(() => {
    return this.budgetService.dotacoes()
      .reduce((acc, b) => acc + (b.total_empenhado || 0), 0);
  });

  // Total Paid (Pago Real do SIGEF)
  totalPaidValue = computed(() => {
    return this.budgetService.dotacoes()
      .reduce((acc, b) => acc + (b.total_pago || 0), 0);
  });

  // Balance (Saldo real a pagar)
  totalBalanceToPay = computed(() => {
    return Math.max(0, this.totalCommittedValue() - this.totalPaidValue());
  });

  // Contracts expiring soon (≤ 90 days)
  expiringContracts = computed(() => {
    return this.filteredContracts()
      .filter(c => c.status_efetivo === ContractStatus.FINALIZANDO)
      .sort((a, b) => (a.dias_restantes || 0) - (b.dias_restantes || 0));
  });

  // Alert: Saldo de Empenho <= Valor Mensal do Contrato
  lowBudgetAlerts = computed(() => {
    const budgets = this.budgetService.dotacoes();
    const selectedYear = this.appContext.anoExercicio();
    
    return budgets
      .filter(b => b.nunotaempenho && b.total_empenhado !== null)
      .filter(b => {
        const totalEmpenhado = b.total_empenhado || 0;
        const valorMensal = b.valor_dotacao || 0;
        return totalEmpenhado <= valorMensal * 1.5;
      })
      .map(b => {
        const totalEmpenhado = b.total_empenhado || 0;
        const valorMensal = b.valor_dotacao || 0;
        return {
          contractId: b.contract_id,
          contractNumber: b.numero_contrato,
          dotacao: b.dotacao,
          nunotaempenho: b.nunotaempenho,
          totalEmpenhado,
          valorMensal,
          percentage: valorMensal > 0 ? (totalEmpenhado / valorMensal) * 100 : 0
        };
      })
      .sort((a, b) => a.percentage - b.percentage)
      .slice(0, 10);
  });

  // Overdue Installments Alert Logic (apenas ano corrente)
  // Regra: pagamento do mês X é efetuado no mês X+1
  // Ex: pagamento de janeiro (01) → vence em fevereiro (02)
  // Se estamos em mês posterior ao mês de vencimento+1, está atrasado
  overdueInstallments = computed(() => {
    const contracts = this.contractService.contracts().filter(c => 
      c.status === ContractStatus.VIGENTE || c.status === ContractStatus.FINALIZANDO
    );
    const allTransactions = this.financialService.transactions();
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    today.setHours(0, 0, 0, 0);

    const alerts: any[] = [];

    contracts.forEach(c => {
      if (!c.valor_mensal || !c.data_pagamento || !c.data_inicio) return;

      const startDate = new Date(c.data_inicio);
      const endDate = c.data_fim_efetiva ? new Date(c.data_fim_efetiva) : new Date(c.data_fim);
      const paymentDay = Number(c.data_pagamento);

      let currentDate = new Date(startDate);
      currentDate.setDate(1);

      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        if (year !== currentYear) {
          currentDate.setMonth(currentDate.getMonth() + 1);
          continue;
        }

        const month = currentDate.getMonth() + 1;
        const reference = `${year}-${month.toString().padStart(2, '0')}`;
        
        // Mês de vencimento = mês da parcela + 1
        const dueMonth = month + 1;
        const dueYear = dueMonth > 12 ? year + 1 : year;
        const dueMonthAdjusted = dueMonth > 12 ? 1 : dueMonth;
        
        const lastDayOfMonth = new Date(dueYear, dueMonthAdjusted - 1, 0).getDate();
        const actualDay = Math.min(paymentDay, lastDayOfMonth);
        const installmentDate = new Date(dueYear, dueMonthAdjusted - 1, actualDay);

        // Verifica se está atrasado: mês atual > mês de vencimento
        // Ex: parcela 01→vence em 02, se estamos em 03 ou posterior, está atrasado
        const isOverdue = currentYear > dueYear || (currentYear === dueYear && currentMonth > dueMonthAdjusted);

        if (isOverdue) {
           // Verifica se tem transação VINCOLADA a esta parcela (não apenas no mesmo mês)
           const isPaid = allTransactions.some(t => 
             t.contract_id === c.id && 
             t.type === TransactionType.LIQUIDATION && 
             t.parcela_referencia === reference
           );

           if (!isPaid) {
             alerts.push({
               contractId: c.id,
               contractName: c.contrato,
               supplier: c.contratada,
               reference: reference,
               monthLabel: new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
               dueDate: installmentDate,
               amount: c.valor_mensal
             });
           }
        }
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    });

    return alerts.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  });

  // 2. Budget Logic (Distribution)
  readonly recentPaymentsList = signal<any[]>([]);
  readonly budgetMetrics = computed(() => {
    const budgets = this.budgetService.dotacoes();

    const totalBudget = budgets.reduce((acc, b) => acc + b.valor_dotacao, 0);
    const totalUsed = budgets.reduce((acc, b) => acc + (b.total_empenhado || 0), 0);

    const percentageUsed = totalBudget > 0 ? (totalUsed / totalBudget) * 100 : 0;

    return {
      totalBudget,
      totalUsed,
      available: totalBudget - totalUsed,
      percentageUsed
    };
  });

  // 3. Recent Payments - from all budgets/OBs tracked via contracts
  recentPayments = computed(() => {
    return this.recentPaymentsList().slice(0, 8);
  });

  constructor() {
    // Reactively render budget chart when metrics change
    effect(() => {
      const metrics = this.budgetMetrics();
      const container = this.chartContainer()?.nativeElement;
      if (container) {
        this.renderDonutChart(container, metrics);
      }
    });

    // Reactively render status chart when contracts change
    effect(() => {
      const statusData = this.contractsByStatus();
      const container = this.statusChartContainer()?.nativeElement;
      if (container) {
        this.renderStatusChart(container, statusData);
      }
    });

    // Reactively render contract type chart
    effect(() => {
      const typeData = this.contractsByType();
      const container = this.contractTypeChartContainer()?.nativeElement;
      if (container) {
        this.renderContractTypeChart(container, typeData);
      }
    });

    // Reactively render monthly execution bar chart
    effect(() => {
      const data = this.monthlyExecutionByType();
      const container = this.monthlyExecutionChartContainer()?.nativeElement;
      if (container) {
        this.renderMonthlyExecutionChart(container, data);
      }
    });

    // Reactively render payment comparison chart
    effect(() => {
      const data = this.paymentComparisonByMonth();
      const container = this.paymentComparisonChartContainer()?.nativeElement;
      if (container) {
        this.renderPaymentComparisonChart(container, data);
      }
    });

    // Reactively render contract comparison chart
    effect(() => {
      const data = this.paymentComparisonByContract();
      const container = this.contractComparisonChartContainer()?.nativeElement;
      if (container) {
        this.renderContractComparisonChart(container, data);
      }
    });
  }

  private renderDonutChart(container: HTMLElement, metrics: any) {
    // Clear previous chart
    d3.select(container).selectAll('*').remove();

    // Create Tooltip Div
    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'absolute z-10 hidden bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none transition-opacity duration-200 opacity-0')
      .style('opacity', 0); // Start hidden

    const width = 220;
    const height = 220;
    const margin = 20;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    // Data for D3
    const data = {
      Used: metrics.totalUsed,
      Available: metrics.available
    };

    // Currency Formatter
    const currencyFormatter = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });

    // Color Palette
    const color = d3.scaleOrdinal()
      .domain(['Used', 'Available'])
      .range(['#004B85', '#E5E7EB']);

    const pie = d3.pie<any>()
      .value((d: any) => d[1])
      .sort(null);

    const data_ready = pie(Object.entries(data));

    const arc = d3.arc()
      .innerRadius(radius * 0.65)
      .outerRadius(radius);

    const arcHover = d3.arc()
      .innerRadius(radius * 0.65)
      .outerRadius(radius * 1.05);

    svg.selectAll('allSlices')
      .data(data_ready)
      .join('path')
      .attr('d', arc as any)
      .attr('fill', (d: any) => color(d.data[0]) as string)
      .attr('stroke', 'white')
      .style('stroke-width', '2px')
      .style('cursor', 'pointer')
      .style('opacity', 0.9)
      .on('mouseover', function (event, d: any) {
        d3.select(this).transition().duration(200).attr('d', arcHover as any);
        const key = d.data[0];
        const value = d.data[1];
        const label = key === 'Used' ? 'Empenhado' : 'Disponível';
        tooltip.html(`
          <span class="font-bold block mb-0.5 text-gray-300 uppercase text-[10px]">${label}</span>
          <span class="text-sm font-semibold">${currencyFormatter.format(value)}</span>
        `)
          .style('opacity', 1)
          .classed('hidden', false);
      })
      .on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, container);
        tooltip
          .style('left', `${x + 15}px`)
          .style('top', `${y + 15}px`);
      })
      .on('mouseout', function (event, d) {
        d3.select(this).transition().duration(200).attr('d', arc as any);
        tooltip.style('opacity', 0).classed('hidden', true);
      });

    svg.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "-0.2em")
      .style("font-size", "24px")
      .style("font-weight", "bold")
      .style("fill", "#004B85")
      .text(`${metrics.percentageUsed.toFixed(1)}%`);

    svg.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1.2em")
      .style("font-size", "12px")
      .style("fill", "#6B7280")
      .text(`Executado`);
  }

  private renderStatusChart(container: HTMLElement, data: { vigentes: number; finalizando: number; rescindidos: number; total: number }) {
    d3.select(container).selectAll('*').remove();

    if (data.total === 0) {
      d3.select(container)
        .append('div')
        .attr('class', 'flex items-center justify-center h-full text-gray-400 text-sm')
        .text('Sem dados de contratos');
      return;
    }

    const chartData = [
      { label: 'Vigentes', value: data.vigentes, color: '#22C55E' },
      { label: 'Finalizando', value: data.finalizando, color: '#F59E0B' },
      { label: 'Rescindidos', value: data.rescindidos, color: '#EF4444' }
    ].filter(d => d.value > 0);

    const width = 180;
    const height = 180;
    const margin = 10;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const pie = d3.pie<any>()
      .value((d: any) => d.value)
      .sort(null);

    const arc = d3.arc()
      .innerRadius(radius * 0.5)
      .outerRadius(radius);

    const arcHover = d3.arc()
      .innerRadius(radius * 0.5)
      .outerRadius(radius * 1.05);

    svg.selectAll('path')
      .data(pie(chartData))
      .join('path')
      .attr('d', arc as any)
      .attr('fill', (d: any) => d.data.color)
      .attr('stroke', 'white')
      .style('stroke-width', '2px')
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d: any) {
        d3.select(this).transition().duration(200).attr('d', arcHover as any);
      })
      .on('mouseout', function (event, d) {
        d3.select(this).transition().duration(200).attr('d', arc as any);
      });

    svg.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .style('font-size', '24px')
      .style('font-weight', 'bold')
      .style('fill', '#374151')
      .text(data.total);
  }

  private renderContractTypeChart(container: HTMLElement, data: { servico: number; material: number; total: number }) {
    d3.select(container).selectAll('*').remove();

    if (data.total === 0) {
      d3.select(container)
        .append('div')
        .attr('class', 'flex items-center justify-center h-full text-gray-400 text-sm')
        .text('Sem dados de contratos');
      return;
    }

    const chartData = [
      { label: 'Serviço', value: data.servico, color: '#3B82F6' },
      { label: 'Material', value: data.material, color: '#F59E0B' }
    ];

    const width = 180;
    const height = 180;
    const margin = 15;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const pie = d3.pie<any>()
      .value((d: any) => d.value)
      .sort(null);

    const arc = d3.arc()
      .innerRadius(radius * 0.5)
      .outerRadius(radius);

    const arcHover = d3.arc()
      .innerRadius(radius * 0.5)
      .outerRadius(radius * 1.05);

    svg.selectAll('path')
      .data(pie(chartData))
      .join('path')
      .attr('d', arc as any)
      .attr('fill', (d: any) => d.data.color)
      .attr('stroke', 'white')
      .style('stroke-width', '2px')
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d: any) {
        d3.select(this).transition().duration(200).attr('d', arcHover as any);
      })
      .on('mouseout', function (event, d) {
        d3.select(this).transition().duration(200).attr('d', arc as any);
      });

    svg.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .style('font-size', '24px')
      .style('font-weight', 'bold')
      .style('fill', '#374151')
      .text(data.total);
  }

  private renderMonthlyExecutionChart(container: HTMLElement, data: { month: string; servico: number; material: number }[]) {
    d3.select(container).selectAll('*').remove();

    if (data.length === 0) {
      d3.select(container)
        .append('div')
        .attr('class', 'flex flex-col items-center justify-center h-full text-gray-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">bar_chart</span><span>Sem dados de execução</span>');
      return;
    }

    // Calculate variations
    const dataWithVariation = data.map((d, i) => {
      const total = d.servico + d.material;
      const prevTotal = i > 0 ? data[i - 1].servico + data[i - 1].material : 0;
      const variation = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
      return { ...d, total, variation };
    });

    const margin = { top: 30, right: 20, bottom: 45, left: 55 };
    const width = 420 - margin.left - margin.right;
    const height = 200 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Gradient definitions
    const defs = svg.append('defs');
    
    const gradientBlue = defs.append('linearGradient')
      .attr('id', 'gradientServico')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    gradientBlue.append('stop').attr('offset', '0%').attr('stop-color', '#60A5FA');
    gradientBlue.append('stop').attr('offset', '100%').attr('stop-color', '#3B82F6');
    
    const gradientAmber = defs.append('linearGradient')
      .attr('id', 'gradientMaterial')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    gradientAmber.append('stop').attr('offset', '0%').attr('stop-color', '#FBBF24');
    gradientAmber.append('stop').attr('offset', '100%').attr('stop-color', '#F59E0B');

    const x0 = d3.scaleBand()
      .domain(dataWithVariation.map(d => d.month))
      .rangeRound([0, width])
      .paddingInner(0.25);

    const x1 = d3.scaleBand()
      .domain(['servico', 'material'])
      .rangeRound([0, x0.bandwidth()])
      .padding(0.1);

    const maxValue = d3.max(dataWithVariation, d => Math.max(d.servico, d.material)) || 0;
    const y = d3.scaleLinear()
      .domain([0, maxValue * 1.15])
      .range([height, 0]);

    const monthLabels: Record<string, string> = {
      '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
      '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
      '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez'
    };

    // Grid lines
    svg.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat(() => ''))
      .selectAll('line')
      .style('stroke', '#E5E7EB')
      .style('stroke-dasharray', '3,3');
    svg.selectAll('.grid .domain').remove();

    // X Axis
    svg.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickFormat(d => {
        const parts = d.split('-');
        const label = monthLabels[parts[1]] || d;
        const year = parts[0].slice(2);
        return `${label}/${year}`;
      }))
      .selectAll('text')
      .style('font-size', '9px')
      .style('fill', '#6B7280')
      .style('font-weight', '500');

    // Y Axis
    svg.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d => {
        const val = Number(d);
        if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
        return val.toString();
      }))
      .selectAll('text')
      .style('font-size', '10px')
      .style('fill', '#6B7280');

    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'absolute z-20 hidden bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none')
      .style('opacity', 0);

    // Bars
    const monthGroups = svg.selectAll('.month-group')
      .data(dataWithVariation)
      .join('g')
      .attr('class', 'month-group')
      .attr('transform', d => `translate(${x0(d.month)},0)`);

    monthGroups.selectAll('rect')
      .data(d => [
        { key: 'servico', value: d.servico },
        { key: 'material', value: d.material }
      ])
      .join('rect')
      .attr('x', d => x1(d.key) || 0)
      .attr('y', d => y(d.value))
      .attr('width', x1.bandwidth())
      .attr('height', d => height - y(d.value))
      .attr('fill', d => d.key === 'servico' ? 'url(#gradientServico)' : 'url(#gradientMaterial)')
      .attr('rx', 3)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this).style('opacity', 0.85);
        tooltip
          .html(`<div class="font-bold mb-1">${d.key === 'servico' ? 'Serviço' : 'Material'}</div><div class="text-gray-300">R$ ${d.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>`)
          .style('opacity', 1)
          .classed('hidden', false);
      })
      .on('mousemove', function(event) {
        const [x, y] = d3.pointer(event, container);
        tooltip.style('left', `${x + 10}px`).style('top', `${y - 10}px`);
      })
      .on('mouseout', function() {
        d3.select(this).style('opacity', 1);
        tooltip.style('opacity', 0).classed('hidden', true);
      });

    // Variation indicators (arrows between months)
    if (dataWithVariation.length > 1) {
      dataWithVariation.slice(1).forEach((d, i) => {
        const prev = dataWithVariation[i];
        const xPos = x0(d.month)! + x0.bandwidth() / 2;
        
        const arrowGroup = svg.append('g')
          .attr('transform', `translate(${xPos}, -8)`)
          .style('cursor', 'pointer');

        const isPositive = d.variation >= 0;
        const color = isPositive ? '#22C55E' : '#EF4444';
        
        arrowGroup.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .style('font-size', '14px')
          .style('fill', color)
          .text(isPositive ? '▲' : '▼');

        arrowGroup.append('text')
          .attr('text-anchor', 'middle')
          .attr('y', 14)
          .style('font-size', '8px')
          .style('fill', color)
          .style('font-weight', '600')
          .text(`${Math.abs(d.variation).toFixed(0)}%`);
      });
    }

    // Current month indicator
    const lastMonth = dataWithVariation[dataWithVariation.length - 1];
    if (lastMonth) {
      const totalStr = lastMonth.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });
      svg.append('text')
        .attr('x', width / 2)
        .attr('y', -10)
        .attr('text-anchor', 'middle')
        .style('font-size', '11px')
        .style('fill', '#374151')
        .style('font-weight', '600')
        .text(`Total: ${totalStr}`);
    }
  }

  private renderPaymentComparisonChart(container: HTMLElement, data: { month: string; expected: number; paid: number }[]) {
    d3.select(container).selectAll('*').remove();

    const hasData = data.some(d => d.expected > 0 || d.paid > 0);
    if (!hasData) {
      d3.select(container)
        .append('div')
        .attr('class', 'flex flex-col items-center justify-center h-full text-gray-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">compare_arrows</span><span>Sem dados de comparação</span>');
      return;
    }

    const margin = { top: 30, right: 20, bottom: 45, left: 60 };
    const width = 500 - margin.left - margin.right;
    const height = 220 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const monthLabels: Record<string, string> = {
      '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
      '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
      '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez'
    };

    const x0 = d3.scaleBand()
      .domain(data.map(d => d.month))
      .rangeRound([0, width])
      .paddingInner(0.25);

    const x1 = d3.scaleBand()
      .domain(['expected', 'paid'])
      .rangeRound([0, x0.bandwidth()])
      .padding(0.1);

    const maxValue = d3.max(data, d => Math.max(d.expected, d.paid)) || 0;
    const y = d3.scaleLinear()
      .domain([0, maxValue * 1.15])
      .range([height, 0]);

    svg.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat(() => ''))
      .selectAll('line')
      .style('stroke', '#E5E7EB')
      .style('stroke-dasharray', '3,3');
    svg.selectAll('.grid .domain').remove();

    svg.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickFormat(d => {
        const parts = d.split('-');
        return monthLabels[parts[1]] || d;
      }))
      .selectAll('text')
      .style('font-size', '9px')
      .style('fill', '#6B7280')
      .style('font-weight', '500');

    svg.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d => {
        const val = Number(d);
        if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
        return val.toString();
      }))
      .selectAll('text')
      .style('font-size', '10px')
      .style('fill', '#6B7280');

    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'absolute z-20 hidden bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none')
      .style('opacity', 0);

    const monthGroups = svg.selectAll('.month-group')
      .data(data)
      .join('g')
      .attr('class', 'month-group')
      .attr('transform', d => `translate(${x0(d.month)},0)`);

    const colors = { expected: '#60A5FA', paid: '#22C55E' };

    monthGroups.selectAll('rect')
      .data(d => [
        { key: 'expected', value: d.expected },
        { key: 'paid', value: d.paid }
      ])
      .join('rect')
      .attr('x', d => x1(d.key) || 0)
      .attr('y', d => y(d.value))
      .attr('width', x1.bandwidth())
      .attr('height', d => height - y(d.value))
      .attr('fill', d => colors[d.key as keyof typeof colors])
      .attr('rx', 3)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this).style('opacity', 0.85);
        const label = d.key === 'expected' ? 'Previsto' : 'Pago';
        tooltip
          .html(`<div class="font-bold mb-1">${label}</div><div class="text-gray-300">R$ ${d.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>`)
          .style('opacity', 1)
          .classed('hidden', false);
      })
      .on('mousemove', function(event) {
        const [x, y] = d3.pointer(event, container);
        tooltip.style('left', `${x + 10}px`).style('top', `${y - 10}px`);
      })
      .on('mouseout', function() {
        d3.select(this).style('opacity', 1);
        tooltip.style('opacity', 0).classed('hidden', true);
      });
  }

  private renderContractComparisonChart(container: HTMLElement, data: any[]) {
    d3.select(container).selectAll('*').remove();

    if (!data.length) {
      d3.select(container)
        .append('div')
        .attr('class', 'flex flex-col items-center justify-center h-full text-slate-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">analytics</span><span>Sem dados para comparação</span>');
      return;
    }

    const margin = { top: 20, right: 20, bottom: 60, left: 70 };
    const width = d3.select(container).node()?.getBoundingClientRect().width || 600;
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = 300 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', chartWidth + margin.left + margin.right)
      .attr('height', chartHeight + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x0 = d3.scaleBand()
      .domain(data.map(d => d.contract))
      .rangeRound([0, chartWidth])
      .paddingInner(0.2);

    const x1 = d3.scaleBand()
      .domain(['expected', 'paid'])
      .rangeRound([0, x0.bandwidth()])
      .padding(0.05);

    const maxValue = d3.max(data, d => Math.max(d.expected, d.paid)) || 0;
    const y = d3.scaleLinear()
      .domain([0, maxValue * 1.1])
      .range([chartHeight, 0]);

    // Axis
    svg.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(x0))
      .selectAll('text')
      .attr('transform', 'translate(-10,0)rotate(-25)')
      .style('text-anchor', 'end')
      .style('font-size', '9px')
      .style('fill', '#64748b');

    svg.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => {
        const val = Number(d);
        if (val >= 1000000) return `R$ ${(val/1000000).toFixed(1)}M`;
        if (val >= 1000) return `R$ ${(val/1000).toFixed(0)}K`;
        return `R$ ${val}`;
      }))
      .selectAll('text')
      .style('font-size', '10px')
      .style('fill', '#64748b');

    // Tooltip
    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'absolute z-20 hidden bg-slate-900 text-white text-[10px] rounded px-2 py-1 shadow-lg pointer-events-none');

    // Groups
    const contractGroups = svg.selectAll('.contract-group')
      .data(data)
      .join('g')
      .attr('class', 'contract-group')
      .attr('transform', d => `translate(${x0(d.contract)},0)`);

    const colors = { expected: '#cbd5e1', paid: '#3b82f6' };

    contractGroups.selectAll('rect')
      .data(d => [
        { key: 'expected', value: d.expected, label: 'Previsto Anual', contract: d.contract },
        { key: 'paid', value: d.paid, label: 'Pago Efetivo', contract: d.contract }
      ])
      .join('rect')
      .attr('x', d => x1(d.key) || 0)
      .attr('y', d => y(d.value))
      .attr('width', x1.bandwidth())
      .attr('height', d => chartHeight - y(d.value))
      .attr('fill', d => colors[d.key as keyof typeof colors])
      .attr('rx', 2)
      .on('mouseover', function(event, d) {
        d3.select(this).attr('opacity', 0.8);
        tooltip
          .html(`<strong>${d.contract}</strong><br>${d.label}: R$ ${d.value.toLocaleString('pt-BR')}`)
          .classed('hidden', false);
      })
      .on('mousemove', (event) => {
        const [x, y] = d3.pointer(event, container);
        tooltip.style('left', (x + 10) + 'px').style('top', (y - 20) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this).attr('opacity', 1);
        tooltip.classed('hidden', true);
      });
  }

  getLinkedObsForInstallment(contractId: string, reference: string) {
    const transactions = this.financialService.transactions();
    return transactions.filter(t => 
      t.contract_id === contractId &&
      t.type === TransactionType.LIQUIDATION &&
      t.parcela_referencia === reference
    );
  }

  // --- Actions ---
  goToContracts() { this.navigate.emit('contracts'); }
  goToFinancial() { this.navigate.emit('financial'); }
  goToBudget() { this.navigate.emit('budget'); }
}