import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, signal, computed, inject, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Transaction,
  TransactionType,
  getTransactionTypeLabel,
  getTransactionTypeColorClass,
  getTransactionIcon,
  getTransactionIconBgClass
} from '../../../../shared/models/transaction.model';
import { getUnidadeLabel } from '../../../../shared/models/budget.model';

import { FinancialService } from '../../services/financial.service';
import { BudgetService } from '../../../budget/services/budget.service';
import { SigefSyncService } from '../../../../core/services/sigef-sync.service';
import { SigefBulkSyncService } from '../../../../core/services/sigef-bulk-sync.service';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-financial-page',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe, FormsModule],
  templateUrl: './financial-page.component.html'
})
export class FinancialPageComponent {
  public financialService  = inject(FinancialService);
  public budgetService     = inject(BudgetService);
  public sigefSyncService  = inject(SigefSyncService);
  public bulkSyncService   = inject(SigefBulkSyncService);

  // Mapa: Nota de Empenho -> Código Unidade Gestora
  private neToUgMap = computed(() => {
    const map = new Map<string, string>();
    for (const d of this.budgetService.allDotacoes()) {
      if (d.nunotaempenho && d.unid_gestora) {
        map.set(d.nunotaempenho, d.unid_gestora);
      }
    }
    return map;
  });

  // Resolve o label da unidade gestora para uma transação
  resolveUnidadeGestora(item: Transaction): string {
    // 1. Se já tem o label definido, usa
    if (item.unidade_gestora_label) {
      return item.unidade_gestora_label;
    }
    // 2. Senão, procura no mapa de dotações pelo commitment_id (NE)
    const ugCode = this.neToUgMap().get(item.commitment_id);
    if (ugCode) {
      return getUnidadeLabel(ugCode);
    }
    // 3. Se não encontrar, retorna --- (NÃO mostra mais o número da dotação)
    return '---';
  }

  // Signals
  searchQuery = signal('');
  activeTab = signal<'ALL' | 'PAYMENTS' | 'COMMITMENTS' | 'CANCELLED'>('ALL');

  // Advanced Filter State
  isFilterPanelOpen = signal(false);
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');
  filterType = signal<TransactionType | ''>('');
  filterContract = signal<string>('');
  filterCommitment = signal<string>('');

  // Pagination State
  currentPage = signal(1);
  pageSize = signal(PAGE_SIZE);

  // Expose Enum to Template
  TransactionType = TransactionType;

  // Helpers for Template
  getTypeLabel = getTransactionTypeLabel;
  getTypeClass = getTransactionTypeColorClass;
  getIcon = getTransactionIcon;
  getIconClass = getTransactionIconBgClass;

  constructor() {
    // Carregar dotações para o mapa de Unidade Gestora
    this.budgetService.loadDotacoes();

    // Reset to page 1 when filters change
    effect(() => {
      // Just accessing these signals to trigger the effect when they change
      this.searchQuery();
      this.activeTab();
      this.filterStartDate();
      this.filterEndDate();
      this.filterType();
      this.filterContract();
      this.filterCommitment();
      
      this.currentPage.set(1);
    });
  }

  // Logic - Filtered transactions
  filteredTransactions = computed(() => {
    // 1. Get Base Data
    const transactions = this.financialService.transactions();

    // 2. Get Filter Values
    const query = this.searchQuery().toLowerCase();
    const tab = this.activeTab();
    const startDate = this.filterStartDate();
    const endDate = this.filterEndDate();
    const type = this.filterType();
    const contract = this.filterContract().toLowerCase();
    const commitment = this.filterCommitment().toLowerCase();

    return transactions.filter(t => {
      // Tab Filter
      if (tab === 'PAYMENTS' && t.type !== TransactionType.LIQUIDATION) return false;
      if (tab === 'COMMITMENTS' && t.type !== TransactionType.COMMITMENT) return false;
      if (tab === 'CANCELLED' && t.type !== TransactionType.CANCELLATION) return false;

      // Advanced Filter: Type
      if (type && t.type !== type) return false;

      // Advanced Filter: Contract (Number match)
      if (contract && !t.contract_number?.toLowerCase().includes(contract)) return false;

      // Advanced Filter: Commitment (ID match)
      if (commitment && !t.commitment_id.toLowerCase().includes(commitment)) return false;

      // Advanced Filter: Date Range
      if (startDate) {
        const start = new Date(startDate);
        const tDate = new Date(t.date);
        tDate.setHours(0, 0, 0, 0);
        const sDate = new Date(start);
        sDate.setHours(0, 0, 0, 0);
        if (tDate < sDate) return false;
      }

      if (endDate) {
        const end = new Date(endDate);
        const tDate = new Date(t.date);
        tDate.setHours(0, 0, 0, 0);
        const eDate = new Date(end);
        eDate.setHours(0, 0, 0, 0);
        if (tDate > eDate) return false;
      }

      // Text Search (Global)
      if (query) {
        const matches =
          t.description.toLowerCase().includes(query) ||
          t.contract_number?.toLowerCase().includes(query) ||
          t.commitment_id.toLowerCase().includes(query) ||
          t.budget_description.toLowerCase().includes(query);

        if (!matches) return false;
      }

      return true;
    });
  });

  // Pagination - Paginated slice
  paginatedTransactions = computed(() => {
    const all = this.filteredTransactions();
    const start = (this.currentPage() - 1) * this.pageSize();
    return all.slice(start, start + this.pageSize());
  });

  // Pagination helpers
  totalPages = computed(() => Math.ceil(this.filteredTransactions().length / this.pageSize()));
  
  startIndex = computed(() => {
    if (this.filteredTransactions().length === 0) return 0;
    return (this.currentPage() - 1) * this.pageSize() + 1;
  });
  
  endIndex = computed(() => {
    const end = this.currentPage() * this.pageSize();
    return Math.min(end, this.filteredTransactions().length);
  });

  hasPrevPage = computed(() => this.currentPage() > 1);
  hasNextPage = computed(() => this.currentPage() < this.totalPages());

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  prevPage() {
    if (this.hasPrevPage()) {
      this.currentPage.update(p => p - 1);
    }
  }

  nextPage() {
    if (this.hasNextPage()) {
      this.currentPage.update(p => p + 1);
    }
  }

  // Page size change handler
  onPageSizeChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const newSize = Number(select.value);
    this.pageSize.set(newSize);
    this.currentPage.set(1);
  }

  // Actions
  setTab(tab: 'ALL' | 'PAYMENTS' | 'COMMITMENTS' | 'CANCELLED') {
    this.activeTab.set(tab);
  }

  updateSearch(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  toggleFilterPanel() {
    this.isFilterPanelOpen.update(v => !v);
  }

  clearFilters() {
    this.filterStartDate.set('');
    this.filterEndDate.set('');
    this.filterType.set('');
    this.filterContract.set('');
    this.filterCommitment.set('');
    this.searchQuery.set('');
  }

  /**
   * Atualiza o espelho com dados dos últimos 60 dias e depois recarrega os contratos.
   * Este é o comportamento do botão "Atualizar SIGEF" na tela financeira.
   */
  async syncGlobal() {
    try {
      console.log('[FinancialPage] Baixando dados dos últimos 60 dias...');
      // 1. Download bulk dos últimos 60 dias (NE + OB)
      await this.bulkSyncService.downloadLast60Days();

      // 2. Recarregar contratos a partir do espelho atualizado
      await this.sigefSyncService.syncAllContractsFinance(true);

      // 3. Recarregar lançamentos locais
      await this.financialService.loadAllTransactions();

      console.log('[FinancialPage] Atualização SIGEF concluída.');
    } catch (err: any) {
      console.error('[FinancialPage] Erro na atualização SIGEF:', err);
    }
  }

  /**
   * Indica se qualquer operação de sync está em andamento (bulk ou NE-a-NE).
   */
  isAnySyncing = computed(() =>
    this.bulkSyncService.isRunning() || this.sigefSyncService.isGlobalSyncing()
  );

  /**
   * Label dinâmico do botão de sync.
   */
  syncButtonLabel = computed(() => {
    if (this.bulkSyncService.isRunning()) {
      const p = this.bulkSyncService.progress();
      return `${p.currentLabel} (${p.percent}%)`;
    }
    if (this.sigefSyncService.isGlobalSyncing()) return 'Atualizando contratos...';
    return 'Atualizar SIGEF';
  });
}