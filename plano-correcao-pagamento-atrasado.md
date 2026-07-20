# Plano de Correção: Card "Pagamentos em Atraso" no Dashboard

## Diagnóstico

### Contrato 135/2021 — Caso Real
- `data_inicio`: 2021-12-16 | `data_fim`: 2022-12-16
- Aditivo 01/2026 estende vigência até **2026-07-28**, `valor_mensal`: R$ 47.813,37
- `parcelas_pagas_manual`: ["2025-12", "2026-01" .. "2026-05"] — **"2026-06" NÃO está na lista**
- Transação LIQUIDATION em **2026-06-16** (R$ 43.265,58) existe mas **sem `parcela_referencia`**
- No contrato detalhes, Junho aparece como pago **por fallback** (extrai mês/ano da `date` da transação)
- Na dash, Junho aparece como atrasado porque o `isPaid` não tem esse fallback

### Bug A — Off-by-one no `pagamentoEmAtraso()` (`dashboard.service.ts:147`)
```typescript
// ❌ month já é 1-based (getMonth()+1), soma +1 novamente
const dueMonth = month + 1; // Junho vira Julho → 10/Jul < hoje → vencido
```
- Consequência: a data de vencimento de cada parcela é calculada com +1 mês
- Exemplo: parcela de Jun (m=6) vira 10/Jul que é passado → considera vencida
- Parcela de Jul (m=7) vira 10/Ago que é futuro → NÃO considera vencida
- Efeito líquido: TODAS as parcelas de Jan a Jun viram "vencidas"

### Bug B — `isPaid` sem fallback por data (`dashboard.service.ts:394-396`)
```typescript
// ❌ Só checa parcela_referencia + parcelas_pagas_manual
const isPaid = allTransactions.some(
  t => t.contract_id === c.id && t.type === 'LIQUIDATION' && t.parcela_referencia === ref
) || (c.parcelas_pagas_manual?.includes(ref) || false);
// ✅ Contrato detalhes também checa payment_month e extrai mês/ano da date
// (contract-details-page.component.ts:225-231)
```
- Transação de 16/06/2026 tem `parcela_referencia = null` e `payment_month = "2026-06"`
- O contrato detalhes reconhece como pago via fallback (`t.date` → "2026-06")
- A dash NÃO reconhece → `isPaid = false` → alerta indevido

### Bug C — Off-by-one no `paymentSchedule()` (`contract-details-page.component.ts:221`)
```typescript
// ❌ month é 1-based (getMonth()+1), mas Date() espera 0-based
const installmentDate = new Date(year, month, actualDay);
// Junho vira new Date(2026, 6, 10) = 10 de Julho
```
- Data exibida na tabela de parcelas está 1 mês adiantada
- Não afeta o dashboard, mas afeta a exibição no contrato

## Plano de Ação

### Passo 1 — Corrigir `pagamentoEmAtraso` (dashboard, off-by-one)
**Arquivo:** `src/features/dashboard/services/dashboard.service.ts` — Linha 147

```typescript
// ANTES
const dueMonth = month + 1;
const dueYear = dueMonth > 12 ? year + 1 : year;
const dueAdjusted = dueMonth > 12 ? 1 : dueMonth;
const lastDay = new Date(dueYear, dueAdjusted - 1, 0).getDate();
const actualDay = Math.min(paymentDay, lastDay);
const installmentDate = new Date(dueYear, dueAdjusted - 1, actualDay);

// DEPOIS
const lastDay = new Date(year, month, 0).getDate();
const actualDay = Math.min(paymentDay, lastDay);
const installmentDate = new Date(year, month - 1, actualDay);
```

**Risco**: Nenhum — `month` sempre estará entre 1 e 12, não precisa de rollover anual.

### Passo 2 — Corrigir `isPaid` no dashboard (fallback por data)
**Arquivo:** `src/features/dashboard/services/dashboard.service.ts` — Linhas 394-396

Adicionar as mesmas verificações de fallback que o contrato detalhes usa:

```typescript
// ANTES
const isPaid = allTransactions.some(
  t => t.contract_id === c.id && t.type === TransactionType.LIQUIDATION && t.parcela_referencia === ref
) || (c.parcelas_pagas_manual?.includes(ref) || false);

// DEPOIS
const isPaid = allTransactions.some(
  t => t.contract_id === c.id && t.type === TransactionType.LIQUIDATION && (
    t.parcela_referencia === ref ||
    t.payment_month === ref ||
    (() => {
      const txRef = `${new Date(t.date).getFullYear()}-${String(new Date(t.date).getMonth() + 1).padStart(2, '0')}`;
      return txRef === ref;
    })()
  )
) || (c.parcelas_pagas_manual?.includes(ref) || false);
```

**Risco**: Muito baixo — mesmo padrão já usado no contrato detalhes (linhas 225-231). Pode ser extraído para função auxiliar se preferir.

### Passo 3 — Corrigir `paymentSchedule` (contrato detalhes, off-by-one)
**Arquivo:** `src/features/contracts/pages/contract-details/contract-details-page.component.ts` — Linha 221

```typescript
// ANTES
const installmentDate = new Date(year, month, actualDay);

// DEPOIS
const installmentDate = new Date(year, month - 1, actualDay);
```

**Risco**: Nenhum — apenas corrige a data exibida. O `monthLabel` e a lógica de status usam `currentDate` (correto) para o label, e a verificação `isPast` agora usará a data correta.

### Passo 4 — Verificar `recentPaymentsList` (dashboard)
**Arquivo:** `src/features/dashboard/services/dashboard.service.ts`

- Linha 434: `t.parcela_referencia === reference` — esta comparação usa a referência correta. Sem mudanças necessárias.

### Passo 5 — Testes de regressão

| Teste | Comportamento esperado |
|-------|------------------------|
| **Dashboard** — card "Pagamentos em Atraso" | Apenas meses com vencimento no passado E não pagos aparecem |
| **135/2021** — Junho pago via LIQUIDATION 16/06 | Deve ser reconhecido como pago (via `payment_month` ou fallback `date`) |
| **135/2021** — Maio não pago | Deve aparecer como atrasado (se `parcelas_pagas_manual` não incluir "2026-05") |
| **Contrato detalhes** — datas das parcelas | Junho mostra "10/06", Julho mostra "10/07", etc. |
| **Contrato detalhes** — status PAID/OVERDUE | PAID se pago, OVERDUE se passou do vencimento, OPEN se futuro |
| **Contratos sem `valor_mensal`** | Não geram alertas |
| **Contratos com `data_pagamento=31`** | `actualDay` respeita último dia do mês (ex: 28/02) |

### Passo 6 — Impacto em dados existentes
- **Nenhum** — correções puramente de lógica de apresentação
- Banco de dados não é alterado
- `parcelas_pagas_manual` e transações permanecem intactas
- Apenas o filtro "atrasado" e a data exibida passam a usar o mês correto

## Arquivos afetados
| Arquivo | Linha(s) | O que muda |
|---------|----------|-----------|
| `src/features/dashboard/services/dashboard.service.ts` | 147 | Off-by-one no cálculo da data de vencimento |
| `src/features/dashboard/services/dashboard.service.ts` | 394-396 | `isPaid` ganha fallback por `payment_month` e `date` |
| `src/features/contracts/pages/contract-details/contract-details-page.component.ts` | 221 | Off-by-one na data exibida da parcela |

## Ordem de execução
1. Editar `dashboard.service.ts` — corrigir `pagamentoEmAtraso`
2. Editar `dashboard.service.ts` — corrigir `isPaid` (adicionar fallback)
3. Editar `contract-details-page.component.ts` — corrigir `installmentDate`
4. Testar visualmente no navegador (especialmente contrato 135/2021)
5. Commitar e fazer push
