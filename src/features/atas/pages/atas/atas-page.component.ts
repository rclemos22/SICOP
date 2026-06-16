import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Ata, AtaStatus, AtaItem, getAtaStatusClass, getAtaStatusLabel } from '../../../../shared/models/ata.model';
import { AtaService } from '../../services/ata.service';
import { AtaFormComponent } from '../../components/ata-form/ata-form.component';
import { AtaSaldoPanelComponent } from '../../components/ata-saldo-panel/ata-saldo-panel.component';

@Component({
  selector: 'app-atas-page',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DecimalPipe, AtaFormComponent, AtaSaldoPanelComponent],
  templateUrl: './atas-page.component.html',
})
export class AtasPageComponent {
  private ataService = inject(AtaService);

  // State
  searchQuery = signal('');
  filterStatus = signal<'ALL' | AtaStatus>('ALL');

  // Drawer
  selectedAta = signal<Ata | null>(null);
  selectedAtaItens = signal<AtaItem[]>([]);
  isEditing = signal(false);
  isCreating = signal(false);
  saving = signal(false);
  saveError = signal<string | null>(null);

  // Helpers
  getStatusClass = getAtaStatusClass;
  getStatusLabel = getAtaStatusLabel;

  readonly atas = this.ataService.atas;
  readonly loading = this.ataService.loading;

  filteredAtas = computed(() => {
    const all = this.atas();
    const query = this.searchQuery().toLowerCase();
    const status = this.filterStatus();

    return all.filter(a => {
      const matchesSearch = !query ||
        a.numero_processo.toLowerCase().includes(query) ||
        a.numero_ata.toLowerCase().includes(query) ||
        (a.fornecedor_nome?.toLowerCase() || '').includes(query) ||
        (a.objeto?.toLowerCase() || '').includes(query);

      const matchesStatus = status === 'ALL' || a.status === status;
      return matchesSearch && matchesStatus;
    });
  });

  updateSearch(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  setFilterStatus(status: 'ALL' | AtaStatus) {
    this.filterStatus.set(status);
  }

  // --- Drawer Actions ---

  openCreate() {
    this.selectedAta.set(null);
    this.selectedAtaItens.set([]);
    this.isEditing.set(false);
    this.isCreating.set(true);
  }

  async openDetails(ata: Ata) {
    this.selectedAta.set(ata);
    this.isEditing.set(false);
    this.isCreating.set(false);

    // Load full details with items
    const result = await this.ataService.loadAtaById(ata.id);
    if (!result.error && result.data) {
      this.selectedAta.set(result.data);
      this.selectedAtaItens.set(result.data.itens || []);
    }
  }

  closeDetails() {
    this.selectedAta.set(null);
    this.selectedAtaItens.set([]);
    this.isEditing.set(false);
    this.isCreating.set(false);
  }

  toggleEditMode() {
    this.isEditing.set(!this.isEditing());
  }

  async saveChanges(data: { header: Partial<Ata>; itens: AtaItem[] }) {
    this.saving.set(true);
    this.saveError.set(null);

    try {
      if (this.isCreating()) {
        const result = await this.ataService.addAta(data.header);
        if (result.error) {
          this.saveError.set(result.error);
          return;
        }

        const createdId = result.data;
        if (createdId && data.itens.length > 0) {
          const itensResult = await this.ataService.saveItens(createdId, data.itens);
          if (itensResult.error) {
            this.saveError.set(itensResult.error);
            return;
          }
        }

        this.closeDetails();
      } else if (this.isEditing() && this.selectedAta()) {
        const id = this.selectedAta()!.id;
        const result = await this.ataService.updateAta(id, data.header);
        if (result.error) {
          this.saveError.set(result.error);
          return;
        }

        const itensResult = await this.ataService.saveItens(id, data.itens);
        if (itensResult.error) {
          this.saveError.set(itensResult.error);
          return;
        }

        this.selectedAta.update(current => current ? { ...current, ...data.header, itens: data.itens } : null);
        this.isEditing.set(false);
      }
    } catch (err: any) {
      this.saveError.set(err.message || 'Erro inesperado ao salvar');
      return;
    } finally {
      this.saving.set(false);
    }

    await this.ataService.loadAtas(false);
  }

  async deleteAta(ata: Ata) {
    if (confirm(`Excluir ata ${ata.numero_ata}?`)) {
      const result = await this.ataService.deleteAta(ata.id);
      if (!result.error) {
        this.closeDetails();
      }
    }
  }
}
