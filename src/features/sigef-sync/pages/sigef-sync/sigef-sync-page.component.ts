import { Component, inject, signal, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SigefSchedulerService } from '../../../../core/services/sigef-scheduler.service';
import { SigefBulkSyncService } from '../../../../core/services/sigef-bulk-sync.service';
import { SigefSyncService, SyncTask } from '../../../../core/services/sigef-sync.service';
import { SyncHistoryService, SyncLogEntry } from '../../../../core/services/sync-history.service';

@Component({
  selector: 'app-sigef-sync-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex-1 overflow-y-auto p-6 md:px-10 md:py-8 h-full">

      <!-- Header -->
      <div class="mb-8 flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Sincronizar SIGEF</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Gerencie a sincronização dos dados com a API oficial do SIGEF.
          </p>
        </div>
        <div class="text-xs text-slate-400">
          Atualizado: {{ refreshTime() }}
        </div>
      </div>

      <!-- Status Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
          <p class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Ciclo Rápido (Cache)</p>
          <p class="text-lg font-bold text-slate-900 dark:text-white mt-1">A cada 5 min</p>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Atualiza a UI com dados do cache local. Sem chamadas à API.</p>
        </div>
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
          <p class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Atualizar SIGEF (Automático)</p>
          <p class="text-lg font-bold text-slate-900 dark:text-white mt-1">A cada 30 min</p>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Últimos 7 dias da API. Disponível 07:00 às 18:00.</p>
        </div>
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
          <p class="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Status da API</p>
          <p class="text-lg font-bold mt-1"
            [class.text-green-600]="!isRunning()"
            [class.text-yellow-600]="isRunning()">
            {{ isRunning() ? 'Sincronizando...' : 'Disponível' }}
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
            @if (lastSyncMessage()) {
              {{ lastSyncMessage() }}
            } @else {
              Nenhuma operação em andamento.
            }
          </p>
        </div>
      </div>

      <!-- Progress Bar (bulk download) -->
      @if (isRunning()) {
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white">Sincronizando...</h3>
            <span class="text-xs font-medium text-slate-500">{{ bulkProgress().percent }}%</span>
          </div>
          <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
            <div class="h-full bg-green-500 rounded-full transition-all duration-500"
              [style.width.%]="bulkProgress().percent">
            </div>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Fase: <strong>{{ bulkProgress().phase }}</strong> —
            {{ bulkProgress().currentLabel }}
          </p>
          <p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {{ bulkProgress().current }} / {{ bulkProgress().total }} operações —
            NEs: {{ bulkProgress().totalNeSaved }}, OBs: {{ bulkProgress().totalObSaved }}
          </p>
          @if (bulkProgress().errors.length > 0) {
            <div class="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg max-h-[150px] overflow-y-auto">
              <p class="text-xs font-bold text-red-600 dark:text-red-400 mb-1">{{ bulkProgress().errors.length }} erro(s):</p>
              @for (err of bulkProgress().errors; track err) {
                <p class="text-xs text-red-500 dark:text-red-300">• {{ err }}</p>
              }
            </div>
          }
        </div>
      }

      <!-- Task Queue (current sync NEs) -->
      @if (syncQueue().length > 0) {
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm mb-6">
          <h3 class="text-sm font-bold text-slate-900 dark:text-white mb-3">
            Fila de Sincronização
            @if (syncStatus()) {
              <span class="text-xs font-normal text-slate-500 ml-2">
                ({{ syncStatus()!.current }} / {{ syncStatus()!.total }})
              </span>
            }
          </h3>
          <div class="max-h-[250px] overflow-y-auto space-y-1.5">
            @for (task of syncQueue(); track task.ne + (task.timestamp ?? 0)) {
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                [class.bg-slate-50]="task.status === 'pending'"
                [class.bg-blue-50]="task.status === 'processing'"
                [class.bg-green-50]="task.status === 'completed'"
                [class.bg-red-50]="task.status === 'error'"
              >
                <span class="shrink-0 w-2 h-2 rounded-full"
                  [class.bg-slate-300]="task.status === 'pending'"
                  [class.bg-blue-500]="task.status === 'processing'"
                  [class.bg-green-500]="task.status === 'completed'"
                  [class.bg-red-500]="task.status === 'error'"
                ></span>
                <span class="font-mono text-slate-600">{{ task.ne }}</span>
                <span class="text-slate-400">(UG:{{ task.ug }})</span>
                <span class="ml-auto font-medium"
                  [class.text-slate-500]="task.status === 'pending'"
                  [class.text-blue-600]="task.status === 'processing'"
                  [class.text-green-600]="task.status === 'completed'"
                  [class.text-red-600]="task.status === 'error'"
                >
                  @if (task.status === 'pending') { pendente }
                  @else if (task.status === 'processing') { processando }
                  @else if (task.status === 'completed') { concluído }
                  @else { erro }
                </span>
                @if (task.message) {
                  <span class="text-red-500 ml-1">— {{ task.message }}</span>
                }
              </div>
            }
          </div>
        </div>
      }

      <!-- Action Buttons -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <button
          (click)="sincronizarTotal()"
          [disabled]="isRunning()"
          class="p-6 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span class="material-symbols-outlined text-[28px] text-green-600 dark:text-green-400">cloud_download</span>
            </div>
            <div>
              <h3 class="text-lg font-bold text-slate-900 dark:text-white">Sincronização Completa</h3>
              <p class="text-sm text-slate-500 dark:text-slate-400">
                Baixa todas as NEs e OBs de todas as dotações cadastradas diretamente da API.
              </p>
            </div>
          </div>
        </button>

        <button
          (click)="sincronizarRecente()"
          [disabled]="isRunning()"
          class="p-6 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <span class="material-symbols-outlined text-[28px] text-blue-600 dark:text-blue-400">refresh</span>
            </div>
            <div>
              <h3 class="text-lg font-bold text-slate-900 dark:text-white">Atualização Rápida</h3>
              <p class="text-sm text-slate-500 dark:text-slate-400">
                Baixa apenas os últimos 60 dias de dados. Mais rápido que a completa.
              </p>
            </div>
          </div>
        </button>
      </div>

      <!-- Message -->
      @if (message()) {
        <div class="p-4 rounded-xl text-sm font-medium border mb-6"
          [class]="message()!.includes('sucesso') || message()!.includes('Concluído') ?
            'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' :
            'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'"
        >
          {{ message() }}
        </div>
      }

      <!-- History Log -->
      <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-slate-900 dark:text-white">
            Histórico de Sincronização
            <span class="text-xs font-normal text-slate-500 ml-2">({{ logEntries().length }} registro(s))</span>
          </h3>
          @if (logEntries().length > 0) {
            <button (click)="limparHistorico()"
              class="text-xs text-red-500 hover:text-red-700 font-medium">
              Limpar
            </button>
          }
        </div>

        @if (logEntries().length === 0) {
          <p class="text-sm text-slate-400 text-center py-6">
            Nenhuma operação registrada ainda. Clique em "Sincronização Completa" ou "Atualização Rápida" para iniciar.
          </p>
        } @else {
          <div class="max-h-[400px] overflow-y-auto space-y-1">
            @for (entry of logEntries(); track entry.id) {
              <div class="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
                [class.bg-blue-50]="entry.type === 'start'"
                [class.bg-green-50]="entry.type === 'success'"
                [class.bg-red-50]="entry.type === 'error'"
                [class.bg-slate-50]="entry.type === 'info'"
              >
                <span class="shrink-0 mt-0.5 w-2 h-2 rounded-full"
                  [class.bg-blue-500]="entry.type === 'start'"
                  [class.bg-green-500]="entry.type === 'success'"
                  [class.bg-red-500]="entry.type === 'error'"
                  [class.bg-slate-400]="entry.type === 'info'"
                ></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-slate-400 shrink-0">{{ formatTime(entry.timestamp) }}</span>
                    <span class="font-medium"
                      [class.text-blue-600]="entry.type === 'start'"
                      [class.text-green-600]="entry.type === 'success'"
                      [class.text-red-600]="entry.type === 'error'"
                      [class.text-slate-600]="entry.type === 'info'"
                    >
                      {{ entry.action }}
                    </span>
                    <span class="text-slate-500">{{ entry.source }}</span>
                  </div>
                  <p class="text-slate-600 mt-0.5">{{ entry.message }}</p>
                </div>
              </div>
            }
          </div>
        }
      </div>

    </div>
  `
})
export class SigefSyncPageComponent implements OnInit, OnDestroy {
  private scheduler = inject(SigefSchedulerService);
  protected bulkSyncService = inject(SigefBulkSyncService);
  protected syncService = inject(SigefSyncService);
  private syncHistory = inject(SyncHistoryService);

  protected message = signal<string | null>(null);
  protected bulkProgress = this.bulkSyncService.progress;

  protected isRunning = signal(false);
  protected lastSyncMessage = signal<string | null>(null);
  protected refreshTime = signal<string>(new Date().toLocaleTimeString('pt-BR'));

  protected syncQueue = this.syncService.syncQueue;
  protected syncStatus = this.syncService.syncStatus;
  protected logEntries = this.syncHistory.entries;

  private _timer: any;

  ngOnInit() {
    this._timer = setInterval(() => {
      this.refreshTime.set(new Date().toLocaleTimeString('pt-BR'));
    }, 10_000);
  }

  ngOnDestroy() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('pt-BR');
    } catch {
      return iso;
    }
  }

  limparHistorico(): void {
    this.syncHistory.clear();
  }

  async sincronizarTotal() {
    this.isRunning.set(true);
    this.message.set(null);
    this.lastSyncMessage.set('Sincronização completa iniciada...');
    this.syncHistory.addEntry('start', 'sync_full', 'manual', 'Sincronização completa iniciada');
    try {
      await this.scheduler.runManualSync();
      this.message.set('Sincronização completa concluída com sucesso!');
      this.lastSyncMessage.set('Concluído em ' + new Date().toLocaleTimeString('pt-BR'));
      this.syncHistory.addEntry('success', 'sync_full', 'manual', 'Sincronização completa concluída');
      setTimeout(() => this.message.set(null), 5000);
    } catch (err: any) {
      this.message.set('Erro: ' + (err.message || 'Erro desconhecido'));
      this.syncHistory.addEntry('error', 'sync_full', 'manual', 'Erro na sincronização completa: ' + (err.message || 'Erro desconhecido'));
      setTimeout(() => this.message.set(null), 8000);
    } finally {
      this.isRunning.set(false);
    }
  }

  async sincronizarRecente() {
    this.isRunning.set(true);
    this.message.set(null);
    this.lastSyncMessage.set('Atualização rápida iniciada...');
    this.syncHistory.addEntry('start', 'sync_quick', 'manual', 'Atualização rápida iniciada (últimos 60 dias)');
    try {
      await this.bulkSyncService.downloadLast60Days();
      await this.syncService.syncAllContractsFinance(true);
      this.message.set('Atualização rápida concluída com sucesso!');
      this.lastSyncMessage.set('Concluído em ' + new Date().toLocaleTimeString('pt-BR'));
      this.syncHistory.addEntry('success', 'sync_quick', 'manual', 'Atualização rápida concluída');
      setTimeout(() => this.message.set(null), 5000);
    } catch (err: any) {
      this.message.set('Erro: ' + (err.message || 'Erro desconhecido'));
      this.syncHistory.addEntry('error', 'sync_quick', 'manual', 'Erro na atualização rápida: ' + (err.message || 'Erro desconhecido'));
      setTimeout(() => this.message.set(null), 8000);
    } finally {
      this.isRunning.set(false);
    }
  }
}
