export type UnidadeOrcamentaria = '080901' | '080101';

export interface Dotacao {
  id: string;
  contract_id: string;
  numero_contrato: string;
  contratada: string;
  dotacao: string;
  credito: string;
  data_disponibilidade: Date;
  unid_gestora: string;
  valor_dotacao: number;
  total_empenhado?: number;
  total_cancelado?: number;
  total_pago?: number;
  saldo_disponivel?: number;
  nunotaempenho?: string;
  contract_type?: 'serviço' | 'material';
}

export interface DotacaoPayload {
  contract_id: string;
  numero_contrato: string;
  dotacao: string;
  credito: string;
  data_disponibilidade: string;
  unid_gestora: string;
  valor_dotacao: number;
  nunotaempenho?: string;
}

export interface NotaEmpenhoVinculada {
  nunotaempenho: string;
  cdunidadegestora: string;
  vlnotaempenho: number;
  dtlancamento: string;
  cdnaturezadespesa: string;
  dehistorico: string;
}

/**
 * Retorna label amigável para a unidade gestora
 */
export function getUnidadeLabel(codigo: string): string {
  switch (codigo) {
    case '080101':
      return 'DPEMA';
    case '080901':
      return 'FADEP';
    default:
      return codigo;
  }
}

/**
 * Calcula o saldo disponível da dotação.
 */
export function calcularSaldoDotacao(dotacao: Dotacao): number {
  return dotacao.saldo_disponivel ?? Math.max(0, dotacao.valor_dotacao - (dotacao.total_empenhado || 0) + (dotacao.total_cancelado || 0));
}

/**
 * Retorna classes CSS para badges de unidade orçamentária
 */
export function getUnidadeBadgeClass(unidade: string): string {
  switch (unidade) {
    case '080901':
      return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
    case '080101':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
    default:
      return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}