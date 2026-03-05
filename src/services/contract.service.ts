import { Injectable, signal, computed, inject, effect } from '@angular/core';
import {
  Contract, ContractStatus, Aditivo, Dotacao, Result,
  calculateDaysRemaining, getEffectiveStatus
} from '../models/contract.model';
import { SupabaseService } from './supabase.service';
import { AppContextService } from './app-context.service';

/**
 * @description Serviço central de contratos do SICOP.
 *
 * Responsabilidades:
 * - Buscar contratos filtrados pelo ano de exercício (server-side via Supabase)
 * - Mapear dados brutos em objetos `Contract` imutáveis
 * - Expor estado reativo via signals readonly
 * - Fornecer busca de aditivos e dotações por contrato
 *
 * @usageNotes
 * Os sinais `contracts`, `loading` e `error` são **somente leitura**.
 * Use `loadContracts()` para forçar um reload manual se necessário.
 */
@Injectable({
  providedIn: 'root'
})
export class ContractService {
  private supabaseService = inject(SupabaseService);
  private appContext = inject(AppContextService);

  // ── Estado Interno (privado e mutável) ──────────────────────────────────

  private _contracts = signal<Contract[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  // ── Estado Público (somente leitura) ────────────────────────────────────

  /** Lista de contratos do ano de exercício atual */
  readonly contracts = this._contracts.asReadonly();

  /** Indica se uma busca está em andamento */
  readonly loading = this._loading.asReadonly();

  /** Mensagem de erro da última operação, ou null se sucesso */
  readonly error = this._error.asReadonly();

  constructor() {
    /**
     * Efeito reativo: recarrega contratos automaticamente sempre que
     * o ano de exercício muda no AppContextService.
     */
    effect(() => {
      const ano = this.appContext.anoExercicio();
      this.loadContracts(ano);
    });
  }

  // ── Data Fetching ───────────────────────────────────────────────────────

  /**
   * Busca contratos do Supabase filtrados pelo ano de exercício.
   * A filtragem é feita **server-side** para reduzir payload.
   *
   * @param ano - Ano de exercício para filtrar (default: ano atual do contexto)
   */
  async loadContracts(ano?: number): Promise<void> {
    const anoExercicio = ano ?? this.appContext.anoExercicio();
    const inicioAno = `${anoExercicio}-01-01`;
    const fimAno = `${anoExercicio}-12-31`;

    this._loading.set(true);
    this._error.set(null);

    try {
      const { data, error } = await this.supabaseService.client
        .from('contratos')
        .select('*')
        .gte('data_inicio', inicioAno)
        .lte('data_inicio', fimAno);

      if (error) throw error;

      const contracts = (data || []).map((raw: any) => this.mapRawToContract(raw));
      this._contracts.set(contracts);
    } catch (err: any) {
      console.error('Erro ao buscar contratos:', err);
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
   * @param numeroContrato - Número do contrato (ex: "124/2024")
   * @returns Result tipado com array de Aditivo ou mensagem de erro.
   */
  async getAditivosPorContrato(numeroContrato: string): Promise<Result<Aditivo[]>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('aditivos')
        .select('*')
        .eq('numero_contrato', numeroContrato)
        .order('data_assinatura', { ascending: false });

      if (error) throw error;

      const aditivos: Aditivo[] = (data || []).map((raw: any) => this.mapRawToAditivo(raw));

      return { data: aditivos, error: null };
    } catch (err: any) {
      console.error('Erro ao buscar aditivos:', err);
      return { data: null, error: err.message || 'Erro ao carregar aditivos' };
    }
  }

  /**
   * Busca dotações de um contrato.
   *
   * @param numeroContrato - Número do contrato.
   * @returns Result tipado com array de Dotacao ou mensagem de erro.
   */
  async getDotacoesPorContrato(numeroContrato: string): Promise<Result<Dotacao[]>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('dotacoes')
        .select('*')
        .eq('numero_contrato', numeroContrato);

      if (error) throw error;

      const dotacoes: Dotacao[] = (data || []).map((raw: any) => ({
        id: raw.id,
        dotacao: raw.dotacao ?? '',
        numero_contrato: raw.numero_contrato ?? '',
        unid_gestora: raw.unid_gestora ?? '',
        valor_dotacao: this.parseNumeric(raw.valor_dotacao)
      }));

      return { data: dotacoes, error: null };
    } catch (err: any) {
      console.error('Erro ao buscar dotações:', err);
      return { data: null, error: err.message || 'Erro ao carregar dotações' };
    }
  }

  // ── Mappers Privados (Data Transformation Layer) ────────────────────────

  /**
   * Converte um registro bruto do Supabase em um objeto `Contract` imutável.
   * Centraliza tratamento de nulos, parsing de datas e cálculo de campos derivados.
   */
  private mapRawToContract(raw: any): Contract {
    const dataFim = this.parseDate(raw.data_fim);
    const daysRemaining = calculateDaysRemaining(dataFim);
    const status = (raw.status as ContractStatus) || ContractStatus.VIGENTE;

    const contract: Contract = {
      id: raw.id,
      contrato: raw.contrato ?? '',
      contratada: raw.contratada ?? '',
      data_inicio: this.parseDate(raw.data_inicio),
      data_fim: dataFim,
      valor_anual: this.parseNumeric(raw.valor_anual),
      status,
      setor_id: raw.setor_id ?? undefined,
      objeto: raw.objeto ?? undefined,
      daysRemaining,
      statusEfetivo: getEffectiveStatus({ status }, daysRemaining)
    };

    return contract;
  }

  /**
   * Converte um registro bruto de aditivo em um objeto `Aditivo` tipado.
   */
  private mapRawToAditivo(raw: any): Aditivo {
    return {
      id: raw.id,
      numero_contrato: raw.numero_contrato ?? '',
      numero_aditivo: raw.numero_aditivo ?? '',
      tipo: raw.tipo ?? 'ALTERACAO',
      data_assinatura: raw.data_assinatura ? this.parseDate(raw.data_assinatura) : undefined,
      nova_vigencia: raw.nova_vigencia ? this.parseDate(raw.nova_vigencia) : undefined,
      valor_aditivo: raw.valor_aditivo != null ? this.parseNumeric(raw.valor_aditivo) : undefined
    };
  }

  // ── Helpers de Parsing ──────────────────────────────────────────────────

  private parseDate(value: any): Date {
    return value ? new Date(value) : new Date();
  }

  private parseNumeric(value: any): number {
    return Number(value) || 0;
  }
}