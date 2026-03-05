import { Component, inject, input, computed, signal, output, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ContractService } from '../../services/contract.service';
import { BudgetService } from '../../services/budget.service';
import { FinancialService } from '../../services/financial.service';
import {
  Contract, ContractStatus, Aditivo,
  calculateDaysRemaining, getEffectiveStatus
} from '../../models/contract.model';
import {
  getTransactionTypeLabel, getTransactionTypeColorClass,
  getTransactionIcon, getTransactionIconBgClass
} from '../../models/transaction.model';
import { getUnidadeBadgeClass } from '../../models/budget.model';

@Component({
  selector: 'app-contract-details-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './contract-details-page.component.html',
})
export class ContractDetailsPageComponent {
  private contractService = inject(ContractService);
  private budgetService = inject(BudgetService);
  private financialService = inject(FinancialService);

  // Inputs & Outputs
  contractId = input.required<string>();
  back = output<void>();

  // Active Tab State
  activeTab = signal<'OVERVIEW' | 'ADITIVOS' | 'BUDGETS' | 'FINANCIAL'>('OVERVIEW');

  // ── Aditivos State ──────────────────────────────────────────────────────

  /** Lista de aditivos carregados do Supabase */
  aditivos = signal<Aditivo[]>([]);

  /** Erro ao carregar aditivos */
  aditivosError = signal<string | null>(null);

  /** Indica se os aditivos estão sendo carregados */
  aditivosLoading = signal<boolean>(false);

  // ── Computed Contract ───────────────────────────────────────────────────

  contract = computed(() => {
    return this.contractService.getContractById(this.contractId());
  });

  /** Dias restantes (usa campo pré-calculado pelo mapper) */
  daysRemaining = computed(() => {
    const c = this.contract();
    return c ? c.daysRemaining : 0;
  });

  /** Status efetivo para exibição (usa campo pré-calculado pelo mapper) */
  statusLabel = computed(() => {
    const c = this.contract();
    if (!c) return '---';
    return c.statusEfetivo;
  });

  statusClass = computed(() => {
    const s = this.statusLabel();
    if (s === ContractStatus.RESCINDIDO) return 'bg-red-50 text-red-600 border-red-200';
    if (s === ContractStatus.FINALIZANDO) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    return 'bg-green-50 text-green-700 border-green-200';
  });

  // ── Lógica de Negócio: Prorrogação ─────────────────────────────────────

  /**
   * Verifica se existe aditivo de prorrogação com nova_vigencia diferente
   * da data_fim original. Se sim, calcula se a data do contrato foi alterada.
   */
  prorrogacaoInfo = computed(() => {
    const c = this.contract();
    const aditivosList = this.aditivos();

    if (!c || aditivosList.length === 0) {
      return null;
    }

    // Encontrar o aditivo de prorrogação mais recente com nova_vigencia
    const prorrogacao = aditivosList.find(
      a => a.tipo === 'PRORROGACAO' && a.nova_vigencia
    );

    if (!prorrogacao || !prorrogacao.nova_vigencia) {
      return null;
    }

    return {
      novaVigencia: prorrogacao.nova_vigencia,
      numeroAditivo: prorrogacao.numero_aditivo,
      dataOriginalAlterada: true
    };
  });

  // ── Computed Related Data ───────────────────────────────────────────────

  budgets = computed(() => {
    return this.budgetService.getBudgetsByContractId(this.contractId());
  });

  transactions = computed(() => {
    const c = this.contract();
    if (!c) return [];
    return this.financialService.getTransactionsByContractNumber(c.contrato);
  });

  financialSummary = computed(() => {
    const trans = this.transactions();

    const totalPaid = trans
      .filter(t => t.type === 'LIQUIDATION')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalCommitted = trans
      .filter(t => t.type === 'COMMITMENT')
      .reduce((sum, t) => sum + t.amount, 0);

    return { totalPaid, totalCommitted };
  });

  // Helpers for Template
  getTypeLabel = getTransactionTypeLabel;
  getTypeClass = getTransactionTypeColorClass;
  getIcon = getTransactionIcon;
  getIconClass = getTransactionIconBgClass;
  getBadgeClass = getUnidadeBadgeClass;

  constructor() {
    /**
     * Efeito reativo: carrega aditivos automaticamente quando o contrato
     * é selecionado (contractId muda).
     */
    effect(() => {
      const c = this.contract();
      if (c) {
        this.loadAditivos(c.contrato);
      }
    });
  }

  /**
   * Carrega aditivos do contrato via service.
   */
  private async loadAditivos(numeroContrato: string): Promise<void> {
    this.aditivosLoading.set(true);
    this.aditivosError.set(null);

    const result = await this.contractService.getAditivosPorContrato(numeroContrato);

    if (result.error) {
      this.aditivosError.set(result.error);
      this.aditivos.set([]);
    } else {
      this.aditivos.set(result.data ?? []);
    }

    this.aditivosLoading.set(false);
  }

  /**
   * Retorna a classe CSS para o badge de tipo de aditivo.
   */
  getAditivoTipoBadge(tipo: string): string {
    if (tipo === 'PRORROGACAO') {
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800';
    }
    return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800';
  }

  /**
   * Retorna label legível para o tipo de aditivo.
   */
  getAditivoTipoLabel(tipo: string): string {
    return tipo === 'PRORROGACAO' ? 'Prorrogação' : 'Alteração';
  }
}