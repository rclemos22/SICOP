# Plano de Correção: Botão "Desmarcar Pagamento" no Contrato Detalhes

## Diagnóstico

### O problema
Ao clicar em "Desmarcar pagamento" em uma parcela paga manualmente, a UI não reage — a parcela continua aparecendo como `PAID`.

### Causa raiz
Existem **dois sinais** de transações no componente `ContractDetailsPageComponent`:

1. **`financialService.transactions`** — sinal global, populado por `loadAllTransactions()`
2. **`dbTransactions`** (`signal<Transaction[]>`) — sinal local, populado por `loadTransactions(contractId)` (linha 572)
3. **`transactions`** (`computed`) — lê de `dbTransactions` (linha 326-327)

O `paymentSchedule` (computed, linha 179) lê de `this.transactions()` (linha 185) para determinar o status de cada parcela:

```typescript
const hasSigefPayment = matches.some(t => !!t.sigef_id);

if (isManualPaid || hasSigefPayment) {
  status = 'PAID';
}
```

O fluxo do `unmarkInstallmentAsPaid()` (linha 1219):
1. ❌ Remove `reference` de `parcelas_pagas_manual` → `isManualPaid` = `false` ✓
2. ❌ Atualiza `contratos` no DB ✓
3. ❌ Deleta transação `manual-pay-{id}-{ref}` do DB ✓
4. ❌ Chama `updateContractTotals` ✓
5. ❌ Chama `loadContracts` (recarrega `contracts()` do DB) ✓
6. ⚠️ **NÃO chama `loadTransactions`** → `dbTransactions` permanece **stale**
7. ❌ `paymentSchedule` reavalia (porque `contract()` mudou): `isManualPaid` = `false`, mas `hasSigefPayment` = `true` (porque `transactions()` ainda tem o registro deletado)

**Resultado**: `status = 'PAID'` ainda, mesmo depois de desmarcar.

### Por que o "Marcar Pago" funciona?
`markInstallmentAsPaidDirectly()` também não recarrega transações, mas funciona porque:
- `isManualPaid = true` (reference adicionada ao sinal localmente)
- O `paymentSchedule` reavalia e vê `isManualPaid = true` → `status = 'PAID'` ✓
- O INSERT no DB é secundário; o sinal local já basta

## Plano de Ação

### Correção (1 arquivo, 1 linha)

**Arquivo:** `src/features/contracts/pages/contract-details/contract-details-page.component.ts`
**Linha:** 1247 (após `loadContracts`)

Adicionar chamada a `loadTransactions` para atualizar `dbTransactions` após deletar a transação manual:

```typescript
// ANTES (linhas 1246-1247):
      await this.financialService.updateContractTotals(c.id);
      await this.contractService.loadContracts(undefined, true);

// DEPOIS:
      await this.financialService.updateContractTotals(c.id);
      await this.contractService.loadContracts(undefined, true);
      await this.loadTransactions(c.id);
```

### Testes de regressão
1. **Desmarcar pagamento manual**: clicar em "Desmarcar" → parcela volta a OPEN ou OVERDUE (dependendo da data)
2. **Marcar pagamento**: continua funcionando (sem alteração)
3. **Pagamento via SIGEF**: botão "Desmarcar" não deve aparecer para pagamentos originados do SIGEF (já é o comportamento esperado — `parcelas_pagas_manual` só contém marcações manuais)

### Impacto
- **Nenhum** em banco de dados ou outras funcionalidades
- Apenas garante que o sinal local `dbTransactions` seja atualizado após a deleção
- A chamada `loadTransactions` faz uma query `SELECT` no DB, sem side effects

## Arquivos afetados
| Arquivo | O que muda |
|---------|-----------|
| `src/features/contracts/pages/contract-details/contract-details-page.component.ts` | +1 linha: `await this.loadTransactions(c.id)` |

## Execução
1. Adicionar `await this.loadTransactions(c.id)` após `loadContracts` em `unmarkInstallmentAsPaid`
2. Buildar e verificar
3. Commitar e fazer push
