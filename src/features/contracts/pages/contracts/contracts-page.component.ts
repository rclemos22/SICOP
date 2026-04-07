import { CommonModule } from '@angular/common';
import { Component, signal, computed, output, inject, OnInit, OnDestroy, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { AppContextService } from '../../../../core/services/app-context.service';
import { Contract, ContractStatus } from '../../../../shared/models/contract.model';
import { ContractCardComponent } from '../../components/contract-card/contract-card.component';
import { ContractFormComponent } from '../../components/contract-form/contract-form.component';
import { ContractListViewComponent } from '../../components/contract-list-view/contract-list-view.component';
import { ContractService } from '../../services/contract.service';

@Component({
  selector: 'app-contracts-page',
  standalone: true,
  imports: [CommonModule, ContractCardComponent, ContractListViewComponent, ContractFormComponent, FormsModule],
  templateUrl: './contracts-page.component.html',
})
export class ContractsPageComponent implements OnInit, OnDestroy {
  public contractService = inject(ContractService);
  private appContext = inject(AppContextService);

  // Input from parent (for editing)
  initialContract = input<any | null>(null);

  // Navigation Event
  createContract = output<void>();
  openContractDetails = output<string>();

  // Modal State
  isFormOpen = signal(false);
  selectedContract = signal<any | null>(null);

  // Layout State
  layoutMode = signal<'grid' | 'list'>('grid');

  // Signals for Filter State
  searchQuery = signal<string>('');
  viewMode = signal<'vigentes' | 'finalizados' | 'rescindidos'>('vigentes');

  // Advanced Filter State
  isFilterPanelOpen = signal(false);
  filterStatus = signal<ContractStatus[]>([]);
  filterSupplier = signal<string>('');
  filterNumber = signal<string>('');

  ContractStatus = ContractStatus; // For template access

  // ── Debounce para busca global ──────────────────────────────────────────

  private searchSubject = new Subject<string>();
  private searchSubscription: any;

  ngOnInit() {
    this.searchSubscription = this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged()
      )
      .subscribe(query => this.searchQuery.set(query));

    // Check if there's an initial contract to edit (passed from parent)
    const initial = this.initialContract();
    if (initial) {
      console.log('[ContractsPage] received initialContract for edit:', initial);
      this.openForm(initial);
    }
  }

  ngOnDestroy() {
    this.searchSubscription?.unsubscribe();
  }

  // ── Computed Properties ─────────────────────────────────────────────────

  /** Indica se há algum filtro ativo */
  hasActiveFilters = computed(() => {
    return this.filterStatus().length > 0 ||
      !!this.filterSupplier() ||
      !!this.filterNumber();
  });

  /** Estado de loading do service */
  isLoading = computed(() => this.contractService.loading());

  /** Indica se está em modo de busca (3+ caracteres) */
  isSearching = computed(() => this.searchQuery().trim().length >= 3);

  /**
   * Lista filtrada de contratos.
   *
   * A filtragem segue esta ordem:
   * 1. **Sobreposição de exercício**: (data_inicio <= fimAno) E (data_fim_efetiva >= inicioAno)
   * 2. **Status/View mode**: Vigentes vs Histórico
   * 3. **Filtros específicos**: fornecedor, número
   * 4. **Busca global**: texto livre
   *
   * Reage automaticamente a mudanças em `appContext.anoExercicio()`.
   */
  filteredContracts = computed(() => {
    const allContracts = this.contractService.contracts();

    // ── 0. Datas-limite do ano de exercício selecionado ──
    const anoSelecionado = this.appContext.anoExercicio();
    const inicioAno = new Date(anoSelecionado, 0, 1);
    const fimAno = new Date(anoSelecionado, 11, 31, 23, 59, 59);

    const globalQuery = this.searchQuery().toLowerCase().trim();
    const mode = this.viewMode();

    // Advanced filters
    const selectedStatuses = this.filterStatus();
    const supQuery = this.filterSupplier().toLowerCase().trim();
    const numQuery = this.filterNumber().toLowerCase().trim();

    const hasStatusFilter = selectedStatuses.length > 0;

    return allContracts.filter(c => {
      // ── 1. Global Search: When searching, show ALL contracts regardless of tab ──
      const effectiveStatus = c.status_efetivo;
      const days = c.dias_restantes ?? 0;
      const isExpired = days < 0;
      const isRescinded = c.status === ContractStatus.RESCINDIDO;

      const hasSearch = globalQuery.length >= 3;

      if (hasSearch) {
        // When searching, show all contracts that match the search query
        const matchesGlobalSearch = 
          c.contrato.toLowerCase().includes(globalQuery) ||
          c.contratada.toLowerCase().includes(globalQuery) ||
          (effectiveStatus && effectiveStatus.toLowerCase().includes(globalQuery));
        
        return matchesGlobalSearch;
      }

      // ── 2. No search: Apply tab filter ──
      // Sobreposição com o ano de exercício para vigentes
      const contratoInicio = new Date(c.data_inicio);
      const contratoFim = new Date(c.data_fim_efetiva);

      if (mode === 'vigentes') {
        if (contratoInicio > fimAno || contratoFim < inicioAno) {
          return false;
        }
      }

      // ── 3. Status/View Logic ──
      let matchesStatus = false;

      if (hasStatusFilter) {
        matchesStatus = selectedStatuses.includes(effectiveStatus);
      } else {
        if (mode === 'vigentes') {
          matchesStatus = !isRescinded && !isExpired;
        } else if (mode === 'rescindidos') {
          matchesStatus = isRescinded;
        } else {
          matchesStatus = isExpired && !isRescinded;
        }
      }

      // ── 4. Specific Field Filters ──
      const matchesSupplier = !supQuery || c.contratada.toLowerCase().includes(supQuery);
      const matchesNumber = !numQuery || c.contrato.toLowerCase().includes(numQuery);

      return matchesStatus && matchesSupplier && matchesNumber;
    });
  });

  activeCount = computed(() => {
    return this.filteredContracts().length;
  });

  // Actions
  setLayoutMode(mode: 'grid' | 'list') {
    this.layoutMode.set(mode);
  }

  /**
   * Busca com debounce: alimenta o Subject ao invés do signal diretamente.
   */
  updateSearch(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchSubject.next(input.value);
  }

  setViewMode(mode: 'vigentes' | 'finalizados' | 'rescindidos') {
    this.viewMode.set(mode);
    this.filterStatus.set([]);
  }

  toggleFilterPanel() {
    this.isFilterPanelOpen.update(v => !v);
  }

  toggleStatusFilter(status: ContractStatus) {
    this.filterStatus.update(current => {
      if (current.includes(status)) {
        return current.filter(s => s !== status);
      } else {
        return [...current, status];
      }
    });
  }

  clearFilters() {
    this.filterStatus.set([]);
    this.filterSupplier.set('');
    this.filterNumber.set('');
    this.searchQuery.set('');
  }

  // Modal Actions
  openForm(contract?: any) {
    if (contract) {
      console.log('=== [openForm] Editing contract:', contract);
      console.log('=== [openForm] contract.id:', contract.id);
      this.selectedContract.set(contract);
    } else {
      this.selectedContract.set(null);
    }
    this.isFormOpen.set(true);
  }

  closeForm() {
    this.isFormOpen.set(false);
    this.selectedContract.set(null);
  }

  async handleSave(data: any) {
    console.log('=== [handleSave] dados recebidos:', data);
    console.log('=== [handleSave] selectedContract (isEditing):', this.selectedContract());
    
    const contractData = {
      contrato: data.number,
      processo_sei: data.processNumber || null,
      link_sei: data.linkSei || null,
      contratada: data.supplier,
      cnpj_contratada: data.cnpjContratada || null,
      fornecedor_id: data.fornecedor_id || null,
      data_inicio: data.startDate ? new Date(data.startDate).toISOString().split('T')[0] : null,
      data_fim: data.endDate ? new Date(data.endDate).toISOString().split('T')[0] : null,
      valor_anual: Number(data.totalValue),
      valor_mensal: data.monthlyValue ? Number(data.monthlyValue) : null,
      data_pagamento: data.data_pagamento || null,
      status: data.status as ContractStatus,
      setor_id: (data.department && data.department.length === 36) ? data.department : null,
      unid_gestora: data.unid_gestora,
      objeto: data.object,
      gestor_contrato: data.gestor_contrato || null,
      fiscal_admin: data.fiscal_admin || null,
      fiscal_tecnico: data.fiscal_tecnico || null
    };
    
    console.log('=== [handleSave] contractData formatted:', JSON.stringify(contractData, null, 2));

    try {
      const isEditing = this.selectedContract();
      console.log('=== [handleSave] isEditing check:', !!isEditing);
      console.log('=== [handleSave] contract id:', isEditing?.id);
      console.log('=== [handleSave] contrato number:', isEditing?.contrato);
      
      if (isEditing && isEditing.id) {
        // Update existing contract
        console.log('=== [handleSave] Calling updateContract with id:', isEditing.id);
        console.log('=== [handleSave] id typeof:', typeof isEditing.id);
        console.log('=== [handleSave] contractData:', JSON.stringify(contractData, null, 2));
        const result = await this.contractService.updateContract(isEditing.id, contractData as any);
        console.log('=== [handleSave] updateContract result:', JSON.stringify(result));
        console.log('=== [handleSave] updateContract hasError:', result.error ? 'YES' : 'NO');
        if (result.error) {
          alert('Erro ao atualizar contrato: ' + result.error);
          return;
        }
        console.log('Contrato atualizado com sucesso');
      } else {
        // Create new contract
        const result = await this.contractService.addContract(contractData as any);
        if (result.error) {
          alert('Erro ao salvar contrato: ' + result.error);
          return;
        }
        console.log('Contrato salvo com sucesso');
      }
      
      this.closeForm();
    } catch (err) {
      console.error('Erro ao salvar contrato:', err);
      alert('Erro ao salvar contrato');
    }
  }

  handleSelect(contractId: string) {
    this.openContractDetails.emit(contractId);
  }
}