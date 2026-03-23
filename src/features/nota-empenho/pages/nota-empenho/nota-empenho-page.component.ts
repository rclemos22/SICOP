import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SigefService, NotaEmpenho, NotaEmpenhoItem } from '../../../../core/services/sigef.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-nota-empenho-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex-1 overflow-y-auto p-6 md:px-10 md:py-8 h-full">
      
      <!-- Header -->
      <div class="mb-8 flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Nota de Empenho</h1>
          <p class="text-sm text-gray-500 mt-1">Consulta de notas de empenho via API SIGEF.</p>
        </div>
        
        <!-- Auth Status -->
        <div class="flex items-center gap-2">
          @if (sigefService.loading()) {
            <span class="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 rounded-full text-sm">
              <span class="animate-spin material-symbols-outlined text-[16px]">sync</span>
              Conectando...
            </span>
          } @else if (sigefService.authenticated()) {
            <span class="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full text-sm">
              <span class="material-symbols-outlined text-[16px]">check_circle</span>
              API Conectada
            </span>
          } @else {
            <span class="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-full text-sm">
              <span class="material-symbols-outlined text-[16px]">error</span>
              Desconectado
            </span>
          }
        </div>
      </div>

      <!-- Debug Toggle -->
      <div class="mb-4 flex items-center gap-2">
        <button 
          (click)="toggleDebug()"
          class="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          {{ debugMode() ? '🔒 Ocultar Debug' : '🔓 Mostrar Debug' }}
        </button>
      </div>

      <!-- Debug Info -->
      @if (debugMode()) {
        <div class="mb-6 p-4 bg-gray-900 text-green-400 font-mono text-xs rounded-lg overflow-x-auto">
          <pre>{{ debugLogs() }}</pre>
        </div>
      }

      <!-- Search Form -->
      <div class="bg-white dark:bg-card-dark p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-6">
        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Número da NE</label>
            <input 
              type="text" 
              [(ngModel)]="numeroNE"
              placeholder="Ex: 2026NE000048"
              autocomplete="off"
              class="w-full px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-sco-blue focus:border-sco-blue outline-none transition-all text-gray-900 dark:text-white placeholder-gray-400"
            >
          </div>
          <div class="w-full md:w-32">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Ano</label>
            <input 
              type="text" 
              [(ngModel)]="ano"
              placeholder="2026"
              autocomplete="off"
              class="w-full px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-sco-blue focus:border-sco-blue outline-none transition-all text-gray-900 dark:text-white placeholder-gray-400"
            >
          </div>
          <div class="flex items-end">
            <button 
              (click)="buscarNotaEmpenho()"
              [disabled]="sigefService.loading() || !numeroNE || !ano"
              class="px-6 py-2.5 bg-sco-blue text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
            >
              @if (sigefService.loading()) {
                <span class="flex items-center gap-2">
                  <span class="animate-spin material-symbols-outlined">sync</span>
                  Buscando...
                </span>
              } @else {
                <span class="flex items-center gap-2">
                  <span class="material-symbols-outlined">search</span>
                  Buscar
                </span>
              }
            </button>
          </div>
        </div>

        @if (sigefService.error()) {
          <div class="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p class="text-red-600 dark:text-red-400 text-sm">{{ sigefService.error() }}</p>
          </div>
        }
      </div>

      <!-- Result -->
      @if (notaEmpenho()) {
        <div class="bg-white dark:bg-card-dark rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <!-- Header Info -->
          <div class="p-6 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl font-bold text-sco-blue dark:text-white">{{ notaEmpenho()!.nuempenho }}</h2>
                <p class="text-sm text-gray-500 mt-1">Nota de Empenho</p>
              </div>
              <span class="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
                {{ notaEmpenho()!.dssituacaoempenho }}
              </span>
            </div>
          </div>

          <!-- Details Grid -->
          <div class="p-6">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              <!-- Credor -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Credor</label>
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ notaEmpenho()!.nmcredor }}</p>
                <p class="text-xs text-gray-500">CNPJ: {{ notaEmpenho()!.cdcredor }}</p>
              </div>

              <!-- Data Emissão -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Data de Emissão</label>
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ notaEmpenho()!.dtemissao | date:'dd/MM/yyyy' }}</p>
              </div>

              <!-- Data Vencimento -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Data de Vencimento</label>
                <p class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ notaEmpenho()!.dtvencimento ? (notaEmpenho()!.dtvencimento | date:'dd/MM/yyyy') : 'Não definido' }}
                </p>
              </div>

              <!-- Natureza da Despesa -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Natureza da Despesa</label>
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ notaEmpenho()!.cdnaturezadespesa }}</p>
                <p class="text-xs text-gray-500">{{ notaEmpenho()!.dsnaturezadespesa }}</p>
              </div>

              <!-- Fonte -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Fonte de Recursos</label>
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ notaEmpenho()!.cdfonte }} - {{ notaEmpenho()!.nmfonte }}</p>
              </div>

              <!-- Ação -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ação</label>
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ notaEmpenho()!.cdacao }} - {{ notaEmpenho()!.nmacao }}</p>
              </div>

            </div>

            <!-- Values Section -->
            <div class="mt-8">
              <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4">Valores</h3>
              <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl">
                  <p class="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase">Empenhado</p>
                  <p class="text-lg font-bold text-blue-700 dark:text-blue-300 mt-1">
                    {{ notaEmpenho()!.vlremessa | currency:'BRL':'symbol':'1.2-2' }}
                  </p>
                </div>
                <div class="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl">
                  <p class="text-xs font-medium text-yellow-600 dark:text-yellow-400 uppercase">RAT</p>
                  <p class="text-lg font-bold text-yellow-700 dark:text-yellow-300 mt-1">
                    {{ notaEmpenho()!.vlrat | currency:'BRL':'symbol':'1.2-2' }}
                  </p>
                </div>
                <div class="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-xl">
                  <p class="text-xs font-medium text-orange-600 dark:text-orange-400 uppercase">RP não proc.</p>
                  <p class="text-lg font-bold text-orange-700 dark:text-orange-300 mt-1">
                    {{ notaEmpenho()!.vlrpnp | currency:'BRL':'symbol':'1.2-2' }}
                  </p>
                </div>
                <div class="bg-green-50 dark:bg-green-900/20 p-4 rounded-xl">
                  <p class="text-xs font-medium text-green-600 dark:text-green-400 uppercase">Liquidado</p>
                  <p class="text-lg font-bold text-green-700 dark:text-green-300 mt-1">
                    {{ notaEmpenho()!.vlliquidado | currency:'BRL':'symbol':'1.2-2' }}
                  </p>
                </div>
                <div class="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl">
                  <p class="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase">Pago</p>
                  <p class="text-lg font-bold text-purple-700 dark:text-purple-300 mt-1">
                    {{ notaEmpenho()!.vlpago | currency:'BRL':'symbol':'1.2-2' }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Contract Link -->
            @if (notaEmpenho()!.nucontrato) {
              <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <p class="text-sm">
                  <span class="font-medium text-gray-600 dark:text-gray-400">Contrato:</span>
                  <span class="ml-2 text-sco-blue font-semibold">{{ notaEmpenho()!.nucontrato }}</span>
                </p>
              </div>
            }
          </div>

          <!-- Itens Table -->
          @if (itens().length > 0) {
            <div class="border-t border-gray-100 dark:border-gray-700">
              <div class="p-6">
                <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4">Itens da Nota de Empenho</h3>
                <div class="overflow-x-auto">
                  <table class="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
                    <thead class="bg-gray-50 dark:bg-gray-800/50">
                      <tr>
                        <th class="px-4 py-3 text-left text-xs font-bold text-gray-400 uppercase">Item</th>
                        <th class="px-4 py-3 text-left text-xs font-bold text-gray-400 uppercase">Descrição</th>
                        <th class="px-4 py-3 text-right text-xs font-bold text-gray-400 uppercase">Qtd</th>
                        <th class="px-4 py-3 text-right text-xs font-bold text-gray-400 uppercase">Vl. Unit.</th>
                        <th class="px-4 py-3 text-right text-xs font-bold text-gray-400 uppercase">Vl. Total</th>
                        <th class="px-4 py-3 text-right text-xs font-bold text-gray-400 uppercase">Saldo</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                      @for (item of itens(); track item.nusequencialitem) {
                        <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td class="px-4 py-3 text-sm text-gray-500">{{ item.nusequencialitem }}</td>
                          <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">{{ item.dsunidadesubitem }}</td>
                          <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ item.qtitem | number:'1.0-0' }}</td>
                          <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ item.vlunitario | currency:'BRL':'symbol':'1.2-2' }}</td>
                          <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right font-medium">{{ item.vlglobal | currency:'BRL':'symbol':'1.2-2' }}</td>
                          <td class="px-4 py-3 text-sm text-right">
                            <span [class]="item.vlsaldoitem > 0 ? 'text-green-600' : 'text-red-600'">
                              {{ item.vlsaldoitem | currency:'BRL':'symbol':'1.2-2' }}
                            </span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          }
        </div>
      } @else if (buscou && !sigefService.loading()) {
        <div class="bg-white dark:bg-card-dark rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <span class="material-symbols-outlined text-[48px] text-gray-300 dark:text-gray-600 mb-4">search_off</span>
          <p class="text-gray-500 dark:text-gray-400">Nota de Empenho não encontrada.</p>
          <p class="text-sm text-gray-400 dark:text-gray-500 mt-2">Verifique o número e tente novamente.</p>
        </div>
      }

    </div>
  `
})
export class NotaEmpenhoPageComponent implements OnInit {
  sigefService = inject(SigefService);
  
  numeroNE = '';
  ano = '2026';
  buscou = false;
  
  notaEmpenho = signal<NotaEmpenho | null>(null);
  itens = signal<NotaEmpenhoItem[]>([]);
  
  debugMode = signal(false);
  debugLogs = signal('');

  ngOnInit() {
  }

  toggleDebug() {
    this.debugMode.update(v => !v);
  }

  addDebugLog(message: string) {
    const timestamp = new Date().toISOString();
    this.debugLogs.update(log => log + `[${timestamp}] ${message}\n`);
  }

  clearDebugLogs() {
    this.debugLogs.set('');
  }

  async buscarNotaEmpenho() {
    if (!this.numeroNE || !this.ano) return;
    
    this.buscou = true;
    this.clearDebugLogs();
    
    this.addDebugLog(`Iniciando busca: NE=${this.numeroNE}, Ano=${this.ano}`);
    this.addDebugLog(`API URL: ${environment.sigefApiUrl}/sigef/notaempenho/?ano=${this.ano}`);
    
    try {
      this.addDebugLog('Chamando getNotaEmpenho...');
      const nota = await this.sigefService.getNotaEmpenho(this.ano);
      this.addDebugLog(`Retornou ${nota.length} notas de empenho`);
      
      this.notaEmpenho.set(nota.find(ne => ne.nunotaempenho === this.numeroNE) || null);
      
      if (this.notaEmpenho()) {
        this.addDebugLog(`NE encontrada: ${this.notaEmpenho()!.nunotaempenho}`);
        const itensNota = await this.sigefService.getItensByNotaEmpenho(this.ano, this.numeroNE);
        this.addDebugLog(`Itens retornados: ${itensNota.length}`);
        this.itens.set(itensNota);
      } else {
        this.addDebugLog('NE não encontrada na lista');
        this.itens.set([]);
      }
    } catch (err: any) {
      this.addDebugLog(`ERRO: ${err.message}`);
      console.error('Erro ao buscar nota de empenho:', err);
    }
  }
}
