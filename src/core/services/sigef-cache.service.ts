import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ErrorHandlerService } from './error-handler.service';

export interface SigefNotaEmpenho {
  id?: string;
  cdunidadegestora: number;
  nunotaempenho: string;
  cdgestao?: number;
  cdcredor?: string;
  cdtipocredor?: string;
  cdtipocredorpessoa?: string;
  cdugfavorecida?: number;
  cdorgao?: number;
  cdsubacao?: number;
  cdfuncao?: number;
  cdsubfuncao?: number;
  cdprograma?: number;
  cdacao?: number;
  localizagasto?: string;
  cdnaturezadespesa?: string;
  cdfonte?: string;
  cdmodalidade?: number;
  vlnotaempenho?: number;
  nuquantidade?: number;
  dtlancamento?: string;
  tipo?: string;
  nuprocesso?: string;
  nuneoriginal?: string;
  dehistorico?: string;
  created_at?: Date;
  updated_at?: Date;
  last_sync?: Date;
}

export interface SigefNeMovimento {
  id?: string;
  cdunidadegestora: number;
  nunotaempenho: string;
  cdevento: number;
  nudocumento?: string;
  cdcredor?: string;
  cdorgao?: number;
  cdsubacao?: number;
  cdfuncao?: number;
  cdsubfuncao?: number;
  cdprograma?: number;
  cdacao?: number;
  cdnaturezadespesa?: string;
  cdfonte?: string;
  cdmodalidade?: number;
  vlnotaempenho?: number;
  dtlancamento?: string;
  dehistorico?: string;
  created_at?: Date;
}

export interface SigefOrdemBancaria {
  id?: string;
  nuordembancaria: string;
  cdunidadegestora: number;
  nunotaempenho?: string;
  cdgestao?: number;
  cdevento?: number;
  nudocumento?: string;
  cdcredor?: string;
  cdtipocredor?: string;
  cdugfavorecida?: number;
  cdorgao?: number;
  cdsubacao?: number;
  cdfuncao?: number;
  cdsubfuncao?: number;
  cdprograma?: number;
  cdacao?: number;
  localizagasto?: string;
  cdnaturezadespesa?: string;
  cdfonte?: string;
  cdmodalidade?: number;
  vltotal?: number;
  dtlancamento?: string;
  dtpagamento?: string;
  cdsituacaoordembancaria?: string;
  situacaopreparacaopagamento?: string;
  tipoordembancaria?: string;
  tipopreparacaopagamento?: string;
  deobservacao?: string;
  definalidade?: string;
  usuario_responsavel?: string;
  created_at?: Date;
  updated_at?: Date;
  last_sync?: Date;
}

export interface NeResumo {
  cdunidadegestora: number;
  nunotaempenho: string;
  cdcredor?: string;
  dtlancamento?: string;
  vlnotaempenho: number;
  cdnaturezadespesa?: string;
  cdfonte?: string;
  valor_empenhado: number;
  valor_pago: number;
  saldo_pagar: number;
}

/**
 * Lista padronizada de status que indicam que a ordem bancária foi paga/confirmada.
 */
export const SIGEF_PAID_STATUSES = [
  'cb', 'confirmada banco', 'creditado', 
  'emitida', 'processada', 'registrada', 
  'ordem bancaria emitida', 'pagamento efetuado',
  'paga', 'pago', 'concluida', 'concluída', 'efetivada', 'liquidada'
];

@Injectable({
  providedIn: 'root'
})
export class SigefCacheService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);

  private _loading = signal<boolean>(false);
  readonly loading = this._loading.asReadonly();

  private _error = signal<string | null>(null);
  readonly error = this._error.asReadonly();

  private CACHE_TIMEOUT_HOURS = 24; // Cache válido por 24 horas

  // ============================================
  // Notas de Empenho
  // ============================================

  async getNotaEmpenho(ug: number, neNumber: string): Promise<SigefNotaEmpenho | null> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('sigef_notas_empenho')
        .select('*')
        .eq('cdunidadegestora', ug)
        .eq('nunotaempenho', neNumber)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapToNotaEmpenho(data);
    } catch (err) {
      return null;
    }
  }

  async saveNotaEmpenho(ne: SigefNotaEmpenho): Promise<void> {
    const payload = {
      cdunidadegestora: ne.cdunidadegestora,
      nunotaempenho: ne.nunotaempenho,
      cdgestao: ne.cdgestao,
      cdcredor: ne.cdcredor,
      cdtipocredor: ne.cdtipocredor,
      cdtipocredorpessoa: ne.cdtipocredorpessoa,
      cdugfavorecida: ne.cdugfavorecida,
      cdorgao: ne.cdorgao,
      cdsubacao: ne.cdsubacao,
      cdfuncao: ne.cdfuncao,
      cdsubfuncao: ne.cdsubfuncao,
      cdprograma: ne.cdprograma,
      cdacao: ne.cdacao,
      localizagasto: ne.localizagasto,
      cdnaturezadespesa: ne.cdnaturezadespesa,
      cdfonte: ne.cdfonte,
      cdmodalidade: ne.cdmodalidade,
      vlnotaempenho: ne.vlnotaempenho,
      nuquantidade: ne.nuquantidade,
      dtlancamento: ne.dtlancamento,
      tipo: ne.tipo,
      nuprocesso: ne.nuprocesso,
      nuneoriginal: ne.nuneoriginal,
      dehistorico: ne.dehistorico,
      last_sync: new Date().toISOString()
    };

    await this.supabaseService.client
      .from('sigef_notas_empenho')
      .upsert(payload, { onConflict: 'cdunidadegestora,nunotaempenho' });
  }

  // ============================================
  // Movimentos de NE (eventos)
  // ============================================

  async getNeMovimentos(ug: number, neNumber: string): Promise<SigefNeMovimento[]> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('sigef_ne_movimentos')
        .select('*')
        .eq('cdunidadegestora', ug)
        .eq('nunotaempenho', neNumber)
        .order('dtlancamento', { ascending: true });

      if (error || !data) {
        return [];
      }

      return data.map(this.mapToNeMovimento);
    } catch (err) {
      return [];
    }
  }

  async saveNeMovimentos(movimentos: SigefNeMovimento[]): Promise<void> {
    const payload = movimentos.map(m => ({
      cdunidadegestora: m.cdunidadegestora,
      nunotaempenho: m.nunotaempenho,
      cdevento: m.cdevento,
      nudocumento: m.nudocumento,
      cdcredor: m.cdcredor,
      cdorgao: m.cdorgao,
      cdsubacao: m.cdsubacao,
      cdfuncao: m.cdfuncao,
      cdsubfuncao: m.cdsubfuncao,
      cdprograma: m.cdprograma,
      cdacao: m.cdacao,
      cdnaturezadespesa: m.cdnaturezadespesa,
      cdfonte: m.cdfonte,
      cdmodalidade: m.cdmodalidade,
      vlnotaempenho: m.vlnotaempenho,
      dtlancamento: m.dtlancamento,
      dehistorico: m.dehistorico
    }));

    if (payload.length > 0) {
      await this.supabaseService.client
        .from('sigef_ne_movimentos')
        .upsert(payload, { onConflict: 'cdunidadegestora,nunotaempenho,cdevento,dtlancamento' });
    }
  }

  // ============================================
  // Ordens Bancárias
  // ============================================

  async getOrdemBancaria(obNumber: string, ug: number): Promise<SigefOrdemBancaria | null> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('sigef_ordens_bancarias')
        .select('*')
        .eq('nuordembancaria', obNumber)
        .eq('cdunidadegestora', ug)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapToOrdemBancaria(data);
    } catch (err) {
      return null;
    }
  }

  async getOrdensBancariasPorNe(ug: number, neNumber: string): Promise<SigefOrdemBancaria[]> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('sigef_ordens_bancarias')
        .select('*')
        .eq('cdunidadegestora', ug)
        .eq('nunotaempenho', neNumber)
        .order('dtlancamento', { ascending: true });

      if (error || !data) {
        return [];
      }

      return data.map(this.mapToOrdemBancaria);
    } catch (err) {
      return [];
    }
  }

  async saveOrdemBancaria(ob: SigefOrdemBancaria): Promise<void> {
    const payload = {
      nuordembancaria: ob.nuordembancaria,
      cdunidadegestora: ob.cdunidadegestora,
      nunotaempenho: ob.nunotaempenho,
      cdgestao: ob.cdgestao,
      cdevento: ob.cdevento,
      nudocumento: ob.nudocumento,
      cdcredor: ob.cdcredor,
      cdtipocredor: ob.cdtipocredor,
      cdugfavorecida: ob.cdugfavorecida,
      cdorgao: ob.cdorgao,
      cdsubacao: ob.cdsubacao,
      cdfuncao: ob.cdfuncao,
      cdsubfuncao: ob.cdsubfuncao,
      cdprograma: ob.cdprograma,
      cdacao: ob.cdacao,
      localizagasto: ob.localizagasto,
      cdnaturezadespesa: ob.cdnaturezadespesa,
      cdfonte: ob.cdfonte,
      cdmodalidade: ob.cdmodalidade,
      vltotal: ob.vltotal,
      dtlancamento: ob.dtlancamento,
      dtpagamento: ob.dtpagamento,
      cdsituacaoordembancaria: ob.cdsituacaoordembancaria,
      situacaopreparacaopagamento: ob.situacaopreparacaopagamento,
      tipoordembancaria: ob.tipoordembancaria,
      tipopreparacaopagamento: ob.tipopreparacaopagamento,
      deobservacao: ob.deobservacao,
      definalidade: ob.definalidade,
      usuario_responsavel: ob.usuario_responsavel,
      last_sync: new Date().toISOString()
    };

    await this.supabaseService.client
      .from('sigef_ordens_bancarias')
      .upsert(payload, { onConflict: 'nuordembancaria,cdunidadegestora' });
  }

  async saveOrdensBancarias(obs: SigefOrdemBancaria[]): Promise<void> {
    const payload = obs.map(ob => ({
      nuordembancaria: ob.nuordembancaria,
      cdunidadegestora: ob.cdunidadegestora,
      nunotaempenho: ob.nunotaempenho,
      cdgestao: ob.cdgestao,
      cdevento: ob.cdevento,
      nudocumento: ob.nudocumento,
      cdcredor: ob.cdcredor,
      cdtipocredor: ob.cdtipocredor,
      cdugfavorecida: ob.cdugfavorecida,
      cdorgao: ob.cdorgao,
      cdsubacao: ob.cdsubacao,
      cdfuncao: ob.cdfuncao,
      cdsubfuncao: ob.cdsubfuncao,
      cdprograma: ob.cdprograma,
      cdacao: ob.cdacao,
      localizagasto: ob.localizagasto,
      cdnaturezadespesa: ob.cdnaturezadespesa,
      cdfonte: ob.cdfonte,
      cdmodalidade: ob.cdmodalidade,
      vltotal: ob.vltotal,
      dtlancamento: ob.dtlancamento,
      dtpagamento: ob.dtpagamento,
      cdsituacaoordembancaria: ob.cdsituacaoordembancaria,
      situacaopreparacaopagamento: ob.situacaopreparacaopagamento,
      tipoordembancaria: ob.tipoordembancaria,
      tipopreparacaopagamento: ob.tipopreparacaopagamento,
      deobservacao: ob.deobservacao,
      definalidade: ob.definalidade,
      usuario_responsavel: ob.usuario_responsavel,
      last_sync: new Date().toISOString()
    }));

    if (payload.length > 0) {
      await this.supabaseService.client
        .from('sigef_ordens_bancarias')
        .upsert(payload, { onConflict: 'nuordembancaria,cdunidadegestora' });
    }
  }

  // ============================================
  // Funções de cálculo
  // ============================================

  calcularValorEmpenhado(movimentos: SigefNeMovimento[]): number {
    return movimentos.reduce((total, m) => {
      // Eventos 400010 (empenho) e 400011 (reforço) somam
      if (m.cdevento === 400010 || m.cdevento === 400011) {
        return total + (m.vlnotaempenho || 0);
      }
      // Evento 400012 (anulação) subtrai
      if (m.cdevento === 400012) {
        return total - (m.vlnotaempenho || 0);
      }
      return total;
    }, 0);
  }

  calcularValorPago(ordensBancarias: SigefOrdemBancaria[]): number {
    return ordensBancarias.reduce((total, ob) => {
      const situacao = ob.cdsituacaoordembancaria?.toLowerCase() || '';
      
      // Verifica se a situação da OB contém algum dos status de pagamento confirmados
      if (SIGEF_PAID_STATUSES.some(status => situacao.includes(status))) {
        return total + (ob.vltotal || 0);
      }
      return total;
    }, 0);
  }

  calcularSaldoPagar(valorEmpenhado: number, valorPago: number): number {
    return valorEmpenhado - valorPago;
  }

  async getNeResumo(ug: number, neNumber: string): Promise<NeResumo | null> {
    const ne = await this.getNotaEmpenho(ug, neNumber);
    if (!ne) return null;

    const movimentos = await this.getNeMovimentos(ug, neNumber);
    const ordens = await this.getOrdensBancariasPorNe(ug, neNumber);

    const valorEmpenhado = this.calcularValorEmpenhado(movimentos);
    const valorPago = this.calcularValorPago(ordens);

    return {
      cdunidadegestora: ug,
      nunotaempenho: neNumber,
      cdcredor: ne.cdcredor,
      dtlancamento: ne.dtlancamento,
      vlnotaempenho: ne.vlnotaempenho || 0,
      cdnaturezadespesa: ne.cdnaturezadespesa,
      cdfonte: ne.cdfonte,
      valor_empenhado: valorEmpenhado,
      valor_pago: valorPago,
      saldo_pagar: this.calcularSaldoPagar(valorEmpenhado, valorPago)
    };
  }

  // ============================================
  // Mappers
  // ============================================

  private mapToNotaEmpenho(data: any): SigefNotaEmpenho {
    return {
      id: data.id,
      cdunidadegestora: data.cdunidadegestora,
      nunotaempenho: data.nunotaempenho,
      cdgestao: data.cdgestao,
      cdcredor: data.cdcredor,
      cdtipocredor: data.cdtipocredor,
      cdtipocredorpessoa: data.cdtipocredorpessoa,
      cdugfavorecida: data.cdugfavorecida,
      cdorgao: data.cdorgao,
      cdsubacao: data.cdsubacao,
      cdfuncao: data.cdfuncao,
      cdsubfuncao: data.cdsubfuncao,
      cdprograma: data.cdprograma,
      cdacao: data.cdacao,
      localizagasto: data.localizagasto,
      cdnaturezadespesa: data.cdnaturezadespesa,
      cdfonte: data.cdfonte,
      cdmodalidade: data.cdmodalidade,
      vlnotaempenho: data.vlnotaempenho,
      nuquantidade: data.nuquantidade,
      dtlancamento: data.dtlancamento,
      tipo: data.tipo,
      nuprocesso: data.nuprocesso,
      nuneoriginal: data.nuneoriginal,
      dehistorico: data.dehistorico,
      created_at: data.created_at,
      updated_at: data.updated_at,
      last_sync: data.last_sync
    };
  }

  private mapToNeMovimento(data: any): SigefNeMovimento {
    return {
      id: data.id,
      cdunidadegestora: data.cdunidadegestora,
      nunotaempenho: data.nunotaempenho,
      cdevento: data.cdevento,
      nudocumento: data.nudocumento,
      cdcredor: data.cdcredor,
      cdorgao: data.cdorgao,
      cdsubacao: data.cdsubacao,
      cdfuncao: data.cdfuncao,
      cdsubfuncao: data.cdsubfuncao,
      cdprograma: data.cdprograma,
      cdacao: data.cdacao,
      cdnaturezadespesa: data.cdnaturezadespesa,
      cdfonte: data.cdfonte,
      cdmodalidade: data.cdmodalidade,
      vlnotaempenho: data.vlnotaempenho,
      dtlancamento: data.dtlancamento,
      dehistorico: data.dehistorico,
      created_at: data.created_at
    };
  }

  private mapToOrdemBancaria(data: any): SigefOrdemBancaria {
    return {
      id: data.id,
      nuordembancaria: data.nuordembancaria,
      cdunidadegestora: data.cdunidadegestora,
      nunotaempenho: data.nunotaempenho,
      cdgestao: data.cdgestao,
      cdevento: data.cdevento,
      nudocumento: data.nudocumento,
      cdcredor: data.cdcredor,
      cdtipocredor: data.cdtipocredor,
      cdugfavorecida: data.cdugfavorecida,
      cdorgao: data.cdorgao,
      cdsubacao: data.cdsubacao,
      cdfuncao: data.cdfuncao,
      cdsubfuncao: data.cdsubfuncao,
      cdprograma: data.cdprograma,
      cdacao: data.cdacao,
      localizagasto: data.localizagasto,
      cdnaturezadespesa: data.cdnaturezadespesa,
      cdfonte: data.cdfonte,
      cdmodalidade: data.cdmodalidade,
      vltotal: data.vltotal,
      dtlancamento: data.dtlancamento,
      dtpagamento: data.dtpagamento,
      cdsituacaoordembancaria: data.cdsituacaoordembancaria,
      situacaopreparacaopagamento: data.situacaopreparacaopagamento,
      tipoordembancaria: data.tipoordembancaria,
      tipopreparacaopagamento: data.tipopreparacaopagamento,
      deobservacao: data.deobservacao,
      definalidade: data.definalidade,
      usuario_responsavel: data.usuario_responsavel,
      created_at: data.created_at,
      updated_at: data.updated_at,
      last_sync: data.last_sync
    };
  }
}