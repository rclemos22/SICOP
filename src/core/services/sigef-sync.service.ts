import { Injectable, inject, signal, computed } from '@angular/core';
import { SigefService, NotaEmpenho, OrdemBancaria } from './sigef.service';
import { SigefMirrorService } from './sigef-mirror.service';
import { SigefCacheService, SigefOrdemBancaria, NeResumo } from './sigef-cache.service';
import { FinancialService } from '../../features/financial/services/financial.service';
import { ContractService } from '../../features/contracts/services/contract.service';
import { BudgetService } from '../../features/budget/services/budget.service';
import { AppContextService } from './app-context.service';

export interface SyncTask {
  ne: string;
  ug: string;
  ano: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
  timestamp?: number;
}

/**
 * SigefSyncService
 *
 * ARQUITETURA "ESPELHO PRIMEIRO":
 *  - Toda consulta de NE/OB é feita PRIMEIRO nas tabelas import_sigef_ne / import_sigef_ob.
 *  - A API oficial do SIGEF só é chamada quando o usuário clica em "Sincronizar SIGEF".
 *  - A sincronização é INCREMENTAL: só baixa registros que ainda não existem no espelho,
 *    ou que foram marcados para atualização forçada.
 */
@Injectable({
  providedIn: 'root'
})
export class SigefSyncService {
  private sigefService    = inject(SigefService);
  private mirrorService   = inject(SigefMirrorService);
  private cacheService    = inject(SigefCacheService);
  private financialService = inject(FinancialService);
  private contractService  = inject(ContractService);
  private budgetService    = inject(BudgetService);
  private appContext       = inject(AppContextService);

  // ─── Estado da fila ──────────────────────────────────────────
  private _syncQueue   = signal<SyncTask[]>([]);
  private _currentIdx  = signal<number>(-1);
  private _isLocked    = signal<boolean>(false);

  readonly syncQueue      = this._syncQueue.asReadonly();
  readonly currentIdx     = this._currentIdx.asReadonly();
  readonly isLocked       = this._isLocked.asReadonly();
  readonly isSyncing      = computed(() => this._currentIdx() >= 0 && this._currentIdx() < this._syncQueue().length);
  readonly isGlobalSyncing = computed(() => this.isSyncing());

  readonly progress = computed(() => {
    const queue = this._syncQueue();
    if (queue.length === 0) return 0;
    return Math.round((Math.max(0, this._currentIdx()) / queue.length) * 100);
  });

  readonly syncStatus = computed(() => {
    const queue = this._syncQueue();
    const idx   = this._currentIdx();
    if (queue.length === 0 || idx < 0) return null;
    return { current: idx + 1, total: queue.length, task: queue[idx] };
  });

  private autoSyncTimer: any;

  constructor() {
    // Sincronização automática: primeiro ciclo após 2 min, depois a cada 10 min
    setTimeout(() => {
      this.runAutomaticSyncCycle();
    }, 120000);
  }

  private async runAutomaticSyncCycle() {
    try {
      if (!this.isSyncing()) {
        const selectedYear = this.appContext.anoExercicio();
        console.log(`[SIGEF SYNC] Ciclo automático: exercício ${selectedYear}`);
        await this.syncAllContractsFinance(false, selectedYear);
      }
    } catch (err) {
      console.error('[SIGEF SYNC] Erro no ciclo automático:', err);
    } finally {
      // Agenda o próximo ciclo para 10 minutos APÓS a finalização deste
      if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = setTimeout(() => {
        this.runAutomaticSyncCycle();
      }, 10 * 60 * 1000);
    }
  }

  startAutomaticSync() {
    if (!this.autoSyncTimer) {
      this.autoSyncTimer = setTimeout(() => {
        this.runAutomaticSyncCycle();
      }, 10 * 60 * 1000);
    }
  }

  // ─── API pública principal ───────────────────────────────────

  /**
   * Obtém o resumo de uma NE. Busca PRIMEIRO no espelho; só vai à API se forceSync = true.
   * Este método é chamado pelo dashboard e páginas de contratos para exibir dados.
   */
  async getNotaEmpenhoWithCache(
    ano: string,
    neNumber: string,
    ug: string,
    forceSync: boolean = false,
    contractId?: string
  ): Promise<NeResumo | null> {
    const ugStr = ug.toString();

    // ── Fase 1: Espelho Primeiro ──────────────────────────────
    if (!forceSync) {
      const movements = await this.mirrorService.getNeMovementsRaw(neNumber, ugStr);
      if (movements.length > 0) {
        console.log(`[SIGEF SYNC] Espelho encontrado para NE ${neNumber}: ${movements.length} registro(s)`);
        // Garante que as tabelas de cache estruturado também estão populadas (legado)
        await this._persistFromMirrorToCache(neNumber, ugStr);
        return this.cacheService.getNeResumo(parseInt(ugStr, 10), neNumber);
      }
    }

    // ── Fase 2: Sincronização via API (forceSync ou espelho vazio) ──
    console.log(`[SIGEF SYNC] ${forceSync ? 'Sync forçado' : 'Espelho vazio'} – chamando API para NE: ${neNumber}`);
    await this._syncNeFromApi(ano, neNumber, ugStr, forceSync);

    // ── Fase 3: Persistir nas tabelas de cache estruturado (legado) ──
    await this._persistFromMirrorToCache(neNumber, ugStr);

    if (contractId) {
      await this.financialService.syncSigefTransactions(contractId).catch(err =>
        console.error('[SIGEF SYNC] Erro ao persistir transações:', err)
      );
    }

    return this.cacheService.getNeResumo(parseInt(ugStr, 10), neNumber);
  }

  /**
   * Sincroniza um lote de NEs (chamado pelo botão "Sincronizar SIGEF").
   * Faz download INCREMENTAL: baixa apenas NEs/OBs que ainda não estão no espelho.
   */
  async syncBatch(
    tasks: { ne: string; ug: string; ano: string }[],
    contractId?: string,
    lockUI: boolean = false
  ): Promise<void> {
    if (this.isSyncing()) {
      console.warn('[SIGEF SYNC] Sincronização já em andamento.');
      return;
    }

    const queue: SyncTask[] = tasks.map(t => ({ ...t, status: 'pending' }));
    this._syncQueue.set(queue);
    this._currentIdx.set(0);
    this._isLocked.set(lockUI);

    try {
      for (let i = 0; i < queue.length; i++) {
        this._currentIdx.set(i);
        const task = queue[i];
        this._updateTaskStatus(i, 'processing');

        try {
          console.log(`[SIGEF SYNC] ${i + 1}/${queue.length} – NE: ${task.ne}`);
          await this.getNotaEmpenhoWithCache(task.ano, task.ne, task.ug, true, contractId);
          this._updateTaskStatus(i, 'completed');
        } catch (err: any) {
          console.error(`[SIGEF SYNC] Erro na NE ${task.ne}:`, err);
          this._updateTaskStatus(i, 'error', err.message || 'Falha na comunicação');
        }

        if (i < queue.length - 1) {
          await this._delay(800);
        }
      }

      if (contractId) {
        await this.financialService.syncSigefTransactions(contractId).catch(err =>
          console.error('[SIGEF SYNC] Erro ao persistir contrato:', err)
        );
      }
    } finally {
      this._isLocked.set(false);
      setTimeout(() => { if (!this.isSyncing()) this._currentIdx.set(-1); }, 5000);
    }
  }

  /**
   * Sincroniza todos os contratos. Chamado automaticamente ou pelo botão global.
   */
  async syncAllContractsFinance(lockUI: boolean = false, year?: number): Promise<void> {
    if (this.isSyncing()) return;

    console.log('[SIGEF SYNC] Iniciando varredura global de contratos...');

    if (this.contractService.contracts().length === 0) {
      await this.contractService.loadContracts();
    }

    const contracts = this.contractService.contracts();
    const allTasks: { ne: string; ug: string; ano: string; contractId: string }[] = [];

    for (const contract of contracts) {
      const budgetResult = await this.budgetService.getBudgetsByContractId(contract.id);
      if (!budgetResult.error && budgetResult.data) {
        budgetResult.data.forEach(b => {
          if (b.nunotaempenho) {
            const bYear = new Date(b.data_disponibilidade).getFullYear();
            if (year && bYear !== year) return;
            allTasks.push({
              ne: b.nunotaempenho,
              ug: b.unid_gestora || '080901',
              ano: bYear.toString(),
              contractId: contract.id
            });
          }
        });
      }
    }

    if (allTasks.length === 0) {
      console.warn('[SIGEF SYNC] Nenhuma NE encontrada para sincronização global.');
      return;
    }

    console.log(`[SIGEF SYNC] ${allTasks.length} NEs para ${contracts.length} contratos.`);

    const queue: SyncTask[] = allTasks.map(t => ({ ne: t.ne, ug: t.ug, ano: t.ano, status: 'pending' }));
    this._syncQueue.set(queue);
    this._currentIdx.set(0);
    this._isLocked.set(lockUI);

    try {
      for (let i = 0; i < queue.length; i++) {
        this._currentIdx.set(i);
        const task = queue[i];
        this._updateTaskStatus(i, 'processing');

        try {
          // Sincronização incremental: forceSync = false (usa espelho se já existir)
          await this.getNotaEmpenhoWithCache(task.ano, task.ne, task.ug, false);
          this._updateTaskStatus(i, 'completed');
        } catch (err: any) {
          this._updateTaskStatus(i, 'error', err.message || 'Falha na comunicação');
        }

        if (i < queue.length - 1) {
          await this._delay(500);
        }
      }

      // Persistir tabelas financeiras em lote
      const affectedContractIds = [...new Set(allTasks.map(t => t.contractId))];
      for (const contractId of affectedContractIds) {
        await this.financialService.syncSigefTransactions(contractId).catch(err =>
          console.error(`[SIGEF SYNC] Erro ao persistir contrato ${contractId}:`, err)
        );
      }

      // Recarregar os caches locais para que as Dashboards sejam atualizadas instantaneamente
      await Promise.all([
        this.contractService.loadContracts(),
        this.financialService.loadAllTransactions(),
        this.budgetService.loadDotacoes()
      ]);

      console.log('[SIGEF SYNC] Sincronização global concluída e interface atualizada.');
    } finally {
      this._isLocked.set(false);
      setTimeout(() => { this._currentIdx.set(-1); }, 5000);
    }
  }

  // ─── Métodos privados ─────────────────────────────────────────

  /**
   * Baixa NE + seus movimentos + OBs da API e grava no espelho.
   * Sincronização INCREMENTAL: para OBs, só baixa as que ainda não existem no espelho.
   */
  private async _syncNeFromApi(ano: string, neNumber: string, ugStr: string, forceSync: boolean): Promise<void> {
    const ugNum = parseInt(ugStr, 10);

    try {
      // 1. Baixar a NE original
      const ne = await this._withRetry(() =>
        this.sigefService.getNotaEmpenhoByNumber(ano, neNumber, ugStr, forceSync)
      );

      if (ne) {
        // Salva no espelho bruto (import_sigef_ne)
        await this.mirrorService.saveNesBulk([ne as Record<string, any>], ugStr);
        // Salva também no cache estruturado legado
        await this.cacheService.saveNotaEmpenho(this._mapApiNeToCache(ne, ugNum));
      }

      // 2. Baixar todos os movimentos (reforços/anulações)
      const movements = await this._withRetry(() =>
        this.sigefService.getNotaEmpenhoMovements(ano, neNumber, ugStr, forceSync)
      );

      if (movements.length > 0) {
        await this.mirrorService.saveNesBulk(movements as Record<string, any>[], ugStr);
        await this.cacheService.saveNeMovimentos(
          movements.map(m => this._mapApiMovementToCache(m as any, ugNum))
        );
      }

      // 3. Baixar OBs (incremental: só as novas)
      const nesVinculadas = [...new Set([
        neNumber,
        ...movements.map(m => m.nunotaempenho).filter(Boolean)
      ])] as string[];

      for (const targetNE of nesVinculadas) {
        await this._syncObsForNe(ano, targetNE, ugStr, ugNum, forceSync);
      }
    } catch (err) {
      console.error(`[SIGEF SYNC] Erro ao sincronizar NE ${neNumber} via API:`, err);
    }
  }

  /**
   * Baixa OBs para uma NE específica de forma incremental.
   * Se forceSync = false, pula OBs que já existem no espelho.
   */
  private async _syncObsForNe(
    ano: string,
    nunotaempenho: string,
    ugStr: string,
    ugNum: number,
    forceSync: boolean
  ): Promise<void> {
    const targetNE = nunotaempenho.trim().toUpperCase();

    // Verificar OBs já existentes no espelho (para sincronização incremental)
    const existingObs = forceSync
      ? new Set<string>()
      : await this.mirrorService.getExistingObNumbers(targetNE, ugStr);

    const anoNE = parseInt(ano, 10);
    const anoAtual = new Date().getFullYear();

    for (let a = anoNE; a <= anoAtual; a++) {
      const datainicio = `${a}-01-01`;
      const datafim    = `${a}-12-31`;

      try {
        let page = 1;
        let hasNext = true;

        while (hasNext && page <= 10) {
          const result = await this.sigefService.getOrdemBancaria(
            datainicio, datafim, page, undefined, targetNE, ugStr, forceSync
          );

          const filtered = result.data.filter(ob => {
            const isTargetNe = (ob.nunotaempenho || '').trim().toUpperCase() === targetNE;
            const isMesUm = (ob.dtlancamento && ob.dtlancamento.split('-')[1] === '01') || 
                            (ob.dtpagamento && ob.dtpagamento.split('-')[1] === '01');
            return isTargetNe && !isMesUm;
          });

          // Incrementalmente: só salva as que ainda não existem
          const newObs = forceSync
            ? filtered
            : filtered.filter(ob => !existingObs.has((ob.nuordembancaria || '').trim().toUpperCase()));

          if (newObs.length > 0) {
            // Salvar no espelho bruto
            await this.mirrorService.saveObsBulk(newObs as Record<string, any>[], ugStr);
            // Salvar no cache estruturado legado
            await this.cacheService.saveOrdensBancarias(
              newObs.map(ob => this._mapApiObToCache(ob, ugNum))
            );
            // Atualizar o set de existentes
            newObs.forEach(ob => existingObs.add((ob.nuordembancaria || '').trim().toUpperCase()));
          }

          hasNext = !!result.next;
          page++;

          if (hasNext) await this._delay(500);
        }
      } catch (err) {
        console.warn(`[SIGEF SYNC] Erro ao baixar OBs do ano ${a} para NE ${targetNE}:`, err);
      }
    }
  }

  /**
   * Garante que as tabelas de cache estruturado (legado) estão populadas
   * a partir do espelho bruto. Isso mantém compatibilidade com o restante do sistema.
   */
  private async _persistFromMirrorToCache(neNumber: string, ugStr: string): Promise<void> {
    const ugNum = parseInt(ugStr, 10);

    // NEs
    const neRaws = await this.mirrorService.getNeMovementsRaw(neNumber, ugStr);
    for (const raw of neRaws) {
      if (raw.nunotaempenho === neNumber || !raw.nuneoriginal) {
        await this.cacheService.saveNotaEmpenho(this._mapRawNeToCache(raw, ugNum));
      } else {
        await this.cacheService.saveNeMovimentos([this._mapRawMovementToCache(raw, ugNum)]);
      }
    }

    // OBs
    const obRaws = await this.mirrorService.getObsRawByNe(neNumber, ugStr);
    if (obRaws.length > 0) {
      await this.cacheService.saveOrdensBancarias(
        obRaws.map(raw => this._mapRawObToCache(raw, ugNum))
      );
    }
  }

  // ─── Utilitários ─────────────────────────────────────────────

  private async _withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 2000): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isNet = /Failed to fetch|NetworkError|TLS|disconnected/i.test(err?.message || '');
        if (isNet && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`[SIGEF SYNC] Retry ${attempt}/${maxRetries} em ${delay}ms...`);
          await this._delay(delay);
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  }

  private _delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private _updateTaskStatus(index: number, status: SyncTask['status'], message?: string) {
    this._syncQueue.update(q => {
      const newQueue = [...q];
      if (newQueue[index]) {
        newQueue[index] = { ...newQueue[index], status, message, timestamp: Date.now() };
      }
      return newQueue;
    });
  }

  // ─── Mappers: API → CacheService (legado) ────────────────────

  private _mapApiNeToCache(ne: NotaEmpenho, ug: number) {
    return {
      cdunidadegestora: ug,
      nunotaempenho: ne.nunotaempenho || '',
      cdgestao: ne.cdgestao ? parseInt(ne.cdgestao, 10) : undefined,
      cdcredor: ne.cdcredor || undefined,
      cdsubacao: ne.cdsubacao ? parseInt(ne.cdsubacao, 10) : undefined,
      cdfuncao: ne.cdfuncao ? parseInt(ne.cdfuncao, 10) : undefined,
      cdsubfuncao: ne.cdsubfuncao ? parseInt(ne.cdsubfuncao, 10) : undefined,
      cdprograma: ne.cdprograma || undefined,
      cdacao: ne.cdacao ? parseInt(ne.cdacao, 10) : undefined,
      cdnaturezadespesa: ne.cdnaturezadespesa || undefined,
      cdfonte: ne.cdfonte || undefined,
      cdmodalidade: ne.cdmodalidadeempenho ? parseInt(ne.cdmodalidadeempenho, 10) : undefined,
      vlnotaempenho: ne.vlnotaempenho || 0,
      nuquantidade: ne.nuquantidade || undefined,
      dtlancamento: ne.dtlancamento || undefined,
      tipo: ne.tipo || undefined,
      nuprocesso: ne.nuprocesso || undefined,
      nuneoriginal: ne.nuneoriginal || undefined,
      dehistorico: ne.dehistorico || undefined
    };
  }

  private _mapApiMovementToCache(m: any, ug: number) {
    return {
      cdunidadegestora: ug,
      nunotaempenho: m.nunotaempenho || '',
      cdevento: m.cdevento || 0,
      nudocumento: m.nudocumento || undefined,
      cdcredor: m.cdcredor || undefined,
      cdorgao: m.cdorgao || undefined,
      cdsubacao: m.cdsubacao || undefined,
      cdfuncao: m.cdfuncao || undefined,
      cdsubfuncao: m.cdsubfuncao || undefined,
      cdprograma: m.cdprograma || undefined,
      cdacao: m.cdacao || undefined,
      cdnaturezadespesa: m.cdnaturezadespesa || undefined,
      cdfonte: m.cdfonte || undefined,
      cdmodalidade: m.cdmodalidade || undefined,
      vlnotaempenho: m.vlnotaempenho || 0,
      dtlancamento: m.dtlancamento || undefined,
      dehistorico: m.dehistorico || undefined,
      nuneoriginal: m.nuneoriginal || undefined
    };
  }

  private _mapApiObToCache(ob: OrdemBancaria, ug: number): SigefOrdemBancaria {
    return {
      nuordembancaria: ob.nuordembancaria || '',
      cdunidadegestora: ug,
      nunotaempenho: ob.nunotaempenho || undefined,
      cdgestao: ob.cdgestao || undefined,
      cdevento: ob.cdevento || undefined,
      nudocumento: ob.nudocumento || undefined,
      cdcredor: ob.cdcredor || undefined,
      cdtipocredor: ob.cdtipocredor || undefined,
      cdugfavorecida: ob.cdugfavorecida || undefined,
      cdorgao: ob.cdorgao || undefined,
      cdsubacao: ob.cdsubacao || undefined,
      cdfuncao: ob.cdfuncao || undefined,
      cdsubfuncao: ob.cdsubfuncao || undefined,
      cdprograma: ob.cdprograma || undefined,
      cdacao: ob.cdacao || undefined,
      localizagasto: ob.localizagasto || undefined,
      cdnaturezadespesa: ob.cdnaturezadespesa || undefined,
      cdfonte: ob.cdfonte || undefined,
      cdmodalidade: ob.cdmodalidade || undefined,
      vltotal: ob.vltotal || 0,
      dtlancamento: ob.dtlancamento || undefined,
      dtpagamento: ob.dtpagamento || undefined,
      cdsituacaoordembancaria: ob.cdsituacaoordembancaria || undefined,
      situacaopreparacaopagamento: ob.situacaopreparacaopagamento || undefined,
      tipoordembancaria: ob.tipoordembancaria || undefined,
      tipopreparacaopagamento: ob.tipopreparacaopagamento || undefined,
      deobservacao: ob.deobservacao || undefined,
      definalidade: ob.definalidade || undefined,
      usuario_responsavel: ob.usuario_responsavel || undefined
    };
  }

  // ─── Mappers: raw_data (espelho) → CacheService (legado) ─────

  private _mapRawNeToCache(raw: Record<string, any>, ug: number) {
    return {
      cdunidadegestora: ug,
      nunotaempenho: raw['nunotaempenho'] || '',
      cdgestao: raw['cdgestao'] ? parseInt(raw['cdgestao'], 10) : undefined,
      cdcredor: raw['cdcredor'] || undefined,
      cdsubacao: raw['cdsubacao'] ? parseInt(raw['cdsubacao'], 10) : undefined,
      cdfuncao: raw['cdfuncao'] ? parseInt(raw['cdfuncao'], 10) : undefined,
      cdsubfuncao: raw['cdsubfuncao'] ? parseInt(raw['cdsubfuncao'], 10) : undefined,
      cdprograma: raw['cdprograma'] || undefined,
      cdacao: raw['cdacao'] ? parseInt(raw['cdacao'], 10) : undefined,
      cdnaturezadespesa: raw['cdnaturezadespesa'] || undefined,
      cdfonte: raw['cdfonte'] || undefined,
      cdmodalidade: raw['cdmodalidadeempenho']
        ? parseInt(raw['cdmodalidadeempenho'], 10)
        : raw['cdmodalidade'] ? parseInt(raw['cdmodalidade'], 10) : undefined,
      vlnotaempenho: raw['vlnotaempenho'] || 0,
      nuquantidade: raw['nuquantidade'] || undefined,
      dtlancamento: raw['dtlancamento'] || undefined,
      tipo: raw['tipo'] || undefined,
      nuprocesso: raw['nuprocesso'] || undefined,
      nuneoriginal: raw['nuneoriginal'] || undefined,
      dehistorico: raw['dehistorico'] || undefined
    };
  }

  private _mapRawMovementToCache(raw: Record<string, any>, ug: number) {
    return {
      cdunidadegestora: ug,
      nunotaempenho: raw['nunotaempenho'] || '',
      cdevento: raw['cdevento'] || 0,
      nudocumento: raw['nudocumento'] || undefined,
      cdcredor: raw['cdcredor'] || undefined,
      cdorgao: raw['cdorgao'] || undefined,
      cdsubacao: raw['cdsubacao'] || undefined,
      cdfuncao: raw['cdfuncao'] || undefined,
      cdsubfuncao: raw['cdsubfuncao'] || undefined,
      cdprograma: raw['cdprograma'] || undefined,
      cdacao: raw['cdacao'] || undefined,
      cdnaturezadespesa: raw['cdnaturezadespesa'] || undefined,
      cdfonte: raw['cdfonte'] || undefined,
      cdmodalidade: raw['cdmodalidade'] || undefined,
      vlnotaempenho: raw['vlnotaempenho'] || 0,
      dtlancamento: raw['dtlancamento'] || undefined,
      dehistorico: raw['dehistorico'] || undefined,
      nuneoriginal: raw['nuneoriginal'] || undefined
    };
  }

  private _mapRawObToCache(raw: Record<string, any>, ug: number): SigefOrdemBancaria {
    return {
      nuordembancaria: raw['nuordembancaria'] || '',
      cdunidadegestora: ug,
      nunotaempenho: raw['nunotaempenho'] || undefined,
      cdgestao: raw['cdgestao'] || undefined,
      cdevento: raw['cdevento'] || undefined,
      nudocumento: raw['nudocumento'] || undefined,
      cdcredor: raw['cdcredor'] || undefined,
      cdtipocredor: raw['cdtipocredor'] || undefined,
      cdugfavorecida: raw['cdugfavorecida'] || undefined,
      cdorgao: raw['cdorgao'] || undefined,
      cdsubacao: raw['cdsubacao'] || undefined,
      cdfuncao: raw['cdfuncao'] || undefined,
      cdsubfuncao: raw['cdsubfuncao'] || undefined,
      cdprograma: raw['cdprograma'] || undefined,
      cdacao: raw['cdacao'] || undefined,
      localizagasto: raw['localizagasto'] || undefined,
      cdnaturezadespesa: raw['cdnaturezadespesa'] || undefined,
      cdfonte: raw['cdfonte'] || undefined,
      cdmodalidade: raw['cdmodalidade'] || undefined,
      vltotal: raw['vltotal'] || 0,
      dtlancamento: raw['dtlancamento'] || undefined,
      dtpagamento: raw['dtpagamento'] || undefined,
      cdsituacaoordembancaria: raw['cdsituacaoordembancaria'] || undefined,
      situacaopreparacaopagamento: raw['situacaopreparacaopagamento'] || undefined,
      tipoordembancaria: raw['tipoordembancaria'] || undefined,
      tipopreparacaopagamento: raw['tipopreparacaopagamento'] || undefined,
      deobservacao: raw['deobservacao'] || undefined,
      definalidade: raw['definalidade'] || undefined,
      usuario_responsavel: raw['usuario_responsavel'] || undefined,
      nuguiarecebimento: raw['nuguiarecebimento'] || undefined,
      vlguiarecebimento: raw['vlguiarecebimento'] ? Number(raw['vlguiarecebimento']) : undefined,
      nunotalancamento: raw['nunotalancamento'] || undefined,
      numns: raw['numns'] || undefined,
      domicilio_origem: raw['domicilio_origem'] || undefined,
      domicilio_destino: raw['domicilio_destino'] || undefined
    };
  }
}