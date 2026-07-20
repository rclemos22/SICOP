# Plano de Correção: Card "Pagamentos em Atraso" no Dashboard

## Diagnóstico

### Contrato 135/2021 — Caso Real
- `data_inicio`: 2021-12-16 | `data_fim`: 2022-12-16
- Aditivo 01/2026 estende vigência até **2026-07-28**, `valor_mensal`: R$ 47.813,37
- `parcelas_pagas_manual`: ["2025-12", "2026-01" .. "2026-05"] — **"2026-06" NÃO está na lista**
- Transação LIQUIDATION em **2026-06-16** (R$ 43.265,58) existe mas **sem `parcela_referencia`**
- No contrato detalhes, Junho aparece como pago **por fallback** (extrai mês/ano da `date` da transação)
- Na dash, Junho aparece como atrasado porque o `isPaid` não tem esse fallback

### Regra de Negócio — Lapso temporal (serviço em M, pago em M+1)
O `month + 1` em `pagamentoEmAtraso()` **não é um bug** — é a regra de negócio:
- Serviço prestado em Janeiro → pago em Fevereiro
- Serviço prestado em Junho → pago em Julho
- O vencimento considera o mês do pagamento (M+1), não o mês do serviço (M)
- Parcela de Junho (m=6) calcula vencimento em 10/Jul → se 10/Jul passou, está em atraso
- Parcela de Julho (m=7) calcula vencimento em 10/Ago → futuro → não atrasado

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

### `paymentSchedule()` — data correta por regra de negócio (`contract-details-page.component.ts:221`)
```typescript
// month é 1-based (getMonth()+1) e reflete o mês do pagamento (M+1)
const installmentDate = new Date(year, month, actualDay);
// Junho: new Date(2026, 6, 10) = 10 de Julho → CORRETO (paga-se em Julho)
```
- A data exibida na tabela de parcelas está **correta** pela regra de negócio
- Serviço em Junho → pagamento esperado em Julho → data exibida 10/Jul

## O que foi corrigido (único bug real)

### Fallback `isPaid` no dashboard (era o único bug)
**Arquivo:** `src/features/dashboard/services/dashboard.service.ts` — Linhas 394-396

A dashboard só verificava `parcela_referencia === ref` para determinar se uma transação LIQUIDATION pagou a parcela. O contrato detalhes tem fallback adicional por `payment_month` e extração mês/ano da `date`. Adicionado o mesmo fallback:

```typescript
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

### O que NÃO foi alterado (comportamento correto mantido)
- `pagamentoEmAtraso()` com `month + 1` — **correto**: serviço em M é pago em M+1
- `installmentDate` com `new Date(year, month, actualDay)` — **correto**: data reflete mês do pagamento

### Verificar `recentPaymentsList` (dashboard)
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
| `src/features/dashboard/services/dashboard.service.ts` | 394-396 | `isPaid` ganha fallback por `payment_month` e `date` |

## Ordem de execução (já concluído)
1. Editar `dashboard.service.ts` — adicionar fallback `isPaid`
2. Testar visualmente no navegador (especialmente contrato 135/2021)
3. Commitar e fazer push
