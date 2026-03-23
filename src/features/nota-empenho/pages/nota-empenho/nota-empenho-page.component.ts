import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SigefService, NotaEmpenho, NotaEmpenhoItem } from '../../../../core/services/sigef.service';
import { environment } from '../../../../environments/environment';

interface UnidadeGestora {
  codigo: string;
  nome: string;
}

@Component({
  selector: 'app-nota-empenho-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex-1 overflow-y-auto p-6 md:px-10 md:py-8 h-full">
      
      <!-- Header -->
      <div class="mb-8 flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Nota de Empenho</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Consulta de notas de empenho via API SIGEF.</p>
        </div>
        
        <!-- Auth Status -->
        <div class="flex items-center gap-2">
          @if (sigefService.loading()) {
            <span class="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-full text-sm font-medium">
              <span class="animate-spin material-symbols-outlined text-[16px]">sync</span>
              Conectando...
            </span>
          } @else if (sigefService.authenticated()) {
            <span class="flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-medium">
              <span class="material-symbols-outlined text-[16px]">check_circle</span>
              API Conectada
            </span>
          } @else {
            <span class="flex items-center gap-2 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full text-sm font-medium">
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
          class="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          {{ debugMode() ? 'Ocultar Debug' : 'Mostrar Debug' }}
        </button>
      </div>

      <!-- Debug Info -->
      @if (debugMode()) {
        <div class="mb-6 p-4 bg-slate-900 text-green-400 font-mono text-xs rounded-lg overflow-x-auto">
          <pre>{{ debugLogs() }}</pre>
        </div>
      }

      <!-- Search Form -->
      <div class="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm mb-6">
        <div class="flex flex-col md:flex-row gap-4">
          
          <!-- Unidade Gestora -->
          <div class="w-full md:w-64">
            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Unidade Gestora</label>
            <select 
              [(ngModel)]="unidadeGestoraSelecionada"
              class="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-slate-900 dark:text-white"
            >
              @for (ug of unidadesGestoras; track ug.codigo) {
                <option [value]="ug.codigo">{{ ug.codigo }} - {{ ug.nome }}</option>
              }
            </select>
          </div>

          <!-- Número da NE -->
          <div class="flex-1">
            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Número da NE</label>
            <input 
              type="text" 
              [(ngModel)]="numeroNE"
              placeholder="Ex: 2026NE000302"
              (keyup.enter)="buscarNotaEmpenho()"
              autocomplete="off"
              class="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500"
            >
          </div>
          
          <div class="flex items-end">
            <button 
              (click)="buscarNotaEmpenho()"
              [disabled]="sigefService.loading() || !numeroNE"
              class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
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
          <div class="mt-4 p-4 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
            <p class="text-red-600 dark:text-red-300 text-sm">{{ sigefService.error() }}</p>
          </div>
        }
      </div>

      <!-- Result -->
      @if (notaEmpenho()) {
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <!-- Header Info -->
          <div class="p-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl font-bold text-blue-600 dark:text-blue-400">{{ notaEmpenho()!.nunotaempenho }}</h2>
                <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Nota de Empenho</p>
              </div>
              <span class="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
                {{ notaEmpenho()!.demodalidadeempenho }}
              </span>
            </div>
          </div>

          <!-- Details Grid -->
          <div class="p-6">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              <!-- Unidade Gestora -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Unidade Gestora</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdunidadegestora }}</p>
              </div>

              <!-- Gestão -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Gestão</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdgestao }}</p>
              </div>

              <!-- Credor -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Credor (CNPJ/CPF)</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdcredor }}</p>
              </div>

              <!-- Data de Lançamento -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Data de Lançamento</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.dtlancamento | date:'dd/MM/yyyy' }}</p>
              </div>

              <!-- Tipo -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Tipo</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.tipo }}</p>
              </div>

              <!-- Processo -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Processo</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.nuprocesso }}</p>
              </div>

              <!-- Natureza da Despesa -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Natureza da Despesa</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdnaturezadespesa }}</p>
              </div>

              <!-- Fonte -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Fonte de Recursos</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdfonte }}</p>
              </div>

              <!-- Ação -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Ação</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdacao }}</p>
              </div>

              <!-- Função -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Função</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdfuncao }}</p>
              </div>

              <!-- Subfunção -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Subfunção</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdsubfuncao }}</p>
              </div>

              <!-- Programa -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Programa</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdprograma }}</p>
              </div>

              <!-- Evento -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Evento</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ notaEmpenho()!.cdevento }}</p>
              </div>

            </div>

            <!-- Values Section -->
            <div class="mt-8">
              <h3 class="text-lg font-bold text-slate-900 dark:text-white mb-4">Valores</h3>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-xl">
                  <p class="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase">Valor Nota Empenho</p>
                  <p class="text-lg font-bold text-blue-700 dark:text-blue-300 mt-1">
                    {{ notaEmpenho()!.vlnotaempenho | currency:'BRL':'symbol':'1.2-2' }}
                  </p>
                </div>
                <div class="bg-slate-100 dark:bg-slate-700 p-4 rounded-xl">
                  <p class="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase">Quantidade</p>
                  <p class="text-lg font-bold text-slate-700 dark:text-slate-300 mt-1">
                    {{ notaEmpenho()!.nuquantidade | number:'1.0-0' }}
                  </p>
                </div>
                <div class="bg-purple-50 dark:bg-purple-900/30 p-4 rounded-xl">
                  <p class="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase">Nota Original</p>
                  <p class="text-lg font-bold text-purple-700 dark:text-purple-300 mt-1">
                    {{ notaEmpenho()!.nuneoriginal }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Histórico -->
            @if (notaEmpenho()!.dehistorico) {
              <div class="mt-6 p-4 bg-slate-100 dark:bg-slate-700 rounded-lg">
                <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Histórico</p>
                <p class="text-sm text-slate-700 dark:text-slate-300">{{ notaEmpenho()!.dehistorico }}</p>
              </div>
            }

          </div>
        </div>
      } @else if (buscou && !sigefService.loading()) {
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
          <span class="material-symbols-outlined text-[48px] text-slate-300 dark:text-slate-600 mb-4">search_off</span>
          <p class="text-slate-500 dark:text-slate-400">Nota de Empenho não encontrada.</p>
          <p class="text-sm text-slate-400 dark:text-slate-500 mt-2">Verifique o número e tente novamente.</p>
        </div>
      }

    </div>
  `
})
export class NotaEmpenhoPageComponent implements OnInit {
  sigefService = inject(SigefService);
  
  numeroNE = '';
  buscou = false;
  
  notaEmpenho = signal<NotaEmpenho | null>(null);
  itens = signal<NotaEmpenhoItem[]>([]);
  
  debugMode = signal(false);
  debugLogs = signal('');

  unidadeGestoraSelecionada = '080101';
  
  unidadesGestoras: UnidadeGestora[] = [
    { codigo: '080101', nome: 'DPEMA' },
    { codigo: '080901', nome: 'FADEP' }
  ];

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

  private extrairAnoDoNumeroNE(numeroNE: string): string {
    const match = numeroNE.match(/^(\d{4})/);
    if (match) {
      return match[1];
    }
    return new Date().getFullYear().toString();
  }

  async buscarNotaEmpenho() {
    if (!this.numeroNE) return;
    
    const cleanNE = this.numeroNE.trim().toUpperCase();
    const ano = this.extrairAnoDoNumeroNE(cleanNE);
    const ug = this.unidadeGestoraSelecionada;
    
    this.buscou = true;
    this.clearDebugLogs();
    
    this.addDebugLog(`Iniciando busca: NE=${cleanNE}, Ano=${ano}, UG=${ug}`);
    this.addDebugLog(`API URL: ${environment.sigefApiUrl}/sigef/notaempenho/?ano=${ano}&cdunidadegestora=${ug}`);
    
    try {
      this.addDebugLog('Chamando getNotaEmpenhoByNumber...');
      const nota = await this.sigefService.getNotaEmpenhoByNumber(ano, cleanNE, ug);
      
      if (nota) {
        this.addDebugLog(`NE encontrada: ${nota.nunotaempenho}`);
        this.addDebugLog(`Campos: ${JSON.stringify(nota, null, 2)}`);
        this.notaEmpenho.set(nota);
        this.itens.set([]);
      } else {
        this.addDebugLog('NE não encontrada');
        this.notaEmpenho.set(null);
        this.itens.set([]);
      }
    } catch (err: any) {
      this.addDebugLog(`ERRO: ${err.message}`);
      console.error('Erro ao buscar nota de empenho:', err);
    }
  }
}
