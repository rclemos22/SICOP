import * as d3 from 'd3';

export interface ContractComparisonData {
  contract: string;
  expected: number;
  paid: number;
}

export class ContractComparisonChart {
  private readonly margin = { top: 30, right: 20, bottom: 60, left: 70 };

  render(container: HTMLElement, data: ContractComparisonData[], viewContract: (contract: string) => void): void {
    d3.select(container).selectAll('*').remove();
    if (!data.length) {
      d3.select(container).append('div').attr('class','flex flex-col items-center justify-center h-full text-slate-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">analytics</span><span>Sem dados para comparação</span>');
      return;
    }

    const width = (d3.select(container).node() as any)?.getBoundingClientRect().width || 600;
    const cw = width - this.margin.left - this.margin.right;
    const ch = 300 - this.margin.top - this.margin.bottom;
    const svg = d3.select(container).append('svg')
      .attr('width', cw + this.margin.left + this.margin.right)
      .attr('height', ch + this.margin.top + this.margin.bottom)
      .append('g').attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    const x0 = d3.scaleBand().domain(data.map(d => d.contract)).rangeRound([0, cw]).paddingInner(0.2);
    const x1 = d3.scaleBand().domain(['expected','paid']).rangeRound([0, x0.bandwidth()]).padding(0.05);
    const maxVal = d3.max(data, d => Math.max(d.expected, d.paid)) || 0;
    const y = d3.scaleLinear().domain([0, maxVal * 1.15]).range([ch, 0]);

    // ── Grid lines (dashed) ──
    const grid = svg.append('g').attr('class','grid').call(
      d3.axisLeft(y).ticks(5).tickSize(-cw).tickFormat(() => '')
    );
    grid.selectAll('line').style('stroke','#E2E8F0').style('stroke-dasharray','4,4');
    grid.selectAll('.domain').remove();

    // ── Cutoff line: average expected ──
    const avgExpected = data.reduce((s, d) => s + d.expected, 0) / data.length;
    if (avgExpected > 0) {
      svg.append('line')
        .attr('x1', 0).attr('x2', cw)
        .attr('y1', y(avgExpected)).attr('y2', y(avgExpected))
        .attr('stroke', '#F59E0B').attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '8,4').attr('opacity', 0.7);
      svg.append('text')
        .attr('x', cw - 4).attr('y', y(avgExpected) - 4)
        .attr('text-anchor', 'end').style('font-size', '9px')
        .style('fill', '#D97706').style('font-weight', '600')
        .text(`Média: R$ ${(avgExpected / 1e3).toFixed(0)}K`);
    }

    // ── Axes ──
    svg.append('g').attr('transform', `translate(0,${ch})`).call(d3.axisBottom(x0))
      .selectAll('text').attr('transform','translate(-10,0)rotate(-25)').style('text-anchor','end')
      .style('font-size','9px').style('fill','#64748b');

    svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d => {
      const v = Number(d);
      if (v >= 1e6) return `R$ ${(v/1e6).toFixed(1)}M`;
      if (v >= 1e3) return `R$ ${(v/1e3).toFixed(0)}K`;
      return `R$ ${v}`;
    })).selectAll('text').style('font-size','10px').style('fill','#64748b');

    // ── Tooltip ──
    const tip = d3.select(container).append('div')
      .attr('class','absolute z-20 hidden bg-slate-900 text-white text-[10px] rounded px-2 py-1 shadow-lg pointer-events-none');

    // ── Bars: blue for expected, green for paid ──
    const colors = { expected: '#3B82F6', paid: '#22C55E' };
    svg.selectAll('.g').data(data).join('g').attr('transform', d => `translate(${x0(d.contract)},0)`)
      .selectAll('rect').data(d => [
        { key:'expected', value:d.expected, label:'Previsto Anual', contract:d.contract },
        { key:'paid', value:d.paid, label:'Pago Efetivo', contract:d.contract },
      ]).join('rect')
      .attr('x', d => x1(d.key) || 0).attr('y', d => y(d.value))
      .attr('width', x1.bandwidth()).attr('height', d => ch - y(d.value))
      .attr('fill', d => colors[d.key as keyof typeof colors]).attr('rx',2).style('cursor','pointer')
      .on('click', (event, d) => viewContract(d.contract))
      .on('mouseover', function (event, d) {
        d3.select(this).attr('opacity',.8);
        const fmt = `R$ ${d.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        tip.html(`<strong>${d.contract}</strong><br>${d.label}: ${fmt}`).classed('hidden',false);
      }).on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, container);
        tip.style('left', (x + 10) + 'px').style('top', (y - 20) + 'px');
      }).on('mouseout', function () { d3.select(this).attr('opacity',1); tip.classed('hidden',true); });
  }
}
