/**
 * @fileoverview Modelo de dados de Contratos do SICOP.
 *
 * As interfaces refletem diretamente as colunas do banco de dados Supabase.
 * Propriedades computadas (`daysRemaining`, `statusEfetivo`) são calculadas
 * uma única vez no mapper do service e consumidas como leitura pelos componentes.
 */

// ─── Enums & Types ───────────────────────────────────────────────────────────

export enum ContractStatus {
  VIGENTE = 'VIGENTE',
  RESCINDIDO = 'RESCINDIDO',
  FINALIZANDO = 'FINALIZANDO',
  ENCERRADO = 'ENCERRADO'
}

export type TipoAditivo = 'ALTERACAO' | 'PRORROGACAO' | 'ADITIVO_PRAZO' | 'ADITIVO_PRAZO_VALOR' | 'ADITIVO_VALOR' | 'ADITIVO_OBJETO' | 'DISTRATO';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface Aditivo {
  id?: string;
  contract_id: string;
  numero_contrato?: string;
  numero_aditivo: string;
  tipo: TipoAditivo;
  tipo_id?: string;
  data_assinatura?: Date;
  nova_vigencia?: Date;
  valor_aditivo?: number;
  novo_valor_mensal?: number;
  data_inicio_novo?: Date;
}



export interface Contract {
  id: string;
  contrato: string;
  processo_sei?: string;
  link_sei?: string;
  contratada: string;
  cnpj_contratada?: string;
  fornecedor_id?: string;
  fornecedor_nome?: string;
  data_inicio: Date;
  data_fim: Date;
  data_pagamento?: number; // Dia do mês para controle de pagamentos (1-31)
  valor_anual: number;
  status: ContractStatus;
  setor_id: string;
  setor_nome?: string;
  unid_gestora: string;
  objeto: string;
  gestor_contrato?: string;
  fiscal_admin?: string;
  fiscal_tecnico?: string;
  data_fim_efetiva?: Date;
  dias_restantes?: number;
  status_efetivo?: ContractStatus;
  tipo?: 'serviço' | 'material';
  total_empenhado?: number;
  total_pago?: number;
  saldo_a_pagar?: number;
  data_ultimo_pagamento?: Date;
  valor_mensal?: number;
  valor_global_atualizado?: number;
  total_aditivos_valor?: number;
}

// ─── Funções Utilitárias ─────────────────────────────────────────────────────


/**
 * Determina o status efetivo do contrato conforme regras de negócio.
 *
 * **Regra de Negócio — Gatilho de 90 dias:**
 * Contratos vigentes cujo término é ≤ 90 dias recebem o status visual
 * `FINALIZANDO` para alertar a equipe sobre a necessidade de renovação
 * ou nova licitação. Contratos rescindidos mantêm seu status original
 * independentemente dos dias restantes.
 *
 * @param contract - Contrato a ser avaliado.
 * @param daysRemaining - Dias restantes até o término (pré-calculado).
 * @returns O status efetivo para exibição na UI.
 */
export function getEffectiveStatus(contract: Pick<Contract, 'status'>, daysRemaining: number): ContractStatus {
  if (contract.status === ContractStatus.RESCINDIDO) {
    return ContractStatus.RESCINDIDO;
  }

  if (daysRemaining < 0) {
    return ContractStatus.ENCERRADO;
  }

  if (daysRemaining <= 90) {
    return ContractStatus.FINALIZANDO;
  }

  return ContractStatus.VIGENTE;
}