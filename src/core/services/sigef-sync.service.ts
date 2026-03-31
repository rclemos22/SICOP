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
   * Obtém resumo de NE usando cache quando disponível
   * Falls back para API se não tiver cache
   */
  async getNotaEmpenhoWithCache(ano: string, neNumber: string, ug: string): Promise<NeResumo | null> {
    const ugNum = parseInt(ug, 10);
    
    // 1. Tentar do cache primeiro
    const cached = await this.cacheService.getNeResumo(ugNum, neNumber);
    
    if (cached) {
      console.log('[SIGEF SYNC] Usando cache para NE:', neNumber);
      return cached;
    }

    // 2. Se não tem cache, buscar da API e salvar
    console.log('[SIGEF SYNC] Buscando NE da API:', neNumber);
    
    try {
      // Buscar NE
      const ne = await this.sigefService.getNotaEmpenhoByNumber(ano, neNumber, ug);
      if (ne) {
        await this.cacheService.saveNotaEmpenho(this.mapApiNeToCache(ne, ugNum));
      }

      // Buscar movimentos (eventos: 400010, 400011, 400012)
      const movements = await this.sigefService.getNotaEmpenhoMovements(ano, neNumber, ug);
      if (movements.length > 0) {
        const cacheMovimentos = movements.map(m => this.mapApiMovementToCache(m, ugNum));
        await this.cacheService.saveNeMovimentos(cacheMovimentos);
      }

      // Buscar OBs vinculadas (busca de anos anteriores até atual)
      const nesViculadas = [...new Set(movements.map(m => m.nunotaempenho).filter(Boolean))] as string[];
      if (nesViculadas.length > 0) {
        const obs = await this.sigefService.getOrdemBancariaMovements(ano, nesViculadas, ug);
        if (obs.length > 0) {
          const cacheObs = obs.map(ob => this.mapApiObToCache(ob, ugNum));
          await this.cacheService.saveOrdensBancarias(cacheObs);
        }
      }

      // Retornar resumo calculado
      return await this.cacheService.getNeResumo(ugNum, neNumber);
    } catch (err) {
      console.error('[SIGEF SYNC] Erro ao sincronizar NE:', err);
      return null;
    }
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