import { Component, input, output } from '@angular/core';
import { Contract } from '../../../shared/models/contract.model';

@Component({
  selector: 'app-expiring-contracts',
  standalone: true,
  imports: [],
  template: `
    <div class="bg-white dark:bg-gray-800 p-6 border border-amber-100 dark:border-amber-900/30 shadow-sm flex-1">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <h3 class="text-md font-bold text-gray-900 dark:text-white">Fim de Vigência</h3>
          <span class="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[10px] font-black leading-none">{{ contracts().length }}</span>
        </div>
        <span class="px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 text-[10px] font-black border border-amber-100 dark:border-amber-800">PRÓX. 120 DIAS</span>
      </div>
      <div class="space-y-3 overflow-y-auto max-h-[200px] pr-2 custom-scrollbar">
        @if (contracts().length > 0) {
          @for (c of contracts(); track c.id) {
            <div (click)="viewContract.emit(c.contrato)"
                 [class]="priorityRowClass(c.dias_restantes ?? 0)">
              <div class="flex-1 min-w-0 mr-3">
                <p class="text-xs font-bold text-gray-900 dark:text-white truncate">{{ c.contrato }}</p>
                <p class="text-[10px] text-gray-500 truncate">{{ c.contratada }}</p>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full" [class]="priorityDotClass(c.dias_restantes ?? 0)"></span>
                <span class="text-[10px] font-black" [class]="priorityTextClass(c.dias_restantes ?? 0)">{{ c.dias_restantes }} dias</span>
              </div>
            </div>
          }
        } @else {
          <div class="h-32 flex flex-col items-center justify-center text-gray-400">
            <span class="material-symbols-outlined text-[32px] mb-2 opacity-20">verified_user</span>
            <p class="text-[10px] font-bold uppercase tracking-widest">Atenção em dia</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class ExpiringContractsComponent {
  readonly contracts = input<Contract[]>([]);
  readonly viewContract = output<string>();

  priorityTextClass(days: number): string {
    if (days <= 60) return 'text-red-600 dark:text-red-400';
    if (days <= 80) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-green-600 dark:text-green-400';
  }

  priorityDotClass(days: number): string {
    if (days <= 60) return 'bg-red-500';
    if (days <= 80) return 'bg-yellow-500';
    return 'bg-green-500';
  }

  priorityRowClass(days: number): string {
    const base = 'flex items-start justify-between p-3 transition-all cursor-pointer ';
    if (days <= 60)
      return base + 'border border-red-200 dark:border-red-900/30 bg-red-50/30 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30';
    if (days <= 80)
      return base + 'border border-yellow-200 dark:border-yellow-900/30 bg-yellow-50/30 dark:bg-yellow-950/20 hover:bg-yellow-50 dark:hover:bg-yellow-950/30';
    return base + 'border border-green-200 dark:border-green-900/30 bg-green-50/30 dark:bg-green-950/20 hover:bg-green-50 dark:hover:bg-green-950/30';
  }
}
