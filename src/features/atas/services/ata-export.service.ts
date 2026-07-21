import { Injectable } from '@angular/core';
import { Ata, SaldoItem, AtaAdesao, getAdesaoStatusLabel } from '../../../shared/models/ata.model';

@Injectable({ providedIn: 'root' })
export class AtaExportService {

  exportSaldoCsv(ata: Ata, saldos: SaldoItem[], adesoes?: AtaAdesao[]): void {
    const header = [
      'Item', 'Descrição', 'Unidade', 'Quantidade Registrada',
      'Valor Unitário', 'Consumido Interno', 'Aderido (Carona)',
      'Saldo Disponível', '% Utilizado',
      'Limite Individual (50%)', 'Limite Coletivo (200%)', 'Saldo para Adesão',
    ];

    const rows = saldos.map(item => [
      item.numero_item,
      this.csvEscape(item.descricao_item),
      item.unidade || '',
      item.quantidade_registrada,
      item.valor_unitario,
      item.quantidade_consumida_interna,
      item.quantidade_aderida,
      item.saldo_disponivel,
      `${item.percentual_utilizado}%`,
      item.limite_individual ?? item.quantidade_registrada * 0.5,
      item.limite_coletivo ?? item.quantidade_registrada * 2.0,
      item.saldo_adesao ?? Math.max(0, (item.quantidade_registrada * 2.0) - item.quantidade_aderida),
    ]);

    const totals = [
      '', 'TOTAIS', '', saldos.reduce((a, b) => a + b.quantidade_registrada, 0),
      '', saldos.reduce((a, b) => a + b.quantidade_consumida_interna, 0),
      saldos.reduce((a, b) => a + b.quantidade_aderida, 0),
      saldos.reduce((a, b) => a + b.saldo_disponivel, 0),
      '', '', '', '',
    ];

    const lines = [
      `Relatório de Saldo de Ata - ${ata.numero_ata}`,
      `Processo: ${ata.numero_processo}`,
      `Fornecedor: ${ata.fornecedor_nome || '-'}`,
      `Status: ${ata.status}`,
      `Data de emissão: ${new Date().toLocaleDateString('pt-BR')}`,
      '',
      header.join(','),
      ...rows.map(r => r.join(',')),
      totals.join(','),
    ];

    // Seção de Órgãos Aderentes
    if (adesoes && adesoes.length > 0) {
      const saldoMap = new Map<string, number>();
      for (const s of saldos) {
        saldoMap.set(s.item_id, s.numero_item);
      }
      lines.push(
        '',
        'ÓRGÃOS ADERENTES (CARONA)',
        'Processo SEI,Órgão,CNPJ,Item,Quantidade,Status',
        ...adesoes
          .filter(a => a.status === 'AUTORIZADA' || a.status === 'PENDENTE')
          .map(a => [
            a.processo_sei || '-',
            this.csvEscape(a.razao_orgao),
            a.cnpj_orgao,
            saldoMap.get(a.ata_item_id) ?? '',
            a.quantidade_autorizada ?? a.quantidade_solicitada,
            getAdesaoStatusLabel(a.status),
          ].join(','))
      );
    }

    lines.push(
      '',
      'Dispositivo Legal: Art. 86, Lei 14.133/2021',
      '§ 3º - Limite individual: cada órgão não participante não poderá exceder 50% dos quantitativos dos itens registrados em ata.',
      '§ 4º - Limite coletivo: o total das adesões externas não poderá exceder o dobro (200%) do quantitativo de cada item.',
    );

    this.download(lines.join('\n'), `saldo_ata_${ata.numero_ata.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
  }

  exportAtasListCsv(atas: Ata[]): void {
    const header = [
      'Nº Ata', 'Nº Processo', 'Fornecedor', 'Objeto',
      'Valor Global', 'Status', 'Vigência Início', 'Vigência Fim', 'Qtd Itens',
    ];

    const rows = atas.map(ata => [
      this.csvEscape(ata.numero_ata),
      this.csvEscape(ata.numero_processo),
      this.csvEscape(ata.fornecedor_nome || '-'),
      this.csvEscape(ata.objeto || '-'),
      ata.valor_global,
      ata.status,
      ata.vigencia_inicio ? new Date(ata.vigencia_inicio).toLocaleDateString('pt-BR') : '-',
      ata.vigencia_fim ? new Date(ata.vigencia_fim).toLocaleDateString('pt-BR') : '-',
      ata.qtd_itens || 0,
    ]);

    const content = [
      `Relatório de Atas de Licitação`,
      `Data de emissão: ${new Date().toLocaleDateString('pt-BR')}`,
      '',
      header.join(','),
      ...rows.map(r => r.join(',')),
    ].join('\n');

    this.download(content, `atas_licitacao.csv`);
  }

  private csvEscape(value: string | number): string {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  private download(content: string, filename: string): void {
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
