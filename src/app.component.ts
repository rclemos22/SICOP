import { CommonModule, registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { Component, inject, HostListener, LOCALE_ID, signal, effect, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AppContextService } from './core/services/app-context.service';
import { SigefService } from './core/services/sigef.service';
import { SigefSyncService } from './core/services/sigef-sync.service';
import { SigefBulkSyncService } from './core/services/sigef-bulk-sync.service';
import { SigefSchedulerService } from './core/services/sigef-scheduler.service';

registerLocaleData(localePt);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-BR' }],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public contextService    = inject(AppContextService);
  public sigefService      = inject(SigefService);
  public sigefSyncService  = inject(SigefSyncService);
  public bulkSyncService   = inject(SigefBulkSyncService);
  public sigefScheduler    = inject(SigefSchedulerService);

  readonly sidebarOpen = signal(false);
  readonly windowWidth = signal(window.innerWidth);
  readonly theme = signal<'light' | 'dark'>(
    (localStorage.getItem('theme') as 'light' | 'dark') || 'light'
  );
  readonly isDesktop = computed(() => this.windowWidth() >= 1024);

  @HostListener('window:resize')
  onResize() { this.windowWidth.set(window.innerWidth); }

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.classList.toggle('dark', t === 'dark');
      document.documentElement.classList.toggle('light', t === 'light');
      localStorage.setItem('theme', t);
    });
  }

  toggleTheme() {
    this.theme.update(t => t === 'dark' ? 'light' : 'dark');
  }
}
