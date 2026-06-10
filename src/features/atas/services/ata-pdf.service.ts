import { inject, Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Ata, AtaItem, SaldoItem, getAtaStatusLabel } from '../../../shared/models/ata.model';

@Injectable({ providedIn: 'root' })
export class AtaPdfService {

  gerarRelatorioSaldo(ata: Ata, itens: AtaItem[], saldos: SaldoItem[]): void {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 20;

    // Cabeçalho
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RELATÓRIO DE SALDO DE ATA', pageW / 2, 25, { align: 'center' });

    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Emissão: ${new Date().toLocaleDateString('pt-BR')}`, pageW - margin, 25, { align: 'right' });

    // Dados da Ata
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text('Ata:', margin, 40);
    doc.setFont('helvetica', 'normal');
    doc.text(`${ata.numero_ata}`, margin + 15, 40);

    doc.setFont('helvetica', 'bold');
    doc.text('Processo:', margin, 47);
    doc.setFont('helvetica', 'normal');
    doc.text(`${ata.numero_processo}`, margin + 25, 47);

    doc.setFont('helvetica', 'bold');
    doc.text('Fornecedor:', margin, 54);
    doc.setFont('helvetica', 'normal');
    doc.text(`${ata.fornecedor_nome || '-'}`, margin + 28, 54);

    doc.setFont('helvetica', 'bold');
    doc.text('Status:', margin, 61);
    doc.setFont('helvetica', 'normal');
    doc.text(`${getAtaStatusLabel(ata.status)}`, margin + 18, 61);

    doc.setFont('helvetica', 'bold');
    doc.text('Vigência:', margin, 68);
    doc.setFont('helvetica', 'normal');
    const vigInicio = ata.vigencia_inicio ? new Date(ata.vigencia_inicio).toLocaleDateString('pt-BR') : '-';
    const vigFim = ata.vigencia_fim ? new Date(ata.vigencia_fim).toLocaleDateString('pt-BR') : '-';
    doc.text(`${vigInicio} a ${vigFim}`, margin + 23, 68);

    // Objeto
    if (ata.objeto) {
      doc.setFont('helvetica', 'bold');
      doc.text('Objeto:', margin, 75);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(ata.objeto, pageW - margin * 2 - 20);
      doc.text(lines, margin + 18, 75);
    }

    // Tabela de Itens e Saldos
    const yInicio = ata.objeto ? 85 : 78;

    const bodyRows = itens.map(item => {
      const saldo = saldos.find(s => s.item_id === item.id);
      return [
        String(item.numero_item),
        item.descricao,
        item.unidade || '-',
        this.fmt(item.quantidade),
        this.fmt(item.valor_unitario),
        this.fmt(saldo?.quantidade_consumida_interna ?? 0),
        this.fmt(saldo?.quantidade_aderida ?? 0),
        this.fmt(saldo?.saldo_disponivel ?? item.quantidade),
        saldo ? `${saldo.percentual_utilizado}%` : '0%',
      ];
    });

    autoTable(doc, {
      startY: yInicio,
      head: [['#', 'Descrição', 'Unid.', 'Qtd Reg.', 'Valor Unit.', 'Consumido', 'Aderido', 'Disponível', '%']],
      body: bodyRows,
      theme: 'grid',
      headStyles: {
        fillColor: [33, 118, 255],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 7,
      },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right', fontStyle: 'bold' },
        8: { halign: 'center', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin },
      didDrawPage: (data) => {
        // Footer
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(
          `SICOP - Sistema de Controle de Contratos e Licitações | Página ${data.pageNumber} de ${pageCount}`,
          pageW / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'center' }
        );
      },
    });

    // Tabela de Consolidação
    const yFinal = (doc as any).lastAutoTable.finalY + 10;
    const totalReg = itens.reduce((a, b) => a + b.quantidade, 0);
    const totalCons = saldos.reduce((a, b) => a + b.quantidade_consumida_interna, 0);
    const totalAd = saldos.reduce((a, b) => a + b.quantidade_aderida, 0);
    const totalDisp = saldos.reduce((a, b) => a + b.saldo_disponivel, 0);
    const pctGeral = totalReg > 0 ? ((totalCons + totalAd) / totalReg * 100).toFixed(2) : '0.00';

    autoTable(doc, {
      startY: yFinal,
      head: [['Indicador', 'Valor']],
      body: [
        ['Quantidade Total Registrada', this.fmt(totalReg)],
        ['Total Consumido (Gestor)', this.fmt(totalCons)],
        ['Total Aderido (Carona)', this.fmt(totalAd)],
        ['Saldo Disponível', this.fmt(totalDisp)],
        ['Percentual Utilizado', `${pctGeral}%`],
      ],
      theme: 'grid',
      headStyles: { fillColor: [33, 118, 255], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        1: { halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin },
    });

    // Nota Legal
    const yNota = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(7);
    doc.setTextColor(130);
    doc.text('Base Legal: Lei 14.133/2021 (arts. 82-86) e Decreto 11.462/2023.', margin, yNota);
    doc.text('Órgão gerenciador: até 100% do item. Cada órgão aderente: até 50% por item. Total de adesões: até 50% do item.', margin, yNota + 4);

    // Salvar
    doc.save(`saldo_ata_${ata.numero_ata.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
  }

  private fmt(val: number): string {
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
