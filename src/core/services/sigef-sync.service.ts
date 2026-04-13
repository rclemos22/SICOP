import { Injectable, inject } from '@angular/core';
import { SigefService, NotaEmpenho, OrdemBancaria } from './sigef.service';
import { SigefCacheService, SigefNotaEmpenho, SigefNeMovimento, SigefOrdemBancaria, NeResumo } from './sigef-cache.service';
import { signal, computed } from '@angular/core';

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

  // Queue State
  private _syncQueue = signal<SyncTask[]>([]);
  private _currentIdx = signal<number>(-1);
  
  readonly syncQueue = this._syncQueue.asReadonly();
  readonly currentIdx = this._currentIdx.asReadonly();
  
  readonly isSyncing = computed(() => this._currentIdx() >= 0 && this._currentIdx() < this._syncQueue().length);
  private _isLocked = signal<boolean>(false);
  readonly isLocked = this._isLocked.asReadonly();
  
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
  async syncBatch(tasks: { ne: string, ug: string, ano: string }[]): Promise<void> {
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
          
          // Atualiza status local da fila
          this.updateTaskStatus(i, 'processing');
          
          try {
              console.log(`[SIGEF SYNC] Processando fila: ${i+1}/${queue.length} - NE: ${task.ne}`);
              // Sincronização profunda forçada
              await this.getNotaEmpenhoWithCache(task.ano, task.ne, task.ug, true);
              this.updateTaskStatus(i, 'completed');
          } catch (err: any) {
              console.error(`[SIGEF SYNC] Erro na fila para NE ${task.ne}:`, err);
              this.updateTaskStatus(i, 'error', err.message || 'Falha na comunicação');
          }

          // Delay de cortesia para a API (1500ms entre requisições de NEs)
          if (i < queue.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1500));
          }
      }
    } finally {
      this._isLocked.set(false); // Libera a navegação
    }

    // Resetar após conclusão (mantendo a fila visível por alguns segundos se necessário)
    setTimeout(() => {
        if (!this.isSyncing()) {
            this._currentIdx.set(-1);
            // Opcional: limpar fila ou manter para histórico
        }
    }, 5000);
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
  async getNotaEmpenhoWithCache(ano: string, neNumber: string, ug: string, forceSync: boolean = false): Promise<NeResumo | null> {
    const ugNum = parseInt(ug, 10);
    
    // 1. Tentar obter os dados básicos da NE do cache local
    let neCached = await this.cacheService.getNotaEmpenho(ugNum, neNumber);
    
    // 2. Só consome a API se forceSync for explicitamente true (clique no botão)
    if (forceSync) {
      console.log('[SIGEF SYNC] Sincronização FORÇADA iniciada para NE:', neNumber);
      try {
        // Buscar dados básicos da NE
        const ne = await this.sigefService.getNotaEmpenhoByNumber(ano, neNumber, ug);
        if (ne) {
          await this.cacheService.saveNotaEmpenho(this.mapApiNeToCache(ne, ugNum));
          neCached = await this.cacheService.getNotaEmpenho(ugNum, neNumber);
        }

        // Buscar movimentos (empenhos/anulações)
        const movements = await this.sigefService.getNotaEmpenhoMovements(ano, neNumber, ug);
        if (movements.length > 0) {
          await this.cacheService.saveNeMovimentos(movements.map(m => this.mapApiMovementToCache(m, ugNum)));
        }

        // Determinar a data mínima para filtrar OBs (pagamento não pode preceder empenho)
        const allDates = movements.map(m => m.dtlancamento).filter(Boolean) as string[];
        const minDate = allDates.length > 0 ? allDates.sort()[0] : undefined;
        const nesVinculadas = [...new Set([neNumber, ...movements.map(m => m.nunotaempenho).filter(Boolean)])] as string[];
        
        console.log('[SIGEF SYNC] Buscando OBs atualizadas via API...');
        const obs = await this.sigefService.getOrdemBancariaMovements(ano, nesVinculadas, ug, minDate);
        if (obs.length > 0) {
          await this.cacheService.saveOrdensBancarias(obs.map(ob => this.mapApiObToCache(ob, ugNum)));
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