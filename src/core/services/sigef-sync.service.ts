import { Injectable, inject } from '@angular/core';
import { SigefService, NotaEmpenho, OrdemBancaria } from './sigef.service';
import { SigefCacheService, SigefNotaEmpenho, SigefNeMovimento, SigefOrdemBancaria, NeResumo } from './sigef-cache.service';
import { signal, computed, effect } from '@angular/core';
import { FinancialService } from '../../features/financial/services/financial.service';
import { ContractService } from '../../features/contracts/services/contract.service';
import { BudgetService } from '../../features/budget/services/budget.service';

export interface SyncTask {
  ne: string;
  ug: string;
  ano: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
  timestamp?: number;
}

@Injectable({
  providedIn: 'root'
})
export class SigefSyncService {
  private sigefService = inject(SigefService);
  private cacheService = inject(SigefCacheService);
  private financialService = inject(FinancialService);
  private contractService = inject(ContractService);
  private budgetService = inject(BudgetService);

  // Queue State
  private _syncQueue = signal<SyncTask[]>([]);
  private _currentIdx = signal<number>(-1);
  
  readonly syncQueue = this._syncQueue.asReadonly();
  readonly currentIdx = this._currentIdx.asReadonly();
  
  readonly isSyncing = computed(() => this._currentIdx() >= 0 && this._currentIdx() < this._syncQueue().length);
  private _isLocked = signal<boolean>(false);
  readonly isLocked = this._isLocked.asReadonly();
  readonly isGlobalSyncing = this._isLocked.asReadonly();
  
  readonly progress = computed(() => {
    const queue = this._syncQueue();
    if (queue.length === 0) return null;
    return {
      current: Math.max(0, this._currentIdx() + 1),
      total: queue.length,
      percentage: Math.round(((this._currentIdx()) / queue.length) * 100)
    };
  });

  /**
   * Sincroniza um lote de NEs criando uma fila controlada
   */
  async syncBatch(tasks: { ne: string, ug: string, ano: string }[], contractId?: string): Promise<void> {
    if (this.isSyncing()) {
      console.warn('[SIGEF SYNC] Já existe uma sincronização em andamento.');
      return;
    }

    const queue: SyncTask[] = tasks.map(t => ({
      ...t,
      status: 'pending'
    }));

    this._syncQueue.set(queue);
    this._currentIdx.set(0);
    this._isLocked.set(true); // Bloqueia a navegação/interface

    try {
      for (let i = 0; i < queue.length; i++) {
          this._currentIdx.set(i);
          const task = queue[i];
          
          this.updateTaskStatus(i, 'processing');
          
          try {
              console.log(`[SIGEF SYNC] Processando: ${i+1}/${queue.length} - NE: ${task.ne} (${task.ano})`);
              // Sincronização profunda forçada
              await this.getNotaEmpenhoWithCache(task.ano, task.ne, task.ug, true, contractId);
              this.updateTaskStatus(i, 'completed');
          } catch (err: any) {
              console.error(`[SIGEF SYNC] Erro na NE ${task.ne}:`, err);
              this.updateTaskStatus(i, 'error', err.message || 'Falha na comunicação');
          }

          // Delay de cortesia para a API (800ms entre requisições de NEs para agilizar sincronização global)
          if (i < queue.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 800));
          }
      }

      // NOVO: Após sincronizar as NEs no cache, garantir persistência no banco para o contrato
      if (contractId) {
        console.log('[SIGEF SYNC] Persistindo transações para o contrato:', contractId);
        await this.financialService.syncSigefTransactions(contractId);
      }
    } finally {
      this._isLocked.set(false);
    }

    // Resetar após conclusão
    setTimeout(() => {
        if (!this.isSyncing()) {
            this._currentIdx.set(-1);
        }
    }, 5000);
  }

  /**
   * Dispara a sincronização de toda a base de contratos e dotações
   */
  async syncAllContractsFinance(): Promise<void> {
    if (this.isSyncing()) return;

    console.log('[SIGEF SYNC] Iniciando varredura global de contratos...');
    
    // 1. Garantir que os contratos estão carregados
    if (this.contractService.contracts().length === 0) {
      await this.contractService.loadContracts();
    }

    const contracts = this.contractService.contracts();
    const allTasks: { ne: string, ug: string, ano: string, contractId: string }[] = [];

    // 2. Coletar todas as NEs de todos os contratos
    for (const contract of contracts) {
      const budgetResult = await this.budgetService.getBudgetsByContractId(contract.id);
      if (!budgetResult.error && budgetResult.data) {
        budgetResult.data.forEach(b => {
          if (b.nunotaempenho) {
            const budgetDate = new Date(b.data_disponibilidade);
            const ano = budgetDate.getFullYear().toString();
            allTasks.push({
              ne: b.nunotaempenho,
              ug: b.unid_gestora || '080901',
              ano: ano,
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

    console.log(`[SIGEF SYNC] Fila global gerada com ${allTasks.length} NEs de ${contracts.length} contratos.`);
    
    // 3. Executar o syncBatch para cada contrato sequencialmente para manter logs limpos
    // Mas agrupamos NEs do mesmo contrato para chamar o syncSigefTransactions apenas uma vez por contrato
    const grouped = new Map<string, typeof allTasks>();
    allTasks.forEach(t => {
      const list = grouped.get(t.contractId) || [];
      list.push(t);
      grouped.set(t.contractId, list);
    });

    for (const [contractId, tasks] of grouped.entries()) {
      console.log(`[SIGEF SYNC] Sincronizando contrato ${contractId} (${tasks.length} NEs)`);
      await this.syncBatch(tasks, contractId);
      // Pequeno respiro entre contratos
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('[SIGEF SYNC] Sincronização global concluída com sucesso.');
  }

  private updateTaskStatus(index: number, status: SyncTask['status'], message?: string) {
    this._syncQueue.update(q => {
        const newQueue = [...q];
        if (newQueue[index]) {
            newQueue[index] = { ...newQueue[index], status, message, timestamp: Date.now() };
        }
        return newQueue;
    });
  }

  /**
   * Obtém resumo de NE usando cache quando disponível, mas garantindo sincronização de movimentos e OBs
   */
  /**
   * Executa função com retry automático em caso de erro de rede
   */
  private async withRetry<T>(fn: () => Promise<T>, maxRetries: number = 3, baseDelay: number = 2000): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isNetworkError = err?.message?.includes('Failed to fetch') || 
                            err?.message?.includes('NetworkError') ||
                            err?.message?.includes('TLS') ||
                            err?.message?.includes('disconnected');
        
        if (isNetworkError && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1); // Backoff exponencial
          console.log(`[SIGEF SYNC] Erro de rede. Tentativa ${attempt}/${maxRetries}. Retry em ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  }

  async getNotaEmpenhoWithCache(ano: string, neNumber: string, ug: string, forceSync: boolean = false, contractId?: string): Promise<NeResumo | null> {
    const ugNum = parseInt(ug, 10);
    
    // 1. Tentar obter os dados básicos da NE do cache local
    let neCached = await this.cacheService.getNotaEmpenho(ugNum, neNumber);
    
    // 2. Só consome a API se forceSync for explicitamente true (clique no botão)
    if (forceSync) {
      console.log('[SIGEF SYNC] Sincronização FORÇADA iniciada para NE:', neNumber);
      try {
        // Buscar dados básicos da NE com retry
        const ne = await this.withRetry(() => this.sigefService.getNotaEmpenhoByNumber(ano, neNumber, ug));
        if (ne) {
          await this.cacheService.saveNotaEmpenho(this.mapApiNeToCache(ne, ugNum));
          neCached = await this.cacheService.getNotaEmpenho(ugNum, neNumber);
        }

        // Buscar movimentos (empenhos/anulações) com retry
        const movements = await this.withRetry(() => this.sigefService.getNotaEmpenhoMovements(ano, neNumber, ug));
        if (movements.length > 0) {
          await this.cacheService.saveNeMovimentos(movements.map(m => this.mapApiMovementToCache(m, ugNum)));
        }

        // Determinar a data mínima para filtrar OBs (pagamento não pode preceder empego)
        const allDates = movements.map(m => m.dtlancamento).filter(Boolean) as string[];
        const minDate = allDates.length > 0 ? allDates.sort()[0] : undefined;
        const nesVinculadas = [...new Set([neNumber, ...movements.map(m => m.nunotaempenho).filter(Boolean)])] as string[];
        
        console.log('[SIGEF SYNC] Buscando OBs atualizadas via API...');
        // REMOÇÃO DO minDate: Garantimos a captura de todo o histórico da NE conforme solicitado
        const obs = await this.withRetry(() => this.sigefService.getOrdemBancariaMovements(ano, nesVinculadas, ug, undefined));
        if (obs.length > 0) {
          await this.cacheService.saveOrdensBancarias(obs.map(ob => this.mapApiObToCache(ob, ugNum)));
        }

        // NOVO: Persistência automática se contractId for fornecido
        if (contractId) {
          console.log('[SIGEF SYNC] Iniciando persistência automática para o contrato:', contractId);
          await this.financialService.syncSigefTransactions(contractId);
        }
      } catch (err) {
        console.error('[SIGEF SYNC] Erro ao sincronizar via API:', neNumber, err);
        // Se falhar a API, continuamos usando o que temos no cache
      }
    }

    // 3. Retornar resumo consolidado do banco local (independente de ter sincronizado agora ou não)
    return await this.cacheService.getNeResumo(ugNum, neNumber);
  }

  private mapApiNeToCache(ne: NotaEmpenho, ug: number): SigefNotaEmpenho {
    return {
      cdunidadegestora: ug,
      nunotaempenho: ne.nunotaempenho || '',
      cdgestao: ne.cdgestao ? parseInt(ne.cdgestao, 10) : undefined,
      cdcredor: ne.cdcredor || undefined,
      cdtipocredor: undefined,
      cdtipocredorpessoa: undefined,
      cdugfavorecida: undefined,
      cdorgao: undefined,
      cdsubacao: ne.cdsubacao ? parseInt(ne.cdsubacao, 10) : undefined,
      cdfuncao: ne.cdfuncao ? parseInt(ne.cdfuncao, 10) : undefined,
      cdsubfuncao: ne.cdsubfuncao ? parseInt(ne.cdsubfuncao, 10) : undefined,
      cdprograma: ne.cdprograma || undefined,
      cdacao: ne.cdacao ? parseInt(ne.cdacao, 10) : undefined,
      localizagasto: undefined,
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

  private mapApiMovementToCache(m: any, ug: number): SigefNeMovimento {
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
      dehistorico: m.dehistorico || undefined
    };
  }

  private mapApiObToCache(ob: OrdemBancaria, ug: number): SigefOrdemBancaria {
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
}