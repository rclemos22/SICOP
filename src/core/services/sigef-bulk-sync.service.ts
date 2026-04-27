import { Injectable, inject, signal, computed } from '@angular/core';
import { SigefService } from './sigef.service';
import { SigefMirrorService } from './sigef-mirror.service';
import { SupabaseService } from './supabase.service';

export interface SyncPeriod {
  id?: string;
  periodo_inicio: string; // ISO date: '2025-01-01'
  periodo_fim: string;    // ISO date: '2025-01-31'
  tipo: 'NE' | 'OB';
  total_registros: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  error_msg?: string;
  started_at?: string;
  finished_at?: string;
}

export interface BulkSyncProgress {
  phase: 'idle' | 'ne' | 'ob' | 'done';
  currentLabel: string;
  current: number;
  total: number;
  percent: number;
  totalNeSaved: number;
  totalObSaved: number;
  errors: string[];
}

/**
 * SigefBulkSyncService
 *
 * ARQUITETURA "ESPELHO COMPLETO POR PERÍODO":
 *
 *  Em vez de baixar NE/OB individualmente conforme são acessadas,
 *  este serviço faz um DOWNLOAD EM MASSA de todos os dados do SIGEF
 *  para um intervalo de datas — mês a mês, sequencialmente.
 *
 *  Fluxo inicial:
 *    1. Download de 2025 completo   (01/01/2025 → 31/12/2025)
 *    2. Download de 2026 até hoje   (01/01/2026 → hoje)
 *
 *  Fluxo de atualização (botão "Atualizar SIGEF"):
 *    - Baixa os últimos 60 dias     (hoje - 60 dias → hoje)
 *
 *  Após o download, o sistema consulta SOMENTE o espelho local
 *  (import_sigef_ne / import_sigef_ob) sem consumir a API oficial.
 */
@Injectable({
  providedIn: 'root'
})
export class SigefBulkSyncService {
  private sigefService  = inject(SigefService);
  private mirrorService = inject(SigefMirrorService);
  private supabase      = inject(SupabaseService);

  private get client() { return this.supabase.client; }

  // ─── Estado reativo ───────────────────────────────────────────
  private _progress = signal<BulkSyncProgress>({
    phase: 'idle',
    currentLabel: '',
    current: 0,
    total: 0,
    percent: 0,
    totalNeSaved: 0,
    totalObSaved: 0,
    errors: []
  });

  private _isRunning = signal<boolean>(false);

  readonly progress   = this._progress.asReadonly();
  readonly isRunning  = this._isRunning.asReadonly();

  // ─── Constantes ────────────────────────────────────────────────
  private readonly UG = '080901'; // Unidade Gestora padrão
  private readonly PAGE_DELAY_MS = 600; // Delay entre páginas
  private readonly MONTH_DELAY_MS = 1000; // Delay entre meses

  // =================================================================
  // API PÚBLICA
  // =================================================================

  /**
   * Executa o download inicial completo:
   *   1. Todos os dados de 2025 (NE + OB)
   *   2. Todos os dados de 2026 até hoje (NE + OB)
   *
   * Pula períodos que já foram baixados com sucesso (idempotente).
   */
  async downloadInitialData(): Promise<void> {
    if (this._isRunning()) {
      console.warn('[BulkSync] Download já em andamento.');
      return;
    }

    this._isRunning.set(true);
    this._resetProgress();

    try {
      const hoje = new Date();
      const anoAtual = hoje.getFullYear();

      // Montar lista de meses a baixar
      const meses: { inicio: string; fim: string; label: string }[] = [];

      // 2025: janeiro a dezembro completo
      for (let m = 1; m <= 12; m++) {
        const inicio = this._formatDate(new Date(2025, m - 1, 1));
        const fim    = this._formatDate(this._lastDayOfMonth(2025, m));
        meses.push({ inicio, fim, label: `2025/${String(m).padStart(2, '0')}` });
      }

      // 2026: janeiro até o mês atual (inclusive)
      if (anoAtual >= 2026) {
        const mesAtual = hoje.getMonth() + 1; // 1-indexed
        for (let m = 1; m <= mesAtual; m++) {
          const inicio = this._formatDate(new Date(2026, m - 1, 1));
          const fim    = m === mesAtual
            ? this._formatDate(hoje)
            : this._formatDate(this._lastDayOfMonth(2026, m));
          meses.push({ inicio, fim, label: `2026/${String(m).padStart(2, '0')}` });
        }
      }

      const total = meses.length * 2; // NE + OB por mês
      let current = 0;
      let totalNe = 0;
      let totalOb = 0;
      const errors: string[] = [];

      // ── Fase NE ──────────────────────────────────────────────
      this._setPhase('ne', current, total, totalNe, totalOb, errors, 'Baixando Notas de Empenho...');

      for (const { inicio, fim, label } of meses) {
        current++;
        this._setProgress(
          'ne', current, total, totalNe, totalOb, errors,
          `NE ${label}`
        );

        // Pular se já baixado com sucesso
        if (await this._isPeriodComplete(inicio, fim, 'NE')) {
          console.log(`[BulkSync] NE ${label} já sincronizado. Pulando.`);
          continue;
        }

        try {
          const count = await this._downloadNePeriod(inicio, fim, label);
          totalNe += count;
          await this._markPeriodComplete(inicio, fim, 'NE', count);
        } catch (err: any) {
          const msg = `NE ${label}: ${err?.message || 'Erro desconhecido'}`;
          errors.push(msg);
          console.error('[BulkSync]', msg);
          await this._markPeriodError(inicio, fim, 'NE', msg);
        }

        await this._delay(this.MONTH_DELAY_MS);
      }

      // ── Fase OB ──────────────────────────────────────────────
      this._setPhase('ob', current, total, totalNe, totalOb, errors, 'Baixando Ordens Bancárias...');

      for (const { inicio, fim, label } of meses) {
        current++;
        this._setProgress(
          'ob', current, total, totalNe, totalOb, errors,
          `OB ${label}`
        );

        if (await this._isPeriodComplete(inicio, fim, 'OB')) {
          console.log(`[BulkSync] OB ${label} já sincronizado. Pulando.`);
          continue;
        }

        try {
          const count = await this._downloadObPeriod(inicio, fim, label);
          totalOb += count;
          await this._markPeriodComplete(inicio, fim, 'OB', count);
        } catch (err: any) {
          const msg = `OB ${label}: ${err?.message || 'Erro desconhecido'}`;
          errors.push(msg);
          console.error('[BulkSync]', msg);
          await this._markPeriodError(inicio, fim, 'OB', msg);
        }

        await this._delay(this.MONTH_DELAY_MS);
      }

      this._setProgress('done', total, total, totalNe, totalOb, errors, 'Download concluído!');
      console.log(`[BulkSync] Download inicial concluído. NEs: ${totalNe}, OBs: ${totalOb}, Erros: ${errors.length}`);

    } finally {
      this._isRunning.set(false);
    }
  }

  /**
   * Atualização incremental dos últimos 60 dias (botão "Atualizar SIGEF").
   * Força o re-download do período mesmo que já exista no controle.
   */
  async downloadLast60Days(): Promise<void> {
    if (this._isRunning()) {
      console.warn('[BulkSync] Download já em andamento.');
      return;
    }

    this._isRunning.set(true);
    this._resetProgress();

    try {
      const hoje  = new Date();
      const inicio60 = new Date(hoje);
      inicio60.setDate(hoje.getDate() - 60);

      const inicioStr = this._formatDate(inicio60);
      const fimStr    = this._formatDate(hoje);

      const label = `últimos 60 dias (${inicioStr} → ${fimStr})`;
      console.log(`[BulkSync] Atualizando ${label}...`);

      let totalNe = 0;
      let totalOb = 0;
      const errors: string[] = [];

      // NE
      this._setProgress('ne', 0, 2, 0, 0, errors, `NE ${label}`);
      try {
        totalNe = await this._downloadNePeriod(inicioStr, fimStr, label, true);
        await this._markPeriodComplete(inicioStr, fimStr, 'NE', totalNe);
      } catch (err: any) {
        errors.push(`NE: ${err?.message}`);
        await this._markPeriodError(inicioStr, fimStr, 'NE', err?.message);
      }

      // OB
      this._setProgress('ob', 1, 2, totalNe, 0, errors, `OB ${label}`);
      try {
        totalOb = await this._downloadObPeriod(inicioStr, fimStr, label, true);
        await this._markPeriodComplete(inicioStr, fimStr, 'OB', totalOb);
      } catch (err: any) {
        errors.push(`OB: ${err?.message}`);
        await this._markPeriodError(inicioStr, fimStr, 'OB', err?.message);
      }

      this._setProgress('done', 2, 2, totalNe, totalOb, errors,
        `Concluído. NEs: ${totalNe}, OBs: ${totalOb}`);

      console.log(`[BulkSync] Atualização concluída. NEs: ${totalNe}, OBs: ${totalOb}`);

    } finally {
      this._isRunning.set(false);
    }
  }

  /**
   * Verifica se o download inicial já foi concluído (ambas as fases 2025 e 2026).
   */
  async isInitialDownloadComplete(): Promise<boolean> {
    const { count } = await this.client
      .from('sigef_sync_periods')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed');
    return (count ?? 0) > 0;
  }

  /**
   * Retorna resumo dos períodos sincronizados.
   */
  async getSyncSummary(): Promise<SyncPeriod[]> {
    const { data } = await this.client
      .from('sigef_sync_periods')
      .select('*')
      .order('periodo_inicio', { ascending: true });
    return (data || []) as SyncPeriod[];
  }

  // =================================================================
  // Download de NEs por período
  // =================================================================

  private async _downloadNePeriod(
    datainicio: string,
    datafim: string,
    label: string,
    forceUpdate: boolean = false
  ): Promise<number> {
    await this._upsertPeriodRunning(datainicio, datafim, 'NE');

    let totalSaved = 0;
    let page = 1;
    let hasNext = true;
    const MAX_PAGES = 50; // Segurança contra loop infinito

    console.log(`[BulkSync] Baixando NEs de ${datainicio} até ${datafim}...`);

    while (hasNext && page <= MAX_PAGES) {
      try {
        const result = await this._withRetry(() =>
          this.sigefService.getNotaEmpenhoByPeriod(datainicio, datafim, page, this.UG)
        );

        if (result.data.length > 0) {
          await this.mirrorService.saveNesBulk(
            result.data as Record<string, any>[],
            this.UG,
            datainicio
          );
          totalSaved += result.data.length;
          console.log(`[BulkSync] NE ${label} pág.${page}: +${result.data.length} (total: ${totalSaved})`);
        }

        hasNext = !!result.next;
        page++;

        if (hasNext) {
          await this._delay(this.PAGE_DELAY_MS);
        }
      } catch (err: any) {
        const isNet = this._isNetworkError(err);
        console.error(`[BulkSync] Erro pág.${page} NE ${label}:`, err?.message);
        if (isNet && totalSaved > 0) {
          // Salva parcial e encerra graciosamente
          console.warn(`[BulkSync] Encerrando NE ${label} após erro de rede. Salvos: ${totalSaved}`);
          hasNext = false;
        } else {
          hasNext = false;
          throw err;
        }
      }
    }

    return totalSaved;
  }

  // =================================================================
  // Download de OBs por período
  // =================================================================

  private async _downloadObPeriod(
    datainicio: string,
    datafim: string,
    label: string,
    forceUpdate: boolean = false
  ): Promise<number> {
    await this._upsertPeriodRunning(datainicio, datafim, 'OB');

    let totalSaved = 0;
    let page = 1;
    let hasNext = true;
    const MAX_PAGES = 50;

    console.log(`[BulkSync] Baixando OBs de ${datainicio} até ${datafim}...`);

    while (hasNext && page <= MAX_PAGES) {
      try {
        const result = await this._withRetry(() =>
          this.sigefService.getOrdemBancaria(
            datainicio,
            datafim,
            page,
            undefined,    // nuordembancaria: não filtra
            undefined,    // nunotaempenho: não filtra — download total
            this.UG,
            true          // bypassMirror: força download da API
          )
        );

        if (result.data.length > 0) {
          await this.mirrorService.saveObsBulk(
            result.data as Record<string, any>[],
            this.UG
          );
          totalSaved += result.data.length;
          console.log(`[BulkSync] OB ${label} pág.${page}: +${result.data.length} (total: ${totalSaved})`);
        }

        hasNext = !!result.next;
        page++;

        if (hasNext) {
          await this._delay(this.PAGE_DELAY_MS);
        }
      } catch (err: any) {
        const isNet = this._isNetworkError(err);
        console.error(`[BulkSync] Erro pág.${page} OB ${label}:`, err?.message);
        if (isNet && totalSaved > 0) {
          // Salva parcial e encerra graciosamente
          console.warn(`[BulkSync] Encerrando OB ${label} após erro de rede. Salvos: ${totalSaved}`);
          hasNext = false;
        } else {
          hasNext = false;
          throw err;
        }
      }
    }

    return totalSaved;
  }

  // =================================================================
  // Controle de períodos sincronizados
  // =================================================================

  private async _isPeriodComplete(inicio: string, fim: string, tipo: 'NE' | 'OB'): Promise<boolean> {
    const { data } = await this.client
      .from('sigef_sync_periods')
      .select('status')
      .eq('periodo_inicio', inicio)
      .eq('periodo_fim', fim)
      .eq('tipo', tipo)
      .maybeSingle();
    return data?.status === 'completed';
  }

  private async _upsertPeriodRunning(inicio: string, fim: string, tipo: 'NE' | 'OB'): Promise<void> {
    await this.client
      .from('sigef_sync_periods')
      .upsert({
        periodo_inicio: inicio,
        periodo_fim: fim,
        tipo,
        status: 'running',
        started_at: new Date().toISOString(),
        total_registros: 0
      }, { onConflict: 'periodo_inicio,periodo_fim,tipo' });
  }

  private async _markPeriodComplete(inicio: string, fim: string, tipo: 'NE' | 'OB', count: number): Promise<void> {
    await this.client
      .from('sigef_sync_periods')
      .upsert({
        periodo_inicio: inicio,
        periodo_fim: fim,
        tipo,
        status: 'completed',
        total_registros: count,
        finished_at: new Date().toISOString(),
        error_msg: null
      }, { onConflict: 'periodo_inicio,periodo_fim,tipo' });
  }

  private async _markPeriodError(inicio: string, fim: string, tipo: 'NE' | 'OB', msg: string): Promise<void> {
    await this.client
      .from('sigef_sync_periods')
      .upsert({
        periodo_inicio: inicio,
        periodo_fim: fim,
        tipo,
        status: 'error',
        error_msg: msg,
        finished_at: new Date().toISOString()
      }, { onConflict: 'periodo_inicio,periodo_fim,tipo' });
  }

  // =================================================================
  // Utilitários
  // =================================================================

  private _formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private _lastDayOfMonth(year: number, month: number): Date {
    return new Date(year, month, 0); // Dia 0 do mês seguinte = último do atual
  }

  private _isNetworkError(err: any): boolean {
    return /ETIMEDOUT|ECONNREFUSED|ECONNRESET|Failed to fetch|NetworkError|TLS|disconnected|timeout/i
      .test(err?.message || err?.cause?.message || String(err) || '');
  }

  private async _withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 3000): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        if (this._isNetworkError(err) && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.warn(`[BulkSync] Retry ${attempt}/${maxRetries} em ${delay}ms... (${err?.message})`);
          await this._delay(delay);
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  }

  private _delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Progress helpers ──────────────────────────────────────────

  private _resetProgress(): void {
    this._progress.set({
      phase: 'idle',
      currentLabel: 'Iniciando...',
      current: 0,
      total: 0,
      percent: 0,
      totalNeSaved: 0,
      totalObSaved: 0,
      errors: []
    });
  }

  private _setPhase(
    phase: BulkSyncProgress['phase'],
    current: number,
    total: number,
    totalNe: number,
    totalOb: number,
    errors: string[],
    label: string
  ): void {
    this._setProgress(phase, current, total, totalNe, totalOb, errors, label);
  }

  private _setProgress(
    phase: BulkSyncProgress['phase'],
    current: number,
    total: number,
    totalNe: number,
    totalOb: number,
    errors: string[],
    label: string
  ): void {
    this._progress.set({
      phase,
      currentLabel: label,
      current,
      total,
      percent: total > 0 ? Math.round((current / total) * 100) : 0,
      totalNeSaved: totalNe,
      totalObSaved: totalOb,
      errors: [...errors]
    });
  }
}
