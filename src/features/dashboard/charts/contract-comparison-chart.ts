import * as d3 from 'd3';

export interface ContractComparisonData {
  contract: string;
  expected: number;
  paid: number;
}

export class ContractComparisonChart {
  private readonly margin = { top: 20, right: 20, bottom: 60, left: 70 };

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
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([ch, 0]);

    svg.append('g').attr('transform', `translate(0,${ch})`).call(d3.axisBottom(x0))
      .selectAll('text').attr('transform','translate(-10,0)rotate(-25)').style('text-anchor','end')
      .style('font-size','9px').style('fill','#64748b');

    svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d => {
      const v = Number(d);
      if (v >= 1e6) return `R$ ${(v/1e6).toFixed(1)}M`;
      if (v >= 1e3) return `R$ ${(v/1e3).toFixed(0)}K`;
      return `R$ ${v}`;
    })).selectAll('text').style('font-size','10px').style('fill','#64748b');

    const tip = d3.select(container).append('div')
      .attr('class','absolute z-20 hidden bg-slate-900 text-white text-[10px] rounded px-2 py-1 shadow-lg pointer-events-none');

    const colors = { expected: '#cbd5e1', paid: '#3b82f6' };
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
        tip.html(`<strong>${d.contract}</strong><br>${d.label}: R$ ${d.value.toLocaleString('pt-BR')}`).classed('hidden',false);
      }).on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, container);
        tip.style('left', (x + 10) + 'px').style('top', (y - 20) + 'px');
      }).on('mouseout', function () { d3.select(this).attr('opacity',1); tip.classed('hidden',true); });
  }
}
