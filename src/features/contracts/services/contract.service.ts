import { Injectable, inject, signal, effect } from '@angular/core';
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
 * - Buscar todos os contratos do Supabase
 * - Carregar aditivos para calcular data_fim_efetiva
 * - Mapear dados brutos em objetos `Contract`
 * - Expor estado reativo via signals readonly
 */
@Injectable({
  providedIn: 'root'
})
export class ContractService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);
  private appContext = inject(AppContextService);

  // ── Estado Interno ──────────────────────────────────
  private _contracts = signal<Contract[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  // Cache de aditivos por contract_id
  private _aditivosCache = signal<Map<string, Aditivo[]>>(new Map());

  // ── Estado Público ────────────────────────────────────
  readonly contracts = this._contracts.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    // Reagir a mudanças no ano de exercício global
    effect(() => {
      const year = this.appContext.anoExercicio();
      this.loadContracts(year);
    });
  }

  // ── Data Fetching ───────────────────────────────────────────────────────

  private async fetchContracts(year: number) {
    try {
      console.log(`[ContractService] Buscando contratos para o ano ${year}...`);
      // Consultamos a tabela contratos diretamente para garantir acesso a todos os relacionamentos
      // sem depender de views que podem estar desatualizadas ou sem as colunas financeiras.
      const { data, error } = await this.supabaseService.client
        .from('contratos')
        .select(`
          *,
          fornecedores:fornecedor_id(razao_social),
          setores:setor_id(nome),
          dotacoes(*)
        `)
        .neq('status', 'EXCLUIDO');

      if (error) throw error;
      return { data, error: null };
    } catch (err) {
      console.error('[ContractService] Erro na query de contratos:', err);
      return { data: [], error: null };
    }
  }

  private async fetchAllAditivos() {
    try {
      const { data, error } = await this.supabaseService.client
        .from('aditivos')
        .select('*, tipo_aditivo(nome)')
        .returns<any[]>();
      
      if (error) {
        console.warn('Erro ao carregar aditivos:', error.message);
        return new Map<string, Aditivo[]>();
      }

      const map = new Map<string, Aditivo[]>();
      (data || []).forEach((raw: any) => {
        const aditivo = this.mapRawToAditivo(raw);
        const existing = map.get(aditivo.contract_id) || [];
        existing.push(aditivo);
        map.set(aditivo.contract_id, existing);
      });
      
      return map;
    } catch (err) {
      console.warn('Exceção ao carregar aditivos:', err);
      return new Map<string, Aditivo[]>();
    }
  }

  async loadContracts(year?: number): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      let rawContracts: any[] = [];
      let aditivosMap = new Map<string, Aditivo[]>();

      const targetYear = year || this.appContext.anoExercicio();
      const contractsResult = await this.fetchContracts(targetYear);
      rawContracts = contractsResult.data || [];

      aditivosMap = await this.fetchAllAditivos();
      this._aditivosCache.set(aditivosMap);

      const contracts = rawContracts.map((raw: any) => {
        const aditivosDoContrato = aditivosMap.get(raw.id) || [];
        return this.mapRawToContract(raw, aditivosDoContrato, targetYear);
      });

      this._contracts.set(contracts);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.loadContracts');
      this._error.set(err.message || 'Erro ao carregar contratos');
      this._contracts.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  getContractById(id: string): Contract | undefined {
    return this.contracts().find(c => c.id === id || c.contrato === id);
  }

  /**
   * Atualiza um contrato específico no sinal local para refletir mudanças instantaneamente na UI.
   */
  updateContractInSignal(contractId: string, updates: Partial<Contract>) {
    this._contracts.update(current => 
      current.map(c => c.id === contractId ? { ...c, ...updates } : c)
    );
  }

  /**
   * Busca aditivos de um contrato, tipados e ordenados.
   */
  async getAditivosPorContractId(contractId: string): Promise<Result<Aditivo[]>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('aditivos')
        .select('*, tipo_aditivo(nome)')
        .eq('contract_id', contractId)
        .order('data_assinatura', { ascending: false });

      if (error) throw error;

      const aditivos = (data || []).map((raw: any) => this.mapRawToAditivo(raw));
      return ok(aditivos);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.getAditivosPorContractId');
      return fail(err.message || 'Erro ao carregar aditivos');
    }
  }

  async addAditivo(aditivo: Partial<Aditivo>): Promise<Result<Aditivo>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('aditivos')
        .insert(aditivo)
        .select('*, tipo_aditivo(nome)')
        .single();

      if (error) throw error;

      await this.loadContracts(); // Atualiza a dashboard e cache central

      const newAditivo = this.mapRawToAditivo(data);
      return ok(newAditivo);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.addAditivo');
      return fail(err.message || 'Erro ao adicionar aditivo');
    }
  }

  async updateAditivo(id: string, aditivo: Partial<Aditivo>): Promise<Result<Aditivo>> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('aditivos')
        .update(aditivo)
        .eq('id', id)
        .select('*, tipo_aditivo(nome)')
        .single();

      if (error) throw error;

      await this.loadContracts(); // Atualiza a dashboard e cache central

      const updatedAditivo = this.mapRawToAditivo(data);
      return ok(updatedAditivo);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.updateAditivo');
      return fail(err.message || 'Erro ao atualizar aditivo');
    }
  }

  async deleteAditivo(id: string): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('aditivos')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await this.loadContracts(); // Atualiza a dashboard e cache central

      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.deleteAditivo');
      return fail(err.message || 'Erro ao excluir aditivo');
    }
  }

  // ── Mappers Privados ────────────────────────

  private mapRawToContract(raw: any, aditivos: Aditivo[] = [], selectedYear?: number): Contract {
    const dataFimOriginal = this.parseDate(raw.data_fim);

    // Agregar valores das dotações (filtrando por ano se fornecido)
    let totalEmpenhado = 0;
    let totalPago = 0;
    let dataUltimoPagamento: Date | undefined = undefined;

    if (raw.dotacoes && Array.isArray(raw.dotacoes)) {
      raw.dotacoes.forEach((d: any) => {
        // As dotações podem vir da tabela dotacoes via join
        const budgetYear = d.ano || (d.data_disponibilidade ? new Date(d.data_disponibilidade).getFullYear() : null);
        
        // Se temos um ano selecionado, só somamos as dotações daquele ano
        // Caso contrário, somamos tudo (all-time) para consistência histórica
        if (!selectedYear || budgetYear === selectedYear) {
          totalEmpenhado += Number(d.total_empenhado) || 0;
          totalPago += Number(d.total_pago) || 0;
          
          const upDate = d.updated_at || d.data_ultimo_pagamento;
          if (upDate) {
            const up = new Date(upDate);
            if (!dataUltimoPagamento || up > dataUltimoPagamento) {
              dataUltimoPagamento = up;
            }
          }
        }
      });
    }
    
    // Filtrar aditivos que alteram vigência (Prorrogação/Prazo)
    const aditivosComVigencia = aditivos
      .filter(a => {
        const tipoUpper = (a.tipo || '').toUpperCase();
        const hasNovaVigencia = !!a.nova_vigencia;
        const isTipoPrazo = tipoUpper.includes('PRAZO') || tipoUpper === 'PRORROGACAO' || tipoUpper.includes('PRAZO');
        return hasNovaVigencia && isTipoPrazo;
      })
      .sort((a, b) => (b.nova_vigencia?.getTime() || 0) - (a.nova_vigencia?.getTime() || 0));
    
    // Calcular Valor Global Atualizado (Original + Sum of Aditivos de Valor)
    const totalAditivosValor = aditivos
      .filter(a => {
        const tipoUpper = (a.tipo || '').toUpperCase();
        return tipoUpper.includes('VALOR') && a.valor_aditivo != null;
      })
      .reduce((acc, current) => acc + (current.valor_aditivo || 0), 0);

    const valorGlobalAtualizado = this.parseNumeric(raw.valor_anual) + totalAditivosValor;

    let dataFimEfetiva: Date;
    let diasRestantes: number;
    
    if (aditivosComVigencia.length > 0 && aditivosComVigencia[0].nova_vigencia) {
      dataFimEfetiva = aditivosComVigencia[0].nova_vigencia;
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const dataFimZero = new Date(dataFimEfetiva);
      dataFimZero.setHours(0, 0, 0, 0);
      
      const diffTime = dataFimZero.getTime() - hoje.getTime();
      diasRestantes = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    } else {
      dataFimEfetiva = raw.data_fim_efetiva ? this.parseDate(raw.data_fim_efetiva) : dataFimOriginal;
      if (raw.dias_restantes != null) {
        diasRestantes = Number(raw.dias_restantes);
      } else {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const dataFimZero = new Date(dataFimEfetiva);
        dataFimZero.setHours(0, 0, 0, 0);
        
        const diffTime = dataFimZero.getTime() - hoje.getTime();
        diasRestantes = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
    }

    // Usar utilitário do model para garantir consistência no status
    // Importante: Pick de status para satisfazer a interface
    const statusEfetivo = (raw.status === 'RESCINDIDO') ? ContractStatus.RESCINDIDO 
      : (raw.status === 'ENCERRADO') ? ContractStatus.ENCERRADO
      : (raw.status === 'VIGENTE' && diasRestantes <= 90) ? ContractStatus.FINALIZANDO
      : ContractStatus.VIGENTE;

    return {
      id: raw.id,
      contrato: raw.contrato ?? '',
      processo_sei: raw.processo_sei ?? undefined,
      link_sei: raw.link_sei ?? undefined,
      contratada: raw.contratada ?? raw.fornecedores?.razao_social ?? raw.razao_social ?? '',
      cnpj_contratada: raw.cnpj_contratada ?? raw.cnpj ?? undefined,
      fornecedor_id: raw.fornecedor_id ?? undefined,
      fornecedor_nome: raw.fornecedores?.razao_social ?? raw.fornecedor_nome ?? undefined,
      data_inicio: this.parseDate(raw.data_inicio),
      data_fim: dataFimOriginal,
      data_pagamento: raw.data_pagamento != null ? Number(raw.data_pagamento) : undefined,
      valor_anual: this.parseNumeric(raw.valor_anual),
      status: (raw.status as ContractStatus) || ContractStatus.VIGENTE,
      tipo: raw.tipo as 'serviço' | 'material' | undefined,
      setor_id: raw.setor_id ?? raw.setor ?? undefined,
      setor_nome: raw.setores?.nome ?? raw.setor_nome ?? undefined,
      unid_gestora: raw.unid_gestora ?? undefined,
      objeto: raw.objeto ?? raw.descricao ?? undefined,
      gestor_contrato: raw.gestor_contrato ?? raw.gestor ?? undefined,
      fiscal_admin: raw.fiscal_admin ?? raw.fiscal_administrativo ?? undefined,
      fiscal_tecnico: raw.fiscal_tecnico ?? undefined,
      data_fim_efetiva: dataFimEfetiva,
      dias_restantes: diasRestantes,
      status_efetivo: statusEfetivo,
      total_empenhado: totalEmpenhado,
      total_pago: totalPago,
      saldo_a_pagar: totalEmpenhado - totalPago,
      data_ultimo_pagamento: dataUltimoPagamento || (raw.data_ultimo_pagamento ? this.parseDate(raw.data_ultimo_pagamento) : undefined),
      valor_mensal: raw.valor_mensal != null ? this.parseNumeric(raw.valor_mensal) : undefined,
      valor_global_atualizado: valorGlobalAtualizado,
      total_aditivos_valor: totalAditivosValor,
      parcelas_pagas_manual: Array.isArray(raw.parcelas_pagas_manual) ? raw.parcelas_pagas_manual : 
                            (raw.parcelas_pagas_manual ? [raw.parcelas_pagas_manual] : [])
    };
  }

  private calculateEffectiveStatus(status: string, diasRestantes: number): ContractStatus {
    if (status === ContractStatus.RESCINDIDO) return ContractStatus.RESCINDIDO;
    if (diasRestantes <= 90) return ContractStatus.FINALIZANDO;
    return ContractStatus.VIGENTE;
  }

  private mapRawToAditivo(raw: any): Aditivo {
    const tipo = raw.tipo_aditivo?.nome || raw.tipo || 'ALTERACAO';
    return {
      id: raw.id,
      contract_id: raw.contract_id ?? '',
      numero_contrato: raw.numero_contrato ?? undefined,
      numero_aditivo: raw.numero_aditivo ?? '',
      tipo: tipo,
      tipo_id: raw.tipo_id ?? undefined,
      data_assinatura: raw.data_assinatura ? this.parseDate(raw.data_assinatura) : undefined,
      nova_vigencia: raw.nova_vigencia ? this.parseDate(raw.nova_vigencia) : undefined,
      valor_aditivo: raw.valor_aditivo != null ? this.parseNumeric(raw.valor_aditivo) : undefined,
      novo_valor_mensal: raw.novo_valor_mensal != null ? this.parseNumeric(raw.novo_valor_mensal) : undefined,
      data_inicio_novo: raw.data_inicio_novo ? this.parseDate(raw.data_inicio_novo) : undefined
    };
  }

  // ── CRUD Operações de Contrato ─────────────────────────────────────────────────────

  async addContract(contract: Partial<Contract>): Promise<Result<null>> {
    try {
      const { error } = await this.supabaseService.client
        .from('contratos')
        .insert(contract as any);

      if (error) throw error;
      await this.loadContracts();
      return ok(null);
    } catch (err: any) {
      this.errorHandler.handle(err, 'ContractService.addContract');
      return fail(err.message || 'Erro ao adicionar contrato');
    }
  }

  async updateContract(id: string, contract: Partial<Contract>): Promise<Result<null>> {
    console.log('[ContractService.updateContract] Starting update for id:', id);
    console.log('[ContractService.updateContract] Data to update:', JSON.stringify(contract, null, 2));
    
    try {
      // Filter out undefined values and only keep valid columns
      const updateData: any = {};
      const allowedFields = [
        'contrato', 'processo_sei', 'link_sei', 'contratada', 'cnpj_contratada', 'fornecedor_id',
        'data_inicio', 'data_fim', 'data_pagamento', 'valor_anual', 'valor_mensal', 'status',
        'setor_id', 'unid_gestora', 'objeto', 'gestor_contrato', 'fiscal_admin', 'fiscal_tecnico', 'tipo',
        'total_empenhado', 'total_pago', 'saldo_a_pagar', 'data_ultimo_pagamento'
      ];
      
      for (const key of allowedFields) {
        if (contract[key] !== undefined) {
          updateData[key] = contract[key];
        }
      }
      
      console.log('[ContractService.updateContract] Filtered update data:', JSON.stringify(updateData, null, 2));
      
      const { error } = await this.supabaseService.client
        .from('contratos')
        .update(updateData)
        .eq('id', id);

      if (error) {
        console.error('[ContractService.updateContract] Supabase error:', error);
        throw error;
      }
      
      console.log('[ContractService.updateContract] Update successful');
      await this.loadContracts();
      return ok(null);
    } catch (err: any) {
      console.error('[ContractService.updateContract] Caught error:', err);
      this.errorHandler.handle(err, 'ContractService.updateContract');
      return fail(err.message || 'Erro ao atualizar contrato');
    }
  }

  private parseDate(value: any): Date {
    return value ? new Date(value) : new Date();
  }

  private parseNumeric(value: any): number {
    return Number(value) || 0;
  }
}