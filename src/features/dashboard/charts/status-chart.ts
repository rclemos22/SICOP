import * as d3 from 'd3';

export interface StatusChartData {
  vigentes: number;
  finalizando: number;
  rescindidos: number;
  encerrados: number;
  total: number;
}

export class StatusChart {
  private svg: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  render(container: HTMLElement, data: StatusChartData): void {
    d3.select(container).selectAll('*').remove();
    if (data.total === 0) {
      d3.select(container).append('div').attr('class', 'flex items-center justify-center h-full text-gray-400 text-sm').text('Sem dados de contratos');
      return;
    }

    const items = [
      { label: 'Vigentes', value: data.vigentes, color: '#22C55E' },
      { label: 'Finalizando', value: data.finalizando, color: '#F59E0B' },
      { label: 'Rescindidos', value: data.rescindidos, color: '#EF4444' },
      { label: 'Encerrados', value: data.encerrados, color: '#9CA3AF' },
    ].filter(d => d.value > 0);

    const size = 180, margin = 10, radius = size / 2 - margin;
    this.svg = d3.select(container).append('svg').attr('width', size).attr('height', size)
      .append('g').attr('transform', `translate(${size / 2},${size / 2})`);

    const pie = d3.pie<any>().value((d: any) => d.value).sort(null);
    const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
    const hover = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 1.05);

    this.svg.selectAll('path').data(pie(items)).join('path')
      .attr('d', arc as any).attr('fill', (d: any) => d.data.color)
      .attr('stroke', 'white').style('stroke-width', '2px').style('cursor', 'pointer')
      .on('mouseover', function () { d3.select(this).transition().duration(200).attr('d', hover as any); })
      .on('mouseout', function () { d3.select(this).transition().duration(200).attr('d', arc as any); });

    this.svg.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
      .style('font-size', '24px').style('font-weight', 'bold').style('fill', '#374151').text(data.total);
  }
}
