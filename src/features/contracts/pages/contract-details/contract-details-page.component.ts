import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, input, computed, signal, output, effect } from '@angular/core';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { AppContextService } from '../../../../core/services/app-context.service';
import { SigefService } from '../../../../core/services/sigef.service';
import { SigefSyncService } from '../../../../core/services/sigef-sync.service';
import { SigefCacheService, SigefNeMovimento, SigefOrdemBancaria, SIGEF_PAID_STATUSES } from '../../../../core/services/sigef-cache.service';
import { SupabaseService } from '../../../../core/services/supabase.service';

import { getUnidadeLabel, getUnidadeBadgeClass, Dotacao } from '../../../../shared/models/budget.model';
import {
  Contract, ContractStatus, Aditivo
} from '../../../../shared/models/contract.model';
import {
  getTransactionTypeLabel, getTransactionTypeColorClass,
  getTransactionIcon, getTransactionIconBgClass,
  Transaction, TransactionType
} from '../../../../shared/models/transaction.model';
import { DotacaoFormComponent } from '../../../budget/components/dotacao-form/dotacao-form.component';
import { BudgetService } from '../../../budget/services/budget.service';
import { FinancialService } from '../../../financial/services/financial.service';
import { AditivoFormComponent } from '../../components/aditivo-form/aditivo-form.component';
import { ContractService } from '../../services/contract.service';

interface PaymentSchedule {
  monthLabel: string;
  reference: string; // YYYY-MM
  date: Date;
  valor: number;
  daysUntil: number;
  isPast: boolean;
  status: 'PAID' | 'OPEN' | 'OVERDUE';
  linkedTransactions: Transaction[];
  totalPago: number;
  paidAt?: Date;
}

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
  public sigefSyncService = inject(SigefSyncService);
  private sigefCacheService = inject(SigefCacheService);
  private supabaseService = inject(SupabaseService);

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
  isObjetoModalOpen = signal(false);
  isLinkObModalOpen = signal(false);
  isMarkAsPaidModalOpen = signal(false);
  
  editingAditivo = signal<Aditivo | null>(null);
  editingDotacao = signal<Dotacao | null>(null);
  selectedInstallment = signal<PaymentSchedule | null>(null);
  
  selectedObIds = signal<Set<string>>(new Set());
  searchObTerm = signal<string>('');
  
  /** OBs encontradas via busca profunda (fora do contexto inicial do contrato) */
  extraObs = signal<Transaction[]>([]);
  isDeepSearching = signal<boolean>(false);
  

  // Filtra transações de liquidação (pagamentos) para vinculação
  availableObs = computed(() => {
    const allTrans = [...this.transactions(), ...this.extraObs()];
    const current = this.selectedInstallment();
    const searchTerm = this.searchObTerm().toLowerCase().trim();
    
    // Remover duplicatas Reais (caso uma extraOb já exista na lista base ou vice-versa)
    const seen = new Set<string>();
    const uniqueTrans = allTrans.filter(t => {
      // Usar o document_number (que é o nudocumento) para garantir unicidade real
      const uniqueKey = t.document_number || t.id;
      if (seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });

    // Apenas liquidações
    const filtered = uniqueTrans.filter(t => {
      // Deve ser do tipo LIQUIDATION
      if (t.type !== 'LIQUIDATION') return false;
      
      // Filtro de busca (se houver)
      if (searchTerm) {
        const matchesSearch = 
          t.description.toLowerCase().includes(searchTerm) || 
          t.commitment_id?.toLowerCase().includes(searchTerm) ||
          t.id.toLowerCase().includes(searchTerm);
        if (!matchesSearch) return false;
      }
      
      // Se não tem vínculo, está disponível
      if (!t.parcela_referencia) return true;
      
      // Se tem vínculo, só está disponível se for para a parcela que estamos editando agora
      if (current && t.parcela_referencia === current.reference) return true;
      
      return false;
    });

    // Ordenação inteligente: 
    // 1. Mesmo mês/ano da parcela selecionada primeiro
    // 2. Por data decrescente
    if (current) {
      const currentYear = current.date.getFullYear();
      const currentMonth = current.date.getMonth();

      return [...filtered].sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        
        const isAMatch = dateA.getFullYear() === currentYear && dateA.getMonth() === currentMonth;
        const isBMatch = dateB.getFullYear() === currentYear && dateB.getMonth() === currentMonth;

        if (isAMatch && !isBMatch) return -1;
        if (!isAMatch && isBMatch) return 1;
        
        return dateB.getTime() - dateA.getTime();
      });
    }

    return filtered;
  });

  // ── Computed Contract ───────────────────────────────────────────────────

  contract = computed(() => {
    return this.contractService.getContractById(this.contractId());
  });

  /** Dias restantes (usa campo pré-calculado pelo mapper) */
  daysRemaining = computed(() => {
    const c = this.contract();
    return c?.dias_restantes ?? 0;
  });

  // ── Lógica de Negócio: Próximos Pagamentos ─────────────────────────────────

  paymentSchedule = computed(() => {
    const c = this.contract();
    if (!c || !c.data_inicio || !c.data_pagamento || !c.valor_mensal) {
      return [];
    }

    const transactions = this.transactions();
    const payments: PaymentSchedule[] = [];
    const paymentDay = Number(c.data_pagamento);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(c.data_inicio);
    const endDate = c.data_fim_efetiva ? new Date(c.data_fim_efetiva) : new Date(c.data_fim);

    // Aditivos que alteram o valor mensal, ordenados por data de início
    const aditivosReajuste = this.aditivos()
      .filter(a => a.novo_valor_mensal != null && a.data_inicio_novo != null)
      .sort((a, b) => new Date(a.data_inicio_novo!).getTime() - new Date(b.data_inicio_novo!).getTime());

    function valorParaMes(ano: number, mes: number): number {
      let valor = Number(c.valor_mensal);
      for (const ad of aditivosReajuste) {
        const inicio = new Date(ad.data_inicio_novo!);
        if (ano > inicio.getFullYear() || (ano === inicio.getFullYear() && mes >= inicio.getMonth() + 1)) {
          valor = Number(ad.novo_valor_mensal);
        }
      }
      return valor;
    }

    let currentDate = new Date(startDate);
    currentDate.setDate(1);

    while (currentDate <= endDate) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const reference = `${year}-${month.toString().padStart(2, '0')}`;

      const lastDayOfDueMonth = new Date(year, month + 1, 0).getDate();
      const actualDay = Math.min(paymentDay, lastDayOfDueMonth);

      const installmentDate = new Date(year, month, actualDay);
      const isPast = installmentDate < today;
      const monthLabel = currentDate.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });

      const matches = transactions.filter(t =>
        t.type === 'LIQUIDATION' && t.parcela_referencia === reference
      );

      let status: 'PAID' | 'OPEN' | 'OVERDUE' = 'OPEN';

      const isManualPaid = c.parcelas_pagas_manual?.includes(reference);

      const hasSigefPayment = matches.some(t => {
        if (!t.sigef_id) return false;
        const desc = t.description.toLowerCase();
        return SIGEF_PAID_STATUSES.some(s => desc.includes(s.toLowerCase()));
      });

      if (isManualPaid || hasSigefPayment) {
        status = 'PAID';
      } else if (isPast) {
        status = 'OVERDUE';
      }

      const paidAt = isManualPaid ? new Date() : undefined;

      payments.push({
        monthLabel,
        reference,
        date: installmentDate,
        valor: valorParaMes(year, month),
        daysUntil: Math.ceil((installmentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
        isPast,
        status,
        linkedTransactions: matches,
        totalPago: matches.reduce((acc, t) => acc + (t.amount || 0), 0),
        paidAt
      });

      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return payments.filter(p => p.date.getFullYear() === this.appContext.anoExercicio());
  });

  // Alias para manter compatibilidade com template se necessário (mas vou mudar o template)
  upcomingPayments = computed(() => {
    return this.paymentSchedule().filter(p => p.status !== 'PAID').slice(0, 6);
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
    const selectedYear = this.appContext.anoExercicio();
    return [...this.budgets()]
      .filter(b => new Date(b.data_disponibilidade).getFullYear() === selectedYear)
      .sort((a, b) => {
        const dateA = a.data_disponibilidade ? new Date(a.data_disponibilidade).getTime() : 0;
        const dateB = b.data_disponibilidade ? new Date(b.data_disponibilidade).getTime() : 0;
        return dateB - dateA; // Descendente
      });
  });
  budgetsLoading = signal<boolean>(false);
  budgetsError = signal<string | null>(null);

  dbTransactions = signal<Transaction[]>([]);
  
  transactions = computed(() => {
    return [...this.dbTransactions()]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  transactionsLoading = signal<boolean>(false);
  transactionsError = signal<string | null>(null);

  lastSyncDate = signal<Date | null>(new Date());
  
  sigefLastSync = signal<Map<string, Date>>(new Map());

  // Calcula total engajado das dotações do contrato filtrado pelo ano selecionado
  budgetSummary = computed(() => {
    const selectedYear = this.appContext.anoExercicio();
    const allBudgets = this.budgets();
    
    // Filtra dotações pelo ano selecionado
    const filteredBudgets = allBudgets.filter(b => {
      const budgetDate = new Date(b.data_disponibilidade);
      return budgetDate.getFullYear() === selectedYear;
    });
    
    const totalEmpenhado = filteredBudgets.reduce((sum, b) => sum + (b.total_empenhado || 0), 0);
    const totalPago = filteredBudgets.reduce((sum, b) => sum + (b.total_pago || 0), 0);
    const saldoDisponivel = filteredBudgets.reduce((sum, b) => sum + (b.saldo_disponivel || 0), 0);
    
    console.log('[DEBUG] budgetSummary - year:', selectedYear, 'Budgets:', filteredBudgets.length, 'totalEmpenhado:', totalEmpenhado);
    
    return { totalEmpenhado, totalPago, saldoDisponivel };
  });

  financialSummary = computed(() => {
    const trans = this.transactions();

    const totalPaid = trans
      .filter(t => t.type === 'LIQUIDATION')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalCommitted = trans
      .reduce((sum, t) => {
        if (t.type === 'COMMITMENT' || t.type === 'REINFORCEMENT') {
          return sum + t.amount;
        }
        if (t.type === 'CANCELLATION') {
          return sum - t.amount;
        }
        return sum;
      }, 0);

    return { totalPaid, totalCommitted };
  });

  // Helpers for Template
  getTypeLabel = getTransactionTypeLabel;
  getTypeClass = getTransactionTypeColorClass;
  getIcon = getTransactionIcon;
  getIconClass = getTransactionIconBgClass;
  getBadgeClass = getUnidadeBadgeClass;

  /** Armazena o queryId atual para permitir cancelamento */
  private currentQueryId: string | null = null;

  constructor() {
    /**
     * Efeito reativo: carrega aditivos, orçamentos e transações
     * automaticamente quando o contrato é selecionado.
     * Cancela consultas anteriores ao mudar de contrato.
     */
    effect(() => {
      const c = this.contract();
      if (c) {
        // Cancela consultas pendentes do contrato anterior
        this.cancelCurrentQueries();
        
        // Gera novo queryId para este contrato
        this.currentQueryId = `contract-${c.id}-${Date.now()}`;
        this.sigefService.enqueueQuery(this.currentQueryId);
        
        this.loadAditivos(c.id);
        this.loadBudgets(c.id);
        this.loadTransactions(c.id);
      }
    });
  }

  /**
   * Cancela todas as consultas pendentes deste componente.
   */
  private cancelCurrentQueries(): void {
    if (this.currentQueryId) {
      this.sigefService.cancelQuery(this.currentQueryId);
      this.currentQueryId = null;
    }
    // Cancela todas as consultas pendentes no serviço
    this.sigefService.cancelAllQueries();
  }

  ngOnDestroy(): void {
    this.cancelCurrentQueries();
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
         this.budgets.set(result.data!);
         this.budgetsLoading.set(false);
      }
    } catch (err: any) {
      this.budgetsError.set(err.message || 'Erro ao carregar dotações');
      this.budgets.set([]);
      this.budgetsLoading.set(false);
    }
  }


  private async loadTransactions(contractId: string): Promise<void> {
    this.transactionsLoading.set(true);
    this.transactionsError.set(null);
    try {
      const data = await this.financialService.getTransactionsByContractId(contractId);
      this.dbTransactions.set(data);
    } catch (err: any) {
      this.transactionsError.set(err.message || 'Erro ao carregar transações');
      this.dbTransactions.set([]);
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
      
      this.onAditivoDeleted(aditivoId);
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
  
  /**
   * Atualiza os dados SIGEF (empenhos e OBs) de todas as dotações do contrato
   * Usa queryId para permitir cancelamento.
   */
  async refreshSigefData(fullScan: boolean = true) {
    const budgets = this.budgets();
    const budgetsComNE = budgets.filter(b => b.nunotaempenho);
    
    if (budgetsComNE.length === 0) {
      console.log('[ContractDetails] Nenhuma dotação com NE para atualizar');
      return;
    }
    
    // Cancela consultas anteriores e gera novo queryId
    this.cancelCurrentQueries();
    this.currentQueryId = `refresh-${this.contractId()}-${Date.now()}`;
    this.sigefService.enqueueQuery(this.currentQueryId);
    
    console.log('[ContractDetails] Atualizando dados SIGEF via Batch Sync...');
    
    try {
      // 1. Criar tarefas para a fila de sincronização
      const tasks = budgetsComNE.map(budget => {
        const neValue = budget.nunotaempenho!.trim();
        const anoNE = neValue.substring(0, 4);
        return {
          ne: neValue,
          ug: budget.unid_gestora,
          ano: anoNE
        };
      });

      // 2. Executar a sincronização em lote (fila controlada com persistência automática no banco)
      await this.sigefSyncService.syncBatch(tasks, this.contract()?.id, true, !fullScan);
      
      // Verifica se foi cancelado
      if (this.currentQueryId && !this.sigefService.hasPendingQuery(this.currentQueryId)) {
        console.log('[ContractDetails] Atualização cancelada.');
        return;
      }
      
      // 3. Atualizar carimbos de data de sincronização local para cada dotação
      const lastSyncMap = new Map(this.sigefLastSync());
      for (const budget of budgetsComNE) {
        lastSyncMap.set(budget.id, new Date());
      }
      this.sigefLastSync.set(lastSyncMap);
      
      // 4. Recarregar contratos para atualizar os cálculos financeiros (Totais Empenhado/Pago) baseados no novo cache
      await this.contractService.loadContracts();
      
      // 5. Recarregar transações do BANCO (agora incluindo os novos dados do SIGEF persistidos)
      await this.loadTransactions(this.contractId());
      
      // 6. Recarregar as dotações (os valores estarão atualizados via database trigger)
      await this.loadBudgets(this.contractId());
      
      this.lastSyncDate.set(new Date());
      console.log('[ContractDetails] Dados SIGEF atualizados com sucesso');
    } catch (err: any) {
      if (err.message === 'Query cancelled') {
        console.log('[ContractDetails] Sincronização cancelada.');
        return;
      }
      console.error('[ContractDetails] Erro na sincronização batch:', err);
    } finally {
      this.currentQueryId = null;
    }
  }

  // ── Vincular OB ──────────────────────────────────────────────────────────

  openLinkObModal(installment: PaymentSchedule) {
    this.selectedInstallment.set(installment);
    
    // Inicializar seleção com transações já vinculadas a esta parcela
    const linkedIds = installment.linkedTransactions.map(t => t.id);
    this.selectedObIds.set(new Set(linkedIds));
    this.searchObTerm.set('');
    this.extraObs.set([]); // Limpar buscas anteriores
    
    this.isLinkObModalOpen.set(true);
  }

  closeLinkObModal() {
    this.isLinkObModalOpen.set(false);
    this.selectedInstallment.set(null);
    this.clearObSelection();
  }

  toggleObSelection(transactionId: string) {
    const current = new Set(this.selectedObIds());
    if (current.has(transactionId)) {
      current.delete(transactionId);
    } else {
      current.add(transactionId);
    }
    this.selectedObIds.set(current);
  }

  isObSelected(transactionId: string): boolean {
    return this.selectedObIds().has(transactionId);
  }

  clearObSelection() {
    this.selectedObIds.set(new Set());
  }

  getSelectedObs() {
    const selectedIds = this.selectedObIds();
    const allAvailable = [...this.transactions(), ...this.extraObs()];
    return allAvailable.filter(t => selectedIds.has(t.id));
  }

  /**
   * Realiza uma busca profunda no banco de dados global e, opcionalmente, no SIGEF
   */
  async performDeepSearch() {
    const term = this.searchObTerm().trim();
    if (term.length < 3) return;

    this.isDeepSearching.set(true);
    try {
      // 1. Buscar no Cache Global (todas as OBs de todos os contratos)
      const foundInCache = await this.sigefCacheService.searchOrdensBancariasGlobais(term);
      
      const newExtraObs: Transaction[] = foundInCache.map((ob) => {
        const obNumero = ob.nuordembancaria || 'S/N';
        const docNumero = ob.nudocumento || obNumero;
        // ID estável: usa nuordembancaria + nudocumento (igual ao padrão do enriquecimento do cache)
        const obId = `cache-ob-${obNumero}-${docNumero}`;
        const paymentDate = ob.dtpagamento ? new Date(ob.dtpagamento) : (ob.dtlancamento ? new Date(ob.dtlancamento) : new Date());

        // Inclui nudocumento na descrição para distinguir OBs com mesmo número
        const description = docNumero !== obNumero
          ? `PAGAMENTO OB ${obNumero} (${ob.cdsituacaoordembancaria || 'PROCESSO'}) - DOC ${docNumero}`.toUpperCase()
          : `PAGAMENTO OB ${obNumero} (${ob.cdsituacaoordembancaria || 'PROCESSO'})`.toUpperCase();
        
        return {
          id: obId,
          description,
          commitment_id: ob.nunotaempenho || undefined,
          document_number: docNumero,
          ob_number: obNumero,
          date: paymentDate,
          type: TransactionType.LIQUIDATION,
          amount: ob.vltotal || 0,
          // Dados mínimos necessários para o vínculo
          contract_id: this.contractId(),
          unidade_gestora_label: getUnidadeLabel(ob.cdunidadegestora.toString())
        } as Transaction;
      });

      // 2. Se o termo se parece com um número de OB (ex: 2024OB...) e não achamos nada de relevante, 
      // poderíamos tentar a API. Mas vamos começar pelo cache global.
      
      // Combinar com as que já temos
      const currentExtras = this.extraObs();
      const combined = [...currentExtras];
      
      newExtraObs.forEach(neo => {
        // Deduplicação na lista de extras: considera número do documento e valor
        if (!combined.some(c => c.document_number === neo.document_number && c.amount === neo.amount)) {
          combined.push(neo);
        }
      });
      
      this.extraObs.set(combined);

    } catch (err) {
      console.error('[Financial] Erro na busca profunda:', err);
    } finally {
      this.isDeepSearching.set(false);
    }
  }

  async linkSelectedTransactionsToInstallment() {
    const installment = this.selectedInstallment();
    if (!installment) return;
    
    const selectedObs = this.getSelectedObs();
    if (selectedObs.length === 0) {
      alert('Selecione pelo menos uma OB para vincular.');
      return;
    }

    try {

      for (const transaction of selectedObs) {
        const isSigef = transaction.id.startsWith('sigef-') || transaction.id.startsWith('cache-');
        let finalId = transaction.id;

        if (isSigef) {
          const { data: existing } = await this.supabaseService.client
            .from('transacoes')
            .select('id')
            .eq('sigef_id', transaction.id)
            .maybeSingle();

          if (existing) {
            finalId = existing.id;
          } else {
            const { data: created, error: createError } = await this.supabaseService.client
              .from('transacoes')
              .insert({
                contract_id: this.contractId(),
                description: transaction.description,
                commitment_id: transaction.commitment_id,
                date: new Date(transaction.date).toISOString().split('T')[0],
                type: transaction.type,
                amount: transaction.amount,
                department: transaction.department,
                budget_description: transaction.budget_description,
                parcela_referencia: installment.reference,
                document_number: transaction.document_number,
                ob_number: transaction.ob_number,
                sigef_id: transaction.id
              })
              .select()
              .single();
            
            if (createError) throw createError;
            finalId = created.id;
          }
        }

        const { error } = await this.supabaseService.client
          .from('transacoes')
          .update({ parcela_referencia: installment.reference })
          .eq('id', finalId);

        if (error) throw error;
      }

      await this.loadTransactions(this.contractId());
      
      await this.loadBudgets(this.contractId());
      await this.contractService.loadContracts(); // Atualiza dashboard

      this.closeLinkObModal();
      
    } catch (err: any) {
      console.error('[ContractDetails] Erro ao vincular OBs:', err);
      alert('Erro ao vincular Ordens Bancárias: ' + (err.message || 'Erro desconhecido'));
    } finally {
    }
  }

  async linkTransactionToInstallment(transactionId: string) {
    const installment = this.selectedInstallment();
    if (!installment) return;

    // Achar a transação selecionada
    const transaction = this.transactions().find(t => t.id === transactionId);
    if (!transaction) return;

    try {

      // Se for uma transação do SIGEF (id começa com 'sigef-' ou 'cache-'), 
      // precisamos primeiro persistir no banco 'transacoes' se não existir, 
      // ou apenas enviar o update com a referência.
      
      const isSigef = transaction.id.startsWith('sigef-') || transaction.id.startsWith('cache-');
      
      let finalId = transaction.id;

      if (isSigef) {
        // Tenta encontrar por sigef_id primeiro (mais seguro)
        const { data: existing } = await this.supabaseService.client
          .from('transacoes')
          .select('id')
          .eq('sigef_id', transaction.id)
          .maybeSingle();

        if (existing) {
          finalId = existing.id;
        } else {
          // Criar novo registro baseado no SIGEF
          const { data: created, error: createError } = await this.supabaseService.client
            .from('transacoes')
            .insert({
              contract_id: this.contractId(),
              description: transaction.description,
              commitment_id: transaction.commitment_id,
              date: new Date(transaction.date).toISOString().split('T')[0],
              type: transaction.type,
              amount: transaction.amount,
              department: transaction.department,
              budget_description: transaction.budget_description,
              parcela_referencia: installment.reference,
              sigef_id: transaction.id
            })
            .select()
            .single();
          
          if (createError) throw createError;
          finalId = created.id;
        }
      }

      // Atualizar o campo parcela_referencia
      const { error } = await this.supabaseService.client
        .from('transacoes')
        .update({ parcela_referencia: installment.reference })
        .eq('id', finalId);

      if (error) throw error;

      // Recarregar dados
      await this.loadTransactions(this.contractId());
      
      await this.loadBudgets(this.contractId());
      await this.contractService.loadContracts(); // Atualiza dashboard
      this.closeLinkObModal();
      
    } catch (err: any) {
      console.error('[ContractDetails] Erro ao vincular OB:', err);
      alert('Erro ao vincular Ordem Bancária: ' + (err.message || 'Erro desconhecido'));
    } finally {
    }
  }

  async unlinkTransaction(transactionId: string) {
    if (!confirm('Deseja remover o vínculo desta OB com a parcela?')) return;
    
    try {

      // Tenta remover vínculo pelo id ou pelo sigef_id
      const query = this.supabaseService.client
        .from('transacoes')
        .update({ parcela_referencia: null });

      if (transactionId.includes('-') && transactionId.length > 30) {
        // Provável UUID
        query.eq('id', transactionId);
      } else {
        // Provável sigef_id
        query.eq('sigef_id', transactionId);
      }

      const { error } = await query;

      if (error) throw error;

      // Recarrega TUDO para garantir que os cards superiores (view SQL) se atualizem
      await this.loadTransactions(this.contractId());
      await this.loadBudgets(this.contractId());
      await this.contractService.loadContracts(); // Atualiza dashboard
    } catch (err: any) {
      console.error('[ContractDetails] Erro ao desvincular:', err);
      alert('Erro ao desvincular: ' + (err.message || 'Erro desconhecido'));
    } finally {
    }
  }

  // ── Marcar Parcela como Pago ─────────────────────────────────────────────────

  openMarkAsPaidModal(installment: PaymentSchedule) {
    this.selectedInstallment.set(installment);
    this.isMarkAsPaidModalOpen.set(true);
  }

  closeMarkAsPaidModal() {
    this.isMarkAsPaidModalOpen.set(false);
    this.selectedInstallment.set(null);
  }

  async unmarkInstallmentAsPaid(installment: PaymentSchedule) {
    if (!confirm('Deseja remover a marcação de pago desta parcela?')) return;

    try {
      console.log('[ContractDetails] Desmarcar pagamento:', installment.reference);
      const c = this.contract();
      if (!c) throw new Error('Contrato não encontrado');

      const parcelasAtuais = c.parcelas_pagas_manual || [];
      const novasParcelas = parcelasAtuais.filter(ref => ref !== installment.reference);
      
      console.log('[ContractDetails] Atualizando banco. Novas parcelas:', novasParcelas);
      
      // Atualização Otimista
      this.contractService.updateContractInSignal(c.id, { parcelas_pagas_manual: novasParcelas });

      const { error } = await this.supabaseService.client
        .from('contratos')
        .update({ parcelas_pagas_manual: novasParcelas })
        .eq('id', c.id);

      if (error) {
        this.contractService.updateContractInSignal(c.id, { parcelas_pagas_manual: parcelasAtuais });
        throw error;
      }

      console.log('[ContractDetails] Sucesso no banco. Sincronizando dados...');
      await this.contractService.loadContracts();

    } catch (err: any) {
      console.error('[ContractDetails] Erro ao desmarcar pagamento:', err);
      alert('Erro ao remover pagamento: ' + (err.message || 'Erro desconhecido'));
    }
  }

  // Função direta para marcar como pago (sem modal)
  async markInstallmentAsPaidDirectly(installment: PaymentSchedule) {
    console.log('[ContractDetails] Marcar como pago diretamente:', installment.reference);
    try {
      const c = this.contract();
      if (!c) throw new Error('Contrato não encontrado');

      // Adicionar referência da parcela ao array de pagas manualmente
      const parcelasAtuais = c.parcelas_pagas_manual || [];
      if (!parcelasAtuais.includes(installment.reference)) {
        const novasParcelas = [...parcelasAtuais, installment.reference];
        
        console.log('[ContractDetails] Atualizando banco. Novas parcelas:', novasParcelas);
        
        // Atualização Otimista: Muda o sinal imediatamente para resposta visual instantânea
        this.contractService.updateContractInSignal(c.id, { parcelas_pagas_manual: novasParcelas });

        const { error } = await this.supabaseService.client
          .from('contratos')
          .update({ parcelas_pagas_manual: novasParcelas })
          .eq('id', c.id);

        if (error) {
          // Reverter em caso de erro
          this.contractService.updateContractInSignal(c.id, { parcelas_pagas_manual: parcelasAtuais });
          throw error;
        }

        console.log('[ContractDetails] Sucesso no banco. Sincronizando dados...');
        await this.contractService.loadContracts();
      }
    } catch (err: any) {
      console.error('[ContractDetails] Erro ao marcar como pago:', err);
      alert('Erro ao registrar pagamento: ' + (err.message || 'Erro desconhecido'));
    }
  }
  
  /**
   * Força a sincronização SIGEF para todas as notas de engajamento do contrato
   */
  /**
   * Força a sincronização SIGEF para todas as notas de empenho do contrato
   */
  async forceSyncSigef() {
    const budgetsData = this.budgets();
    if (budgetsData.length === 0) {
      alert('Nenhuma dotação encontrada para forçar sincronização.');
      return;
    }
    
    // Lista de NEs para sincronizar
    const tasks = budgetsData
      .filter(b => !!b.nunotaempenho)
      .map(b => {
        const neValue = b.nunotaempenho!.trim();
        return {
          ne: neValue,
          ug: b.unid_gestora || '080901',
          ano: neValue.substring(0, 4)
        };
      });

    if (tasks.length === 0) {
      alert('Nenhuma Nota de Empenho válida para sincronizar.');
      return;
    }

    try {
      console.log(`[ForceSync] Iniciando sincronização em lote (RÁPIDA) de ${tasks.length} NEs para contrato ${this.contractId()}`);
      
      // Utiliza o serviço unificado que gerencia status, retentativas e persistência
      // recentOnly = true por padrão
      await this.sigefSyncService.syncBatch(tasks, this.contractId(), false, true);
      
      // Recarregar os dados locais para refletir a persistência
      await this.loadBudgets(this.contractId());
      await this.loadTransactions(this.contractId());
      
      alert('Sincronização e atualização do banco de dados concluídas com sucesso!');
    } catch (err: any) {
      console.error('[ForceSync] Erro:', err);
      alert('Erro na sincronização: ' + (err.message || 'Erro desconhecido'));
    } finally {
    }
  }
}