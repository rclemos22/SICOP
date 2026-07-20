# SICOP - Summary

## Stack
Angular 21 standalone + zoneless, Tailwind CSS, Supabase (PostgreSQL), D3.js, jsPDF, Vite.

## Important Database Rules
- `sigef_ordens_bancarias` has constraint `uk_sigef_ob UNIQUE (nuordembancaria, cdunidadegestora, nudocumento)` — onConflict must use all 3 columns.
- `transacoes` has NO `dotacao_id` column. Do not send this field in upsert payloads.
- Use `BudgetService` to map commitment_id (NE number) → dotacao_id when needed.
- UG stored as INTEGER (e.g. 80901) without padding — convert to string `'080901'` for display.

## Fixed Issues (Jul 2026)

### 1. Cache OBs vazio
- `sigef_ordens_bancarias` estava vazio (0 registros) porque `onConflict` usava apenas 2 colunas em vez de 3.
- Corrigido para: `onConflict: 'nuordembancaria,cdunidadegestora,nudocumento'`
- Populado manualmente: 375 registros via script.

### 2. `empenhadoLiquido` vs `empenhado` bruto
- `financial.service.ts:970` usava `totals.empenhado` (bruto) para atualizar `dotacoes.total_empenhado`.
- Corrigido para usar `empenhadoLiquido` (empenhado − cancelado).

### 3. Recarga de sinais após sincronia
- `syncSigefTransactions` não recarregava dados após `updateContractTotals`.
- Adicionada chamada a `contractService.loadContracts()` e `loadAllTransactions(true)`.

### 4. Remoção de filtro `commitment_id`
- `loadAllTransactions` filtrava por `commitment_id IS NOT NULL`, ocultando transações legadas.

### 5. `dotacao_id` ausente na tabela `transacoes`
- O código enviava `dotacao_id` nos upserts, mas a coluna não existe.
- Removido `dotacao_id` de todos os payloads de upsert.
- `updateContractTotals` agora usa `BudgetService` + `commitment_id` para mapear dotações.

### 6. Evento 400013 ignorado como empenho original
- Contrato 001/2026 (UG DPEMA) tinha NE 2026NE000853 com `cdevento=400013` no cache, mas `syncSigefTransactions` só reconhecia 400010/400011/400012.
- `financial.service.ts:678` — filtro de commitment agora inclui `m.cdevento === 400013`.
- `sigef-cache.service.ts:617` — `calcularValorEmpenhado` agora soma evento 400013.
- Fix manual aplicado: transaction COMMITMENT inserida, totais do contrato e dotação corrigidos.
- Após redeploy, sincronizações futuras do contrato serão processadas corretamente.

## Sync Result (Jul 2026)
- 32 contratos sincronizados com transações reais (cache NE + OB).
- Total empenhado global: R$ 6.690.801,98 (+174.860)
- Total pago global: R$ 5.649.922,48
- Saldo a pagar global: R$ 1.040.879,50
- 1 contrato (124/2024) sem dotações com NE — não tem transações.

## Previously Known (now fixed)
- ~~Contrato 001/2026: `total_empenhado=0` mas `total_pago=174.860` — dados de NE ausentes no cache.~~
