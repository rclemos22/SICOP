import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SigefService, OrdemBancaria } from '../../../../core/services/sigef.service';
import { environment } from '../../../../environments/environment';

interface UnidadeGestora {
  codigo: string;
  nome: string;
}

@Component({
  selector: 'app-ordem-bancaria-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
  template: `
    <div class="flex-1 overflow-y-auto p-6 md:px-10 md:py-8 h-full">
      
      <!-- Header -->
      <div class="mb-8 flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Ordem Bancária</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Consulta de ordens bancárias via API SIGEF.</p>
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

          <!-- Número da OB -->
          <div class="flex-1">
            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Número da OB</label>
            <input 
              type="text" 
              [(ngModel)]="numeroOB"
              placeholder="Ex: 2026OB000656"
              (keyup.enter)="buscarOrdemBancaria()"
              autocomplete="off"
              class="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500"
            >
          </div>
          
          <div class="flex items-end">
            <button 
              (click)="buscarOrdemBancaria()"
              [disabled]="sigefService.loading() || !numeroOB"
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
      @if (ordemBancaria()) {
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <!-- Header Info -->
          <div class="p-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl font-bold text-green-600 dark:text-green-400">{{ ordemBancaria()!.nuordembancaria || ordemBancaria()!.nudocumento }}</h2>
                <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Ordem Bancária</p>
              </div>
              <span class="px-3 py-1 rounded-full text-sm font-medium"
                [class]="getStatusClass(ordemBancaria()!.cdsituacaoordembancaria)">
                {{ ordemBancaria()!.cdsituacaoordembancaria || 'Não informada' }}
              </span>
            </div>
          </div>

          <!-- Details Grid -->
          <div class="p-6">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              <!-- Unidade Gestora -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Unidade Gestora</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.cdunidadegestora }}</p>
              </div>

              <!-- Gestão -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Gestão</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.cdgestao }}</p>
              </div>

              <!-- Nota Empenho -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Nota Empenho</label>
                <p class="text-sm font-medium text-blue-600 dark:text-blue-400">{{ ordemBancaria()!.nunotaempenho || '---' }}</p>
              </div>

              <!-- Data de Lançamento -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Data de Lançamento</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.dtlancamento | date:'dd/MM/yyyy' }}</p>
              </div>

              <!-- Data de Pagamento -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Data de Pagamento</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.dtpagamento | date:'dd/MM/yyyy' }}</p>
              </div>

              <!-- Credor -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Credor</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.cdcredor || '---' }}</p>
              </div>

              <!-- Número Documento -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Número Documento</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.nudocumento || '---' }}</p>
              </div>

              <!-- Situação da Ordem -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Situação da Ordem</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.cdsituacaoordembancaria || '---' }}</p>
              </div>

              <!-- Tipo OB -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Tipo OB</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.tipoordembancaria || '---' }}</p>
              </div>

              <!-- Situação -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Situação</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.situacaopreparacaopagamento || '---' }}</p>
              </div>

              <!-- Tipo Preparação -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Tipo Preparação</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.tipopreparacaopagamento || '---' }}</p>
              </div>

              <!-- Usuário Responsável -->
              <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Responsável</label>
                <p class="text-sm font-medium text-slate-900 dark:text-white">{{ ordemBancaria()!.usuario_responsavel || '---' }}</p>
              </div>

            </div>

            <!-- Values Section -->
            <div class="mt-8">
              <h3 class="text-lg font-bold text-slate-900 dark:text-white mb-4">Valores</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-green-50 dark:bg-green-900/30 p-4 rounded-xl">
                  <p class="text-xs font-medium text-green-600 dark:text-green-400 uppercase">Valor Total</p>
                  <p class="text-lg font-bold text-green-700 dark:text-green-300 mt-1">
                    {{ ordemBancaria()!.vltotal | currency:'BRL':'symbol':'1.2-2' }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Observação / Finalidade -->
            @if (ordemBancaria()!.deobservacao || ordemBancaria()!.definalidade) {
              <div class="mt-6 space-y-4">
                @if (ordemBancaria()!.deobservacao) {
                  <div class="p-4 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Observação</p>
                    <p class="text-sm text-slate-700 dark:text-slate-300">{{ ordemBancaria()!.deobservacao }}</p>
                  </div>
                }
                @if (ordemBancaria()!.definalidade) {
                  <div class="p-4 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Finalidade</p>
                    <p class="text-sm text-slate-700 dark:text-slate-300">{{ ordemBancaria()!.definalidade }}</p>
                  </div>
                }
              </div>
            }

          </div>
        </div>
      } @else if (buscou && !sigefService.loading()) {
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
          <span class="material-symbols-outlined text-[48px] text-slate-300 dark:text-slate-600 mb-4">search_off</span>
          <p class="text-slate-500 dark:text-slate-400">Ordem Bancária não encontrada.</p>
          <p class="text-sm text-slate-400 dark:text-slate-500 mt-2">Verifique o número e tente novamente.</p>
        </div>
      }

    </div>
  `
})
export class OrdemBancariaPageComponent implements OnInit {
  sigefService = inject(SigefService);
  
  numeroOB = '';
  buscou = false;
  
  ordemBancaria = signal<OrdemBancaria | null>(null);
  
  unidadeGestoraSelecionada = '080101';
  
  unidadesGestoras: UnidadeGestora[] = [
    { codigo: '080101', nome: 'DPEMA' },
    { codigo: '080901', nome: 'FADEP' }
  ];

  private extrairAnoDoNumeroOB(numeroOB: string): string {
    const match = numeroOB.trim().match(/^(\d{4})/);
    if (match) {
      return match[1];
    }
    return new Date().getFullYear().toString();
  }

  ngOnInit() {
  }

  getStatusClass(situacao: string | null): string {
    const s = situacao?.toLowerCase() || '';
    if (s.includes('confirmada') || s.includes('creditado')) {
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800';
    }
    if (s.includes('pendente') || s.includes('agendado')) {
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800';
    }
    if (s.includes('cancelada') || s.includes('rejeitada')) {
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800';
    }
    return 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600';
  }

  async buscarOrdemBancaria() {
    if (!this.numeroOB) return;
    
    const cleanOB = this.numeroOB.trim().toUpperCase();
    const ug = this.unidadeGestoraSelecionada;
    const ano = this.extrairAnoDoNumeroOB(cleanOB);
    
    console.log('[DEBUG OB] Buscando:', { cleanOB, ug, ano });
    
    this.buscou = true;
    this.ordemBancaria.set(null);
    
    try {
      // Buscar com paginação para encontrar a OB
      let page = 1;
      const maxPages = 100;
      let found: OrdemBancaria | null = null;
      
      while (page <= maxPages && !found) {
        const ob = await this.sigefService.getOrdemBancaria(
          `${ano}-01-01`,
          `${ano}-12-31`,
          page,
          cleanOB, // Usar nuordembancaria para buscar por número da OB
          undefined,
          ug // Passar a UG selecionada para o filtro da API
        );
        
        console.log(`[DEBUG OB] Página ${page}: ${ob.data.length} resultados, next: ${ob.next}`);
        
        if (ob.data.length === 0) {
          console.log('[DEBUG OB] Sem resultados nesta página, parando');
          break;
        }
        
        // Log dos primeiros resultados para debug
        if (page === 1) {
          console.log('[DEBUG OB] Primeiros resultados (keys):', ob.data.slice(0, 3).map((item: any) => Object.keys(item)));
          console.log('[DEBUG OB] Primeiros resultados (full):', ob.data.slice(0, 3));
        }
        
        // Filtrar pelo número da OB e UG - usar nudocumento como fallback
        // Normalizar UG para número para evitar problemas com zeros à esquerda
        found = ob.data.find(item => 
          (item.nuordembancaria?.toUpperCase() === cleanOB || item.nudocumento?.toUpperCase() === cleanOB) && 
          Number(item.cdunidadegestora) === Number(ug)
        ) || null;
        
        console.log(`[DEBUG OB] após filtro: found=${found ? found.nuordembancaria : null}`);
        
        if (!found && ob.next) {
          page++;
          await new Promise(r => setTimeout(r, 100));
        } else {
          break;
        }
      }
      
      console.log('[DEBUG OB] Resultado:', found ? `Encontrado: nudocumento:${found.nudocumento} nuordembancaria:${found.nuordembancaria} UG:${found.cdunidadegestora}` : 'Não encontrado');
      
      if (found) {
        this.ordemBancaria.set(found);
      } else {
        this.ordemBancaria.set(null);
      }
    } catch (err: any) {
      console.error('Erro ao buscar ordem bancária:', err);
      this.ordemBancaria.set(null);
    }
  }
}
