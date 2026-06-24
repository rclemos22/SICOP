# Plano de Trabalho — Atualização Automática dos Cards (Cache)

## Objetivo

Garantir que todos os cards com dados financeiros e de contrato carreguem automaticamente a partir do cache local ao inicializar a página, e que uma rotina silenciosa de atualização ocorra a cada **20 minutos**, eliminando a necessidade de refrescos manuais.

---

## Diagnóstico da Situação Atual

| Aspecto | Estado Atual | Problema |
|---------|-------------|----------|
| **Dashboard — cards principais** | Carregam apenas em `ngOnInit()` via `dashboardService.loadAllData()` | Se o usuário navegar para outra rota e voltar, o componente é destruído/recriado e recarrega, mas dados podem estar obsoletos durante a sessão |
| **Dashboard — refreshAllData** | Existe (`dashboard.service.ts:444`) mas só é chamado na troca de ano e após sync manual | Nenhum ciclo periódico aciona o refresh |
| **Contract Details — auto-refresh** | Já existe um `setInterval` de 5 min (`contract-details-page.component.ts:501`) | Intervalo muito curto; só atualiza o contrato específico, não o dashboard |
| **SIGEF Scheduler — cache cycle** | Roda a cada 5 min, chama `syncService.runAutomaticSyncCycle()` | Sincroniza mirror → cache financeiro, mas não atualiza os signals do dashboard (contractService, budgetService, financialService) |
| **Dashboard — `loadContracts`, `loadDotacoes`, `loadAllTransactions`** | Cada um faz query no Supabase (cache local) | Leves e rápidos (`silent = true` sem loading spinner) — ideais para refresh periódico |
| **Cards do contrato (detalhamento)** | Carregam via `loadContracts()` e signals do `ContractService` | Já reativos: se o sinal `contracts` mudar, os cards atualizam automaticamente |

---

## Escopo do Trabalho

### Fase 1 — Serviço: `DashboardRefreshScheduler`

**Criar:** `src/core/services/dashboard-refresh-scheduler.service.ts`

Serviço singleton que orquestra os ciclos de refresh dos cards do dashboard e demais páginas.

#### Comportamento

1. **Na inicialização (assim que o app estiver pronto):**
   - Aguarda 10 segundos após o boot para dar tempo ao download inicial do SIGEF
   - Dispara `dashboardService.refreshAllData()` (silencioso, sem loading)

2. **A cada 20 minutos:**
   - Dispara `dashboardService.refreshAllData()` (silencioso)
   - Atualiza todos os signals → UI reativa reflete as mudanças automaticamente

3. **Integração com rota do Dashboard:**
   - Quando o usuário navega para `/dashboard`, dispara um refresh extra se o último refresh foi há mais de 5 minutos

#### Rascunho da Implementação

```typescript
@Injectable({ providedIn: 'root' })
export class DashboardRefreshSchedulerService implements OnDestroy {
  private dashboardService = inject(DashboardService);
  private contractService = inject(ContractService);
  private budgetService = inject(BudgetService);
  private financialService = inject(FinancialService);

  private _refreshTimer: any = null;
  private _lastRefresh = signal<Date | null>(null);

  readonly lastRefresh = this._lastRefresh.asReadonly();

  constructor() {
    // Aguarda 10s pós-boot, depois atualiza os cards
    setTimeout(() => this._triggerRefresh(), 10_000);
    // Ciclo automático a cada 20 minutos
    this._refreshTimer = setInterval(() => this._triggerRefresh(), 20 * 60_000);
  }

  ngOnDestroy(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  async refreshNow(): Promise<void> {
    return this._triggerRefresh();
  }

  private async _triggerRefresh(): Promise<void> {
    try {
      console.log('[DashboardRefresh] Atualizando cards a partir do cache...');
      const year = this.dashboardService['appContext'].anoExercicio();

      await Promise.all([
        this.contractService.loadContracts(undefined, true),    // silent=true
        this.budgetService.loadDotacoes(true),                   // silent=true
        this.financialService.loadAllTransactions(true),         // silent=true
        this.dashboardService['loadRecentPayments'](year),
        this.dashboardService['loadCacheTotals'](),
      ]);

      this._lastRefresh.set(new Date());
      console.log('[DashboardRefresh] Cards atualizados com sucesso.');
    } catch (err) {
      console.error('[DashboardRefresh] Erro ao atualizar cards:', err);
      // Erro silencioso — a próxima tentativa será em 20 min
    }
  }
}
```

> **Nota:** O método `_triggerRefresh` espelha a lógica de `DashboardService.refreshAllData()`. Para evitar duplicação, deve-se refatorar `refreshAllData()` para ser pública e chamada diretamente. Ou, alternativamente, o scheduler pode chamar `dashboardService.refreshAllData()` diretamente se o método for exposto publicamente (já é público).

---

### Fase 2 — Refatorar `DashboardService.refreshAllData()` para Uso Externo

**Arquivo:** `src/features/dashboard/services/dashboard.service.ts`

Ajustar `refreshAllData()` para ser chamado pelo scheduler sem depender de métodos privados:

- `loadRecentPayments(year)` e `loadCacheTotals()` já são privados
- Opção A: torná-los públicos (quebraria encapsulamento)
- Opção B (recomendada): o scheduler chama apenas `dashboardService.refreshAllData()` e move a lógica de `loadRecentPayments` e `loadCacheTotals` para dentro de `refreshAllData()` se já não estiver

Verificar se `refreshAllData()` já chama `loadRecentPayments` e `loadCacheTotals` — sim, já chama (dashboard.service.ts:447-451).

Portanto, o scheduler pode simplesmente chamar:

```typescript
await this.dashboardService.refreshAllData();
```

**Nenhuma alteração necessária no DashboardService.** O scheduler apenas consumirá o método já existente.

---

### Fase 3 — SIGEF Cache Cycle Propaga aos Signals do Dashboard (Sem Lock)

**Arquivo:** `src/core/services/sigef-scheduler.service.ts`

O ciclo rápido de cache (5 min) chama `syncService.runAutomaticSyncCycle()`, que copia dados do mirror para as tabelas de cache (`sigef_ne_movimentos`, `sigef_ordens_bancarias`, `transacoes`). Como essa operação **não acessa a API oficial do SIGEF** (apenas tabelas locais do Supabase), adicionamos `dashboardService.refreshAllData()` ao final **sem nenhum lock**:

```typescript
private async _runCacheCycle(): Promise<void> {
  console.log('[Scheduler] Ciclo rápido (cache) — mirror → cache');
  await this.syncService.runAutomaticSyncCycle();
  // Apenas consultas Supabase (cache local) — sem acessar a API oficial do SIGEF
  await this.dashboardService.refreshAllData();
}
```

> **Importante:** NÃO usa `_isRunning` nem `withApiLock`. O cache cycle e o `refreshAllData()` operam exclusivamente sobre o cache local (Supabase), sem concorrência com a API oficial do SIGEF.

---

### Fase 4 — Cooldown para Evitar Múltiplos Refreshes Simultâneos

**Arquivo:** `src/core/services/dashboard-refresh-scheduler.service.ts` (ou existente)

Para evitar que múltiplos ciclos disparem refresh ao mesmo tempo:

| Gatilho | Quando | Cooldown |
|---------|--------|----------|
| DashboardRefreshScheduler (20 min) | A cada 20 min | Sempre roda |
| SIGEF cache cycle (5 min) | A cada 5 min | Só roda `refreshAllData` se último refresh há > 1 min |
| Navegação para `/dashboard` | Ao entrar na rota | Só roda se último refresh há > 5 min |

```typescript
private shouldRefresh(): boolean {
  const last = this._lastRefresh();
  if (!last) return true;
  const elapsed = Date.now() - last.getTime();
  return elapsed > 60_000; // 1 min de cooldown mínimo
}
```

---

### Fase 5 — Consolidar Auto-Refresh do Contract Details

**Arquivo:** `src/features/contracts/pages/contract-details/contract-details-page.component.ts`

O auto-refresh atual de 5 minutos no contract details (`atualizarLancamentos()`) busca dados do cache local (não da API). Com o novo scheduler de 20 min, esse intervalo pode ser ajustado:

| Opção | Prós | Contras |
|-------|------|---------|
| **A)** Manter 5 min no contract details + 20 min no dashboard | Cards do contrato sempre frescos | Duas chamadas ao cache próximas |
| **B)** Unificar em 20 min com o scheduler global | Consistência, menos queries | Cards do contrato podem ficar 20 min desatualizados |
| **C)** Contract details faz refresh ao ganhar foco (`router.events`) | Dado mais recente ao entrar na página | Não resolve stale data durante a navegação |

**Recomendação: Manter os 5 min no contract details** (já implementado e leve, pois só consulta cache local), **e adicionar o gatilho de rota** como complemento.

---

## Arquivos Alterados

| Arquivo | Tipo de Alteração | Descrição |
|---------|------------------|-----------|
| `src/core/services/dashboard-refresh-scheduler.service.ts` | **NOVO** | Serviço de refresh periódico dos cards |
| `src/core/services/sigef-scheduler.service.ts` | **Alterar** | Adicionar `dashboardService.refreshAllData()` ao cache cycle |
| `src/features/dashboard/pages/dashboard/dashboard-page.component.ts` | **Alterar** | Injetar `DashboardRefreshScheduler`; refresh ao navegar para rota |
| `src/app.component.ts` | **Alterar** | Nenhuma (o scheduler é `providedIn: 'root'` e inicia no construtor) |
| `src/features/contracts/pages/contract-details/contract-details-page.component.ts` | **Opcional** | Ajustar intervalo de 5 min → 20 min ou manter |

---

## Resumo do Fluxo

```
[Boot do App]
    │
    ├── SigefSchedulerService (após 5 min)
    │       ├── Cache Cycle (5 min):  mirror → cache
    │       └── SIGEF Update Cycle (30 min): API → mirror → cache
    │
    └── DashboardRefreshScheduler (após 10s)
            └── refreshAllData() → contracts.loadContracts()
                                → budgetService.loadDotacoes()
                                → financialService.loadAllTransactions()
                                → loadRecentPayments()
                                → loadCacheTotals()
                    │
                    └── A cada 20 min: refreshAllData() (silencioso)
```

## Comportamento Esperado

| Cenário | Antes | Depois |
|---------|-------|--------|
| Usuário abre o dashboard pela 1ª vez | LoadAllData() exibe loading | LoadAllData() exibe loading |
| Usuário fica 20 min no dashboard | Dados estagnados | Dados atualizados automaticamente |
| SIGEF atualiza dados no cache via scheduler | Dashboard só vê após refresh manual | Dashboard atualiza em ≤ 5 min |
| Usuário navega para Orçamento e volta | Dados recarregados (componente destroy/cria) | Refresh condicional rápido |
| Contract Details aberto por > 5 min | `atualizarLancamentos()` a cada 5 min | Mantido (leve, cache local) |

---

## Riscos e Observações

- **Múltiplos refreshes simultâneos:** O cooldown de 1 min (Fase 4) evita que os ciclos de 5 min e 20 min colidam
- **Performance:** `refreshAllData()` com `silent=true` não mostra loading spinner — o usuário não percebe a atualização
- **Signals reativos:** Como todos os cards usam `computed()` ou `signal()` dos services, a mudança nos sinais propaga automaticamente para a DOM — sem necessidade de detecção manual
- **Erros silenciosos:** Refreshes com erro são logados no console mas não exibem toast/modal para o usuário — a próxima tentativa cobre
- **Ciclo de 20 min vs 5 min do SIGEF:** O ciclo de 5 min do SIGEF faz mirror → cache (mais pesado), enquanto o refresh de 20 min é apenas leitura de cache (leve)
