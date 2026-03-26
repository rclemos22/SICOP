import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, input, computed, signal, output, effect } from '@angular/core';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { AppContextService } from '../../../../core/services/app-context.service';
import { SigefService } from '../../../../core/services/sigef.service';

import { getUnidadeBadgeClass, Dotacao } from '../../../../shared/models/budget.model';
import {
  Contract, ContractStatus, Aditivo
} from '../../../../shared/models/contract.model';
import {
  getTransactionTypeLabel, getTransactionTypeColorClass,
  getTransactionIcon, getTransactionIconBgClass,
  Transaction
} from '../../../../shared/models/transaction.model';
import { DotacaoFormComponent } from '../../../budget/components/dotacao-form/dotacao-form.component';
import { BudgetService } from '../../../budget/services/budget.service';
import { FinancialService } from '../../../financial/services/financial.service';
import { AditivoFormComponent } from '../../components/aditivo-form/aditivo-form.component';
import { ContractService } from '../../services/contract.service';

@Component({
  selector: 'app-contract-details-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, DecimalPipe, AditivoFormComponent, DotacaoFormComponent, StatusBadgeComponent],
  templateUrl: './contract-details-page.component.html',
})
export class ContractDetailsPageComponent {
  private contractService = inject(ContractService);
  private budgetService = inject(BudgetService);
  private financialService = inject(FinancialService);
  private appContext = inject(AppContextService);
  private sigefService = inject(SigefService);

  // Inputs & Outputs
  contractId = input.required<string>();
  back = output<void>();
  editContract = output<any>();

  // Active Tab State
  activeTab = signal<'OVERVIEW' | 'ADITIVOS' | 'BUDGETS' | 'FINANCIAL'>('OVERVIEW');

  // View Modes
  aditivosViewMode = signal<'cards' | 'list'>('cards');
  budgetsViewMode = signal<'cards' | 'list'>('cards');

  // ── Aditivos State ──────────────────────────────────────────────────────

  /** Lista de aditivos carregados do Supabase */
  aditivos = signal<Aditivo[]>([]);

  sortedAditivos = computed(() => {
    return [...this.aditivos()].sort((a, b) => {
      const dateA = a.data_assinatura ? new Date(a.data_assinatura).getTime() : 0;
      const dateB = b.data_assinatura ? new Date(b.data_assinatura).getTime() : 0;
      return dateB - dateA; // Descendente
    });
  });

  /** Erro ao carregar aditivos */
  aditivosError = signal<string | null>(null);

  /** Indica se os aditivos estão sendo carregados */
  aditivosLoading = signal<boolean>(false);

  // ── Modals State ────────────────────────────────────────────────────────
  isAditivoModalOpen = signal(false);
  isDotacaoModalOpen = signal(false);
  editingAditivo = signal<Aditivo | null>(null);
  editingDotacao = signal<Dotacao | null>(null);

  // ── Computed Contract ───────────────────────────────────────────────────

  contract = computed(() => {
    return this.contractService.getContractById(this.contractId());
  });

  /** Dias restantes (usa campo pré-calculado pelo mapper) */
  daysRemaining = computed(() => {
    const c = this.contract();
    return c?.dias_restantes ?? 0;
  });

  // ── Lógica de Negócio: Prorrogação ─────────────────────────────────────

  /**
   * Verifica se existe aditivo que altera a vigência (prorrogação de prazo)
   * com nova_vigencia diferente da data_fim original.
   */
  prorrogacaoInfo = computed(() => {
    const c = this.contract();
    const aditivosList = this.aditivos();

    if (!c || aditivosList.length === 0) {
      return null;
    }

    // Tipos de aditivo que podem alterar a vigência
    const tiposProrrogacao = ['PRORROGACAO', 'ADITIVO_PRAZO', 'ADITIVO_PRAZO_VALOR'];

    // Encontrar o aditivo de prorrogação mais recente com nova_vigencia
    const prorrogacao = aditivosList.find(
      a => tiposProrrogacao.includes(a.tipo) && a.nova_vigencia
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

  // ── Budgets & Financial State ───────────────────────────────────────────

  budgets = signal<Dotacao[]>([]);

  sortedBudgets = computed(() => {
    return [...this.budgets()].sort((a, b) => {
      const dateA = a.data_disponibilidade ? new Date(a.data_disponibilidade).getTime() : 0;
      const dateB = b.data_disponibilidade ? new Date(b.data_disponibilidade).getTime() : 0;
      return dateB - dateA; // Descendente
    });
  });
  budgetsLoading = signal<boolean>(false);
  budgetsError = signal<string | null>(null);

  transactions = signal<Transaction[]>([]);
  transactionsLoading = signal<boolean>(false);
  transactionsError = signal<string | null>(null);

  lastSyncDate = signal<Date | null>(new Date());

  // Calcula total engajado das dotações do contrato (apenas do ano atual)
  budgetSummary = computed(() => {
    const allBudgets = this.budgets();
    const currentYear = this.appContext.anoExercicio();
    
    // Filtrar apenas dotações do ano atual
    const budgetsDoAno = allBudgets.filter(b => {
      const data = new Date(b.data_disponibilidade);
      return data.getFullYear() === currentYear;
    });
    
    const totalEmpenhado = budgetsDoAno.reduce((sum, b) => sum + (b.total_empenhado || 0), 0);
    const totalPago = budgetsDoAno.reduce((sum, b) => sum + (b.total_pago || 0), 0);
    const saldoDisponivel = budgetsDoAno.reduce((sum, b) => sum + (b.saldo_disponivel || 0), 0);
    
    console.log('[DEBUG] budgetSummary - currentYear:', currentYear, 'budgetsDoAno:', budgetsDoAno.length, 'totalEmpenhado:', totalEmpenhado);
    
    return { totalEmpenhado, totalPago, saldoDisponivel };
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
     * Efeito reativo: carrega aditivos, orçamentos e transações
     * automaticamente quando o contrato é selecionado.
     */
    effect(() => {
      const c = this.contract();
      if (c) {
        this.loadAditivos(c.id);
        this.loadBudgets(c.id);
        this.loadTransactions(c.id);
      }
    });
  }

  private async loadBudgets(contractId: string): Promise<void> {
    this.budgetsLoading.set(true);
    this.budgetsError.set(null);
    try {
      const result = await this.budgetService.getBudgetsByContractId(contractId);
      if (result.error) {
         this.budgetsError.set(result.error);
         this.budgets.set([]);
      } else {
         // Carregar dotações e enriquecer com SIGEF apenas uma vez ao entrar na página
         this.budgetsLoading.set(true);
         const enriched = await this.enrichBudgetsWithSigef(result.data!);
         this.budgets.set(enriched);
         this.budgetsLoading.set(false);
      }
    } catch (err: any) {
      this.budgetsError.set(err.message || 'Erro ao carregar dotações');
      this.budgets.set([]);
      this.budgetsLoading.set(false);
    }
  }

  /**
   * Enriquece as dotações com valores do SIGEF (apenas quando entra na página)
   */
  private async enrichBudgetsWithSigef(budgets: Dotacao[]): Promise<Dotacao[]> {
    const currentYear = this.appContext.anoExercicio();
    const enrichedBudgets = [...budgets];

    for (let i = 0; i < enrichedBudgets.length; i++) {
      const budget = enrichedBudgets[i];
      const dataDisp = new Date(budget.data_disponibilidade);
      
      // Processar todas as dotações (não filtrar por ano atual)
      // O filtro de exibição nos KPIs é feito no budgetSummary computado

      // Se tem NE vinculada, buscar detalhes
      if (budget.nunotaempenho) {
        try {
          // Extrair ano dos 4 primeiros dígitos da NE (ex: "2025NE000302" -> "2025")
          const neValue = budget.nunotaempenho.trim();
          const anoNE = neValue.substring(0, 4);
          
          console.log('[DEBUG] NE do banco:', neValue);
          console.log('[DEBUG] Ano extraído (substring 0-4):', anoNE);
          console.log('[DEBUG] UG:', budget.unid_gestora);
          
          const neDetails = await this.sigefService.getNotaEmpenhoByNumber(
            anoNE,
            neValue,
            budget.unid_gestora
          );

          if (neDetails) {
            // Extrair diretamente do vlnotaempenho da API
            const vlEmpenhado = neDetails.vlnotaempenho || 0;
            
            // Saldo = Dotação - Empenhado (pode ser negativo se exceder)
            const saldo = budget.valor_dotacao - vlEmpenhado;
            
            enrichedBudgets[i] = {
              ...budget,
              total_empenhado: vlEmpenhado,
              total_pago: 0,
              saldo_disponivel: saldo
            };
            console.log('[DEBUG] enrichBudgetsWithSigef - Dotação:', budget.valor_dotacao, 'Empenhado:', vlEmpenhado, 'Saldo:', saldo);
          }
        } catch (err) {
          console.warn('[DEBUG] enrichBudgetsWithSigef - Error:', budget.nunotaempenho, err);
        }
      }
    }

    return enrichedBudgets;
  }

  private async loadTransactions(contractId: string): Promise<void> {
    this.transactionsLoading.set(true);
    this.transactionsError.set(null);
    try {
      const data = await this.financialService.getTransactionsByContractId(contractId);
      this.transactions.set(data);
    } catch (err: any) {
      this.transactionsError.set(err.message || 'Erro ao carregar transações');
      this.transactions.set([]);
    } finally {
      this.transactionsLoading.set(false);
    }
  }

  /**
   * Carrega aditivos do contrato via service.
   */
  private async loadAditivos(contractId: string): Promise<void> {
    this.aditivosLoading.set(true);
    this.aditivosError.set(null);

    const result = await this.contractService.getAditivosPorContractId(contractId);

    if (result.error) {
      this.aditivosError.set(result.error);
      this.aditivos.set([]);
    } else {
      this.aditivos.set(result.data ?? []);
    }

    this.aditivosLoading.set(false);
  }

  /**
   * Retorna label legível para o tipo de aditivo.
   */
  getAditivoTipoLabel(tipo: string): string {
    const labels: Record<string, string> = {
      'PRORROGACAO': 'Prorrogação',
      'ADITIVO_PRAZO': 'Aditivo de Prazo',
      'ADITIVO_PRAZO_VALOR': 'Aditivo de Prazo e Valor',
      'ADITIVO_VALOR': 'Aditivo de Valor',
      'ADITIVO_OBJETO': 'Aditivo de Objeto',
      'DISTRATO': 'Distrato',
      'ALTERACAO': 'Alteração'
    };
    return labels[tipo] || tipo.replace('_', ' ');
  }

  /**
   * Retorna a classe CSS para o badge de tipo de aditivo.
   */
  getAditivoTipoBadge(tipo: string): string {
    if (tipo.includes('PRAZO')) {
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800';
    }
    return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800';
  }

  // ── Modal Actions ─────────────────────────────────────────────────────

  openAditivoModal(aditivo?: Aditivo) {
    if (aditivo) {
      this.editingAditivo.set(aditivo);
    } else {
      this.editingAditivo.set(null);
    }
    this.isAditivoModalOpen.set(true);
  }

  closeAditivoModal() {
    this.isAditivoModalOpen.set(false);
    this.editingAditivo.set(null);
  }

  onAditivoSaved(aditivo: Aditivo) {
    this.aditivos.update(current => {
      const idx = current.findIndex(a => a.id === aditivo.id);
      if (idx >= 0) {
        const updated = [...current];
        updated[idx] = aditivo;
        return updated;
      }
      return [aditivo, ...current];
    });
    this.closeAditivoModal();
  }

  onAditivoDeleted(aditivoId: string) {
    this.aditivos.update(current => current.filter(a => a.id !== aditivoId));
  }

  async deleteAditivo(aditivoId: string) {
    if (!confirm('Tem certeza que deseja excluir este aditivo?')) {
      return;
    }
    
    try {
      const result = await this.contractService.deleteAditivo(aditivoId);
      
      if (result.error) {
        alert('Erro ao excluir aditivo: ' + result.error);
        return;
      }
      
      this.aditivos.update(current => current.filter(a => a.id !== aditivoId));
    } catch (err) {
      alert('Erro ao excluir aditivo');
    }
  }

  openDotacaoModal(dotacao?: Dotacao) {
    if (dotacao) {
      this.editingDotacao.set(dotacao);
    } else {
      this.editingDotacao.set(null);
    }
    this.isDotacaoModalOpen.set(true);
  }

  closeDotacaoModal() {
    this.isDotacaoModalOpen.set(false);
    this.editingDotacao.set(null);
  }

  onDotacaoSaved(dotacao: Dotacao | null) {
    if (dotacao) {
      this.budgets.update(current => {
        const idx = current.findIndex(b => b.id === dotacao.id);
        if (idx >= 0) {
          const updated = [...current];
          updated[idx] = dotacao;
          return updated;
        }
        return [dotacao, ...current];
      });
    } else {
      this.loadBudgets(this.contractId());
    }
    this.closeDotacaoModal();
  }

  openEditContract() {
    console.log('[ContractDetails] Editar contrato clicado');
    // Emit the contract object so the form can be populated
    this.editContract.emit(this.contract());
  }
}