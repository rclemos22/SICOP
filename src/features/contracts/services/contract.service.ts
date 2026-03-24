import { Injectable, signal, inject } from '@angular/core';
import { AppContextService } from '../../../core/services/app-context.service';

import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Dotacao } from '../../../shared/models/budget.model';
import {
  Contract, ContractStatus, Aditivo
} from '../../../shared/models/contract.model';
import { Result, ok, fail } from '../../../shared/models/result.model';

/**
 * @description Serviço central de contratos do SICOP.
 *
 * Responsabilidades:
 * - Buscar todos os contratos do Supabase (filtragem por exercício é client-side)
 * - Carregar aditivos PRORROGACAO em batch para calcular `data_fim_efetiva`
 * - Mapear dados brutos em objetos `Contract` imutáveis
 * - Expor estado reativo via signals readonly
 *
 * @usageNotes
 * A filtragem por ano de exercício é feita nos **componentes** via `computed`,
 * usando sobreposição de intervalos: `(data_inicio <= fimAno) && (data_fim_efetiva >= inicioAno)`.
 * Isso permite que um contrato vigente de 2024 a 2026 apareça em 2024, 2025 e 2026.
 */
@Injectable({
  providedIn: 'root'
})
export class ContractService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);

  // ── Estado Interno (privado e mutável) ──────────────────────────────────

  private _contracts = signal<Contract[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  // ── Estado Público (somente leitura) ────────────────────────────────────

  /** Lista completa de contratos (sem filtro de ano — componentes filtram) */
  readonly contracts = this._contracts.asReadonly();

  /** Indica se uma busca está em andamento */
  readonly loading = this._loading.asReadonly();

  /** Mensagem de erro da última operação, ou null se sucesso */
  readonly error = this._error.asReadonly();

  constructor() {
    // Carrega todos os contratos uma única vez na inicialização
    this.loadContracts();
  }

  // ── Data Fetching ───────────────────────────────────────────────────────

  /**
   * Busca TODOS os contratos a partir da view vw_contratos_vigencia.
   * A view já calcula `data_fim_efetiva`, `dias_restantes` e `status_efetivo`.
   */
  private async fetchContracts() {
    return this.supabaseService.client
      .from('vw_contratos_vigencia')
      .select('*');
  }

  async loadContracts(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const { data: rawContracts, error: contractsError } = await this.fetchContracts();

      if (contractsError) throw contractsError;

      const contracts = (rawContracts || []).map((raw: any) =>
        this.mapRawToContract(raw)
      );

      this._contracts.set(contracts);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.loadContracts');
      this._error.set(err.message || 'Erro ao carregar contratos');
      this._contracts.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Busca um contrato por ID ou número.
   */
  getContractById(id: string): Contract | undefined {
    return this.contracts().find(c => c.id === id || c.contrato === id);
  }

  /**
   * Busca aditivos de um contrato, tipados e ordenados por data de assinatura
   * (mais recente primeiro).
   *
   * @param contractId - ID do contrato (UUID)
   * @returns Result tipado com array de Aditivo ou mensagem de erro.
   */
  async getAditivosPorContractId(contractId: string): Promise<Result<Aditivo[]>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('aditivos')
        .select('*')
        .eq('contract_id', contractId)
        .order('data_assinatura', { ascending: false });

      if (error) throw error;

      const aditivos: Aditivo[] = (data || []).map((raw: any) => this.mapRawToAditivo(raw));

      return ok(aditivos);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.getAditivosPorContractId');
      return fail(err.message || 'Erro ao carregar aditivos');
    }
  }



  /**
   * Adiciona um novo aditivo ao Supabase.
   */
  async addAditivo(aditivo: Partial<Aditivo>): Promise<Result<Aditivo>> {
    console.log('ContractService.addAditivo - inserting:', aditivo);
    try {
      const { data, error } = await this.supabaseService.client
        .from('aditivos')
        .insert(aditivo)
        .select()
        .single();

      console.log('ContractService.addAditivo - result:', { data, error });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      const newAditivo = this.mapRawToAditivo(data);
      console.log('ContractService.addAditivo - mapped:', newAditivo);
      return ok(newAditivo);
    } catch (err: any) {
      console.error('ContractService.addAditivo - catch error:', err);
      this.errorHandler.handle(err, 'ContractService.addAditivo');
      return fail(err.message || 'Erro ao adicionar aditivo');
    }
  }

  /**
   * Atualiza um aditivo existente no Supabase.
   */
  async updateAditivo(id: string, aditivo: Partial<Aditivo>): Promise<Result<Aditivo>> {
    console.log('ContractService.updateAditivo - updating:', id, aditivo);
    try {
      const { data, error } = await this.supabaseService.client
        .from('aditivos')
        .update(aditivo)
        .eq('id', id)
        .select()
        .single();

      console.log('ContractService.updateAditivo - result:', { data, error });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      const updatedAditivo = this.mapRawToAditivo(data);
      return ok(updatedAditivo);
    } catch (err: any) {
      console.error('ContractService.updateAditivo - catch error:', err);
      this.errorHandler.handle(err, 'ContractService.updateAditivo');
      return fail(err.message || 'Erro ao atualizar aditivo');
    }
  }

  /**
   * Exclui um aditivo do Supabase.
   */
  async deleteAditivo(id: string): Promise<Result<null>> {
    console.log('ContractService.deleteAditivo - deleting:', id);
    try {
      const { error } = await this.supabaseService.client
        .from('aditivos')
        .delete()
        .eq('id', id);

      console.log('ContractService.deleteAditivo - result:', { error });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      return ok(null);
    } catch (err: any) {
      console.error('ContractService.deleteAditivo - catch error:', err);
      this.errorHandler.handle(err, 'ContractService.deleteAditivo');
      return fail(err.message || 'Erro ao excluir aditivo');
    }
  }

  // ── Mappers Privados (Data Transformation Layer) ────────────────────────

  /**
   * Converte um registro bruto da view vw_contratos_vigencia em um objeto `Contract`.
   */
  private mapRawToContract(raw: any): Contract {
    return {
      id: raw.id,
      contrato: raw.contrato ?? '',
      contratada: raw.contratada ?? '',
      fornecedor_id: raw.fornecedor_id ?? undefined,
      data_inicio: this.parseDate(raw.data_inicio),
      data_fim: this.parseDate(raw.data_fim),
      valor_anual: this.parseNumeric(raw.valor_anual),
      status: (raw.status as ContractStatus) || ContractStatus.VIGENTE,
      setor_id: raw.setor_id ?? undefined,
      unid_gestora: raw.unid_gestora ?? undefined,
      objeto: raw.objeto ?? undefined,
      gestor_contrato: raw.gestor_contrato ?? undefined,
      fiscal_admin: raw.fiscal_admin ?? undefined,
      fiscal_tecnico: raw.fiscal_tecnico ?? undefined,
      data_fim_efetiva: raw.data_fim_efetiva ? this.parseDate(raw.data_fim_efetiva) : undefined,
      dias_restantes: raw.dias_restantes != null ? Number(raw.dias_restantes) : undefined,
      status_efetivo: (raw.status_efetivo as ContractStatus) || undefined
    };
  }

  /**
   * Converte um registro bruto de aditivo em um objeto `Aditivo` tipado.
   */
  private mapRawToAditivo(raw: any): Aditivo {
    return {
      id: raw.id,
      contract_id: raw.contract_id ?? '',
      numero_aditivo: raw.numero_aditivo ?? '',
      tipo: raw.tipo ?? 'ALTERACAO',
      data_assinatura: raw.data_assinatura ? this.parseDate(raw.data_assinatura) : undefined,
      nova_vigencia: raw.nova_vigencia ? this.parseDate(raw.nova_vigencia) : undefined,
      valor_aditivo: raw.valor_aditivo != null ? this.parseNumeric(raw.valor_aditivo) : undefined
    };
  }

  // ── CRUD Operations ─────────────────────────────────────────────────────

  async addContract(contract: Partial<Contract>): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('contratos')
        .insert(contract);

      if (error) throw error;

      await this.loadContracts();
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.addContract');
      return fail(err.message || 'Erro ao adicionar contrato');
    }
  }

  async updateContract(id: string, contract: Partial<Contract>): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('contratos')
        .update(contract)
        .eq('id', id);

      if (error) throw error;

      await this.loadContracts();
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.updateContract');
      return fail(err.message || 'Erro ao atualizar contrato');
    }
  }

  // ── Helpers de Parsing ──────────────────────────────────────────────────

  private parseDate(value: any): Date {
    return value ? new Date(value) : new Date();
  }

  private parseNumeric(value: any): number {
    return Number(value) || 0;
  }
}