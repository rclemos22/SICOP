export enum TransactionType {
  LIQUIDATION = 'LIQUIDATION',     // Pagamento (Seta baixo, Vermelho)
  COMMITMENT = 'COMMITMENT',       // Empenho (Seta cima, Verde)
  REINFORCEMENT = 'REINFORCEMENT', // Reforço (Soma, Azul)
  CANCELLATION = 'CANCELLATION'    // Cancelamento (Bloqueio, Amarelo)
}

export interface Transaction {
  id: string;
  contract_id: string;
  description: string;
  commitment_id: string;
  date: Date;
  type: TransactionType;
  amount: number;
  department: string;
  budget_description: string;
  nunotaempenho?: string;
  dotacao_id?: string;
}

// Helpers for UI logic (Icons, Colors, Labels) based on Type

export function getTransactionTypeLabel(type: TransactionType): string {
  switch (type) {
    case TransactionType.LIQUIDATION: return 'Liquidado';
    case TransactionType.COMMITMENT: return 'Empenhado';
    case TransactionType.REINFORCEMENT: return 'Reforço';
    case TransactionType.CANCELLATION: return 'Cancelado';
    default: return 'Desconhecido';
  }
}

export function getTransactionTypeColorClass(type: TransactionType): string {
  switch (type) {
    case TransactionType.LIQUIDATION: 
      return 'bg-red-50 text-red-600 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/30';
    case TransactionType.COMMITMENT: 
      return 'bg-green-50 text-green-600 border-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/30';
    case TransactionType.REINFORCEMENT: 
      return 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-900/30';
    case TransactionType.CANCELLATION: 
      return 'bg-yellow-50 text-yellow-700 border-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-500 dark:border-yellow-900/30';
  }
}

export function getTransactionIcon(type: TransactionType): string {
  switch (type) {
    case TransactionType.LIQUIDATION: return 'arrow_downward';
    case TransactionType.COMMITMENT: return 'arrow_upward';
    case TransactionType.REINFORCEMENT: return 'add';
    case TransactionType.CANCELLATION: return 'block';
  }
}

export function getTransactionIconBgClass(type: TransactionType): string {
  switch (type) {
    case TransactionType.LIQUIDATION: return 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400';
    case TransactionType.COMMITMENT: return 'bg-green-50 text-green-500 dark:bg-green-900/20 dark:text-green-400';
    case TransactionType.REINFORCEMENT: return 'bg-blue-50 text-blue-500 dark:bg-blue-900/20 dark:text-blue-400';
    case TransactionType.CANCELLATION: return 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-500';
  }
}