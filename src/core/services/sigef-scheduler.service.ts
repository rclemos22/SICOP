import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { SigefSyncService } from './sigef-sync.service';
import { SigefBulkSyncService } from './sigef-bulk-sync.service';
import { SigefService } from './sigef.service';
import { ContractService } from '../../features/contracts/services/contract.service';

/**
 * SigefSchedulerService
 *
 * Serviço central que orquestra todos os ciclos de sincronização:
 *
 * 1. Ciclo Rápido (5 min) — Apenas mirror → cache, NUNCA chama API SIGEF.
 *    Atualiza os dados apresentados na UI a partir do cache local.
 *
 * 2. Ciclo Médio (30 min, 07:00-18:00) — Chama a API SIGEF para baixar
 *    os últimos 7 dias de dados (Atualizar SIGEF automático).
 *
 * 3. Ciclo Lento (Manual) — "Sincronizar SIGEF" acionado pelo usuário.
 *    Faz download completo de todas as NEs e OBs da API.
 *
 * Todos os ciclos respeitam o lock global da API para evitar concorrência.
 */
@Injectable({
  providedIn: 'root'
})
export class SigefSchedulerService implements OnDestroy {
  private syncService = inject(SigefSyncService);
  private bulkSyncService = inject(SigefBulkSyncService);
  private sigefService = inject(SigefService);
  private contractService = inject(ContractService);

  private _cacheCycleTimer: any = null;
  private _sigefUpdateTimer: any = null;

  private _isRunning = signal(false);
  readonly isRunning = this._isRunning.asReadonly();

  constructor() {
    // Inicia os ciclos 5 minutos após o boot (dá tempo ao download inicial)
    setTimeout(() => this._startCycles(), 5 * 60_000);
  }

  ngOnDestroy(): void {
    this._stopAll();
  }

  private _startCycles(): void {
    this._startCacheCycle();
    this._startSigefUpdateCycle();
  }

  // ── Ciclo Rápido: Cache (5 min) ──────────────────────────────
  // Atualiza a UI a partir do mirror/cache, sem chamar a API SIGEF.
  private _startCacheCycle(): void {
    this._runCacheCycle();
    this._cacheCycleTimer = setInterval(() => this._runCacheCycle(), 5 * 60_000);
  }

  private async _runCacheCycle(): Promise<void> {
    if (this._isRunning()) return;
    console.log('[Scheduler] Ciclo rápido (cache) — mirror → cache');
    await this.syncService.runAutomaticSyncCycle();
  }

  // ── Ciclo Médio: Atualizar SIGEF (30 min, 07:00-18:00) ──────
  // Baixa dados dos últimos 15 dias da API SIGEF e atualiza o cache.
  private _startSigefUpdateCycle(): void {
    this._runSigefUpdateCycle();
    this._sigefUpdateTimer = setInterval(() => this._runSigefUpdateCycle(), 30 * 60_000);
  }

  private async _runSigefUpdateCycle(): Promise<void> {
    const hora = new Date().getHours();
    if (hora < 7 || hora >= 18) {
      console.log('[Scheduler] Fora do horário comercial (07-18h). Pulando ciclo SIGEF.');
      return;
    }

    if (this._isRunning()) {
      console.log('[Scheduler] Ciclo anterior ainda em execução. Pulando.');
      return;
    }

    if (this.bulkSyncService.isRunning() || this.syncService.isSyncing()) {
      console.log('[Scheduler] Sincronização manual em andamento. Pulando ciclo.');
      return;
    }

    this._isRunning.set(true);
    try {
      console.log('[Scheduler] Ciclo médio — baixando últimos 15 dias da API SIGEF');
      const inicio = new Date();
      inicio.setDate(inicio.getDate() - 15);
      const fim = new Date();
      console.log(`[Scheduler] Período: ${inicio.toISOString().split('T')[0]} a ${fim.toISOString().split('T')[0]}`);
      await this.sigefService.withApiLock(async () => {
        await this.bulkSyncService.downloadLastDays(15);
        await this.syncService.syncAllContractsFinance(true);
        await this.contractService.loadContracts(undefined, true);
      });
      console.log('[Scheduler] Ciclo médio concluído.');
    } catch (err: any) {
      console.error('[Scheduler] Erro no ciclo médio:', err?.message);
      // Não propaga o erro — o ciclo seguinte tentará novamente em 30 min.
    } finally {
      this._isRunning.set(false);
    }
  }

  // ── Sincronizar SIGEF Manual ────────────────────────────────
  async runManualSync(): Promise<void> {
    if (this._isRunning()) {
      throw new Error('Uma sincronização já está em andamento.');
    }

    if (this.bulkSyncService.isRunning() || this.syncService.isSyncing()) {
      throw new Error('Outra operação de sincronização está em andamento.');
    }

    this._isRunning.set(true);
    try {
      await this.sigefService.withApiLock(async () => {
        console.log('[Scheduler] Sincronização manual — download completo');
        await this.bulkSyncService.downloadInitialData();
        await this.syncService.syncAllContractsFinance(true);
        await this.contractService.loadContracts(undefined, true);
      });
      console.log('[Scheduler] Sincronização manual concluída.');
    } finally {
      this._isRunning.set(false);
    }
  }

  private _stopAll(): void {
    if (this._cacheCycleTimer) {
      clearInterval(this._cacheCycleTimer);
      this._cacheCycleTimer = null;
    }
    if (this._sigefUpdateTimer) {
      clearInterval(this._sigefUpdateTimer);
      this._sigefUpdateTimer = null;
    }
  }
}
