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

@Component({
  selector: 'app-financial-page',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  templateUrl: './financial-page.component.html'
})
export class FinancialPageComponent {
  public financialService = inject(FinancialService);

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
        // Assuming t.date is a Date object. 
        // We set t.date to midnight for comparison or simply compare timestamps
        // Simple string comparison for dates YYYY-MM-DD often works if consistent, 
        // but let's compare timestamps.

        // Fix: Adjust input date to consider timezone offset if needed, or simple comparison:
        // Let's assume input '2025-01-01' is meant to include transactions on that day.
        // t.date usually has time 00:00:00 se oriundo de formatação baseline.
        const tDate = new Date(t.date);
        tDate.setHours(0, 0, 0, 0);
        const sDate = new Date(start);
        sDate.setHours(0, 0, 0, 0);

        // Need to account for timezone in input vs local creation?
        // Let's use simple string logic for robust day comparison in local time
        // or just ensure we compare >= start
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
}