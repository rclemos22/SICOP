import { Transaction } from './transaction.model';

export type InstallmentStatus = 'PAID' | 'OPEN' | 'OVERDUE';

export interface PaymentSchedule {
  monthLabel: string;
  reference: string;
  date: Date;
  valor: number;
  daysUntil: number;
  isPast: boolean;
  status: InstallmentStatus;
  isManualPayment: boolean;
  isSigefPayment: boolean;
  linkedTransactions: Transaction[];
  totalPago: number;
  paidAt?: Date;
}
