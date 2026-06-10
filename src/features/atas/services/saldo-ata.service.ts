import { inject, Injectable, signal } from '@angular/core';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AtaConsumoInterno, AtaAdesao, SaldoItem, SaldoResumo, AdesaoStatus } from '../../../shared/models/ata.model';
import { Result, ok, fail } from '../../../shared/models/result.model';

@Injectable({ providedIn: 'root' })
export class SaldoAtaService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);

  private _saldos = signal<SaldoItem[]>([]);
  private _resumo = signal<SaldoResumo | null>(null);
  private _loading = signal(false);
  private _error = signal<string | null>(null);

  readonly saldos = this._saldos.asReadonly();
  readonly resumo = this._resumo.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  // ---- Saldos ----

  async loadSaldos(ataId: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const { data, error } = await this.supabaseService.client
        .from('vw_ata_saldo_item')
        .select('*')
        .eq('ata_id', ataId)
        .order('numero_item', { ascending: true });

      if (error) throw error;
      this._saldos.set((data || []).map(this.mapToSaldoItem));
    } catch (err: any) {
      this.errorHandler.handle(err, 'SaldoAtaService.loadSaldos');
      this._error.set(err.message || 'Erro ao carregar saldos');
      this._saldos.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  async loadResumo(ataId: string): Promise<void> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('vw_ata_saldo_resumo')
        .select('*')
        .eq('ata_id', ataId)
        .single();

      if (error) throw error;
      this._resumo.set(data ? this.mapToSaldoResumo(data) : null);
    } catch (err: any) {
      this._resumo.set(null);
    }
  }

  async getSaldoByItem(itemId: string): Promise<Result<SaldoItem>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('vw_ata_saldo_item')
        .select('*')
        .eq('item_id', itemId)
        .single();

      if (error) throw error;
      return ok(this.mapToSaldoItem(data));
    } catch (err: any) {
      return fail(err.message || 'Erro ao carregar saldo do item');
    }
  }

  // ---- Consumo Interno ----

  async registrarConsumo(consumo: AtaConsumoInterno): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('ata_consumo_interno')
        .insert({
          ata_id: consumo.ata_id,
          ata_item_id: consumo.ata_item_id,
          quantidade: consumo.quantidade,
          documento_sei: consumo.documento_sei || null,
          data_consumo: consumo.data_consumo,
          observacao: consumo.observacao || null,
        });

      if (error) throw error;
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'SaldoAtaService.registrarConsumo');
      return fail(err.message || 'Erro ao registrar consumo');
    }
  }

  async listarConsumos(ataId: string, ataItemId?: string): Promise<Result<AtaConsumoInterno[]>> {
    try {
      let query = this.supabaseService.client
        .from('ata_consumo_interno')
        .select('*')
        .eq('ata_id', ataId)
        .order('data_consumo', { ascending: false });

      if (ataItemId) {
        query = query.eq('ata_item_id', ataItemId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return ok(data || []);
    } catch (err: any) {
      return fail(err.message || 'Erro ao listar consumos');
    }
  }

  async excluirConsumo(id: string): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('ata_consumo_interno')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return ok(null);
    } catch (err: any) {
      return fail(err.message || 'Erro ao excluir consumo');
    }
  }

  // ---- Adesões ----

  async solicitarAdesao(adesao: AtaAdesao): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('ata_adesoes')
        .insert({
          ata_id: adesao.ata_id,
          ata_item_id: adesao.ata_item_id,
          cnpj_orgao: adesao.cnpj_orgao,
          razao_orgao: adesao.razao_orgao,
          quantidade_solicitada: adesao.quantidade_solicitada,
          quantidade_autorizada: null,
          status: 'PENDENTE',
          data_solicitacao: adesao.data_solicitacao || new Date().toISOString().split('T')[0],
          justificativa: adesao.justificativa || null,
        });

      if (error) throw error;
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'SaldoAtaService.solicitarAdesao');
      return fail(err.message || 'Erro ao solicitar adesão');
    }
  }

  async autorizarAdesao(id: string, quantidadeAutorizada: number): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('ata_adesoes')
        .update({
          quantidade_autorizada: quantidadeAutorizada,
          status: 'AUTORIZADA',
          data_resposta: new Date().toISOString().split('T')[0],
        })
        .eq('id', id);

      if (error) throw error;
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'SaldoAtaService.autorizarAdesao');
      return fail(err.message || 'Erro ao autorizar adesão');
    }
  }

  async rejeitarAdesao(id: string, justificativa: string): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('ata_adesoes')
        .update({
          status: 'REJEITADA',
          data_resposta: new Date().toISOString().split('T')[0],
          justificativa,
        })
        .eq('id', id);

      if (error) throw error;
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'SaldoAtaService.rejeitarAdesao');
      return fail(err.message || 'Erro ao rejeitar adesão');
    }
  }

  async cancelarAdesao(id: string): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('ata_adesoes')
        .update({ status: 'CANCELADA' })
        .eq('id', id);

      if (error) throw error;
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'SaldoAtaService.cancelarAdesao');
      return fail(err.message || 'Erro ao cancelar adesão');
    }
  }

  async listarAdesoes(ataId: string, ataItemId?: string): Promise<Result<AtaAdesao[]>> {
    try {
      let query = this.supabaseService.client
        .from('ata_adesoes')
        .select('*')
        .eq('ata_id', ataId)
        .order('data_solicitacao', { ascending: false });

      if (ataItemId) {
        query = query.eq('ata_item_id', ataItemId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return ok(data || []);
    } catch (err: any) {
      return fail(err.message || 'Erro ao listar adesões');
    }
  }

  async listarAdesoesPendentes(): Promise<Result<AtaAdesao[]>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('ata_adesoes')
        .select('*')
        .eq('status', 'PENDENTE')
        .order('data_solicitacao', { ascending: false });

      if (error) throw error;
      return ok(data || []);
    } catch (err: any) {
      return fail(err.message || 'Erro ao listar adesões pendentes');
    }
  }

  // ---- Validações Legais (Decreto 11.462/2023) ----

  async validarLimiteAdesao(ataItemId: string, quantidadePretendida: number): Promise<{
    permitido: boolean;
    motivo?: string;
    maximoPermitido: number;
  }> {
    const saldo = await this.getSaldoByItem(ataItemId);
    if (!saldo.data) {
      return { permitido: false, motivo: 'Item não encontrado', maximoPermitido: 0 };
    }

    const item = saldo.data;
    // Cada órgão aderente pode solicitar até 50% da quantidade registrada
    const maxPorOrgao = item.quantidade_registrada * 0.5;

    // Total de adesões não pode ultrapassar 50% da quantidade registrada
    const maxTotalAdesoes = item.quantidade_registrada * 0.5;
    const saldoParaAdesoes = maxTotalAdesoes - item.quantidade_aderida;

    const maximoPermitido = Math.min(maxPorOrgao, saldoParaAdesoes);

    if (quantidadePretendida > maximoPermitido) {
      return {
        permitido: false,
        motivo: `Quantidade excede o limite legal. Máximo permitido: ${maximoPermitido} unidades. `
              + `(Limite por órgão: ${maxPorOrgao} | Saldo disponível para adesões: ${saldoParaAdesoes})`,
        maximoPermitido,
      };
    }

    return { permitido: true, maximoPermitido };
  }

  async validarLimiteConsumoInterno(ataItemId: string, quantidadePretendida: number): Promise<{
    permitido: boolean;
    motivo?: string;
    maximoPermitido: number;
  }> {
    const saldo = await this.getSaldoByItem(ataItemId);
    if (!saldo.data) {
      return { permitido: false, motivo: 'Item não encontrado', maximoPermitido: 0 };
    }

    const item = saldo.data;
    // Órgão gerenciador pode consumir até 100% da quantidade registrada
    const consumido = item.quantidade_consumida_interna;
    const saldoRestante = item.quantidade_registrada - consumido;

    if (quantidadePretendida > saldoRestante) {
      return {
        permitido: false,
        motivo: `Saldo insuficiente. Disponível: ${saldoRestante} unidades.`,
        maximoPermitido: saldoRestante,
      };
    }

    return { permitido: true, maximoPermitido: saldoRestante };
  }

  // ---- Mappers ----

  private mapToSaldoItem(raw: any): SaldoItem {
    return {
      item_id: raw.item_id,
      ata_id: raw.ata_id,
      numero_item: Number(raw.numero_item) || 0,
      descricao_item: raw.descricao_item ?? '',
      unidade: raw.unidade ?? undefined,
      quantidade_registrada: Number(raw.quantidade_registrada) || 0,
      valor_unitario: Number(raw.valor_unitario) || 0,
      quantidade_consumida_interna: Number(raw.quantidade_consumida_interna) || 0,
      quantidade_aderida: Number(raw.quantidade_aderida) || 0,
      saldo_disponivel: Number(raw.saldo_disponivel) || 0,
      percentual_utilizado: Number(raw.percentual_utilizado) || 0,
      numero_ata: raw.numero_ata ?? '',
      numero_processo: raw.numero_processo ?? '',
      ata_status: raw.ata_status ?? '',
    };
  }

  private mapToSaldoResumo(raw: any): SaldoResumo {
    return {
      ata_id: raw.ata_id,
      numero_ata: raw.numero_ata ?? '',
      numero_processo: raw.numero_processo ?? '',
      ata_status: raw.ata_status ?? '',
      total_itens: Number(raw.total_itens) || 0,
      total_quantidade_registrada: Number(raw.total_quantidade_registrada) || 0,
      total_quantidade_consumida: Number(raw.total_quantidade_consumida) || 0,
      total_quantidade_aderida: Number(raw.total_quantidade_aderida) || 0,
      total_saldo_disponivel: Number(raw.total_saldo_disponivel) || 0,
      percentual_geral: Number(raw.percentual_geral) || 0,
    };
  }
}
