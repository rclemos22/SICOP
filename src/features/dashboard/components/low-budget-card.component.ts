import { Component, input, output } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { LowBudgetAlert } from '../services/dashboard.service';

@Component({
  selector: 'app-low-budget-card',
  standalone: true,
  imports: [CurrencyPipe, DecimalPipe],
  template: `
    <div class="mb-8 overflow-hidden bg-white dark:bg-gray-800 border-l-4 border-amber-500 shadow-sm">
      <div class="p-4 bg-amber-50/30 dark:bg-amber-900/10 flex items-center justify-between border-b border-amber-100 dark:border-amber-900/20">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-amber-500">warning</span>
          <h3 class="text-sm font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">Atenção: Saldo de Empenho Baixo</h3>
        </div>
        <span class="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 text-[10px] font-black border border-amber-200 dark:border-amber-800">
          {{ alerts().length }} {{ alerts().length === 1 ? 'ALERTA' : 'ALERTAS' }}
        </span>
      </div>
      <div class="p-2 max-h-[180px] overflow-y-auto custom-scrollbar">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          @for (a of alerts(); track a.contractId) {
            <div
              (click)="viewContract.emit(a.contractNumber)"
              class="flex items-center p-3 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-100 dark:border-gray-700 hover:border-amber-300 dark:hover:border-amber-900/50 hover:bg-amber-50/20 transition-all cursor-pointer group"
              title="Clique para ir ao contrato"
            >
              <div class="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400 mr-3 group-hover:scale-110 transition-transform">
                <span class="material-symbols-outlined text-[20px]">account_balance</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2 overflow-hidden">
                  <p class="text-[11px] font-black text-gray-900 dark:text-white truncate">{{ a.contractNumber }}</p>
                  <span class="text-[9px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 whitespace-nowrap">{{ a.percentage | number:'1.0-0' }}%</span>
                </div>
                <p class="text-[10px] text-gray-500 truncate mt-0.5">{{ a.dotacao }}</p>
              </div>
              <div class="ml-3 text-right">
                <p class="text-[11px] font-black text-gray-700 dark:text-gray-300">{{ a.saldoEmpenho | currency:'BRL':'symbol':'1.2-2' }}</p>
                <span class="text-[8px] font-black text-amber-500 uppercase">Saldo Emp.</span>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class LowBudgetCardComponent {
  readonly alerts = input<LowBudgetAlert[]>([]);
  readonly viewContract = output<string>();
}
