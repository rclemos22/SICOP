import { Injectable, inject, signal, computed } from '@angular/core';
import { SigefService, NotaEmpenho, OrdemBancaria } from './sigef.service';
import { SigefMirrorService } from './sigef-mirror.service';
import { SigefCacheService, SigefOrdemBancaria, NeResumo } from './sigef-cache.service';
import { FinancialService } from '../../features/financial/services/financial.service';
import { ContractService } from '../../features/contracts/services/contract.service';
import { BudgetService } from '../../features/budget/services/budget.service';
import { AppContextService } from './app-context.service';
import { SupabaseService } from './supabase.service';
import { DebugService } from './debug.service';

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
 * ARQUITETURA "ESPELHO PRIMEIRO" (refatorado):
 *
 *  - O espelho (import_sigef_ne / import_sigef_ob) é a ÚNICA fonte de dados.
 *  - O download bulk (por período) é feito EXCLUSIVAMENTE pelo SigefBulkSyncService.
 *  - Este serviço apenas:
 *      1. Lê do espelho para popular os caches estruturados (legado).
 *      2. Gerencia a fila de tarefas e o estado de progresso da UI.
 *      3. Chama a API individual somente quando uma NE não existe no espelho
 *         (fallback pontual para casos que escaparam do bulk).
 *  - Implementa fila de consultas para evitar concorrência na navegação.
 */
@Injectable({
  providedIn: 'root'
})
export class SigefSyncService {
  private sigefService     = inject(SigefService);
  private mirrorService    = inject(SigefMirrorService);
  private cacheService     = inject(SigefCacheService);
  private financialService = inject(FinancialService);
  private contractService  = inject(ContractService);
  private budgetService    = inject(BudgetService);
  private appContext       = inject(AppContextService);
  private supabase         = inject(SupabaseService);
  private debug            = inject(DebugService);

  /** Armazena o queryId atual para permitir cancelamento */
  private currentQueryId: string | null = null;

  /**
   * Flag: true quando o download bulk inicial já tem ao menos UM período concluído.
   * Enquanto false, NENHUMA chamada à API individual é feita — evita ETIMEDOUT
   * em massa enquanto o espelho ainda está sendo populado.
   */
  private _bulkReady = false;

  // ─── Estado da fila ──────────────────────────────────────────
  private _syncQueue  = signal<SyncTask[]>([]);
  private _currentIdx = signal<number>(-1);
  private _isLocked   = signal<boolean>(false);

  readonly syncQueue       = this._syncQueue.asReadonly();
  readonly currentIdx      = this._currentIdx.asReadonly();
  readonly isLocked        = this._isLocked.asReadonly();
  setLocked(locked: boolean) { this._isLocked.set(locked); }
  readonly isSyncing       = computed(() => this._currentIdx() >= 0 && this._currentIdx() < this._syncQueue().length);
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
    // Verifica o estado do bulk e agenda o ciclo automático apenas se pronto.
    // O ciclo só começa 5 minutos após o boot, dando tempo ao download inicial.
    setTimeout(() => { this._initAutoSync(); }, 5 * 60_000);
  }

  /**
   * Verifica se o download bulk inicial já tem algum período concluído.
   * Enquanto false, chamadas individuais à API ficam bloqueadas.
   */
  private async _checkBulkReady(): Promise<boolean> {
    if (this._bulkReady) return true;
    const { count } = await this.supabase.client
      .from('sigef_sync_periods')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed');
    this._bulkReady = (count ?? 0) > 0;
    return this._bulkReady;
  }

  private async _initAutoSync() {
    const ready = await this._checkBulkReady();
    if (!ready) {
      console.log('[SIGEF SYNC] Espelho não está pronto. Ciclo automático adiado 10 min.');
      this.autoSyncTimer = setTimeout(() => { this._initAutoSync(); }, 10 * 60_000);
      return;
    }
    this.runAutomaticSyncCycle();
  }

  private async runAutomaticSyncCycle() {
    try {
      if (!this.isSyncing()) {
        const ready = await this._checkBulkReady();
        if (!ready) {
          console.log('[SIGEF SYNC] Espelho ainda vazio. Pulando ciclo automático.');
          return;
        }
        const selectedYear = this.appContext.anoExercicio();
        console.log(`[SIGEF SYNC] Ciclo automático: exercício ${selectedYear}`);
        await this.syncAllContractsFinance(false, selectedYear);
      }
    } catch (err) {
      console.error('[SIGEF SYNC] Erro no ciclo automático:', err);
    } finally {
      if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = setTimeout(() => { this.runAutomaticSyncCycle(); }, 10 * 60_000);
    }
  }

  startAutomaticSync() {
    if (!this.autoSyncTimer) {
      this.autoSyncTimer = setTimeout(() => { this.runAutomaticSyncCycle(); }, 10 * 60_000);
    }
  }

  // ─── API pública principal ───────────────────────────────────

  /**
   * Obtém o resumo de uma NE.
   * 1ª tentativa: espelho (import_sigef_ne / import_sigef_ob)
   * 2ª tentativa (apenas se forceSync=true ou espelho vazio): API individual
   * Suporta cancelamento via currentQueryId.
   */
  async getNotaEmpenhoWithCache(
    ano: string,
    neNumber: string,
    ug: string,
    forceSync: boolean = false,
    contractId?: string,
    recentOnly: boolean = true
  ): Promise<NeResumo | null> {
    const ugStr = ug.toString();

    // ── Fase 1: Espelho Primeiro ──────────────────────────────
    const movements = await this.mirrorService.getNeMovementsRaw(neNumber, ugStr);
    if (movements.length > 0) {
      console.log(`[SIGEF SYNC] Espelho: NE ${neNumber} — ${movements.length} registro(s).`);
      await this._persistFromMirrorToCache(neNumber, ugStr);

      // Se for ação manual (forceSync), busca OBs da API para a NE principal
      // E também para todas as NEs vinculadas (reforços), já que cada NE
      // vinculada pode ter suas próprias OBs.
      if (forceSync) {
        const ugNum = parseInt(ugStr, 10);
        const obRaws = await this.mirrorService.getObsRawByNe(neNumber, ugStr);
        this.debug.sync(`NE ${neNumber}: ${obRaws.length} OB(s) no espelho. Buscando novas da API (recentOnly=${recentOnly})...`);

        // NEs vinculadas: a NE original + todas as NEs dos movimentos (reforços)
        const allNes = [...new Set([
          neNumber,
          ...movements.map((m: any) => m.nunotaempenho).filter(Boolean)
        ])] as string[];

        for (const targetNe of allNes) {
          if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) break;
          await this._syncObsForNe(ano, targetNe, ugStr, ugNum, forceSync, recentOnly, this.currentQueryId || undefined);
        }

        if (contractId) {
          await this.financialService.syncSigefTransactions(contractId).catch(err =>
            console.error('[SIGEF SYNC] Erro ao persistir transações:', err)
          );
        }
      }

      return this.cacheService.getNeResumo(parseInt(ugStr, 10), neNumber);
    }

    // ── Fase 2: Fallback à API ou Saída Graciosa ──────────────────────────
    
    // Se NÃO é um sincronismo forçado (clique manual), NUNCA vamos à API.
    // Isso garante que a navegação entre contratos seja 100% offline/espelho.
    if (!forceSync) {
      console.log(`[SIGEF SYNC] NE ${neNumber} ausente do espelho. Modo offline (navegação/auto): ignorando API.`);
      return this.cacheService.getNeResumo(parseInt(ugStr, 10), neNumber);
    }

    // Verifica se foi cancelado antes de prosseguir
    if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
      console.log(`[SIGEF SYNC] Consulta cancelada para NE ${neNumber} antes da API.`);
      return this.cacheService.getNeResumo(parseInt(ugStr, 10), neNumber);
    }

    // Daqui para baixo, apenas se forceSync === true (Ação Manual)
    
    const bulkReady = await this._checkBulkReady();
    if (!bulkReady) {
      console.warn(`[SIGEF SYNC] Sync forçado solicitado para NE ${neNumber}, mas o download inicial ainda está em curso.`);
    }

    // ── Fase 3: Fallback pontual à API (Apenas Ação Manual) ────
    console.log(`[SIGEF SYNC] NE ${neNumber} não encontrada no espelho. Executando busca manual via API (recentOnly=${recentOnly})...`);
    await this._syncNeFromApi(ano, neNumber, ugStr, forceSync, recentOnly);
    await this._persistFromMirrorToCache(neNumber, ugStr);

    if (contractId) {
      await this.financialService.syncSigefTransactions(contractId).catch(err =>
        console.error('[SIGEF SYNC] Erro ao persistir transações:', err)
      );
    }

    return this.cacheService.getNeResumo(parseInt(ugStr, 10), neNumber);
  }

  /**
   * Sincroniza um lote de NEs (chamado pelo botão "Sincronizar SIGEF" no contrato).
   * Agora usa EXCLUSIVAMENTE o espelho — só chama API se a NE não existe localmente.
   * Suporta cancelamento via currentQueryId.
   */
  async syncBatch(
    tasks: { ne: string; ug: string; ano: string }[],
    contractId?: string,
    lockUI: boolean = false,
    recentOnly: boolean = true
  ): Promise<void> {
    if (this.isSyncing()) {
      console.warn('[SIGEF SYNC] Sincronização já em andamento.');
      return;
    }

    // Verifica se foi cancelado antes de começar
    if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
      console.log('[SIGEF SYNC] syncBatch cancelado antes de iniciar.');
      return;
    }

    const queue: SyncTask[] = tasks.map(t => ({ ...t, status: 'pending' }));
    this._syncQueue.set(queue);
    this._currentIdx.set(0);
    this._isLocked.set(lockUI);
    this.debug.sync(`Iniciando syncBatch: ${queue.length} NE(s)`);

    try {
      for (let i = 0; i < queue.length; i++) {
        if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
          this.debug.warn(`syncBatch cancelado na NE ${queue[i].ne}`);
          break;
        }

        this._currentIdx.set(i);
        const task = queue[i];
        this._updateTaskStatus(i, 'processing');
        this.debug.sync(`[${i + 1}/${queue.length}] NE: ${task.ne} (UG:${task.ug})`);

        try {
          await this.getNotaEmpenhoWithCache(task.ano, task.ne, task.ug, true, contractId, recentOnly);
          this._updateTaskStatus(i, 'completed');
        } catch (err: any) {
          if (err.message === 'Query cancelled') {
            console.log(`[SIGEF SYNC] syncBatch cancelado na NE ${task.ne}.`);
            break;
          }
          console.error(`[SIGEF SYNC] Erro na NE ${task.ne}:`, err);
          this._updateTaskStatus(i, 'error', err.message || 'Falha na comunicação');
        }

        if (i < queue.length - 1) {
          // Verifica se foi cancelado antes do delay
          if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
            console.log(`[SIGEF SYNC] syncBatch cancelado após NE ${task.ne}.`);
            break;
          }
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
   * Carrega dados financeiros de todos os contratos a partir do espelho.
   * NÃO faz download — apenas lê do espelho e popula os caches.
   */
  async syncAllContractsFinance(lockUI: boolean = false, year?: number): Promise<void> {
    if (this.isSyncing()) return;

    // Se o espelho não tem dados, não há o que carregar — apenas atualiza a UI local.
    const ready = await this._checkBulkReady();
    if (!ready) {
      console.log('[SIGEF SYNC] Espelho vazio (bulk pendente). Recarregando apenas dados locais.');
      await Promise.all([
        this.contractService.loadContracts(),
        this.financialService.loadAllTransactions(),
      ]).catch(err => console.error('[SIGEF SYNC] Erro ao recarregar dados locais:', err));
      return;
    }

    console.log('[SIGEF SYNC] Carregando dados do espelho para contratos...');

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
      console.warn('[SIGEF SYNC] Nenhuma NE encontrada nos contratos.');
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
          // Mirror-first: forceSync=false usa espelho se disponível
          await this.getNotaEmpenhoWithCache(task.ano, task.ne, task.ug, false);
          this._updateTaskStatus(i, 'completed');
        } catch (err: any) {
          this._updateTaskStatus(i, 'error', err.message || 'Falha');
        }

        if (i < queue.length - 1) await this._delay(300);
      }

      // Persistir tabelas financeiras
      const affectedContractIds = [...new Set(allTasks.map(t => t.contractId))];
      for (const contractId of affectedContractIds) {
        await this.financialService.syncSigefTransactions(contractId).catch(err =>
          console.error(`[SIGEF SYNC] Erro contrato ${contractId}:`, err)
        );
      }

      await Promise.all([
        this.contractService.loadContracts(),
        this.financialService.loadAllTransactions(),
        this.budgetService.loadDotacoes()
      ]);

      console.log('[SIGEF SYNC] Carregamento concluído e interface atualizada.');
    } finally {
      this._isLocked.set(false);
      setTimeout(() => { this._currentIdx.set(-1); }, 5000);
    }
  }

  // ─── Sincronização pontual via API (fallback) ─────────────────

  private async _syncNeFromApi(
    ano: string, 
    neNumber: string, 
    ugStr: string, 
    forceSync: boolean,
    recentOnly: boolean = true
  ): Promise<void> {
    // Guard: em modo automático (navegação/auto), nunca chama API se o bulk
    // ainda não foi concluído (evita ETIMEDOUT em cascata).
    // Em modo forçado (botão manual), ignora o guard — o usuário explicitamente
    // pediu para buscar, independente do estado do bulk.
    if (!forceSync) {
      const ready = await this._checkBulkReady();
      if (!ready) {
        this.debug.warn(`_syncNeFromApi bloqueado para NE ${neNumber} — bulk pendente`);
        return;
      }
    }

    // Verifica se foi cancelado
    if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
      console.log(`[SIGEF SYNC] _syncNeFromApi cancelado para NE ${neNumber}.`);
      return;
    }

    const ugNum = parseInt(ugStr, 10);

    try {
      const ne = await this._withRetry(() =>
        this.sigefService.getNotaEmpenhoByNumber(ano, neNumber, ugStr, forceSync, this.currentQueryId)
      );

      // Verifica se foi cancelado após a chamada
      if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
        console.log(`[SIGEF SYNC] _syncNeFromApi cancelado após busca da NE ${neNumber}.`);
        return;
      }

      if (ne) {
        await this.mirrorService.saveNesBulk([ne as Record<string, any>], ugStr);
        await this.cacheService.saveNotaEmpenho(this._mapApiNeToCache(ne, ugNum));
      }

      const movements = await this._withRetry(() =>
        this.sigefService.getNotaEmpenhoMovements(ano, neNumber, ugStr, forceSync, this.currentQueryId)
      );

      // Verifica se foi cancelado após busca de movimentos
      if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
        console.log(`[SIGEF SYNC] _syncNeFromApi cancelado após movimentos da NE ${neNumber}.`);
        return;
      }

      if (movements.length > 0) {
        await this.mirrorService.saveNesBulk(movements as Record<string, any>[], ugStr);
        await this.cacheService.saveNeMovimentos(
          movements.map(m => this._mapApiMovementToCache(m as any, ugNum))
        );
      }

      // IMPORTANTE: Só buscamos OBs individuais via API se for um SYNC FORÇADO (botão manual).
      // Caso contrário, esperamos o Bulk Sync (Espelho) baixar as OBs em massa.
      // Isso evita o erro de rede (ETIMEDOUT) nas paginações longas de OBs.
      if (forceSync) {
        const nesVinculadas = [...new Set([
          neNumber,
          ...movements.map(m => m.nunotaempenho).filter(Boolean)
        ])] as string[];

        for (const targetNE of nesVinculadas) {
          // Verifica se foi cancelado antes de cada NE vinculada
          if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
            console.log(`[SIGEF SYNC] _syncNeFromApi cancelado antes de OBs da NE ${targetNE}.`);
            return;
          }
          await this._syncObsForNe(ano, targetNE, ugStr, ugNum, forceSync, recentOnly);
        }
      } else {
        console.log(`[SIGEF SYNC] NE ${neNumber}: Pulando busca reativa de OBs (Modo Espelho Ativo).`);
      }
    } catch (err: any) {
      if (err.message === 'Query cancelled') {
        console.log(`[SIGEF SYNC] _syncNeFromApi cancelado para NE ${neNumber}.`);
        return;
      }
      console.error(`[SIGEF SYNC] Erro ao sincronizar NE ${neNumber} via API:`, err);
    }
  }

  private async _syncObsForNe(
    ano: string,
    nunotaempenho: string,
    ugStr: string,
    ugNum: number,
    forceSync: boolean,
    recentOnly: boolean = true,
    queryId?: string
  ): Promise<void> {
    // Guard: em modo automático, não busca OBs se o bulk não concluiu.
    // Em modo forçado (botão manual), ignora o guard.
    if (!forceSync) {
      const ready = await this._checkBulkReady();
      if (!ready) {
        this.debug.warn(`_syncObsForNe bloqueado — NE ${nunotaempenho}, bulk pendente`);
        return;
      }
    }

    // Verifica se foi cancelado
    if (queryId && !this.sigefService.hasPendingQuery(queryId)) {
      console.log(`[SIGEF SYNC] _syncObsForNe cancelado para NE ${nunotaempenho}.`);
      return;
    }

    const targetNE = nunotaempenho.trim().toUpperCase();

    const existingObs = forceSync
      ? new Set<string>()
      : await this.mirrorService.getExistingObNumbers(targetNE, ugStr);

    if (recentOnly) {
      const today = new Date();
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(today.getDate() - 60);
      const di = sixtyDaysAgo.toISOString().split('T')[0];
      const df = today.toISOString().split('T')[0];
      this.debug.sync(`OBs: busca rápida (${di} a ${df}) NE ${targetNE}`);
      await this._fetchObsForPeriod(di, df, targetNE, ugStr, ugNum, forceSync, existingObs, queryId);
    } else {
      const anoNE = parseInt(ano, 10);
      const anoAtual = new Date().getFullYear();
      for (let a = anoNE; a <= anoAtual; a++) {
        if (queryId && !this.sigefService.hasPendingQuery(queryId)) {
          this.debug.warn(`OBs cancelado NE ${targetNE} ano ${a}`);
          return;
        }
        this.debug.sync(`OBs: varredura ano ${a} NE ${targetNE}`);
        await this._fetchObsForPeriod(`${a}-01-01`, `${a}-12-31`, targetNE, ugStr, ugNum, forceSync, existingObs, queryId);
      }
    }
  }

  /**
   * Helper para buscar OBs paginadas em um período específico
   */
  private async _fetchObsForPeriod(
    datainicio: string,
    datafim: string,
    targetNE: string,
    ugStr: string,
    ugNum: number,
    forceSync: boolean,
    existingObs: Set<string>,
    queryId?: string
  ): Promise<void> {
    const MAX_PAGE_RETRIES = 3;
    let page = 1;
    let hasNext = true;

    while (hasNext && page <= 10) {
      if (queryId && !this.sigefService.hasPendingQuery(queryId)) {
        this.debug.warn(`fetchObs cancelado NE ${targetNE} pág ${page}`);
        return;
      }

      let pageRetries = 0;
      let success = false;

      while (!success && pageRetries <= MAX_PAGE_RETRIES) {
        try {
          const result = await this.sigefService.getOrdemBancaria(
            datainicio, datafim, page, undefined, targetNE, ugStr, forceSync, queryId
          );

          const filtered = result.data.filter(ob => {
            const isTargetNe = (ob.nunotaempenho || '').trim().toUpperCase() === targetNE;
            const isTargetUg = !ugStr || (ob.cdunidadegestora?.toString() === ugStr);
            return isTargetNe && isTargetUg;
          });

          const newObs = forceSync
            ? filtered
            : filtered.filter(ob => !existingObs.has((ob.nuordembancaria || '').trim().toUpperCase()));

          if (newObs.length > 0) {
            this.debug.sync(`OBs: ${newObs.length} nova(s) NE ${targetNE} pág ${page}`);
            await this.mirrorService.saveObsBulk(newObs as Record<string, any>[], ugStr);
            await this.cacheService.saveOrdensBancarias(
              newObs.map(ob => this._mapApiObToCache(ob, ugNum))
            );
            newObs.forEach(ob => existingObs.add((ob.nuordembancaria || '').trim().toUpperCase()));
          }

          hasNext = !!result.next;
          success = true;
        } catch (err: any) {
          if (err.message === 'Query cancelled') {
            this.debug.warn(`fetchObs cancelado NE ${targetNE}`);
            return;
          }
          pageRetries++;
          if (pageRetries <= MAX_PAGE_RETRIES) {
            this.debug.warn(`OBs timeout pág ${page} NE ${targetNE} — retry ${pageRetries}/${MAX_PAGE_RETRIES}`);
            await this._delay(2000 * pageRetries);
          } else {
            this.debug.error(`OBs falhou pág ${page} NE ${targetNE} após ${MAX_PAGE_RETRIES} tentativas — pulando`);
            hasNext = false;
          }
        }
      }

      if (success) {
        page++;
        if (hasNext && queryId && !this.sigefService.hasPendingQuery(queryId)) {
          this.debug.warn(`fetchObs cancelado NE ${targetNE}`);
          return;
        }
        if (hasNext) await this._delay(500);
      }
    }
  }

  private async _persistFromMirrorToCache(neNumber: string, ugStr: string): Promise<void> {
    const ugNum = parseInt(ugStr, 10);

    const neRaws = await this.mirrorService.getNeMovementsRaw(neNumber, ugStr);
    for (const raw of neRaws) {
      if (raw.nunotaempenho === neNumber || !raw.nuneoriginal) {
        await this.cacheService.saveNotaEmpenho(this._mapRawNeToCache(raw, ugNum));
      } else {
        await this.cacheService.saveNeMovimentos([this._mapRawMovementToCache(raw, ugNum)]);
      }
    }

    const obRaws = await this.mirrorService.getObsRawByNe(neNumber, ugStr);
    if (obRaws.length > 0) {
      await this.cacheService.saveOrdensBancarias(
        obRaws.map(raw => this._mapRawObToCache(raw, ugNum))
      );
    }
  }

  // ─── Utilitários ─────────────────────────────────────────────

  private async _withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 3000): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        if (this._isNetworkError(err) && attempt < maxRetries) {
          const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000) * (0.85 + Math.random() * 0.3);
          console.warn(`[SIGEF SYNC] Retry ${attempt}/${maxRetries} em ${Math.round(delay)}ms... (${this._extractErrorMsg(err)})`);
          await this._delay(delay);
        } else {
          throw err;
        }
      }
    }
    throw lastError;
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

  private _extractErrorMsg(err: any): string {
    if (typeof err === 'string') return err;
    if (err instanceof AggregateError && err.errors?.length > 0) {
      return err.errors.map((e: any) => e?.message || String(e)).join('; ');
    }
    return err?.message || err?.cause?.message || String(err) || 'Erro desconhecido';
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