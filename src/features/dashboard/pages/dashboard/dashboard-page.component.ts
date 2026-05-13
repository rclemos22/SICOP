import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, computed, output, viewChild, ElementRef, effect, signal } from '@angular/core';
import * as d3 from 'd3';
import { DashboardService } from '../../services/dashboard.service';
import { AppContextService } from '../../../../core/services/app-context.service';
import { SigefSyncService } from '../../../../core/services/sigef-sync.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent {
  readonly dashboardService = inject(DashboardService);
  readonly appContext = inject(AppContextService);
  readonly sigefSync = inject(SigefSyncService);

  // D3 Containers
  statusChartContainer = viewChild<ElementRef>('statusChart');
  monthlyExecutionChartContainer = viewChild<ElementRef>('monthlyExecutionChart');
  paymentComparisonChartContainer = viewChild<ElementRef>('paymentComparisonChart');
  contractComparisonChartContainer = viewChild<ElementRef>('contractComparisonChart');

  // Outputs
  navigate = output<'contracts' | 'financial' | 'budget'>();
  viewContract = output<string>();

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
        this.dashboardService.loadAllData();
      }
    });

    effect(() => {
      const container = this.statusChartContainer()?.nativeElement;
      if (container) this.renderStatusChart(container, this.contractsByStatus());
    });

    effect(() => {
      const container = this.monthlyExecutionChartContainer()?.nativeElement;
      if (container) this.renderMonthlyExecutionChart(container, this.monthlyExecution());
    });

    effect(() => {
      const container = this.paymentComparisonChartContainer()?.nativeElement;
      if (container) this.renderPaymentComparisonChart(container, this.paymentComparisonByMonth());
    });

    effect(() => {
      const container = this.contractComparisonChartContainer()?.nativeElement;
      if (container) this.renderContractComparisonChart(container, this.paymentComparisonByContract());
    });
  }

  ngOnInit() {
    this.dashboardService.loadAllData();
  }

  retry() { this.dashboardService.loadAllData(); }

  getLinkedObsForInstallment(contractId: string, reference: string) {
    return this.dashboardService.getLinkedObsForInstallment(contractId, reference);
  }

  goToContracts() { this.navigate.emit('contracts'); }
  goToFinancial() { this.navigate.emit('financial'); }
  goToBudget() { this.navigate.emit('budget'); }

  async syncAllSigef() { await this.dashboardService.syncAllSigef(); }

  // ── D3 Charts ─────────────────────────────────────────────────────────

  private renderStatusChart(
    container: HTMLElement,
    data: { vigentes: number; finalizando: number; rescindidos: number; encerrados: number; total: number }
  ) {
    d3.select(container).selectAll('*').remove();
    if (data.total === 0) {
      d3.select(container).append('div').attr('class', 'flex items-center justify-center h-full text-gray-400 text-sm').text('Sem dados de contratos');
      return;
    }
    const chartData = [
      { label: 'Vigentes', value: data.vigentes, color: '#22C55E' },
      { label: 'Finalizando', value: data.finalizando, color: '#F59E0B' },
      { label: 'Rescindidos', value: data.rescindidos, color: '#EF4444' },
      { label: 'Encerrados', value: data.encerrados, color: '#9CA3AF' },
    ].filter(d => d.value > 0);

    const width = 180, height = 180, margin = 10, radius = Math.min(width, height) / 2 - margin;
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height)
      .append('g').attr('transform', `translate(${width / 2},${height / 2})`);

    const pie = d3.pie<any>().value((d: any) => d.value).sort(null);
    const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
    const arcHover = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 1.05);

    svg.selectAll('path').data(pie(chartData)).join('path')
      .attr('d', arc as any).attr('fill', (d: any) => d.data.color)
      .attr('stroke', 'white').style('stroke-width', '2px').style('cursor', 'pointer')
      .on('mouseover', function () { d3.select(this).transition().duration(200).attr('d', arcHover as any); })
      .on('mouseout', function () { d3.select(this).transition().duration(200).attr('d', arc as any); });

    svg.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
      .style('font-size', '24px').style('font-weight', 'bold').style('fill', '#374151').text(data.total);
  }

  private renderMonthlyExecutionChart(container: HTMLElement, data: { month: string; total: number }[]) {
    d3.select(container).selectAll('*').remove();
    if (data.length === 0) {
      d3.select(container).append('div').attr('class', 'flex flex-col items-center justify-center h-full text-gray-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">bar_chart</span><span>Sem dados de execução</span>');
      return;
    }

    const dataWithVar = data.map((d, i) => {
      const prev = i > 0 ? data[i - 1].total : 0;
      return { ...d, variation: prev > 0 ? ((d.total - prev) / prev) * 100 : 0 };
    });

    const margin = { top: 30, right: 20, bottom: 45, left: 55 };
    const width = 420 - margin.left - margin.right, height = 200 - margin.top - margin.bottom;
    const svg = d3.select(container).append('svg')
      .attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom)
      .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', 'gradTotal').attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#60A5FA');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#3B82F6');

    const x = d3.scaleBand().domain(dataWithVar.map(d => d.month)).rangeRound([0, width]).padding(0.3);
    const maxVal = d3.max(dataWithVar, d => d.total) || 0;
    const y = d3.scaleLinear().domain([0, maxVal * 1.15]).range([height, 0]);

    const monthAbbr: Record<string, string> = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };

    svg.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat(() => ''))
      .selectAll('line').style('stroke', '#E5E7EB').style('stroke-dasharray', '3,3');
    svg.selectAll('.grid .domain').remove();

    svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickFormat(d => { const p = d.split('-'); return `${monthAbbr[p[1]] || d}/${p[0].slice(2)}`; }))
      .selectAll('text').style('font-size', '9px').style('fill', '#6B7280').style('font-weight', '500');

    svg.append('g').attr('class', 'y-axis').call(d3.axisLeft(y).ticks(4).tickFormat(d => {
      const v = Number(d); if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
      if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`; return v.toString();
    })).selectAll('text').style('font-size', '10px').style('fill', '#6B7280');

    const tooltip = d3.select(container).append('div')
      .attr('class', 'absolute z-20 hidden bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none').style('opacity', 0);

    svg.selectAll('.bar').data(dataWithVar).join('rect').attr('class', 'bar')
      .attr('x', d => x(d.month) || 0).attr('y', d => y(d.total))
      .attr('width', x.bandwidth()).attr('height', d => height - y(d.total))
      .attr('fill', 'url(#gradTotal)').attr('rx', 3).style('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        d3.select(this).style('opacity', 0.85);
        tooltip.html(`<div class="font-bold mb-1">Total Executado</div><div class="text-gray-300">R$ ${d.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>`)
          .style('opacity', 1).classed('hidden', false);
      }).on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, container);
        tooltip.style('left', `${x + 10}px`).style('top', `${y - 10}px`);
      }).on('mouseout', function () { d3.select(this).style('opacity', 1); tooltip.style('opacity', 0).classed('hidden', true); });

    if (dataWithVar.length > 1) {
      dataWithVar.slice(1).forEach(d => {
        if (d.variation === 0) return;
        const xPos = x(d.month)! + x.bandwidth() / 2;
        const g = svg.append('g').attr('transform', `translate(${xPos}, -8)`).style('cursor', 'pointer');
        const isPos = d.variation >= 0;
        const color = isPos ? '#22C55E' : '#EF4444';
        g.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em').style('font-size', '14px').style('fill', color).text(isPos ? '▲' : '▼');
        g.append('text').attr('text-anchor', 'middle').attr('y', 14).style('font-size', '8px').style('fill', color).style('font-weight', '600')
          .text(`${Math.abs(d.variation).toFixed(0)}%`);
      });
    }

    const last = dataWithVar[dataWithVar.length - 1];
    if (last) {
      svg.append('text').attr('x', width / 2).attr('y', -10).attr('text-anchor', 'middle')
        .style('font-size', '11px').style('fill', '#374151').style('font-weight', '600')
        .text(`Total: ${last.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}`);
    }
  }

  private renderPaymentComparisonChart(container: HTMLElement, data: { month: string; expected: number; paid: number }[]) {
    d3.select(container).selectAll('*').remove();
    const hasData = data.some(d => d.expected > 0 || d.paid > 0);
    if (!hasData) {
      d3.select(container).append('div').attr('class', 'flex flex-col items-center justify-center h-full text-gray-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">compare_arrows</span><span>Sem dados de comparação</span>');
      return;
    }

    const margin = { top: 30, right: 20, bottom: 45, left: 60 };
    const width = 500 - margin.left - margin.right, height = 220 - margin.top - margin.bottom;
    const svg = d3.select(container).append('svg')
      .attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom)
      .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const monthAbbr: Record<string, string> = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };

    const x0 = d3.scaleBand().domain(data.map(d => d.month)).rangeRound([0, width]).paddingInner(0.25);
    const x1 = d3.scaleBand().domain(['expected', 'paid']).rangeRound([0, x0.bandwidth()]).padding(0.1);
    const maxVal = d3.max(data, d => Math.max(d.expected, d.paid)) || 0;
    const y = d3.scaleLinear().domain([0, maxVal * 1.15]).range([height, 0]);

    svg.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat(() => ''))
      .selectAll('line').style('stroke', '#E5E7EB').style('stroke-dasharray', '3,3');
    svg.selectAll('.grid .domain').remove();
    svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickFormat(d => { const p = d.split('-'); return monthAbbr[p[1]] || d; }))
      .selectAll('text').style('font-size', '9px').style('fill', '#6B7280').style('font-weight', '500');
    svg.append('g').attr('class', 'y-axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d => { const v = Number(d); if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`; if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`; return v.toString(); }))
      .selectAll('text').style('font-size', '10px').style('fill', '#6B7280');

    const tooltip = d3.select(container).append('div')
      .attr('class', 'absolute z-20 hidden bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none').style('opacity', 0);

    const groups = svg.selectAll('.g').data(data).join('g').attr('transform', d => `translate(${x0(d.month)},0)`);
    const colors = { expected: '#60A5FA', paid: '#22C55E' };
    groups.selectAll('rect').data(d => [{ key: 'expected', value: d.expected }, { key: 'paid', value: d.paid }]).join('rect')
      .attr('x', d => x1(d.key) || 0).attr('y', d => y(d.value)).attr('width', x1.bandwidth())
      .attr('height', d => height - y(d.value)).attr('fill', d => colors[d.key as keyof typeof colors]).attr('rx', 3)
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        d3.select(this).style('opacity', 0.85);
        tooltip.html(`<div class="font-bold mb-1">${d.key === 'expected' ? 'Previsto' : 'Pago'}</div><div class="text-gray-300">R$ ${d.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>`)
          .style('opacity', 1).classed('hidden', false);
      }).on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, container);
        tooltip.style('left', `${x + 10}px`).style('top', `${y - 10}px`);
      }).on('mouseout', function () { d3.select(this).style('opacity', 1); tooltip.style('opacity', 0).classed('hidden', true); });
  }

  private renderContractComparisonChart(container: HTMLElement, data: { contract: string; expected: number; paid: number }[]) {
    d3.select(container).selectAll('*').remove();
    if (!data.length) {
      d3.select(container).append('div').attr('class', 'flex flex-col items-center justify-center h-full text-slate-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">analytics</span><span>Sem dados para comparação</span>');
      return;
    }

    const margin = { top: 20, right: 20, bottom: 60, left: 70 };
    const width = (d3.select(container).node() as any)?.getBoundingClientRect().width || 600;
    const cw = width - margin.left - margin.right, ch = 300 - margin.top - margin.bottom;
    const svg = d3.select(container).append('svg').attr('width', cw + margin.left + margin.right)
      .attr('height', ch + margin.top + margin.bottom).append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x0 = d3.scaleBand().domain(data.map(d => d.contract)).rangeRound([0, cw]).paddingInner(0.2);
    const x1 = d3.scaleBand().domain(['expected', 'paid']).rangeRound([0, x0.bandwidth()]).padding(0.05);
    const maxVal = d3.max(data, d => Math.max(d.expected, d.paid)) || 0;
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([ch, 0]);

    svg.append('g').attr('transform', `translate(0,${ch})`).call(d3.axisBottom(x0))
      .selectAll('text').attr('transform', 'translate(-10,0)rotate(-25)').style('text-anchor', 'end')
      .style('font-size', '9px').style('fill', '#64748b');
    svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d => {
      const v = Number(d); if (v >= 1e6) return `R$ ${(v/1e6).toFixed(1)}M`; if (v >= 1e3) return `R$ ${(v/1e3).toFixed(0)}K`; return `R$ ${v}`;
    })).selectAll('text').style('font-size', '10px').style('fill', '#64748b');

    const tooltip = d3.select(container).append('div')
      .attr('class', 'absolute z-20 hidden bg-slate-900 text-white text-[10px] rounded px-2 py-1 shadow-lg pointer-events-none');

    const groups = svg.selectAll('.g').data(data).join('g').attr('transform', d => `translate(${x0(d.contract)},0)`);
    const colors = { expected: '#cbd5e1', paid: '#3b82f6' };

    groups.selectAll('rect').data(d => [
      { key: 'expected', value: d.expected, label: 'Previsto Anual', contract: d.contract },
      { key: 'paid', value: d.paid, label: 'Pago Efetivo', contract: d.contract },
    ]).join('rect').attr('x', d => x1(d.key) || 0).attr('y', d => y(d.value)).attr('width', x1.bandwidth())
      .attr('height', d => ch - y(d.value)).attr('fill', d => colors[d.key as keyof typeof colors]).attr('rx', 2)
      .style('cursor', 'pointer')
      .on('click', (event, d) => this.viewContract.emit(d.contract))
      .on('mouseover', function (event, d) {
        d3.select(this).attr('opacity', 0.8);
        tooltip.html(`<strong>${d.contract}</strong><br>${d.label}: R$ ${d.value.toLocaleString('pt-BR')}`).classed('hidden', false);
      }).on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, container);
        tooltip.style('left', (x + 10) + 'px').style('top', (y - 20) + 'px');
      }).on('mouseout', function () { d3.select(this).attr('opacity', 1); tooltip.classed('hidden', true); });
  }
}
