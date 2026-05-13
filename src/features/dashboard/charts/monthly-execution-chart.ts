import * as d3 from 'd3';

export interface MonthlyData {
  month: string;
  total: number;
}

export class MonthlyExecutionChart {
  private readonly margin = { top: 30, right: 20, bottom: 45, left: 55 };
  private readonly monthAbbr: Record<string, string> = {
    '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun',
    '07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez',
  };

  render(container: HTMLElement, data: MonthlyData[]): void {
    d3.select(container).selectAll('*').remove();
    if (data.length === 0) {
      d3.select(container).append('div').attr('class', 'flex flex-col items-center justify-center h-full text-gray-400 text-sm')
        .html('<span class="material-symbols-outlined text-3xl mb-2">bar_chart</span><span>Sem dados de execução</span>');
      return;
    }

    const w = 420 - this.margin.left - this.margin.right;
    const h = 200 - this.margin.top - this.margin.bottom;
    const svg = d3.select(container).append('svg')
      .attr('width', w + this.margin.left + this.margin.right)
      .attr('height', h + this.margin.top + this.margin.bottom)
      .append('g').attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', 'gradME').attr('x1','0%').attr('y1','0%').attr('x2','0%').attr('y2','100%');
    grad.append('stop').attr('offset','0%').attr('stop-color','#60A5FA');
    grad.append('stop').attr('offset','100%').attr('stop-color','#3B82F6');

    const x = d3.scaleBand().domain(data.map(d => d.month)).rangeRound([0, w]).padding(0.3);
    const maxVal = d3.max(data, d => d.total) || 0;
    const y = d3.scaleLinear().domain([0, maxVal * 1.15]).range([h, 0]);

    svg.append('g').attr('class','grid')
      .call(d3.axisLeft(y).ticks(4).tickSize(-w).tickFormat(() => ''))
      .selectAll('line').style('stroke','#E5E7EB').style('stroke-dasharray','3,3');
    svg.selectAll('.grid .domain').remove();

    svg.append('g').attr('class','x-axis').attr('transform',`translate(0,${h})`)
      .call(d3.axisBottom(x).tickFormat(d => {
        const p = (d as string).split('-');
        return `${this.monthAbbr[p[1]] || d}/${p[0].slice(2)}`;
      })).selectAll('text').style('font-size','9px').style('fill','#6B7280').style('font-weight','500');

    svg.append('g').attr('class','y-axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d => {
        const v = Number(d);
        if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`;
        if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`;
        return v.toString();
      })).selectAll('text').style('font-size','10px').style('fill','#6B7280');

    const tip = d3.select(container).append('div')
      .attr('class','absolute z-20 hidden bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none')
      .style('opacity',0);

    svg.selectAll('.bar').data(data).join('rect').attr('class','bar')
      .attr('x', d => x(d.month) || 0).attr('y', d => y(d.total))
      .attr('width', x.bandwidth()).attr('height', d => h - y(d.total))
      .attr('fill','url(#gradME)').attr('rx',3).style('cursor','pointer')
      .on('mouseover', function (event, d) {
        d3.select(this).style('opacity',.85);
        tip.html(`<div class="font-bold mb-1">Total Executado</div><div class="text-gray-300">R$ ${d.total.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>`)
          .style('opacity',1).classed('hidden',false);
      }).on('mousemove', function (event) {
        const [x,y] = d3.pointer(event,container); tip.style('left',`${x+10}px`).style('top',`${y-10}px`);
      }).on('mouseout', function () { d3.select(this).style('opacity',1); tip.style('opacity',0).classed('hidden',true); });

    // Variation arrows
    if (data.length > 1) {
      data.slice(1).forEach((d,i) => {
        const prev = data[i].total;
        const varPct = prev > 0 ? ((d.total - prev) / prev) * 100 : 0;
        if (varPct === 0) return;
        const xPos = x(d.month)! + x.bandwidth() / 2;
        const g = svg.append('g').attr('transform',`translate(${xPos},-8)`).style('cursor','pointer');
        const pos = varPct >= 0; const color = pos ? '#22C55E' : '#EF4444';
        g.append('text').attr('text-anchor','middle').attr('dy','0.35em').style('font-size','14px').style('fill',color).text(pos ? '▲' : '▼');
        g.append('text').attr('text-anchor','middle').attr('y',14).style('font-size','8px').style('fill',color).style('font-weight','600')
          .text(`${Math.abs(varPct).toFixed(0)}%`);
      });
    }

    const last = data[data.length - 1];
    if (last) {
      svg.append('text').attr('x',w/2).attr('y',-10).attr('text-anchor','middle')
        .style('font-size','11px').style('fill','#374151').style('font-weight','600')
        .text(`Total: ${last.total.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:0})}`);
    }
  }
}
