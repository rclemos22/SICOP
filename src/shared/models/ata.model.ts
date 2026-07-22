export type AtaStatus = 'ATIVA' | 'VENCIDA' | 'SUSPENSA' | 'CANCELADA' | 'ENCERRADA';

export interface Ata {
  id: string;
  numero_processo: string;
  numero_ata: string;
  objeto?: string;
  fornecedor_id?: string;
  fornecedor_nome?: string;
  data_assinatura?: Date;
  vigencia_inicio?: Date;
  vigencia_fim?: Date;
  valor_global: number;
  status: AtaStatus;
  observacao?: string;
  qtd_itens?: number;
  itens?: AtaItem[];
}

export interface AtaItem {
  id?: string;
  ata_id?: string;
  numero_item: number;
  descricao: string;
  unidade?: string;
  quantidade: number;
  valor_unitario: number;
}

export function getAtaStatusLabel(status: AtaStatus): string {
  switch (status) {
    case 'ATIVA': return 'Ativa';
    case 'VENCIDA': return 'Vencida';
    case 'SUSPENSA': return 'Suspensa';
    case 'CANCELADA': return 'Cancelada';
    case 'ENCERRADA': return 'Encerrada';
    default: return status;
  }
}

export function getAtaStatusClass(status: AtaStatus): string {
  switch (status) {
    case 'ATIVA': return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
    case 'VENCIDA': return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
    case 'SUSPENSA': return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800';
    case 'CANCELADA': return 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700';
    case 'ENCERRADA': return 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    default: return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

// ----- Saldo e Consumo -----

export type AdesaoStatus = 'PENDENTE' | 'AUTORIZADA' | 'REJEITADA' | 'CANCELADA';

export interface AtaConsumoInterno {
  id?: string;
  ata_id: string;
  ata_item_id: string;
  quantidade: number;
  documento_sei?: string;
  data_consumo: string;
  observacao?: string;
  created_at?: string;
}

export interface AtaAdesao {
  id?: string;
  ata_id: string;
  ata_item_id: string;
  cnpj_orgao: string;
  razao_orgao: string;
  processo_sei?: string;
  quantidade_solicitada: number;
  quantidade_autorizada?: number;
  status: AdesaoStatus;
  data_solicitacao: string;
  data_resposta?: string;
  justificativa?: string;
  created_at?: string;
}

export interface SaldoItem {
  item_id: string;
  ata_id: string;
  numero_item: number;
  descricao_item: string;
  unidade?: string;
  quantidade_registrada: number;
  valor_unitario: number;
  quantidade_consumida_interna: number;
  quantidade_aderida: number;
  saldo_disponivel: number;
  // Saldo disponível para consumo próprio pelo órgão gerenciador (até 100% do registrado)
  saldo_consumo_interno: number;
  // Saldo total disponível para adesões (limite coletivo 200% - já aderido)
  saldo_adesao_total: number;
  percentual_utilizado: number;
  numero_ata: string;
  numero_processo: string;
  ata_status: string;
  // Limites legais (Art. 86, Lei 14.133/2021)
  limite_individual?: number;
  limite_coletivo?: number;
  saldo_adesao?: number;
}

export interface SaldoResumo {
  ata_id: string;
  numero_ata: string;
  numero_processo: string;
  ata_status: string;
  total_itens: number;
  total_quantidade_registrada: number;
  total_quantidade_consumida: number;
  total_quantidade_aderida: number;
  total_saldo_disponivel: number;
  total_saldo_consumo_interno: number;
  total_saldo_adesao_total: number;
  percentual_geral: number;
}

export function getAdesaoStatusLabel(status: AdesaoStatus): string {
  switch (status) {
    case 'PENDENTE': return 'Pendente';
    case 'AUTORIZADA': return 'Autorizada';
    case 'REJEITADA': return 'Rejeitada';
    case 'CANCELADA': return 'Cancelada';
    default: return status;
  }
}

export function getAdesaoStatusClass(status: AdesaoStatus): string {
  switch (status) {
    case 'PENDENTE': return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800';
    case 'AUTORIZADA': return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
    case 'REJEITADA': return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
    case 'CANCELADA': return 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700';
    default: return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}
