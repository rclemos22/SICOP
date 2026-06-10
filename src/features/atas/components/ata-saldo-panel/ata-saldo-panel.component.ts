import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, inject, input, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SaldoAtaService } from '../../services/saldo-ata.service';
import { AtaPdfService } from '../../services/ata-pdf.service';
import { Ata, AtaItem, SaldoItem, AtaConsumoInterno, AtaAdesao, getAdesaoStatusLabel, getAdesaoStatusClass } from '../../../../shared/models/ata.model';

@Component({
  selector: 'app-ata-saldo-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './ata-saldo-panel.component.html',
})
export class AtaSaldoPanelComponent implements OnInit {
  private saldoService = inject(SaldoAtaService);
  private pdfService = inject(AtaPdfService);

  ata = input.required<Ata>();
  itens = input<AtaItem[]>([]);

  activeTab = signal<'saldo' | 'consumo' | 'adesoes'>('saldo');

  readonly saldos = this.saldoService.saldos;
  readonly loading = this.saldoService.loading;

  // Consumo form
  showConsumoForm = signal(false);
  consumoForm = { ata_item_id: '', quantidade: 0, documento_sei: '', data_consumo: '', observacao: '' };

  // Adesão form
  showAdesaoForm = signal(false);
  adesaoForm = { ata_item_id: '', cnpj_orgao: '', razao_orgao: '', quantidade_solicitada: 0, justificativa: '' };

  // Validation messages
  validationError = signal<string | null>(null);

  // Loaded lists
  consumos = signal<AtaConsumoInterno[]>([]);
  adesoes = signal<AtaAdesao[]>([]);

  // Helpers
  getAdesaoStatusLabel = getAdesaoStatusLabel;
  getAdesaoStatusClass = getAdesaoStatusClass;

  // Saldo total
  saldoGlobal = computed(() => {
    const items = this.saldos();
    return {
      registrado: items.reduce((a, b) => a + b.quantidade_registrada, 0),
      consumido: items.reduce((a, b) => a + b.quantidade_consumida_interna, 0),
      aderido: items.reduce((a, b) => a + b.quantidade_aderida, 0),
      disponivel: items.reduce((a, b) => a + b.saldo_disponivel, 0),
    };
  });

  ngOnInit(): void {
    this.loadData();
  }

  private async loadData() {
    const ataId = this.ata().id;
    await Promise.all([
      this.saldoService.loadSaldos(ataId),
      this.loadConsumos(),
      this.loadAdesoes(),
    ]);
  }

  private async loadConsumos() {
    const result = await this.saldoService.listarConsumos(this.ata().id);
    if (!result.error) this.consumos.set(result.data!);
  }

  private async loadAdesoes() {
    const result = await this.saldoService.listarAdesoes(this.ata().id);
    if (!result.error) this.adesoes.set(result.data!);
  }

  setActiveTab(tab: 'saldo' | 'consumo' | 'adesoes') {
    this.activeTab.set(tab);
    this.validationError.set(null);
  }

  // ---- Consumo ----
  openConsumoForm() {
    this.consumoForm = { ata_item_id: '', quantidade: 0, documento_sei: '', data_consumo: new Date().toISOString().split('T')[0], observacao: '' };
    this.validationError.set(null);
    this.showConsumoForm.set(true);
  }

  async submitConsumo() {
    const f = this.consumoForm;
    if (!f.ata_item_id || f.quantidade <= 0) {
      this.validationError.set('Selecione o item e informe a quantidade.');
      return;
    }

    const validacao = await this.saldoService.validarLimiteConsumoInterno(f.ata_item_id, f.quantidade);
    if (!validacao.permitido) {
      this.validationError.set(validacao.motivo!);
      return;
    }

    const result = await this.saldoService.registrarConsumo({
      ata_id: this.ata().id,
      ata_item_id: f.ata_item_id,
      quantidade: f.quantidade,
      documento_sei: f.documento_sei || undefined,
      data_consumo: f.data_consumo,
      observacao: f.observacao || undefined,
    });

    if (!result.error) {
      this.showConsumoForm.set(false);
      this.validationError.set(null);
      await this.loadData();
    }
  }

  async excluirConsumo(id: string) {
    if (!confirm('Excluir este registro de consumo?')) return;
    const result = await this.saldoService.excluirConsumo(id);
    if (!result.error) await this.loadData();
  }

  // ---- Adesões ----
  openAdesaoForm() {
    this.adesaoForm = { ata_item_id: '', cnpj_orgao: '', razao_orgao: '', quantidade_solicitada: 0, justificativa: '' };
    this.validationError.set(null);
    this.showAdesaoForm.set(true);
  }

  async submitAdesao() {
    const f = this.adesaoForm;
    if (!f.ata_item_id || !f.cnpj_orgao || !f.razao_orgao || f.quantidade_solicitada <= 0) {
      this.validationError.set('Preencha todos os campos obrigatórios.');
      return;
    }

    const validacao = await this.saldoService.validarLimiteAdesao(f.ata_item_id, f.quantidade_solicitada);
    if (!validacao.permitido) {
      this.validationError.set(validacao.motivo!);
      return;
    }

    const result = await this.saldoService.solicitarAdesao({
      ata_id: this.ata().id,
      ata_item_id: f.ata_item_id,
      cnpj_orgao: f.cnpj_orgao,
      razao_orgao: f.razao_orgao,
      quantidade_solicitada: f.quantidade_solicitada,
      justificativa: f.justificativa || undefined,
      status: 'PENDENTE',
      data_solicitacao: new Date().toISOString().split('T')[0],
    });

    if (!result.error) {
      this.showAdesaoForm.set(false);
      this.validationError.set(null);
      await this.loadData();
    }
  }

  async autorizarAdesao(adesao: AtaAdesao) {
    const qtd = prompt(`Autorizar quantidade para ${adesao.razao_orgao}:`, String(adesao.quantidade_solicitada));
    if (!qtd) return;
    const num = Number(qtd);
    if (num <= 0) return;

    const validacao = await this.saldoService.validarLimiteAdesao(adesao.ata_item_id, num);
    if (!validacao.permitido) {
      alert(validacao.motivo);
      return;
    }

    const result = await this.saldoService.autorizarAdesao(adesao.id!, num);
    if (!result.error) await this.loadData();
  }

  async rejeitarAdesao(adesao: AtaAdesao) {
    const justificativa = prompt('Justificativa para rejeição:');
    if (!justificativa) return;
    const result = await this.saldoService.rejeitarAdesao(adesao.id!, justificativa);
    if (!result.error) await this.loadData();
  }

  async cancelarAdesao(adesao: AtaAdesao) {
    if (!confirm(`Cancelar adesão de ${adesao.razao_orgao}?`)) return;
    const result = await this.saldoService.cancelarAdesao(adesao.id!);
    if (!result.error) await this.loadData();
  }

  exportPdf() {
    this.pdfService.gerarRelatorioSaldo(this.ata(), this.itens(), this.saldos());
  }

  // ---- Utility ----
  percentBarClass(pct: number): string {
    if (pct >= 100) return 'bg-red-500';
    if (pct >= 80) return 'bg-amber-500';
    return 'bg-green-500';
  }
}
