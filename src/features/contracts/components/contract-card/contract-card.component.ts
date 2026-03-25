import { CommonModule, NgClass } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';

import { Contract, ContractStatus } from '../../../../shared/models/contract.model';

@Component({
  selector: 'app-contract-card',
  standalone: true,
  imports: [CommonModule, NgClass, StatusBadgeComponent],
  templateUrl: './contract-card.component.html',
})
export class ContractCardComponent {
  contract = input.required<Contract>();

  // Output event when card is clicked - goes to details
  select = output<void>();

  /** Usa daysRemaining pré-calculado pelo mapper do service */
  daysRemaining = computed(() => this.contract().dias_restantes ?? 0);

  /** Usa statusEfetivo pré-calculado pelo mapper do service */
  effectiveStatus = computed(() => this.contract().status_efetivo);

  // UI Helpers based on status

  isRescinded = computed(() => this.effectiveStatus() === ContractStatus.RESCINDIDO);
  isFinalizing = computed(() => this.effectiveStatus() === ContractStatus.FINALIZANDO);
  isVigente = computed(() => this.effectiveStatus() === ContractStatus.VIGENTE);

  // Dynamic Classes

  cardBorderClass = computed(() => {
    if (this.isRescinded()) return 'hover:border-red-200';
    if (this.isFinalizing()) return 'hover:border-yellow-300';
    return 'hover:border-sco-blue/30';
  });

  titleHoverClass = computed(() => {
    if (this.isRescinded()) return 'group-hover:text-red-700';
    if (this.isFinalizing()) return 'group-hover:text-yellow-700';
    return 'group-hover:text-sco-blue';
  });

  footerIcon = computed(() => {
    if (this.isRescinded()) return 'block';
    if (this.isFinalizing()) return 'priority_high';
    return 'event_upcoming';
  });

  footerTextClass = computed(() => {
    if (this.isRescinded()) return 'text-gray-400 dark:text-gray-500';
    if (this.isFinalizing()) return 'text-orange-600 dark:text-orange-400';
    return 'text-gray-500 dark:text-gray-400';
  });

  footerMessage = computed(() => {
    if (this.isRescinded()) return 'Encerrado';
    const days = this.daysRemaining();
    if (days < 0) return `Venceu há ${Math.abs(days)} dias`;
    return `Vence em ${days} dias`;
  });
}