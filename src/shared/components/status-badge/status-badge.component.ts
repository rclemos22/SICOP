import { CommonModule } from '@angular/common';
import { Component, input, computed } from '@angular/core';
import { ContractStatus } from '../../models/contract.model';


@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border shadow-sm transition-colors"
          [ngClass]="badgeClass()">
      {{ label() }}
    </span>
  `
})
export class StatusBadgeComponent {
  status = input.required<ContractStatus>();

  label = computed(() => {
    switch (this.status()) {
      case ContractStatus.VIGENTE: return 'Vigente';
      case ContractStatus.RESCINDIDO: return 'Rescindido';
      case ContractStatus.FINALIZANDO: return 'Finalizando';
      case ContractStatus.ENCERRADO: return 'Encerrado';
      default: return this.status();
    }
  });

  badgeClass = computed(() => {
    switch (this.status()) {
      case ContractStatus.VIGENTE:
        return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
      case ContractStatus.RESCINDIDO:
        return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
      case ContractStatus.FINALIZANDO:
        return 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800';
      case ContractStatus.ENCERRADO:
        return 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
    }
  });
}
