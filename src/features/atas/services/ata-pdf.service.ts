import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Ata, AtaItem, SaldoItem, AtaAdesao, getAtaStatusLabel, getAdesaoStatusLabel } from '../../../shared/models/ata.model';

@Injectable({ providedIn: 'root' })
export class AtaPdfService {

  async gerarRelatorioSaldo(ata: Ata, itens: AtaItem[], saldos: SaldoItem[], adesoes: AtaAdesao[]): Promise<void> {
    try {
      console.log('[AtaPdfService] Iniciando geração do PDF...');
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 20;

      // Mapa de item_id → descricao
      const itemMap = new Map<string, string>();
      for (const item of itens) {
        if (item.id) itemMap.set(item.id, item.descricao);
      }

      // Cabeçalho com logo
      const logoBase64 = await this.loadLogoAsBase64();
    let headerY = 14;
    if (logoBase64) {
      doc.addImage(logoBase64, 'PNG', margin, 8, 22, 22);
      headerY = 14;
    }

    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text('DEFENSORIA PÚBLICA DO ESTADO', logoBase64 ? margin + 28 : margin, headerY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Supervisão de Informática', logoBase64 ? margin + 28 : margin, headerY + 5);

    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Emissão: ${new Date().toLocaleDateString('pt-BR')}`, pageW - margin, headerY + 2, { align: 'right' });

    // Linha separadora
    const lineY = headerY + 12;
    doc.setDrawColor(200);
    doc.line(margin, lineY, pageW - margin, lineY);

    // Título
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text('RELATÓRIO DE SALDO DE ATA', pageW / 2, lineY + 10, { align: 'center' });

    // Dados da Ata
    let yPos = lineY + 18;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Ata:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(`${ata.numero_ata}`, margin + 15, yPos);

    yPos += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('Processo:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(`${ata.numero_processo}`, margin + 25, yPos);

    yPos += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('Fornecedor:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(`${ata.fornecedor_nome || '-'}`, margin + 28, yPos);

    yPos += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('Status:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(`${getAtaStatusLabel(ata.status)}`, margin + 18, yPos);

    yPos += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('Vigência:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    const vigInicio = ata.vigencia_inicio ? new Date(ata.vigencia_inicio).toLocaleDateString('pt-BR') : '-';
    const vigFim = ata.vigencia_fim ? new Date(ata.vigencia_fim).toLocaleDateString('pt-BR') : '-';
    doc.text(`${vigInicio} a ${vigFim}`, margin + 23, yPos);

    // Objeto
    if (ata.objeto) {
      yPos += 7;
      doc.setFont('helvetica', 'bold');
      doc.text('Objeto:', margin, yPos);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(ata.objeto, pageW - margin * 2 - 20);
      doc.text(lines, margin + 18, yPos);
      yPos += lines.length * 4 + 2;
    } else {
      yPos += 7;
    }

    // Tabela de Itens e Saldos
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

    const tableStartY = yPos + 2;

    autoTable(doc, {
      startY: tableStartY,
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
        this.drawFooter(doc, pageW, data.pageNumber);
      },
    });

    // Tabela de Consolidação
    let yFinal = (doc as any).lastAutoTable.finalY + 8;
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
      didDrawPage: (data) => {
        this.drawFooter(doc, pageW, data.pageNumber);
      },
    });

    yFinal = (doc as any).lastAutoTable.finalY + 8;

    // Tabela de Órgãos Aderentes
    const adesoesFiltradas = adesoes.filter(a => a.status === 'AUTORIZADA' || a.status === 'PENDENTE');
    if (adesoesFiltradas.length > 0) {
      if (yFinal + 20 > doc.internal.pageSize.getHeight() - 30) {
        doc.addPage();
        yFinal = 20;
      }

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('ÓRGÃOS ADERENTES (CARONA)', pageW / 2, yFinal, { align: 'center' });
      yFinal += 6;

      const adesoesRows = adesoesFiltradas.map(a => {
        const saldoItem = saldos.find(s => s.item_id === a.ata_item_id);
        return [
          a.processo_sei || '-',
          a.razao_orgao,
          a.cnpj_orgao,
          String(saldoItem?.numero_item ?? ''),
          this.fmt(a.quantidade_autorizada ?? a.quantidade_solicitada),
          getAdesaoStatusLabel(a.status),
        ];
      });

      autoTable(doc, {
        startY: yFinal,
        head: [['Proc. SEI', 'Órgão', 'CNPJ', 'Item', 'Quantidade', 'Status']],
        body: adesoesRows,
        theme: 'grid',
        headStyles: {
          fillColor: [46, 160, 67],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 8,
          halign: 'center',
        },
        bodyStyles: { fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 34 },
          1: { cellWidth: 60 },
          2: { cellWidth: 26 },
          3: { halign: 'center', cellWidth: 10 },
          4: { halign: 'right', cellWidth: 22 },
          5: { halign: 'center', cellWidth: 18 },
        },
        margin: { left: margin, right: margin },
        didDrawPage: (data) => {
          this.drawFooter(doc, pageW, data.pageNumber);
        },
      });

      yFinal = (doc as any).lastAutoTable.finalY + 8;
    }

    // Nota Legal
    if (yFinal + 20 > doc.internal.pageSize.getHeight() - 10) {
      doc.addPage();
      yFinal = 20;
    }

    doc.setFontSize(7);
    doc.setTextColor(130);
    doc.text('Dispositivo Legal: Art. 86, Lei 14.133/2021.', margin, yFinal);
    doc.text('§ 3º — Limite individual: cada órgão não participante não poderá exceder 50% dos quantitativos dos itens registrados em ata.', margin, yFinal + 4);
    doc.text('§ 4º — Limite coletivo: o total das adesões externas não poderá exceder o dobro (200%) do quantitativo de cada item.', margin, yFinal + 8);
    doc.text('Referência de cálculo: quantitativo original registrado na ata — não o saldo disponível.', margin, yFinal + 12);

    // Salvar
    console.log('[AtaPdfService] Salvando PDF...');
    doc.save(`saldo_ata_${ata.numero_ata.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    console.log('[AtaPdfService] PDF gerado com sucesso.');
    } catch (err) {
      console.error('[AtaPdfService] Erro ao gerar PDF:', err);
    }
  }

  private drawFooter(doc: jsPDF, pageW: number, pageNumber: number): void {
    const pageCount = doc.getNumberOfPages();
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      `SICOP - Sistema de Controle de Contratos e Licitações | Página ${pageNumber} de ${pageCount}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  private async loadLogoAsBase64(): Promise<string | null> {
    for (const path of ['logo_dpema.png', 'assets/logo_dpema.png']) {
      try {
        const response = await fetch(path);
        if (!response.ok) continue;
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch {
        continue;
      }
    }
    console.warn('[AtaPdfService] Logo não encontrada, gerando relatório sem logotipo.');
    return null;
  }

  private fmt(val: number): string {
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
