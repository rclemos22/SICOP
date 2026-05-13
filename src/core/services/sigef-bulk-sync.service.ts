import { Injectable, inject, signal } from '@angular/core';
import { SigefService } from './sigef.service';
import { SigefMirrorService } from './sigef-mirror.service';
import { SupabaseService } from './supabase.service';

interface RegisteredNE {
  nunotaempenho: string;
  ug: string;
  ano: number;
}

export interface SyncPeriod {
  id?: string;
  periodo_inicio: string;
  periodo_fim: string;
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

@Injectable({
  providedIn: 'root'
})
export class SigefBulkSyncService {
  private sigefService = inject(SigefService);
  private mirrorService = inject(SigefMirrorService);
  private supabase = inject(SupabaseService);

  private get client() { return this.supabase.client; }

  // Estado reativo
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

  readonly progress = this._progress.asReadonly();
  readonly isRunning = this._isRunning.asReadonly();

  // Constantes
  private readonly UG = '080901';
  private readonly PAGE_DELAY_MS = 600;
  private readonly MONTH_DELAY_MS = 1000;

  // Métodos auxiliares para progresso
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

  // API Pública

  async downloadInitialData(): Promise<void> {
    if (this._isRunning()) {
      console.warn('[BulkSync] Download já em andamento.');
      return;
    }

    this._isRunning.set(true);
    this._resetProgress();

    try {
      const registeredNEs = await this._getRegisteredNEs();

      if (registeredNEs.length === 0) {
        console.warn('[BulkSync] Nenhuma NE cadastrada. Encerrando.');
        this._setProgress('done', 0, 0, 0, 0, [], 'Nenhuma NE cadastrada.');
        return;
      }

      const total = registeredNEs.length * 2;
      let current = 0;
      let totalNe = 0;
      let totalOb = 0;
      const errors: string[] = [];

      // Fase NE
      this._setPhase('ne', current, total, totalNe, totalOb, errors, 'Baixando Notas de Empenho cadastradas...');

      for (const { nunotaempenho, ug, ano } of registeredNEs) {
        current++;
        const label = `NE ${nunotaempenho} (${ano})`;
        this._setProgress('ne', current, total, totalNe, totalOb, errors, label);

        const neYear = parseInt(ano.toString(), 10);
        const inicioNE = `${neYear}-01-01`;
        const fimNE = `${neYear}-12-31`;

        if (await this._isPeriodComplete(inicioNE, fimNE, 'NE')) {
          console.log(`[BulkSync] ${label} já sincronizado. Pulando.`);
          totalNe++;
          continue;
        }

        try {
          const count = await this._downloadSpecificNE(nunotaempenho, ug, ano);
          totalNe += count;
          await this._markPeriodComplete(inicioNE, fimNE, 'NE', count);
        } catch (err: any) {
          const msg = `${label}: ${err?.message || 'Erro desconhecido'}`;
          errors.push(msg);
          console.error('[BulkSync]', msg);
          await this._markPeriodError(inicioNE, fimNE, 'NE', msg);
        }

        await this._delay(this.MONTH_DELAY_MS);
      }

      // Fase OB
      this._setPhase('ob', current, total, totalNe, totalOb, errors, 'Baixando Ordens Bancárias das NEs cadastradas...');

      for (const { nunotaempenho, ug, ano } of registeredNEs) {
        current++;
        const label = `OB ${nunotaempenho} (${ano})`;
        this._setProgress('ob', current, total, totalNe, totalOb, errors, label);

        const neYear = parseInt(ano.toString(), 10);
        const inicioNE = `${neYear}-01-01`;
        const fimNE = `${neYear}-12-31`;

        if (await this._isPeriodComplete(inicioNE, fimNE, 'OB')) {
          console.log(`[BulkSync] OBs de ${label} já sincronizados. Pulando.`);
          totalOb++;
          continue;
        }

        try {
          const count = await this._downloadObsForNE(nunotaempenho, ug, ano);
          totalOb += count;
          await this._markPeriodComplete(inicioNE, fimNE, 'OB', count);
        } catch (err: any) {
          const msg = `${label}: ${err?.message || 'Erro desconhecido'}`;
          errors.push(msg);
          console.error('[BulkSync]', msg);
          await this._markPeriodError(inicioNE, fimNE, 'OB', msg);
        }

        await this._delay(this.MONTH_DELAY_MS);
      }

      this._setProgress('done', total, total, totalNe, totalOb, errors, 'Download concluído!');
      console.log(`[BulkSync] Download inicial concluído. NEs: ${totalNe}, OBs: ${totalOb}, Erros: ${errors.length}`);

    } finally {
      this._isRunning.set(false);
    }
  }

  async downloadLast60Days(): Promise<void> {
    if (this._isRunning()) {
      console.warn('[BulkSync] Download já em andamento.');
      return;
    }

    this._isRunning.set(true);
    this._resetProgress();

    try {
      const hoje = new Date();
      const inicio60 = new Date(hoje);
      inicio60.setDate(hoje.getDate() - 60);

      const inicioStr = this._formatDate(inicio60);
      const fimStr = this._formatDate(hoje);

      const label = `últimos 60 dias (${inicioStr} → ${fimStr})`;
      console.log(`[BulkSync] Atualizando ${label}...`);

      const registeredNEs = await this._getRegisteredNEs();

      if (registeredNEs.length === 0) {
        console.warn('[BulkSync] Nenhuma NE cadastrada. Encerrando.');
        this._setProgress('done', 0, 0, 0, 0, [], 'Nenhuma NE cadastrada.');
        return;
      }

      const total = registeredNEs.length * 2;
      let current = 0;
      let totalNe = 0;
      let totalOb = 0;
      const errors: string[] = [];

      // Fase NE
      this._setPhase('ne', current, total, totalNe, totalOb, errors, `Atualizando NEs (${label})...`);

      for (const { nunotaempenho, ug, ano } of registeredNEs) {
        current++;
        const neLabel = `NE ${nunotaempenho} (${ano})`;
        this._setProgress('ne', current, total, totalNe, totalOb, errors, neLabel);

        try {
          const count = await this._downloadSpecificNE(nunotaempenho, ug, ano);
          totalNe += count;
        } catch (err: any) {
          const msg = `${neLabel}: ${err?.message || 'Erro desconhecido'}`;
          errors.push(msg);
          console.error('[BulkSync]', msg);
        }

        await this._delay(this.MONTH_DELAY_MS);
      }

      // Fase OB
      this._setPhase('ob', current, total, totalNe, totalOb, errors, `Atualizando OBs (${label})...`);

      for (const { nunotaempenho, ug, ano } of registeredNEs) {
        current++;
        const obLabel = `OB ${nunotaempenho} (${ano})`;
        this._setProgress('ob', current, total, totalNe, totalOb, errors, obLabel);

        try {
          const count = await this._downloadObsForNE(nunotaempenho, ug, ano);
          totalOb += count;
        } catch (err: any) {
          const msg = `${obLabel}: ${err?.message || 'Erro desconhecido'}`;
          errors.push(msg);
          console.error('[BulkSync]', msg);
        }

        await this._delay(this.MONTH_DELAY_MS);
      }

      this._setProgress('done', total, total, totalNe, totalOb, errors,
        `Concluído. NEs: ${totalNe}, OBs: ${totalOb}`);

      console.log(`[BulkSync] Atualização concluída. NEs: ${totalNe}, OBs: ${totalOb}`);

    } finally {
      this._isRunning.set(false);
    }
  }

  async isInitialDownloadComplete(): Promise<boolean> {
    const { count } = await this.client
      .from('sigef_sync_periods')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed');
    return (count ?? 0) > 0;
  }

  async getSyncSummary(): Promise<SyncPeriod[]> {
    const { data } = await this.client
      .from('sigef_sync_periods')
      .select('*')
      .order('periodo_inicio', { ascending: true });
    return (data || []) as SyncPeriod[];
  }

  // Métodos privados

  private async _getRegisteredNEs(): Promise<RegisteredNE[]> {
    const { data, error } = await this.client
      .from('dotacoes')
      .select('nunotaempenho, unid_gestora, data_disponibilidade')
      .not('nunotaempenho', 'is', null);

    if (error) {
      console.error('[BulkSync] Erro ao buscar NEs cadastradas:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.warn('[BulkSync] Nenhuma NE cadastrada no sistema. Nada para sincronizar.');
      return [];
    }

    const neMap = new Map<string, RegisteredNE>();

    for (const item of data) {
      if (!item.nunotaempenho) continue;
      const ne = item.nunotaempenho.trim().toUpperCase();
      const ug = item.unid_gestora || '080901';
      const ano = new Date(item.data_disponibilidade).getFullYear();
      const key = `${ne}-${ug}-${ano}`;
      if (!neMap.has(key)) {
        neMap.set(key, { nunotaempenho: ne, ug, ano });
      }
    }

    const registered = Array.from(neMap.values());
    console.log(`[BulkSync] Encontradas ${registered.length} NEs cadastradas no sistema.`);
    return registered;
  }

  private async _downloadSpecificNE(
    nunotaempenho: string,
    ug: string,
    ano: number
  ): Promise<number> {
    console.log(`[BulkSync] Baixando NE específica: ${nunotaempenho} (${ano})...`);

    let totalSaved = 0;

    try {
      const ne = await this._withRetry(() =>
        this.sigefService.getNotaEmpenhoByNumber(ano.toString(), nunotaempenho, ug, true)
      );

      if (ne) {
        await this.mirrorService.saveNesBulk(
          [ne as Record<string, any>],
          ug,
          `${ano}-01-01`
        );
        totalSaved = 1;
        console.log(`[BulkSync] NE ${nunotaempenho} baixada com sucesso.`);
      }

      const movements = await this._withRetry(() =>
        this.sigefService.getNotaEmpenhoMovements(ano.toString(), nunotaempenho, ug, true)
      );

      if (movements && movements.length > 0) {
        await this.mirrorService.saveNesBulk(
          movements as Record<string, any>[],
          ug,
          `${ano}-01-01`
        );
        totalSaved += movements.length;
        console.log(`[BulkSync] +${movements.length} movimentos para NE ${nunotaempenho}.`);
      }

    } catch (err: any) {
      console.error(`[BulkSync] Erro ao baixar NE ${nunotaempenho}:`, err?.message);
      throw err;
    }

    return totalSaved;
  }

  private async _downloadObsForNE(
    nunotaempenho: string,
    ug: string,
    ano: number
  ): Promise<number> {
    console.log(`[BulkSync] Baixando OBs da NE: ${nunotaempenho}...`);

    let totalSaved = 0;
    const anoAtual = new Date().getFullYear();

    for (let a = ano; a <= anoAtual; a++) {
      const inicio = `${a}-01-01`;
      const fim = a === anoAtual
        ? this._formatDate(new Date())
        : `${a}-12-31`;

      let page = 1;
      let hasNext = true;
      const MAX_PAGES = 20;

      while (hasNext && page <= MAX_PAGES) {
        try {
          const result = await this._withRetry(() =>
            this.sigefService.getOrdemBancaria(
              inicio,
              fim,
              page,
              undefined,
              nunotaempenho,
              ug,
              true
            )
          );

          if (result.data.length > 0) {
            await this.mirrorService.saveObsBulk(
              result.data as Record<string, any>[],
              ug
            );
            totalSaved += result.data.length;
            console.log(`[BulkSync] NE ${nunotaempenho} (${a}) pág.${page}: +${result.data.length} OBs`);
          }

          hasNext = !!result.next;
          page++;

          if (hasNext) {
            await this._delay(this.PAGE_DELAY_MS);
          }
        } catch (err: any) {
          const isNet = this._isNetworkError(err);
          if (isNet && totalSaved > 0) {
            console.warn(`[BulkSync] Encerrando OBs ${nunotaempenho} após erro de rede. Salvos: ${totalSaved}`);
            hasNext = false;
          } else {
            throw err;
          }
        }
      }
    }

    return totalSaved;
  }

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

  private _formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private _lastDayOfMonth(year: number, month: number): Date {
    return new Date(year, month, 0);
  }

  private _isNetworkError(err: any): boolean {
    const patterns = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|Failed to fetch|NetworkError|TLS|disconnected|timeout|socket|handshake|connection reset|abort|enotfound|eai_again/i;
    if (patterns.test(err?.message || '')) return true;
    if (patterns.test(err?.cause?.message || '')) return true;
    if (patterns.test(String(err) || '')) return true;
    if (err?.name === 'AbortError' || err?.name === 'AggregateError') return true;
    if (err instanceof AggregateError && err.errors?.length > 0) {
      return err.errors.some((e: any) => patterns.test(e?.message || String(e)));
    }
    return false;
  }

  private async _withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 3000): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        if (this._isNetworkError(err) && attempt < maxRetries) {
          const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000) * (0.85 + Math.random() * 0.3);
          console.warn(`[BulkSync] Retry ${attempt}/${maxRetries} em ${Math.round(delay)}ms... (${err?.message || ''})`);
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
}
