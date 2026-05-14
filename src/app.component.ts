import { CommonModule, registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { Component, inject, LOCALE_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AppContextService } from './core/services/app-context.service';
import { SigefService } from './core/services/sigef.service';
import { SigefSyncService } from './core/services/sigef-sync.service';
import { SigefBulkSyncService } from './core/services/sigef-bulk-sync.service';

registerLocaleData(localePt);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-BR' }],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public contextService   = inject(AppContextService);
  public sigefService     = inject(SigefService);
  public sigefSyncService = inject(SigefSyncService);
  public bulkSyncService  = inject(SigefBulkSyncService);

  private readonly FIX_VERSION = 'v2-ne-only-queries';

  constructor() {
    setTimeout(async () => {
      try {
        const done = await this.bulkSyncService.isInitialDownloadComplete();
        if (!done) {
          console.log('[App] Espelho SIGEF vazio — iniciando download inicial (2025 + 2026)...');
          await this.bulkSyncService.downloadInitialData();
          console.log('[App] Download inicial concluído.');
          // Popular transacoes a partir dos dados recém-baixados
          await this.sigefSyncService.syncAllContractsFinance(false);
        } else {
          console.log('[App] Espelho SIGEF já possui dados. Download inicial pulado.');
        }

        // Aplicar correção de relacionamentos NE/OB uma única vez
        await this._applySigefFixIfNeeded();
      } catch (err) {
        console.error('[App] Erro no download inicial do SIGEF:', err);
      }
    }, 3000);
  }

  private async _applySigefFixIfNeeded(): Promise<void> {
    const applied = localStorage.getItem('sigef_fix_applied');
    if (applied === this.FIX_VERSION) return;

    console.log(`[App] Aplicando correção de relacionamentos NE/OB (${this.FIX_VERSION})...`);
    try {
      await this.sigefSyncService.applyFixToAllContracts();
      localStorage.setItem('sigef_fix_applied', this.FIX_VERSION);
      console.log('[App] Correção aplicada com sucesso.');
    } catch (err) {
      console.error('[App] Erro ao aplicar correção:', err);
    }
  }

  sidebarOpen = false;
  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }
}
