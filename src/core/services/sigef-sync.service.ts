import { Injectable, inject } from '@angular/core';
import { SigefService, NotaEmpenho, OrdemBancaria } from './sigef.service';
import { SigefCacheService, SigefNotaEmpenho, SigefNeMovimento, SigefOrdemBancaria, NeResumo } from './sigef-cache.service';

@Injectable({
  providedIn: 'root'
})
export class SigefSyncService {
  private sigefService = inject(SigefService);
  private cacheService = inject(SigefCacheService);

  /**
   * Obtém resumo de NE usando cache quando disponível, mas garantindo sincronização de movimentos e OBs
   */
  async getNotaEmpenhoWithCache(ano: string, neNumber: string, ug: string, forceSync: boolean = true): Promise<NeResumo | null> {
    const ugNum = parseInt(ug, 10);
    
    // 1. Tentar obter os dados básicos da NE do cache
    let neCached = await this.cacheService.getNotaEmpenho(ugNum, neNumber);
    
    // 2. Se não tem NE no cache ou forceSync, buscar dados básicos da NE
    if (!neCached || (forceSync && this.isCacheOld(neCached.last_sync))) {
      console.log('[SIGEF SYNC] Sincronizando dados básicos da NE:', neNumber);
      try {
        const ne = await this.sigefService.getNotaEmpenhoByNumber(ano, neNumber, ug);
        if (ne) {
          await this.cacheService.saveNotaEmpenho(this.mapApiNeToCache(ne, ugNum));
          neCached = await this.cacheService.getNotaEmpenho(ugNum, neNumber);
        }
      } catch (err) {
        console.warn('[SIGEF SYNC] Erro ao buscar NE base:', neNumber, err);
      }
    }

    // 3. Sincronizar movimentos e OBs (Isto deve ocorrer sempre que forceSync for true ou cache for antigo)
    // Para garantir que "pesquisa sempre até a data atual", buscamos movimentos/OBs se solicitado
    if (forceSync) {
      console.log('[SIGEF SYNC] Sincronizando movimentos e OBs para:', neNumber);
      try {
        // Buscar movimentos (empenhos/anulações)
        const movements = await this.sigefService.getNotaEmpenhoMovements(ano, neNumber, ug);
        if (movements.length > 0) {
          await this.cacheService.saveNeMovimentos(movements.map(m => this.mapApiMovementToCache(m, ugNum)));
        }

        // Buscar OBs vinculadas percorrendo todas as NEs encontradas nos movimentos
        const nesVinculadas = [...new Set([neNumber, ...movements.map(m => m.nunotaempenho).filter(Boolean)])] as string[];
        
        const obs = await this.sigefService.getOrdemBancariaMovements(ano, nesVinculadas, ug);
        if (obs.length > 0) {
          await this.cacheService.saveOrdensBancarias(obs.map(ob => this.mapApiObToCache(ob, ugNum)));
        }
      } catch (err) {
        console.error('[SIGEF SYNC] Falha na sincronização financeira profunda de:', neNumber, err);
      }
    }

    // 4. Retornar resumo final consolidado (calculado via View ou Função no CacheService)
    return await this.cacheService.getNeResumo(ugNum, neNumber);
  }

  private isCacheOld(lastSync: Date | string | undefined): boolean {
    if (!lastSync) return true;
    const last = new Date(lastSync).getTime();
    const now = Date.now();
    // Cache de dados básicos da NE dura 12 horas, mas movimentos/OBs o dashboard força sync
    return (now - last) > (12 * 60 * 60 * 1000); 
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