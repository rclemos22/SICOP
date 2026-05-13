import { Component, input, output } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { OverdueAlert } from '../services/dashboard.service';

@Component({
  selector: 'app-overdue-alerts-card',
  standalone: true,
  imports: [CurrencyPipe, DatePipe],
  template: `
    <div class="mb-8 overflow-hidden bg-white dark:bg-gray-800 border-l-4 border-red-500 shadow-sm">
      <div class="p-4 bg-red-50/30 dark:bg-red-900/10 flex items-center justify-between border-b border-red-100 dark:border-red-900/20">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-red-500">warning</span>
          <h3 class="text-sm font-black text-red-600 dark:text-red-400 uppercase tracking-wider">Atenção: Pagamentos em Atraso</h3>
        </div>
        <span class="px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[10px] font-black border border-red-200 dark:border-red-800">
          {{ alerts().length }} {{ alerts().length === 1 ? 'PENDÊNCIA' : 'PENDÊNCIAS' }}
        </span>
      </div>
      <div class="p-2 max-h-[220px] overflow-y-auto custom-scrollbar">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          @for (a of alerts(); track a.contractId + a.reference) {
            <div
              (click)="viewContract.emit(a.contractName)"
              class="flex items-center p-3 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-100 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-900/50 hover:bg-red-50/20 transition-all cursor-pointer group"
              title="Clique para ir ao contrato"
            >
              <div class="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 mr-3 group-hover:scale-110 transition-transform">
                <span class="material-symbols-outlined text-[20px]">money_off</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2 overflow-hidden">
                  <p class="text-[11px] font-black text-gray-900 dark:text-white truncate">{{ a.contractName }}</p>
                  <span class="text-[9px] font-bold text-red-500 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 whitespace-nowrap">{{ a.reference }}</span>
                </div>
                <p class="text-[10px] text-gray-500 truncate mt-0.5">{{ a.supplier }}</p>
                <p class="text-[9px] font-bold text-gray-400 uppercase mt-1">{{ a.monthLabel }}</p>
              </div>
              <div class="ml-3 text-right">
                <p class="text-[11px] font-black text-gray-700 dark:text-gray-300">{{ a.amount | currency:'BRL' }}</p>
                <span class="text-[8px] font-black text-red-500 uppercase">Vencido</span>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class OverdueAlertsCardComponent {
  readonly alerts = input<OverdueAlert[]>([]);
  readonly viewContract = output<string>();
}
