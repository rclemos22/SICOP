import { CommonModule, DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';

import { Contract, ContractStatus } from '../../../../shared/models/contract.model';

@Component({
  selector: 'app-contract-list-view',
  standalone: true,
  imports: [CommonModule, DatePipe, StatusBadgeComponent],
  template: `
    <div class="bg-white dark:bg-card-dark rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nº Contrato</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Fornecedor</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Término</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Valor Global</th>
              <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ações</th>
            </tr>
          </thead>
          <tbody class="bg-white dark:bg-card-dark divide-y divide-gray-200 dark:divide-gray-700">
            @for (contract of contracts(); track contract.id) {
              <tr 
                (click)="select.emit(contract.id)"
                class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group cursor-pointer"
              >
                <!-- Number -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm font-semibold text-gray-900 dark:text-white font-mono">
                    {{ contract.contrato }}
                  </div>
                </td>

                <!-- Supplier -->
                <td class="px-6 py-4">
                  <div class="text-sm text-gray-900 dark:text-gray-200 line-clamp-1 max-w-[250px]" [title]="contract.contratada">
                    {{ contract.contratada }}
                  </div>
                </td>

                <!-- Status Badge (usa statusEfetivo pré-calculado) -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <app-status-badge [status]="contract.status_efetivo || contract.status"></app-status-badge>
                </td>

                <!-- Validity (Termino) -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex flex-col">
                    <span class="text-sm text-gray-700 dark:text-gray-300">
                      {{ contract.data_fim | date:'dd/MM/yyyy' }}
                    </span>
                    <span class="text-xs font-medium" [class]="getDaysClass(contract)">
                      {{ getDaysLabel(contract) }}
                    </span>
                  </div>
                </td>

                <!-- Value -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm font-medium text-gray-900 dark:text-white">
                    R$ {{ contract.valor_anual | number:'1.2-2':'pt-BR' }}
                  </div>
                </td>

                <!-- Actions -->
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button 
                    (click)="edit.emit(contract); $event.stopPropagation()"
                    class="text-gray-400 hover:text-sco-blue transition-colors mr-2"
                    title="Editar"
                  >
                    <span class="material-symbols-outlined text-[20px]">edit</span>
                  </button>
                  <button 
                    (click)="select.emit(contract.id)"
                    class="text-gray-400 hover:text-sco-blue transition-colors"
                  >
                    <span class="material-symbols-outlined text-[20px]">chevron_right</span>
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `
})
export class ContractListViewComponent {
  contracts = input.required<Contract[]>();
  select = output<string>();
  edit = output<Contract>();

  getDaysLabel(contract: Contract): string {
    const days = contract.dias_restantes ?? 0;
    if (contract.status_efetivo === ContractStatus.RESCINDIDO) return 'Encerrado';
    if (days < 0) return `Venceu há ${Math.abs(days)} dias`;
    return `${days} dias restantes`;
  }

  getDaysClass(contract: Contract): string {
    const days = contract.dias_restantes ?? 0;
    if (contract.status_efetivo === ContractStatus.RESCINDIDO) return 'text-gray-400';
    if (contract.status_efetivo === ContractStatus.FINALIZANDO) return 'text-yellow-600 dark:text-yellow-500';
    if (days < 0) return 'text-red-500';
    return 'text-green-600 dark:text-green-500';
  }
}