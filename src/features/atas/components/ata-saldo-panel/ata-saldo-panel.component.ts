import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, inject, input, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SaldoAtaService } from '../../services/saldo-ata.service';
import { AtaPdfService } from '../../services/ata-pdf.service';
import { AtaExportService } from '../../services/ata-export.service';
import { Ata, AtaItem, SaldoItem, AtaConsumoInterno, AtaAdesao, getAdesaoStatusLabel, getAdesaoStatusClass } from '../../../../shared/models/ata.model';

@Component({
  selector: 'app-ata-saldo-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './ata-saldo-panel.component.html',
})
export class AtaSaldoPanelComponent implements OnInit {
  protected Math = Math;

  private saldoService = inject(SaldoAtaService);
  private pdfService = inject(AtaPdfService);
  private exportService = inject(AtaExportService);

  ata = input.required<Ata>();
  itens = input<AtaItem[]>([]);

  activeTab = signal<'itens' | 'saldo' | 'consumo' | 'adesoes'>('itens');

  readonly saldos = this.saldoService.saldos;
  readonly loading = this.saldoService.loading;
  readonly saldoError = this.saldoService.error;

  // Consumo form
  showConsumoForm = signal(false);
  consumoForm = { ata_item_id: '', quantidade: 0, documento_sei: '', data_consumo: '', observacao: '' };

  // Adesão form
  showAdesaoForm = signal(false);
  adesaoForm = { itens: [] as Array<{ ata_item_id: string; quantidade: number }>, razao_orgao: '', processo_sei: '', justificativa: '' };

  // Validation messages
  validationError = signal<string | null>(null);

  // Authorization modal
  showAuthModal = signal<AtaAdesao | null>(null);
  authItemSelecionado = signal<{ itemId: string; itemNumero: number; itemDescricao: string } | null>(null);
  authQuantidade = signal(0);
  authValidation = signal<{ permitido: boolean; motivo?: string; maximoPermitido: number } | null>(null);

  // Rejection modal
  showRejectModal = signal<AtaAdesao | null>(null);
  rejectJustificativa = signal('');

  // Loaded lists
  consumos = signal<AtaConsumoInterno[]>([]);
  adesoes = signal<AtaAdesao[]>([]);

  // Helpers
  getAdesaoStatusLabel = getAdesaoStatusLabel;
  getAdesaoStatusClass = getAdesaoStatusClass;

  // Total dos itens
  totalItens = computed(() =>
    this.itens().reduce((acc, i) => acc + (i.quantidade * i.valor_unitario), 0)
  );

  // Saldo total
  saldoGlobal = computed(() => {
    const items = this.saldos();
    return {
      registrado: items.reduce((a, b) => a + b.quantidade_registrada, 0),
      consumido: items.reduce((a, b) => a + b.quantidade_consumida_interna, 0),
      aderido: items.reduce((a, b) => a + b.quantidade_aderida, 0),
      disponivel: items.reduce((a, b) => a + b.saldo_disponivel, 0),
      consumoInterno: items.reduce((a, b) => a + b.saldo_consumo_interno, 0),
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

  setActiveTab(tab: 'itens' | 'saldo' | 'consumo' | 'adesoes') {
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
    const itensIniciais = this.saldos().map(s => ({
      ata_item_id: s.item_id,
      quantidade: 0,
    }));
    this.adesaoForm = { itens: itensIniciais, razao_orgao: '', processo_sei: '', justificativa: '' };
    this.validationError.set(null);
    this.showAdesaoForm.set(true);
  }

  toggleItemSelecionado(itemId: string) {
    const itens = this.adesaoForm.itens;
    const idx = itens.findIndex(i => i.ata_item_id === itemId);
    if (idx >= 0) {
      if (itens[idx].quantidade > 0) {
        itens[idx].quantidade = 0;
      } else {
        itens[idx].quantidade = 1;
      }
      this.adesaoForm = { ...this.adesaoForm, itens: [...itens] };
    }
  }

  getItemQuantidade(itemId: string): number {
    const found = this.adesaoForm.itens.find(i => i.ata_item_id === itemId);
    return found?.quantidade ?? 0;
  }

  setItemQuantidade(itemId: string, qtd: number) {
    const itens = this.adesaoForm.itens;
    const idx = itens.findIndex(i => i.ata_item_id === itemId);
    if (idx >= 0) {
      itens[idx].quantidade = Math.max(0, qtd);
      this.adesaoForm = { ...this.adesaoForm, itens: [...itens] };
    }
  }

  onItemQtdInput(event: Event, itemId: string) {
    const target = event.target as HTMLInputElement;
    this.setItemQuantidade(itemId, Number(target.value));
  }

  getAuthAtaItemId(): string {
    const adesao = this.showAuthModal();
    const selItem = this.authItemSelecionado();
    if (!adesao || !selItem) return '';
    const itemAtual = adesao.itens?.find(i => i.id === selItem.itemId);
    return itemAtual?.ata_item_id || adesao.ata_item_id || '';
  }

  getItensSelecionados() {
    return this.adesaoForm.itens.filter(i => i.quantidade > 0);
  }

  async submitAdesao() {
    const f = this.adesaoForm;
    const itensSelecionados = this.getItensSelecionados();

    if (!f.razao_orgao) {
      this.validationError.set('Informe a Razão Social do órgão solicitante.');
      return;
    }

    if (itensSelecionados.length === 0) {
      this.validationError.set('Selecione ao menos um item e informe a quantidade.');
      return;
    }

    const validacao = await this.saldoService.validarMultiplosItens(itensSelecionados, f.razao_orgao);
    if (!validacao.permitido) {
      this.validationError.set(validacao.motivo!);
      return;
    }

    const result = await this.saldoService.solicitarAdesao({
      ata_id: this.ata().id,
      razao_orgao: f.razao_orgao,
      processo_sei: f.processo_sei || undefined,
      itens: itensSelecionados.map(i => ({
        adesao_id: '',
        ata_item_id: i.ata_item_id,
        quantidade_solicitada: i.quantidade,
      })),
      justificativa: f.justificativa || undefined,
      status: 'PENDENTE',
      data_solicitacao: new Date().toISOString().split('T')[0],
    });

    if (result.error) {
      this.validationError.set(result.error);
      return;
    }

    this.showAdesaoForm.set(false);
    this.validationError.set(null);
    await this.loadData();
  }

  openAuthModal(adesao: AtaAdesao) {
    this.showAuthModal.set(adesao);
    this.authItemSelecionado.set(null);
    this.authQuantidade.set(0);
    this.authValidation.set(null);

    if (adesao.itens && adesao.itens.length > 0) {
      const primeiroItem = adesao.itens[0];
      const saldoItem = this.getSaldoItem(primeiroItem.ata_item_id);
      this.authItemSelecionado.set({
        itemId: primeiroItem.id || '',
        itemNumero: saldoItem?.numero_item || 0,
        itemDescricao: saldoItem?.descricao_item || '',
      });
      this.authQuantidade.set(primeiroItem.quantidade_solicitada);
      this.validateAuthQuantidade(adesao, primeiroItem.ata_item_id, primeiroItem.quantidade_solicitada);
    }
  }

  selectAuthItem(item: { itemId: string; ataItemId: string; qtdSolicitada: number }) {
    const saldoItem = this.getSaldoItem(item.ataItemId);
    this.authItemSelecionado.set({
      itemId: item.itemId,
      itemNumero: saldoItem?.numero_item || 0,
      itemDescricao: saldoItem?.descricao_item || '',
    });
    this.authQuantidade.set(item.qtdSolicitada);
    this.validateAuthQuantidade(this.showAuthModal()!, item.ataItemId, item.qtdSolicitada);
  }

  async validateAuthQuantidade(adesao: AtaAdesao, ataItemId: string, quantidade: number) {
    if (quantidade <= 0) {
      this.authValidation.set({ permitido: false, motivo: 'Quantidade deve ser maior que zero.', maximoPermitido: 0 });
      return;
    }
    const result = await this.saldoService.validarLimiteAdesao(ataItemId, quantidade, adesao.cnpj_orgao);
    this.authValidation.set(result);
  }

  async confirmAutorizarAdesao() {
    const adesao = this.showAuthModal();
    const quantidade = this.authQuantidade();
    const itemSelecionado = this.authItemSelecionado();
    if (!adesao || quantidade <= 0) return;

    const validacao = this.authValidation();
    if (!validacao?.permitido) return;

    if (itemSelecionado && itemSelecionado.itemId) {
      const result = await this.saldoService.autorizarAdesao(adesao.id!, quantidade, itemSelecionado.itemId);
      if (!result.error) {
        this.showAuthModal.set(null);
        this.authValidation.set(null);
        await this.loadData();
      }
    } else {
      const result = await this.saldoService.autorizarAdesao(adesao.id!, quantidade);
      if (!result.error) {
        this.showAuthModal.set(null);
        this.authValidation.set(null);
        await this.loadData();
      }
    }
  }

  cancelAuthModal() {
    this.showAuthModal.set(null);
    this.authValidation.set(null);
  }

  onAuthQuantidadeInput(event: Event, ataItemId: string) {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);
    this.authQuantidade.set(value);
    this.validateAuthQuantidade(this.showAuthModal()!, ataItemId, value);
  }

  openRejectModal(adesao: AtaAdesao) {
    this.showRejectModal.set(adesao);
    this.rejectJustificativa.set('');
  }

  async confirmRejeitarAdesao() {
    const adesao = this.showRejectModal();
    const justificativa = this.rejectJustificativa();
    if (!adesao || !justificativa.trim()) return;

    const result = await this.saldoService.rejeitarAdesao(adesao.id!, justificativa.trim());
    if (!result.error) {
      this.showRejectModal.set(null);
      await this.loadData();
    }
  }

  cancelRejectModal() {
    this.showRejectModal.set(null);
  }

  async cancelarAdesao(adesao: AtaAdesao) {
    if (adesao.status === 'AUTORIZADA') {
      alert('Solicitações de adesão autorizadas não podem ser canceladas.');
      return;
    }
    if (!confirm(`Cancelar adesão de ${adesao.razao_orgao}?`)) return;
    const result = await this.saldoService.cancelarAdesao(adesao.id!);
    if (!result.error) await this.loadData();
    else alert(result.error);
  }

  async excluirAdesao(adesao: AtaAdesao) {
    if (adesao.status === 'AUTORIZADA') {
      alert('Solicitações de adesão autorizadas não podem ser excluídas.');
      return;
    }
    if (!confirm(`Deseja excluir a solicitação de adesão de ${adesao.razao_orgao}?`)) return;
    const result = await this.saldoService.excluirAdesao(adesao.id!);
    if (!result.error) await this.loadData();
    else alert(result.error);
  }

  async exportPdf() {
    await this.pdfService.gerarRelatorioSaldo(this.ata(), this.itens(), this.saldos(), this.adesoes());
  }

  exportCsv() {
    this.exportService.exportSaldoCsv(this.ata(), this.saldos(), this.adesoes());
  }

  getSaldoItem(ataItemId: string): SaldoItem | undefined {
    return this.saldos().find(s => s.item_id === ataItemId);
  }

  percentualDisponivelAdesao(item: SaldoItem): number {
    if (item.quantidade_registrada <= 1) return 0;
    if (item.percentual_disponivel_adesao != null) return item.percentual_disponivel_adesao;
    return Number((((item.saldo_adesao_total) / item.quantidade_registrada) * 100).toFixed(2));
  }

  // ---- Utility ----
  percentBarClass(pct: number): string {
    if (pct >= 100) return 'bg-red-500';
    if (pct >= 80) return 'bg-amber-500';
    return 'bg-green-500';
  }

  riskLevel(pct: number): { label: string; class: string } {
    if (pct >= 100) return { label: 'Esgotado', class: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800' };
    if (pct >= 80) return { label: 'Crítico', class: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800' };
    if (pct >= 50) return { label: 'Atenção', class: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800' };
    return { label: 'Normal', class: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800' };
  }
}
