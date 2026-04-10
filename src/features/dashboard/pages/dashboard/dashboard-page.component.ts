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
      await this.loadAllData();
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

  // Overdue Installments Alert Logic
  overdueInstallments = computed(() => {
    const contracts = this.contractService.contracts().filter(c => 
      c.status === ContractStatus.VIGENTE || c.status === ContractStatus.FINALIZANDO
    );
    const allTransactions = this.financialService.transactions();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const alerts: any[] = [];

    contracts.forEach(c => {
      // Só processa se tiver valor mensal e dia de pagamento definido
      if (!c.valor_mensal || !c.data_pagamento || !c.data_inicio) return;

      const startDate = new Date(c.data_inicio);
      const endDate = c.data_fim_efetiva ? new Date(c.data_fim_efetiva) : new Date(c.data_fim);
      const paymentDay = Number(c.data_pagamento);

      let currentDate = new Date(startDate);
      currentDate.setDate(1);

      // Iterar pelos meses desde o início do contrato até hoje
      while (currentDate <= endDate && currentDate <= today) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const reference = `${year}-${month.toString().padStart(2, '0')}`;
        
        const lastDayOfMonth = new Date(year, month, 0).getDate();
        const actualDay = Math.min(paymentDay, lastDayOfMonth);
        const installmentDate = new Date(year, month - 1, actualDay);

        // Se a data prevista de pagamento já passou
        if (installmentDate < today) {
           // Verificar se existe pagamento (LIQUIDATION) para este contrato e referência
           const isPaid = allTransactions.some(t => 
             t.contract_id === c.id && 
             t.type === TransactionType.LIQUIDATION && 
             (t.parcela_referencia === reference || 
              (new Date(t.date).getFullYear() === year && new Date(t.date).getMonth() + 1 === month))
           );

           if (!isPaid) {
             alerts.push({
               contractId: c.id,
               contractName: c.contrato,
               supplier: c.contratada,
               reference: reference,
               monthLabel: installmentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
               dueDate: installmentDate,
               amount: c.valor_mensal
             });
           }
        }
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    });

    // Ordenar por data de vencimento (mais atrasadas primeiro)
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
        .attr('class', 'flex items-center justify-center h-full text-gray-400 text-sm')
        .text('Sem dados de execução');
      return;
    }

    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const width = 380 - margin.left - margin.right;
    const height = 220 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x0 = d3.scaleBand()
      .domain(data.map(d => d.month))
      .rangeRound([0, width])
      .paddingInner(0.2);

    const x1 = d3.scaleBand()
      .domain(['servico', 'material'])
      .rangeRound([0, x0.bandwidth()])
      .padding(0.05);

    const maxValue = d3.max(data, d => Math.max(d.servico, d.material)) || 0;
    const y = d3.scaleLinear()
      .domain([0, maxValue * 1.1])
      .range([height, 0]);

    const color = d3.scaleOrdinal()
      .domain(['servico', 'material'])
      .range(['#3B82F6', '#F59E0B']);

    const monthLabels: Record<string, string> = {
      '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
      '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
      '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez'
    };

    svg.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickFormat(d => {
        const parts = d.split('-');
        return monthLabels[parts[1]] || d;
      }))
      .selectAll('text')
      .style('font-size', '10px')
      .style('fill', '#6B7280');

    svg.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => {
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
      .attr('class', 'absolute z-10 hidden bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none')
      .style('opacity', 0);

    const monthGroups = svg.selectAll('.month-group')
      .data(data)
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
      .attr('fill', d => color(d.key) as string)
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this).style('opacity', 0.8);
        tooltip
          .html(`<span class="font-bold">${d.key === 'servico' ? 'Serviço' : 'Material'}</span><br/>R$ ${d.value.toLocaleString('pt-BR')}`)
          .style('opacity', 1)
          .classed('hidden', false);
      })
      .on('mousemove', function(event) {
        const [x, y] = d3.pointer(event, container);
        tooltip
          .style('left', `${x + 15}px`)
          .style('top', `${y - 10}px`);
      })
      .on('mouseout', function() {
        d3.select(this).style('opacity', 1);
        tooltip.style('opacity', 0).classed('hidden', true);
      });
  }

  // --- Actions ---
  goToContracts() { this.navigate.emit('contracts'); }
  goToFinancial() { this.navigate.emit('financial'); }
  goToBudget() { this.navigate.emit('budget'); }
}