import { inject, Injectable, signal, computed } from '@angular/core';
import { Dotacao, DotacaoPayload } from '../models/budget.model';
import { SupabaseService } from './supabase.service';
import { AppContextService } from './app-context.service';

@Injectable({
  providedIn: 'root'
})
export class BudgetService {
  private supabaseService = inject(SupabaseService);
  private appContext = inject(AppContextService);

  private _allBudgets = signal<Dotacao[]>([]);

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
    const { data, error } = await this.supabaseService.client
      .from('vw_saldo_dotacoes')
      .select('*');

    if (error) {
      console.error('Erro ao carregar todas as dotações:', error);
      throw error;
    }

    this._allBudgets.set((data || []).map((raw: any) => this.mapRawToDotacao(raw)));
  }

  /**
   * Retorna todas as dotações vinculadas a um contrato específico ignorando o filtro de ano.
   */
  async getBudgetsByContractId(contractId: string): Promise<Dotacao[]> {
    const { data, error } = await this.supabaseService.client
      .from('vw_saldo_dotacoes')
      .select('*')
      .eq('contract_id', contractId);

    if (error) {
      console.error('Erro ao buscar dotações do contrato:', error);
      throw error;
    }

    return (data || []).map((raw: any) => this.mapRawToDotacao(raw));
  }

  /**
   * Adiciona uma nova dotação vinculada a um contrato.
   */
  async addDotacao(payload: DotacaoPayload): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('dotacoes')
      .insert(payload);

    if (error) {
      console.error('Erro ao adicionar dotação:', error);
      throw error;
    }

    // Refresh global list
    await this.loadDotacoes();
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
    };
  }
}