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
    // Ciclos automáticos desativados — executar manualmente via runManualSync()
  }

  ngOnDestroy(): void {
    this._stopAll();
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
