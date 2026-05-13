import { Component, input, output } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RecentPayment } from '../services/dashboard.service';

@Component({
  selector: 'app-recent-payments-table',
  standalone: true,
  imports: [CurrencyPipe, DatePipe],
  template: `
    <div class="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="p-4 sm:p-6 border-b border-gray-50 dark:border-gray-750 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h3 class="text-lg font-black text-gray-900 dark:text-white">Últimos Pagamentos Localizados</h3>
        <button (click)="viewFinancial.emit()"
                class="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-widest flex items-center self-start sm:self-auto">
          Ver Histórico Completo <span class="material-symbols-outlined text-[14px] ml-2">chevron_right</span>
        </button>
      </div>

      <div class="overflow-x-auto">
        @if (payments().length > 0) {
          <table class="w-full hidden md:table">
            <thead>
              <tr class="text-left border-b border-gray-50 dark:border-gray-750">
                <th class="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Nº Contrato</th>
                <th class="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Contratada / Fornecedor</th>
                <th class="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center">Data Pagamento</th>
                <th class="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-right">Valor</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50 dark:divide-gray-750">
              @for (p of payments(); track p.id) {
                <tr class="hover:bg-gray-50/50 dark:hover:bg-gray-750/30 transition-colors group">
                  <td class="px-6 py-4">
                    <div class="flex flex-col">
                      <span class="inline-flex items-center px-2 py-1 bg-gray-100 dark:bg-gray-700 text-[10px] font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 w-fit mb-1">{{ p.contrato }}</span>
                      <span class="text-[9px] text-gray-400 font-medium">OB {{ p.nuordembancaria }}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <div class="flex items-center">
                      <div class="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-[10px] mr-3">
                        {{ p.contratada.substring(0, 2).toUpperCase() }}
                      </div>
                      <p class="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[200px]">{{ p.contratada }}</p>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-center">
                    <div class="inline-flex flex-col items-center">
                      <span class="text-sm font-black text-gray-700 dark:text-gray-300">{{ p.data_pagamento | date:'dd/MM/yyyy' }}</span>
                      <span class="text-[9px] text-emerald-500 font-bold uppercase tracking-tighter">{{ p.situacao }}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-right">
                    <p class="text-sm font-black text-emerald-600 dark:text-emerald-400">{{ p.vltotal | currency:'BRL' }}</p>
                  </td>
                </tr>
              }
            </tbody>
          </table>

          <div class="md:hidden divide-y divide-gray-50 dark:divide-gray-800">
            @for (p of payments(); track p.id) {
              <div class="p-4 hover:bg-gray-50/50 dark:hover:bg-gray-750/30 transition-colors flex flex-col gap-3">
                <div class="flex items-start justify-between">
                  <div class="flex items-center">
                    <div class="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs mr-3 rounded-full">
                      {{ p.contratada.substring(0, 2).toUpperCase() }}
                    </div>
                    <div class="flex flex-col min-w-0">
                      <p class="text-sm font-bold text-gray-900 dark:text-white truncate pr-2 max-w-[180px]">{{ p.contratada }}</p>
                      <span class="text-[10px] font-black text-gray-500 uppercase mt-0.5">OB {{ p.nuordembancaria }}</span>
                    </div>
                  </div>
                  <div class="text-right">
                    <p class="text-sm font-black text-emerald-600 dark:text-emerald-400">{{ p.vltotal | currency:'BRL' }}</p>
                    <p class="text-[10px] text-gray-400 font-medium">{{ p.data_pagamento | date:'dd/MM/yyyy' }}</p>
                  </div>
                </div>
                <div class="flex items-center justify-between pt-2 border-t border-gray-50 dark:border-gray-750">
                  <span class="text-[10px] font-bold text-gray-400 uppercase">Contrato:</span>
                  <span class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-[10px] font-black text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">{{ p.contrato }}</span>
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="flex flex-col items-center justify-center py-20 text-gray-300 dark:text-gray-600">
            <span class="material-symbols-outlined text-[48px] mb-4 opacity-20">history_edu</span>
            <p class="font-bold text-sm uppercase tracking-widest">Nenhum pagamento registrado no sistema</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class RecentPaymentsTableComponent {
  readonly payments = input<RecentPayment[]>([]);
  readonly viewFinancial = output<void>();
}
