import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Transaction,
  TransactionType,
  getTransactionTypeLabel,
  getTransactionTypeColorClass,
  getTransactionIcon,
  getTransactionIconBgClass
} from '../../../../shared/models/transaction.model';

import { FinancialService } from '../../services/financial.service';
import { SigefSyncService } from '../../../../core/services/sigef-sync.service';
import { SigefBulkSyncService } from '../../../../core/services/sigef-bulk-sync.service';

@Component({
  selector: 'app-financial-page',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  templateUrl: './financial-page.component.html'
})
export class FinancialPageComponent {
  public financialService  = inject(FinancialService);
  public sigefSyncService  = inject(SigefSyncService);
  public bulkSyncService   = inject(SigefBulkSyncService);

  // Signals
  searchQuery = signal('');
  activeTab = signal<'ALL' | 'PAYMENTS' | 'COMMITMENTS'>('ALL');

  // Advanced Filter State
  isFilterPanelOpen = signal(false);
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');
  filterType = signal<TransactionType | ''>('');
  filterContract = signal<string>('');
  filterCommitment = signal<string>('');

  // Expose Enum to Template
  TransactionType = TransactionType;

  // Helpers for Template
  getTypeLabel = getTransactionTypeLabel;
  getTypeClass = getTransactionTypeColorClass;
  getIcon = getTransactionIcon;
  getIconClass = getTransactionIconBgClass;

  // Logic
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

      // Advanced Filter: Type
      if (type && t.type !== type) return false;

      // Advanced Filter: Contract (Number match)
      if (contract && !t.contract_number?.toLowerCase().includes(contract)) return false;

      // Advanced Filter: Commitment (ID match)
      if (commitment && !t.commitment_id.toLowerCase().includes(commitment)) return false;

      // Advanced Filter: Date Range
      if (startDate) {
        // Create date at midnight local time to compare strictly by day
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

  // Actions
  setTab(tab: 'ALL' | 'PAYMENTS' | 'COMMITMENTS') {
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
  get isAnySyncing(): boolean {
    return this.bulkSyncService.isRunning() || this.sigefSyncService.isGlobalSyncing();
  }

  /**
   * Label dinâmico do botão de sync.
   */
  get syncButtonLabel(): string {
    if (this.bulkSyncService.isRunning()) {
      const p = this.bulkSyncService.progress();
      return `${p.currentLabel} (${p.percent}%)`;
    }
    if (this.sigefSyncService.isGlobalSyncing()) return 'Atualizando contratos...';
    return 'Atualizar SIGEF';
  }
}