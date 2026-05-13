import * as d3 from 'd3';

export interface PaymentComparisonData {
  month: string;
  expected: number;
  paid: number;
}

export class PaymentComparisonChart {
  private readonly margin = { top: 30, right: 20, bottom: 45, left: 60 };
  private readonly monthAbbr: Record<string, string> = {
    '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun',
    '07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez',
  };

  render(container: HTMLElement, data: PaymentComparisonData[]): void {
    d3.select(container).selectAll('*').remove();
    if (!data.some(d => d.expected > 0 || d.paid > 0)) {
      d3.select(container).append('div').attr('class','flex flex-col items-center justify-center h-full text-gray-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">compare_arrows</span><span>Sem dados de comparação</span>');
      return;
    }

    const w = 500 - this.margin.left - this.margin.right;
    const h = 220 - this.margin.top - this.margin.bottom;
    const svg = d3.select(container).append('svg')
      .attr('width', w + this.margin.left + this.margin.right)
      .attr('height', h + this.margin.top + this.margin.bottom)
      .append('g').attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    const x0 = d3.scaleBand().domain(data.map(d => d.month)).rangeRound([0, w]).paddingInner(0.25);
    const x1 = d3.scaleBand().domain(['expected','paid']).rangeRound([0, x0.bandwidth()]).padding(0.1);
    const maxVal = d3.max(data, d => Math.max(d.expected, d.paid)) || 0;
    const y = d3.scaleLinear().domain([0, maxVal * 1.15]).range([h, 0]);

    svg.append('g').attr('class','grid')
      .call(d3.axisLeft(y).ticks(4).tickSize(-w).tickFormat(() => ''))
      .selectAll('line').style('stroke','#E5E7EB').style('stroke-dasharray','3,3');
    svg.selectAll('.grid .domain').remove();

    svg.append('g').attr('class','x-axis').attr('transform',`translate(0,${h})`)
      .call(d3.axisBottom(x0).tickFormat(d => this.monthAbbr[(d as string).split('-')[1]] || d as string))
      .selectAll('text').style('font-size','9px').style('fill','#6B7280').style('font-weight','500');

    svg.append('g').attr('class','y-axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d => {
        const v = Number(d); if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`;
        if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`; return v.toString();
      })).selectAll('text').style('font-size','10px').style('fill','#6B7280');

    const tip = d3.select(container).append('div')
      .attr('class','absolute z-20 hidden bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none').style('opacity',0);

    const colors = { expected: '#60A5FA', paid: '#22C55E' };
    svg.selectAll('.group').data(data).join('g').attr('transform', d => `translate(${x0(d.month)},0)`)
      .selectAll('rect').data(d => [
        { key:'expected', value: d.expected }, { key:'paid', value: d.paid },
      ]).join('rect')
      .attr('x', d => x1(d.key) || 0).attr('y', d => y(d.value))
      .attr('width', x1.bandwidth()).attr('height', d => h - y(d.value))
      .attr('fill', d => colors[d.key as keyof typeof colors]).attr('rx',3).style('cursor','pointer')
      .on('mouseover', function (event, d) {
        d3.select(this).style('opacity',.85);
        const label = d.key === 'expected' ? 'Previsto' : 'Pago';
        tip.html(`<div class="font-bold mb-1">${label}</div><div class="text-gray-300">R$ ${d.value.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>`)
          .style('opacity',1).classed('hidden',false);
      }).on('mousemove', function (event) {
        const [x,y] = d3.pointer(event,container); tip.style('left',`${x+10}px`).style('top',`${y-10}px`);
      }).on('mouseout', function () { d3.select(this).style('opacity',1); tip.style('opacity',0).classed('hidden',true); });
  }
}
