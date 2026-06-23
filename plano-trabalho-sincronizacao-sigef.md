# Plano de Trabalho — Refatoração da Sincronização SIGEF

## Objetivo

Reorganizar a arquitetura de sincronização com o SIGEF para:
1. Remover o "Sincronizar SIGEF" do detalhamento do contrato e movê-lo para o menu "Ordem Bancária"
2. Ciclo automático de cache a cada 5 minutos (atualização da UI)
3. "Atualizar SIGEF" automático a cada 30 minutos entre 07:00-18:00
4. "Sincronizar SIGEF" exclusivamente manual
5. Sem conflito entre requisições concorrentes na API oficial
6. Paginação otimizada para reduzir consumo excessivo e latência

---

## Diagnóstico da Situação Atual

| Aspecto | Estado Atual | Problema |
|---------|-------------|----------|
| `Sincronizar SIGEF` | Botão no topo + modal do contrato | Acoplado ao detalhamento do contrato |
| Ciclo automático | 10 min, só mirror→cache | Não busca dados novos da API |
| `Atualizar SIGEF` | Manual, na tela Financeira | Sempre baixa últimos 60 dias inteiros |
| Sincronização concorrente | Fila global (`queryQueue`) serializa chamadas, mas sem trava entre operações | Pode ter conflito entre manual e automático |
| `_downloadObsForNE` | `MAX_PAGES = 20` + 600ms entre páginas | Paginação fixa, sem seguir `result.next` |
| `_fetchObsForPeriod` | `MAX_PAGES = 10` + 500ms entre páginas | Mesmo problema |
| `getOrdemBancariaMovements` | `MAX_PAGES = 10` | Mesmo problema |
| Delays entre NEs | 800ms (syncBatch) / 1000ms (bulk) | Altos, aumentam latência total |
| Marcação de período completo | Ano inteiro marcado mesmo com download parcial | Impede re-download de meses futuros |

---

## Escopo do Trabalho

### Fase 1 — Remover "Sincronizar SIGEF" do Contrato

**Arquivos:** `contract-details-page.component.html`, `contract-details-page.component.ts`

1. Remover do HTML:
   - Botão "Sincronizar SIGEF" da barra de ações (linhas ~35-47)
   - Botão "Sincronizar SIGEF agora" do modal "Vincular Ordem Bancária" (linhas ~1295-1301)

2. Remover ou realocar do TS:
   - Método `refreshSigefData()` (linha ~745)
   - Método `forceSyncSigef()` (linha ~1176)

3. Manter no contrato APENAS:
   - `atualizarLancamentos()` (busca dados do cache local)
   - Auto-refresh de 15min (mudar para 5min na Fase 2)

---

### Fase 2 — Novo Serviço: `SigefSchedulerService`

**Criar:** `src/core/services/sigef-scheduler.service.ts`

Serviço central que orquestra todos os ciclos de sincronização, substituindo a lógica espalhada.

#### 2.1 Ciclo Rápido — Cache (a cada 5 min)

```typescript
// Executa a cada 5 minutos
// SEMPRE roda (sem restrição de horário)
// APENAS mirror → cache, NUNCA chama API SIGEF
async runCacheCycle(): Promise<void> {
  // Equivalente ao runAutomaticSyncCycle() atual
  await this.syncService.syncAllContractsFinance(false, ano);
  // Recarrega dados na UI
  await this.contractService.loadContracts(undefined, true);
}
```

**O que muda:**
- `sigef-sync.service.ts` linha 132: `10 * 60_000` → `5 * 60_000`
- Remove o `syncAllContractsFinance` do ciclo automático antigo

#### 2.2 Ciclo Médio — Atualizar SIGEF (a cada 30 min, 07:00-18:00)

```typescript
async runSigefUpdateCycle(): Promise<void> {
  const hora = new Date().getHours();
  if (hora < 7 || hora >= 18) return; // Fora do horário comercial

  // Verifica se não há sync manual em andamento
  if (this.bulkSyncService.isRunning() || this.syncService.isSyncing()) return;

  // Baixa dados dos últimos 7 dias (não 60) da API
  await this.bulkSyncService.downloadLastDays(7);
  // Sincroniza mirror → cache financeiro
  await this.syncService.syncAllContractsFinance(true, ano);
}
```

**O que muda:**
- `downloadLast60Days()` → `downloadLastDays(7)` — baixa apenas 7 dias, não 60
- Verifica hora antes de executar
- Verifica se há operação manual em andamento antes de executar

#### 2.3 Ciclo Lento — Sincronizar SIGEF (manual)

- Único ponto de acesso: botão na página "Ordem Bancária" ou novo item de submenu
- Quando acionado: `bulkSyncService.downloadInitialData()` → `syncService.syncAllContractsFinance(true)`
- Bloqueia execução de ciclos automáticos enquanto roda

---

### Fase 3 — Menu "Ordem Bancária" com Sincronização

**Arquivos:** `app.component.html`, `app.routes.ts`, nova página ou modal

#### Opção A — Botão na página Ordem Bancária (recomendada)

Adicionar botão "Sincronizar SIGEF" na página `/ordem-bancaria`:
- Botão verde com ícone `cloud_download`
- Chama `SigefBulkSyncService.downloadInitialData()` + `SigefSyncService.syncAllContractsFinance(true)`
- Componente da página: `src/features/ordem-bancaria/pages/ordem-bancaria/ordem-bancaria-page.component.ts`
- Mostra progresso (já existe via `isRunning()` e `progress()`)

#### Opção B — Submenu "Sincronizar SIGEF" no sidebar

Adicionar abaixo do item "Ordem Bancária":
```html
<a routerLink="/ordem-bancaria/sync" ...>
  <span class="material-symbols-outlined">sync</span>
  Sincronizar SIGEF
</a>
```

Criar rota `/ordem-bancaria/sync` que carrega um componente de sincronização com barra de progresso.

---

### Fase 4 — Prevenção de Conflitos (API Lock)

**Arquivos:** `sigef-scheduler.service.ts` (novo), `sigef-sync.service.ts`, `sigef-bulk-sync.service.ts`

#### 4.1 Lock Centralizado

Criar um `SyncLock` service ou usar os sinais existentes:

```typescript
// sigef.service.ts — lock global de API
private _apiLocked = signal<boolean>(false);
readonly apiLocked = this._apiLocked.asReadonly();

async withApiLock<T>(fn: () => Promise<T>): Promise<T> {
  if (this._apiLocked()) throw new Error('API já está sendo utilizada');
  this._apiLocked.set(true);
  try { return await fn(); }
  finally { this._apiLocked.set(false); }
}
```

#### 4.2 Verificações Pré-Execução

Toda operação que chama a API SIGEF deve verificar:

| Operação | Verifica | Bloqueia |
|----------|----------|----------|
| `downloadInitialData()` | `!bulkSync.isRunning()` | ✅ Já existe |
| `downloadLastDays()` | `!bulkSync.isRunning()` | ✅ Já existe |
| `syncBatch()` | `!syncService.isSyncing()` | ✅ Já existe |
| `syncAllContractsFinance()` | `!syncService.isSyncing()` | ✅ Já existe |
| **Ciclo 30min** | `!bulkSync.isRunning() && !syncService.isSyncing()` | ❌ Novo |
| **Sincronizar SIGEF manual** | `!bulkSync.isRunning() && !autoScheduler.isRunning()` | ❌ Novo |

---

### Fase 5 — Otimização de Paginação e Latência

#### 5.1 Paginação Inteligente via `result.next`

**`sigef-bulk-sync.service.ts` — `_downloadObsForNE`:**

Atual:
```typescript
while (hasNext && page <= MAX_PAGES) {
```
Remove `MAX_PAGES = 20` e usa apenas `result.next`:
```typescript
while (hasNext) {
  const result = await this.sigefService.getOrdemBancaria(...page...);
  hasNext = !!result.next;
  page++;
}
```

A API do SIGEF já retorna paginação correta via `result.next`. O filtro por `nunotaempenho` já é passado como parâmetro e é processado server-side, então cada página já retorna apenas dados relevantes.

**`sigef-sync.service.ts` — `_fetchObsForPeriod`:**

Atual: `while (hasNext && page <= 10)`
Corrigir para: `while (hasNext)` (sem cap fixo)

**`sigef.service.ts` — `getOrdemBancariaMovements`:**

Atual: `while (nextUrl && page <= 10)` (linha 1002)
Corrigir para: `while (nextUrl)` (sem cap fixo)

#### 5.2 Redução de Delays

| Delay Atual | Novo | Local |
|------------|------|-------|
| 800ms entre NEs (syncBatch) | **300ms** | `sigef-sync.service.ts:289` |
| 1000ms entre NEs (bulk) | **500ms** | `sigef-bulk-sync.service.ts:65` |
| 600ms entre páginas (bulk) | **300ms** | `sigef-bulk-sync.service.ts:64` |
| 500ms entre páginas (OB sync) | **300ms** | `sigef-sync.service.ts:643` |
| 2000ms entre páginas NE scan | **1000ms** | `sigef.service.ts:703` |
| 1000ms entre páginas movimentos | **500ms** | `sigef.service.ts:766` |

#### 5.3 Filtro por Data nos Downloads

**`downloadLast60Days()` atualmente baixa dados de TODAS as NEs.**

Criar `downloadLastDays(days: number)` que:
- Aceita parâmetro `days` (7 para o ciclo de 30min, 60 para manual)
- Usa a data de início como filtro na chamada da API
- Pula NEs que já foram atualizadas recentemente (verifica `finished_at` em `sigef_sync_periods`)

#### 5.4 Correção da Marcação de Período

**Problema atual:** `_downloadObsForNE` marca `2026-01-01` a `2026-12-31` como completo, mas só baixou até a data atual.

**Correção:** Marcar o período real baixado:
```typescript
const fim = this._formatDate(new Date()); // ao invés de `${a}-12-31`
await this._markPeriodComplete(inicio, fim, 'OB', count);
```

E no `_isPeriodComplete`, considerar o período como "completo" apenas se `fim >= hoje - 1 dia`.

---

## Resumo das Alterações por Arquivo

| Arquivo | Tipo de Alteração | Descrição |
|---------|------------------|-----------|
| `contract-details-page.component.html` | **Remover** | Botões "Sincronizar SIGEF" |
| `contract-details-page.component.ts` | **Remover** | Métodos `refreshSigefData()`, `forceSyncSigef()` |
| `contract-details-page.component.ts` | **Alterar** | Auto-refresh: 15min → 5min (linha 501) |
| `app.component.html` | **Adicionar** | Item "Sincronizar SIGEF" no menu sob "Ordem Bancária" |
| `app.routes.ts` | **Adicionar** | Rota `/ordem-bancaria/sync` (se optar por submenu) |
| `sigef-scheduler.service.ts` | **NOVO** | Serviço central de agendamento |
| `sigef-sync.service.ts` | **Alterar** | Ciclo automático: 10min → 5min; delays reduzidos |
| `sigef-bulk-sync.service.ts` | **Alterar** | Paginação sem cap fixo; delays reduzidos; `downloadLastDays()` |
| `sigef.service.ts` | **Alterar** | Paginação sem cap fixo; delays reduzidos; API lock |
| `ordem-bancaria-page.component.ts` | **Alterar** | Adicionar botão "Sincronizar SIGEF" |

---

## Status da Execução

| Fase | Descrição | Status |
|------|-----------|--------|
| Fase 1 | Remover "Sincronizar SIGEF" do contrato | ✅ Concluído |
| Fase 2 | `SigefSchedulerService` com ciclos de 5min e 30min | ✅ Concluído |
| Fase 3 | Menu "Sincronizar SIGEF" no sidebar | ✅ Concluído |
| Fase 4 | Lock e prevenção de concorrência | ✅ Concluído |
| Fase 5 | Paginação e delays (performance) | ✅ Concluído |

## Alterações Adicionais

| Arquivo | Descrição |
|---------|-----------|
| `budget-page.component.html/ts` | Cards de dotação agrupados por UG, layout compacto, ordenação |
| `ata-saldo-panel.component.html/ts` | Correção de erro de template: `@let` com arrow function → método `getSaldoItem()` |
| `financial-page.component.ts` | `syncGlobal()` envolvido em `withApiLock()` para evitar concorrência |
| `sync-history.service.ts` | **NOVO** — Log persistente de sync em localStorage (max 1000 entradas) |
| `dashboard-refresh-scheduler.service.ts` | **NOVO** — Refresh silencioso dos cards do dashboard a cada 20min |
| `sigef-sync-page.component.ts` | **NOVO** — Página dedicada de sincronização com fila de tasks e histórico |
| `financial.service.ts` | Dedup key `ne\|type\|amount` → `ne\|type\|docNum\|amount`; delete guardado por `hasLiquidations`; dotacoes update condicional |
| `sigef-bulk-sync.service.ts` | `_isPeriodComplete` substituído por `_isPeriodRecentlyComplete` (janela 1h); delays 300→2000ms; cooldown exponencial 30s-5min; NE/movimentos independentes |
| `sigef-sync.service.ts` | `recentOnly` → `daysBack` (5/15/30/0); delays 300→2000ms; integração com `SyncHistoryService` |
| `sigef.service.ts` | `getNotaEmpenhoByNumber` páginas 2-3 com catch (retorna null em vez de throw) |
| `contract-details-page.component.ts` | `loadNesPagamentos` pós-sync; `refreshSigefData(daysBack)` substitui `fullScan` |

---

## Riscos e Observações

- A API do SIGEF tem limite de 30s por requisição (AbortController) — manter
- A fila `queryQueue` serializa TUDO — bom para evitar sobrecarga, mas pode ser gargalo
- O lock do `SigefSchedulerService` deve ser o primeiro a verificar, antes de qualquer chamada
- `downloadLastDays(7)` reduz drasticamente o volume vs `downloadLast60Days()` — ajustar se necessário
- Após a refatoração, o `_checkBulkReady()` precisa considerar períodos parciais, não apenas completos
- **Anti-flood:** `_setCooldown()` com backoff exponencial (30s, 60s, 120s, 240s, 300s max) após ETIMEDOUT; reset apenas se operação completa sem erros de rede
- **dotacoes nunca zerado:** `syncSigefTransactions` só altera campos com dados no upsert; delete `cache-ob-%` só roda se novos LIQUIDATIONs foram criados
