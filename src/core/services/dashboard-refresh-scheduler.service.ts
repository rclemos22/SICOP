import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { DashboardService } from '../../features/dashboard/services/dashboard.service';

@Injectable({
  providedIn: 'root'
})
export class DashboardRefreshSchedulerService implements OnDestroy {
  private dashboardService = inject(DashboardService);

  private _refreshTimer: any = null;
  private _lastRefresh = signal<Date | null>(null);

  readonly lastRefresh = this._lastRefresh.asReadonly();

  constructor() {
    setTimeout(() => this._triggerRefresh(), 10_000);
    this._refreshTimer = setInterval(() => this._triggerRefresh(), 20 * 60_000);
  }

  ngOnDestroy(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  async refreshNow(): Promise<void> {
    return this._triggerRefresh();
  }

  shouldRefresh(): boolean {
    const last = this._lastRefresh();
    if (!last) return true;
    return Date.now() - last.getTime() > 60_000;
  }

  private async _triggerRefresh(): Promise<void> {
    try {
      console.log('[DashboardRefresh] Atualizando cards a partir do cache...');
      await this.dashboardService.refreshAllData();
      this._lastRefresh.set(new Date());
      console.log('[DashboardRefresh] Cards atualizados com sucesso.');
    } catch (err) {
      console.error('[DashboardRefresh] Erro ao atualizar cards:', err);
    }
  }
}
