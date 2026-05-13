import { Component, input, output } from '@angular/core';
import { Contract } from '../../../shared/models/contract.model';

@Component({
  selector: 'app-expiring-contracts',
  standalone: true,
  imports: [],
  template: `
    <div class="bg-white dark:bg-gray-800 p-6 border border-amber-100 dark:border-amber-900/30 shadow-sm flex-1">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-md font-bold text-gray-900 dark:text-white">Fim de Vigência</h3>
        <span class="px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 text-[10px] font-black border border-amber-100 dark:border-amber-800">PRÓX. 90 DIAS</span>
      </div>
      <div class="space-y-3 overflow-y-auto max-h-[200px] pr-2 custom-scrollbar">
        @if (contracts().length > 0) {
          @for (c of contracts(); track c.id) {
            <div (click)="viewContract.emit(c.contrato)"
                 class="flex items-start justify-between p-3 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 border border-transparent hover:border-amber-100 transition-all cursor-pointer">
              <div class="flex-1 min-w-0 mr-3">
                <p class="text-xs font-bold text-gray-900 dark:text-white truncate">{{ c.contrato }}</p>
                <p class="text-[10px] text-gray-500 truncate">{{ c.contratada }}</p>
              </div>
              <div class="text-right">
                <span class="text-[10px] font-black text-amber-600">{{ c.dias_restantes }} dias</span>
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
}
