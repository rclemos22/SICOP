import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

/**
 * Representa um registro bruto de Nota de Empenho como vem da API do SIGEF.
 * O campo raw_data contém o payload completo original.
 */
export interface ImportSigefNe {
  id?: string;
  nunotaempenho: string;
  cdunidadegestora: string;
  ano?: number | null;
  nuneoriginal?: string | null;
  raw_data: Record<string, any>;
  imported_at?: string;
  last_sync?: string;
}

/**
 * Representa um registro bruto de Ordem Bancária como vem da API do SIGEF.
 * O campo raw_data contém o payload completo original.
 */
export interface ImportSigefOb {
  id?: string;
  nuordembancaria: string;
  cdunidadegestora: string;
  nudocumento?: string | null;
  nunotaempenho?: string | null;
  ano?: number | null;
  dtlancamento?: string | null;
  dtpagamento?: string | null;
  cdsituacaoordembancaria?: string | null;
  vltotal?: number | null;
  raw_data: Record<string, any>;
  imported_at?: string;
  last_sync?: string;
}

/**
 * SigefMirrorService
 *
 * Responsável exclusivamente por ler e gravar nas tabelas de espelho bruto:
 *   - import_sigef_ne  → Notas de Empenho (raw da API)
 *   - import_sigef_ob  → Ordens Bancárias  (raw da API)
 *
 * PRINCÍPIOS:
 *  1. Os dados são gravados SEM QUALQUER TRATAMENTO (raw_data = JSON da API).
 *  2. As consultas são feitas PRIMEIRO aqui; a API oficial só é chamada na sincronização
 *     explícita (botão "Sincronizar SIGEF").
 *  3. A sincronização é INCREMENTAL: só insere/atualiza registros que ainda não existem
 *     ou que mudaram, evitando consumo desnecessário da API.
 */
@Injectable({
  providedIn: 'root'
})
export class SigefMirrorService {
  private supabaseService = inject(SupabaseService);

  private get client() {
    return this.supabaseService.client;
  }

  // =============================================================
  // Notas de Empenho (import_sigef_ne)
  // =============================================================

  /**
   * Verifica se uma NE já existe no espelho.
   */
  async hasNe(nunotaempenho: string, cdunidadegestora: string): Promise<boolean> {
    const { count } = await this.client
      .from('import_sigef_ne')
      .select('id', { count: 'exact', head: true })
      .eq('nunotaempenho', nunotaempenho.trim().toUpperCase())
      .eq('cdunidadegestora', cdunidadegestora.toString());
    return (count ?? 0) > 0;
  }

  /**
   * Retorna todos os registros de NE para um número de empenho (inclui reforços/anulações
   * onde nuneoriginal = nunotaempenho buscado).
   */
  async getNesByNumber(nunotaempenho: string, cdunidadegestora: string): Promise<ImportSigefNe[]> {
    const ne = nunotaempenho.trim().toUpperCase();
    const { data, error } = await this.client
      .from('import_sigef_ne')
      .select('*')
      .eq('cdunidadegestora', cdunidadegestora.toString())
      .or(`nunotaempenho.eq.${ne},nuneoriginal.eq.${ne}`)
      .order('imported_at', { ascending: true });

    if (error) {
      console.error('[SigefMirror] Erro ao buscar NEs:', error);
      return [];
    }
    return data as ImportSigefNe[];
  }

  /**
   * Retorna o raw_data de uma NE específica (apenas o empenho original, não reforços).
   */
  async getNeRaw(nunotaempenho: string, cdunidadegestora: string): Promise<Record<string, any> | null> {
    const { data, error } = await this.client
      .from('import_sigef_ne')
      .select('raw_data')
      .eq('nunotaempenho', nunotaempenho.trim().toUpperCase())
      .eq('cdunidadegestora', cdunidadegestora.toString())
      .maybeSingle();

    if (error || !data) return null;
    return data.raw_data;
  }

  /**
   * Retorna todos os raw_data de movimentações (original + reforços/anulações) para uma NE.
   */
  async getNeMovementsRaw(nunotaempenho: string, cdunidadegestora: string): Promise<Record<string, any>[]> {
    const rows = await this.getNesByNumber(nunotaempenho, cdunidadegestora);
    return rows.map(r => r.raw_data);
  }

  /**
   * Salva um lote de NEs no espelho (upsert por nunotaempenho + cdunidadegestora).
   * Só atualiza registros que já existem (incremental).
   */
  async saveNesBulk(items: Record<string, any>[], cdunidadegestora: string): Promise<void> {
    if (!items || items.length === 0) return;

    const payload: ImportSigefNe[] = items
      .filter(item => item.nunotaempenho)
      .map(item => ({
        nunotaempenho: (item.nunotaempenho as string).trim().toUpperCase(),
        cdunidadegestora: cdunidadegestora.toString(),
        ano: item.ano ? Number(item.ano) : null,
        nuneoriginal: item.nuneoriginal
          ? (item.nuneoriginal as string).trim().toUpperCase()
          : null,
        raw_data: item,
        last_sync: new Date().toISOString()
      }));

    if (payload.length === 0) return;

    const { error } = await this.client
      .from('import_sigef_ne')
      .upsert(payload, { onConflict: 'nunotaempenho,cdunidadegestora' });

    if (error) {
      console.error('[SigefMirror] Erro ao salvar NEs em bulk:', error);
    } else {
      console.log(`[SigefMirror] ${payload.length} NEs salvas no espelho.`);
    }
  }

  /**
   * Retorna quais nunotaempenho de uma lista ainda NÃO existem no espelho.
   * Usado para sincronização incremental.
   */
  async getMissingNes(nunotaempenhos: string[], cdunidadegestora: string): Promise<string[]> {
    if (!nunotaempenhos.length) return [];

    const normalized = nunotaempenhos.map(n => n.trim().toUpperCase());
    const { data, error } = await this.client
      .from('import_sigef_ne')
      .select('nunotaempenho')
      .eq('cdunidadegestora', cdunidadegestora.toString())
      .in('nunotaempenho', normalized);

    if (error) return normalized; // em caso de erro, assume todos como ausentes

    const existing = new Set((data || []).map((r: any) => r.nunotaempenho as string));
    return normalized.filter(n => !existing.has(n));
  }

  // =============================================================
  // Ordens Bancárias (import_sigef_ob)
  // =============================================================

  /**
   * Retorna todas as OBs de uma NE no espelho.
   */
  async getObsByNe(nunotaempenho: string, cdunidadegestora: string): Promise<ImportSigefOb[]> {
    const { data, error } = await this.client
      .from('import_sigef_ob')
      .select('*')
      .eq('nunotaempenho', nunotaempenho.trim().toUpperCase())
      .eq('cdunidadegestora', cdunidadegestora.toString())
      .order('dtlancamento', { ascending: true });

    if (error) {
      console.error('[SigefMirror] Erro ao buscar OBs:', error);
      return [];
    }
    return data as ImportSigefOb[];
  }

  /**
   * Retorna os raw_data de todas as OBs de uma NE.
   */
  async getObsRawByNe(nunotaempenho: string, cdunidadegestora: string): Promise<Record<string, any>[]> {
    const rows = await this.getObsByNe(nunotaempenho, cdunidadegestora);
    return rows.map(r => r.raw_data);
  }

  /**
   * Retorna uma OB específica pelo número.
   */
  async getObByNumber(nuordembancaria: string, cdunidadegestora: string): Promise<ImportSigefOb | null> {
    const { data, error } = await this.client
      .from('import_sigef_ob')
      .select('*')
      .eq('nuordembancaria', nuordembancaria.trim().toUpperCase())
      .eq('cdunidadegestora', cdunidadegestora.toString())
      .maybeSingle();

    if (error || !data) return null;
    return data as ImportSigefOb;
  }

  /**
   * Salva um lote de OBs no espelho (upsert por nuordembancaria + cdunidadegestora + nudocumento).
   */
  async saveObsBulk(items: Record<string, any>[], cdunidadegestora: string): Promise<void> {
    if (!items || items.length === 0) return;

    const payload: ImportSigefOb[] = items
      .filter(item => item.nuordembancaria)
      .map(item => ({
        nuordembancaria: (item.nuordembancaria as string).trim().toUpperCase(),
        cdunidadegestora: cdunidadegestora.toString(),
        nudocumento: item.nudocumento ? (item.nudocumento as string).trim() : null,
        nunotaempenho: item.nunotaempenho
          ? (item.nunotaempenho as string).trim().toUpperCase()
          : null,
        ano: item.ano ? Number(item.ano) : null,
        dtlancamento: item.dtlancamento || null,
        dtpagamento: item.dtpagamento || null,
        cdsituacaoordembancaria: item.cdsituacaoordembancaria || null,
        vltotal: item.vltotal != null ? Number(item.vltotal) : null,
        raw_data: item,
        last_sync: new Date().toISOString()
      }));

    if (payload.length === 0) return;

    const { error } = await this.client
      .from('import_sigef_ob')
      .upsert(payload, { onConflict: 'nuordembancaria,cdunidadegestora,nudocumento' });

    if (error) {
      console.error('[SigefMirror] Erro ao salvar OBs em bulk:', error);
    } else {
      console.log(`[SigefMirror] ${payload.length} OBs salvas no espelho.`);
    }
  }

  /**
   * Retorna quais nuordembancaria de uma lista já existem no espelho para uma NE.
   * Usado para sincronização incremental (evitar re-download de OBs já conhecidas).
   */
  async getExistingObNumbers(nunotaempenho: string, cdunidadegestora: string): Promise<Set<string>> {
    const { data, error } = await this.client
      .from('import_sigef_ob')
      .select('nuordembancaria')
      .eq('nunotaempenho', nunotaempenho.trim().toUpperCase())
      .eq('cdunidadegestora', cdunidadegestora.toString());

    if (error || !data) return new Set();
    return new Set((data as any[]).map(r => r.nuordembancaria as string));
  }

  /**
   * Busca global de OBs no espelho (para o modal de vinculação).
   */
  async searchObs(search: string, cdunidadegestora?: string): Promise<ImportSigefOb[]> {
    let query = this.client
      .from('import_sigef_ob')
      .select('*')
      .or(`nuordembancaria.ilike.%${search}%,nunotaempenho.ilike.%${search}%`)
      .limit(30);

    if (cdunidadegestora) {
      query = query.eq('cdunidadegestora', cdunidadegestora.toString());
    }

    const { data, error } = await query;
    if (error) return [];
    return data as ImportSigefOb[];
  }

  // =============================================================
  // Utilitários
  // =============================================================

  /**
   * Retorna a data da última sincronização de uma NE específica.
   */
  async getLastSyncNe(nunotaempenho: string, cdunidadegestora: string): Promise<Date | null> {
    const { data } = await this.client
      .from('import_sigef_ne')
      .select('last_sync')
      .eq('nunotaempenho', nunotaempenho.trim().toUpperCase())
      .eq('cdunidadegestora', cdunidadegestora.toString())
      .maybeSingle();

    if (!data?.last_sync) return null;
    return new Date(data.last_sync);
  }

  /**
   * Retorna a data da última sincronização de OBs de uma NE.
   */
  async getLastSyncObs(nunotaempenho: string, cdunidadegestora: string): Promise<Date | null> {
    const { data } = await this.client
      .from('import_sigef_ob')
      .select('last_sync')
      .eq('nunotaempenho', nunotaempenho.trim().toUpperCase())
      .eq('cdunidadegestora', cdunidadegestora.toString())
      .order('last_sync', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.last_sync) return null;
    return new Date(data.last_sync);
  }
}
