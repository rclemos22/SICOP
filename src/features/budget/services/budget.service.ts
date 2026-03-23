import { inject, Injectable, signal, computed } from '@angular/core';
import { AppContextService } from '../../../core/services/app-context.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';

import { SupabaseService } from '../../../core/services/supabase.service';
import { Dotacao, DotacaoPayload } from '../../../shared/models/budget.model';
import { Result, ok, fail } from '../../../shared/models/result.model';

@Injectable({
  providedIn: 'root'
})
export class BudgetService {
  private supabaseService = inject(SupabaseService);
  private appContext = inject(AppContextService);
  private errorHandler = inject(ErrorHandlerService);

  private _allBudgets = signal<Dotacao[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Sinal reativo que filtra as dotações pelo ano de exercício selecionado.
   */
  readonly dotacoes = computed(() => {
    const selectedYear = this.appContext.anoExercicio();
    return this._allBudgets().filter(d => {
      const budgetDate = new Date(d.data_disponibilidade);
      return budgetDate.getFullYear() === selectedYear;
    });
  });

  /**
   * Cabelo global: busca todas as dotações da view vw_saldo_dotacoes sem filtros iniciais.
   */
  async loadDotacoes(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const { data, error } = await this.supabaseService.client
        .from('vw_saldo_dotacoes')
        .select('*');

      if (error) throw error;
      this._allBudgets.set((data || []).map((raw: any) => this.mapRawToDotacao(raw)));
    } catch (err: any) {
      this.errorHandler.handle(err, 'BudgetService.loadDotacoes');
      this._error.set(err.message || 'Erro ao carregar dotações');
      this._allBudgets.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Retorna todas as dotações vinculadas a um contrato específico ignorando o filtro de ano.
   */
  async getBudgetsByContractId(contractId: string): Promise<Result<Dotacao[]>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('vw_saldo_dotacoes')
        .select('*')
        .eq('contract_id', contractId);

      if (error) throw error;
      return ok((data || []).map((raw: any) => this.mapRawToDotacao(raw)));
    } catch (err: any) {
      this.errorHandler.handle(err, 'BudgetService.getBudgetsByContractId');
      return fail(err.message || 'Erro ao buscar dotações do contrato');
    }
  }

  /**
   * Adiciona uma nova dotação vinculada a um contrato.
   */
  async addDotacao(payload: DotacaoPayload): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('dotacoes')
        .insert(payload);

      if (error) throw error;

      await this.loadDotacoes();
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'BudgetService.addDotacao');
      return fail(err.message || 'Erro ao adicionar dotação');
    }
  }

  private mapRawToDotacao(raw: any): Dotacao {
    return {
      id: raw.id,
      contract_id: raw.contract_id,
      numero_contrato: raw.numero_contrato || '---',
      contratada: raw.contratada,
      dotacao: raw.dotacao,
      credito: raw.credito || '---',
      data_disponibilidade: raw.data_disponibilidade ? new Date(raw.data_disponibilidade) : new Date(),
      unid_gestora: raw.unid_gestora,
      valor_dotacao: Number(raw.valor_dotacao) || 0,
      total_empenhado: Number(raw.total_empenhado) || 0,
      total_cancelado: Number(raw.total_cancelado) || 0,
      total_pago: Number(raw.total_pago) || 0,
      saldo_disponivel: Number(raw.saldo_disponivel) || 0,
      nunotaempenho: raw.nunotaempenho || null,
    };
  }

  async updateDotacao(id: string, payload: Partial<DotacaoPayload>): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('dotacoes')
        .update(payload)
        .eq('id', id);

      if (error) throw error;
      await this.loadDotacoes();
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'BudgetService.updateDotacao');
      return fail(err.message || 'Erro ao atualizar dotação');
    }
  }

  async deleteDotacao(id: string): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('dotacoes')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await this.loadDotacoes();
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'BudgetService.deleteDotacao');
      return fail(err.message || 'Erro ao excluir dotação');
    }
  }
}