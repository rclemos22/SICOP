import { Component, input, output } from '@angular/core';

export interface AtaAlertMetric {
  expiringCount: number;
  pendingAdesoesCount: number;
  criticalSaldoCount: number;
  totalActive: number;
}

@Component({
  selector: 'app-ata-alerts-card',
  standalone: true,
  template: `
    <div class="bg-white dark:bg-gray-800 border-l-4 border-purple-500 shadow-sm h-full flex flex-col">
      <div class="p-4 bg-purple-50/30 dark:bg-purple-900/10 flex items-center justify-between border-b border-purple-100 dark:border-purple-900/20">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-purple-500">gavel</span>
          <h3 class="text-sm font-black text-purple-600 dark:text-purple-400 uppercase tracking-wider">Atas de Licitação</h3>
        </div>
      </div>
      <div class="flex-1 p-4 grid grid-cols-3 gap-3">
        <div (click)="navigateToAtas.emit()"
          class="flex flex-col items-center justify-center p-3 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-100 dark:border-gray-700 rounded-lg hover:border-purple-300 dark:hover:border-purple-900/50 hover:bg-purple-50/20 transition-all cursor-pointer group text-center">
          <span class="text-2xl font-black text-gray-900 dark:text-white group-hover:text-purple-600 transition-colors">{{ metrics().expiringCount }}</span>
          <span class="text-[9px] font-bold text-gray-500 uppercase mt-1">A Vencer</span>
          @if (metrics().expiringCount > 0) {
            <span class="text-[8px] text-amber-600 font-semibold mt-0.5">⇢ Verificar</span>
          }
        </div>
        <div (click)="navigateToAtas.emit()"
          class="flex flex-col items-center justify-center p-3 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-100 dark:border-gray-700 rounded-lg hover:border-purple-300 dark:hover:border-purple-900/50 hover:bg-purple-50/20 transition-all cursor-pointer group text-center">
          <span class="text-2xl font-black text-amber-600 dark:text-amber-400 group-hover:text-purple-600 transition-colors">{{ metrics().pendingAdesoesCount }}</span>
          <span class="text-[9px] font-bold text-gray-500 uppercase mt-1">Adesões Pend.</span>
          @if (metrics().pendingAdesoesCount > 0) {
            <span class="text-[8px] text-amber-600 font-semibold mt-0.5">⇢ Analisar</span>
          }
        </div>
        <div (click)="navigateToAtas.emit()"
          class="flex flex-col items-center justify-center p-3 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-100 dark:border-gray-700 rounded-lg hover:border-purple-300 dark:hover:border-purple-900/50 hover:bg-purple-50/20 transition-all cursor-pointer group text-center">
          <span class="text-2xl font-black text-red-600 dark:text-red-400 group-hover:text-purple-600 transition-colors">{{ metrics().criticalSaldoCount }}</span>
          <span class="text-[9px] font-bold text-gray-500 uppercase mt-1">Saldo Crítico</span>
          @if (metrics().criticalSaldoCount > 0) {
            <span class="text-[8px] text-amber-600 font-semibold mt-0.5">⇢ Revisar</span>
          }
        </div>
      </div>
    </div>
  `,
})
export class AtaAlertsCardComponent {
  readonly metrics = input.required<AtaAlertMetric>();
  readonly navigateToAtas = output<void>();
}
