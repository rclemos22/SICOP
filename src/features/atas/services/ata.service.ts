import { inject, Injectable, signal } from '@angular/core';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Ata, AtaItem, AtaStatus } from '../../../shared/models/ata.model';
import { Result, ok, fail } from '../../../shared/models/result.model';

@Injectable({ providedIn: 'root' })
export class AtaService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);

  private _atas = signal<Ata[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  readonly atas = this._atas.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  async loadAtas(silent?: boolean): Promise<void> {
    if (!silent) {
      this._loading.set(true);
      this._error.set(null);
    }
    try {
      const { data, error } = await this.supabaseService.client
        .from('vw_atas_resumo')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      this._atas.set((data || []).map(raw => this.mapRawToAta(raw)));
    } catch (err: any) {
      if (!silent) {
        this.errorHandler.handle(err, 'AtaService.loadAtas');
        this._error.set(err.message || 'Erro ao carregar atas');
      }
      if (!silent) {
        this._atas.set([]);
      }
    } finally {
      if (!silent) this._loading.set(false);
    }
  }

  async loadAtaById(id: string): Promise<Result<Ata>> {
    try {
      const [ataResult, itensResult] = await Promise.all([
        this.supabaseService.client
          .from('vw_atas_resumo')
          .select('*')
          .eq('id', id)
          .single(),
        this.supabaseService.client
          .from('ata_itens')
          .select('*')
          .eq('ata_id', id)
          .order('numero_item', { ascending: true }),
      ]);

      if (ataResult.error) throw ataResult.error;
      if (!ataResult.data) return fail('Ata não encontrada');

      const ata = this.mapRawToAta(ataResult.data);
      ata.itens = (itensResult.data || []).map(raw => this.mapRawToItem(raw));
      return ok(ata);
    } catch (err: any) {
      this.errorHandler.handle(err, 'AtaService.loadAtaById');
      return fail(err.message || 'Erro ao carregar ata');
    }
  }

  async addAta(ata: Partial<Ata>): Promise<Result<string>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('atas')
        .insert({
          numero_processo: ata.numero_processo,
          numero_ata: ata.numero_ata,
          objeto: ata.objeto || null,
          fornecedor_id: ata.fornecedor_id || null,
          data_assinatura: ata.data_assinatura || null,
          vigencia_inicio: ata.vigencia_inicio || null,
          vigencia_fim: ata.vigencia_fim || null,
          valor_global: ata.valor_global || 0,
          status: ata.status || 'ATIVA',
          observacao: ata.observacao || null,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        const nova: Ata = this.mapRawToAta(data);
        this._atas.update(current => [nova, ...current]);
      }
      return ok(data?.id);
    } catch (err: any) {
      this.errorHandler.handle(err, 'AtaService.addAta');
      return fail(err.message || 'Erro ao adicionar ata');
    }
  }

  async updateAta(id: string, ata: Partial<Ata>): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('atas')
        .update({
          numero_processo: ata.numero_processo,
          numero_ata: ata.numero_ata,
          objeto: ata.objeto,
          fornecedor_id: ata.fornecedor_id,
          data_assinatura: ata.data_assinatura,
          vigencia_inicio: ata.vigencia_inicio,
          vigencia_fim: ata.vigencia_fim,
          valor_global: ata.valor_global,
          status: ata.status,
          observacao: ata.observacao,
          updated_at: new Date(),
        })
        .eq('id', id);

      if (error) throw error;
      await this.loadAtas(true);
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'AtaService.updateAta');
      return fail(err.message || 'Erro ao atualizar ata');
    }
  }

  async deleteAta(id: string): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('atas')
        .delete()
        .eq('id', id);

      if (error) throw error;
      this._atas.update(current => current.filter(a => a.id !== id));
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'AtaService.deleteAta');
      return fail(err.message || 'Erro ao excluir ata');
    }
  }

  async saveItens(ataId: string, itens: AtaItem[]): Promise<Result<null>> {
    try {
      const { error: deleteError } = await this.supabaseService.client
        .from('ata_itens')
        .delete()
        .eq('ata_id', ataId);

      if (deleteError) throw deleteError;

      if (itens.length > 0) {
        const { error: insertError } = await this.supabaseService.client
          .from('ata_itens')
          .insert(itens.map(item => ({
            ata_id: ataId,
            numero_item: item.numero_item,
            descricao: item.descricao,
            unidade: item.unidade || null,
            quantidade: item.quantidade,
            valor_unitario: item.valor_unitario,
          })));

        if (insertError) throw insertError;
      }

      await this.loadAtas(true);
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'AtaService.saveItens');
      return fail(err.message || 'Erro ao salvar itens');
    }
  }

  private mapRawToAta(raw: any): Ata {
    return {
      id: raw.id,
      numero_processo: raw.numero_processo ?? '',
      numero_ata: raw.numero_ata ?? '',
      objeto: raw.objeto ?? undefined,
      fornecedor_id: raw.fornecedor_id ?? undefined,
      fornecedor_nome: raw.fornecedor_nome ?? undefined,
      data_assinatura: raw.data_assinatura ? new Date(raw.data_assinatura) : undefined,
      vigencia_inicio: raw.vigencia_inicio ? new Date(raw.vigencia_inicio) : undefined,
      vigencia_fim: raw.vigencia_fim ? new Date(raw.vigencia_fim) : undefined,
      valor_global: Number(raw.valor_global) || 0,
      status: (raw.status as AtaStatus) || 'ATIVA',
      observacao: raw.observacao ?? undefined,
      qtd_itens: Number(raw.qtd_itens) || 0,
    };
  }

  private mapRawToItem(raw: any): AtaItem {
    return {
      id: raw.id,
      ata_id: raw.ata_id,
      numero_item: Number(raw.numero_item) || 0,
      descricao: raw.descricao ?? '',
      unidade: raw.unidade ?? undefined,
      quantidade: Number(raw.quantidade) || 0,
      valor_unitario: Number(raw.valor_unitario) || 0,
    };
  }
}
