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

### 7. Pagamentos em Atraso — falso positivo no dashboard
- Regra de negócio: serviço em M, pago em M+1 (ex: Jan pago em Fev). O `month+1` em `pagamentoEmAtraso` está **correto**.
- `dashboard.service.ts:394-396` — `isPaid` no dashboard não tinha fallback por `payment_month` ou `date` da transação (diferente do contrato detalhes que usa fallback nas linhas 225-231).
- **Caso concreto**: Contrato 135/2021 com LIQUIDATION em 16/06/2026 aparecia como atrasado na dash porque `parcela_referencia=null` e não havia fallback.
- Fix: adicionado fallback `payment_month` e extração mês/ano da `date` (mesma lógica do contrato detalhes).

### 8. Botão "Desmarcar Pagamento" não funcionava
- `contract-details-page.component.ts` — `unmarkInstallmentAsPaid` não recarregava `dbTransactions` após deletar a transação manual, então o `paymentSchedule` computado continuava vendo a transação deletada no cache do sinal.
- Fix: adicionado `await this.loadTransactions(c.id)` após `loadContracts` no `confirmUnmarkInstallment`.

### 9. "Desmarcar" aparecia para pagamentos via SIGEF (não só manuais)
- O `@if (p.status !== 'PAID')` mostrava o botão "Desmarcar" para TODAS as parcelas com status PAID, mesmo quando o pagamento era de origem SIGEF (não manual).
- `hasSigefPayment` no `paymentSchedule` computado não distinguia entre transações manuais (`manual_payment: true`) e SIGEF — qualquer LIQUIDATION com `sigef_id` não nulo contava como pagamento SIGEF, incluindo a manual.
- Fix: `hasSigefPayment` agora filtra `!t.manual_payment`; adicionados flags `isManualPayment`/`isSigefPayment` ao `PaymentSchedule`. Template usa `@else if (p.isManualPayment)` para exibir o botão "Desmarcar".
- `contract-details-page.component.html` — quando `p.isSigefPayment && !p.isManualPayment`, exibe badge "Pago via SIGEF" no lugar do botão.

### 10. `confirm()` nativo substituído por modal estilizado
- `unmarkInstallmentAsPaid` usava `confirm()` nativo do navegador, destoando do visual do sistema.
- Criado modal de confirmação `isUnmarkConfirmModalOpen` com ícone undo, cores vermelhas, e texto explicativo, seguindo o mesmo padrão do modal "Marcar como Pago".

### 11. Desativada consideração de transações SIGEF no cronograma de pagamentos
- `paymentSchedule` no contract-details considerava LIQUIDATION transactions (`hasSigefPayment`) para marcar parcelas como PAID.
- Removida `hasSigefPayment` do cálculo de status — agora apenas `parcelas_pagas_manual` define PAID.
- `isSigefPayment` nos objetos de parcela sempre `false`; template não mostra mais badge "Pago via SIGEF".
- DB: removidos "2026-05" e "2026-06" de `parcelas_pagas_manual` em 17 contratos (maio/junho ainda não pagos).

### 12. `overdueInstallments` no dashboard ignorava SIGEF
- `dashboard.service.ts` — `overdueInstallments` usava `allTransactions.some(...)` para verificar LIQUIDATIONs por data, fazendo com que 101 transações SIGEF de Maio/Junho 2026 marcassem como pagas.
- Fix: removido o check de transações; `isPaid` verifica apenas `parcelas_pagas_manual`.

### 13. Card "Atas de Licitação" não aparecia
- Template do dashboard só exibia o card quando `expiringCount > 0 || pendingAdesoesCount > 0`.
- Com apenas 1 ATA ativa (018/2026, vigência até 2027-05-20) e 0 adesões pendentes, o card nunca aparecia.
- Fix: adicionado `totalActive` ao `AtaAlertMetric`; `@if` agora também exibe o card quando `totalActive > 0`.

### 14. ATA — Fornecedor não salvava
- Coluna `fornecedor_nome` não existia na tabela `atas`; `ata.service.ts:188` lia `raw.fornecedor_nome` sempre undefined.
- Criada migration `sql/13_FIX_ATAS_FORNECEDOR_E_ITENS.sql`: `ADD COLUMN fornecedor_nome`, recria `vw_atas_resumo`.
- `ata-form.component.ts`: campo `fornecedor_nome` no form, `selectSupplier()` salva `razao_social`.
- `ata.service.ts`: `addAta()`/`updateAta()` incluem `fornecedor_nome`.

### 15. ATA — Edição apagava consumo interno e adesões
- `saveItens()` fazia `DELETE FROM ata_itens WHERE ata_id = ?` + reINSERT, quebrando FKs com `ata_consumo_interno` / `ata_adesoes` via cascade.
- Migration `sql/13_FIX_ATAS_FORNECEDOR_E_ITENS.sql`: remove `ON DELETE CASCADE` das FKs.
- `saveItens()` reescrita com diff (INSERT/UPDATE/DELETE seletivo) preservando FKs.

### 16. Contrato 80/2025 — Diagnóstico de divergência
- `_loadTransactionsFromCache` tinha dedup key usando `ne` duplicado em vez de `document_number`.
- Cleanup de registros legados em `syncSigefTransactions` sem error handling próprio (interrompia o fluxo).
- SQL `sql/14_DIAGNOSTICO_CONTRATO_80_2025.sql`: diagnóstico completo (contrato, transações, cache, mirror, disparidades, correção).
- `financial.service.ts:809-828`: cleanup envolvido em try-catch próprio.

### 17. Relatório PDF de Saldo de ATA — Logo, órgãos aderentes, async
- `ata-pdf.service.ts`: cabeçalho com logo DPEMA + "DEFENSORIA PÚBLICA DO ESTADO" / "Supervisão de Informática".
- Tabela "Órgãos Aderentes" (verde) incluída com colunas: Proc. SEI, Órgão, CNPJ, Item, Quantidade, Status.
- Footer com paginação; método `async` com try-catch.
- Logo em `public/logo_dpema.png` (servida via `assets` em `angular.json`).
- `angular.json`: adicionada seção `assets` apontando para `public/`.
- `ata-export.service.ts`: CSV inclui seção de órgãos aderentes.

### 18. ATA — Campo Processo SEI nas adesões
- Modelo `AtaAdesao`: adicionado `processo_sei?: string`.
- Formulário de solicitação inclui campo "Nº Processo SEI".
- Card da adesão exibe "Processo SEI: xxx" e apenas número do item (sem descrição).
- PDF e CSV incluem coluna "Proc. SEI" na ordem: Proc. SEI → Órgão → CNPJ → Item → Quantidade → Status.
- Migration `sql/15_ADD_PROCCESSO_SEI_ADESOES.sql`: `ALTER TABLE ata_adesoes ADD COLUMN processo_sei TEXT`.

### 19. ATA — Separação saldo consumo próprio vs adesão + painel
- Migration `sql/16_SEPARAR_SALDO_CONSUMO_ADESAO.sql`: adiciona `saldo_consumo_interno` e `saldo_adesao_total` em `vw_ata_saldo_item` e `vw_ata_saldo_resumo`.
- Modelo `SaldoItem`: novos campos `saldo_consumo_interno`, `saldo_adesao_total`, `percentual_utilizado`.
- Modelo `SaldoResumo`: novos campos `total_saldo_consumo_interno`, `total_saldo_adesao_total`.
- `saldo-ata.service.ts`: `validarLimiteAdesao` usa `saldo_adesao_total`, `validarLimiteConsumoInterno` usa `saldo_consumo_interno`.
- `ata-saldo-panel.component.ts`: dois cards globais separados (Consumo Próprio e Saldo Adesão), quantidades sem `.00`, detalhamento por item com 6 colunas.

### 20. ATA — Relatório PDF com tabelas separadas
- `ata-pdf.service.ts`:
  - **Tabela 1 — Consumo Próprio** (azul): todos os itens com #, Descrição, Unid., Qtd Registrada, Consumido Interno, **Saldo Consumo Próprio**, % Utilizado.
  - **Tabela 2 — Itens com Adesão** (verde): apenas itens com adesões, colunas: #, Descrição, Unid., Qtd Registrada, **Limite Colet. (200%)**, Limite Indiv. (50%), Aderido, **Saldo para Adesão**.
  - **Tabela 3 — Órgãos Aderentes** mantida; removida tabela de consolidação.
  - `fmtInt()` para exibir inteiros sem decimais; `headStyles` com `halign: center` e `valign: middle`.
- `ata-export.service.ts`: CSV com colunas "Saldo Consumo Próprio" e "Saldo Adesão Total".
