# Plano de Trabalho — Melhoria da Gestão de Atas

## Objetivo
Corrigir os cálculos de limites legais conforme Art. 86 da Lei 14.133/2021 e melhorar a experiência visual do módulo de Atas.

---

> **Status: ✅ Todas as fases implementadas em 19/06/2026**

## Diagnóstico Atual

### Erros Críticos Identificados

| # | Local | Problema | Impacto |
|---|-------|----------|---------|
| 1 | `saldo-ata.service.ts:263` | Limite coletivo calculado como **50%** em vez de **200%** (Art. 86 § 4º) | Impede adesões legítimas |
| 2 | `ata-saldo-panel.component.html:311-317` | Texto informa "Total de adesões: 50%" — deveria ser 200% | Desinforma o usuário |
| 3 | `ata-pdf.service.ts:147-148` | Nota legal no PDF com limite coletivo de 50% | Relatório incorreto |
| 4 | `ata-saldo-panel.component.ts:171` | Autorização de adesão usa `prompt()` nativo | UX pobre, sem validação visual |

### Lacunas Funcionais

| # | Lacuna | Descrição |
|---|--------|-----------|
| 5 | Limite individual por órgão (§ 3º) | Não há rastreamento de quanto cada órgão já consumiu por item — a validação atual verifica apenas a quantidade solicitada vs. 50%, mas não o acumulado do mesmo órgão |
| 6 | Indicadores visuais de limite | Saldo por item não mostra as linhas de 50% (individual) e 200% (coletivo) na barra de progresso |
| 7 | Dashboard sem atas | Não há card no dashboard principal com alertas de atas (vencimento, saldo crítico, adesões pendentes) |
| 8 | Adesões pendentes sem visibilidade global | Não há contador/badge global de adesões pendentes |
| 9 | Sem ordenação/filtro por fornecedor na listagem | A listagem de atas só filtra por status e texto livre |
| 10 | Sem edição de consumo/adesão | Não é possível editar um registro de consumo ou adesão, apenas excluir e recriar |

---

## Fases do Plano

---

### FASE 1 — Correção dos Cálculos Legais (Art. 86, Lei 14.133/2021) ✅

**Prioridade: ALTA** — Impacta diretamente a conformidade legal

#### 1.1 Corrigir limite coletivo em `validarLimiteAdesao()`
**Arquivo:** `src/features/atas/services/saldo-ata.service.ts`
- Alterar `maxTotalAdesoes = item.quantidade_registrada * 0.5` para `item.quantidade_registrada * 2.0`
- Adicionar rastreamento por órgão: buscar adesões já autorizadas do mesmo CNPJ para o mesmo item e deduzir do limite individual (§ 3º)
- Ajustar mensagens de validação para refletir os percentuais corretos
- Referência de cálculo deve ser SEMPRE `quantidade_registrada` (original), nunca `saldo_disponivel`

**Regras após correção:**
```
Limite individual (§ 3º): min(
    quantidade_registrada * 0.5 - quantidade_já_autorizada_mesmo_orgao,
    saldo_disponivel_para_adesoes
)
Limite coletivo (§ 4º): quantidade_registrada * 2.0 - total_aderido

Máximo permitido = min(limite_individual, limite_coletivo, saldo_disponivel)
```

#### 1.2 Corrigir texto informativo no painel
**Arquivo:** `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.html`
- Linhas 311-317: substituir referência a "Decreto 11.462/2023" por "Art. 86, Lei 14.133/2021"
- Corrigir percentuais: individual 50%, coletivo 200%

**Texto corrigido:**
```
Dispositivo Legal — Art. 86, Lei 14.133/2021
§ 3º — Limite individual: cada órgão não participante não poderá exceder 50% dos quantitativos dos itens registrados em ata.
§ 4º — Limite coletivo: o total das adesões externas não poderá exceder o dobro (200%) do quantitativo de cada item registrado, independentemente do número de aderentes.
```

#### 1.3 Corrigir nota legal no PDF
**Arquivo:** `src/features/atas/services/ata-pdf.service.ts`
- Linha 147-148: atualizar texto da nota legal com os percentuais corretos

---

### FASE 2 — Melhorias Visuais no Painel de Saldo ✅

**Prioridade: ALTA** — Impacta a usabilidade diária

#### 2.1 Barra de progresso com indicadores de limite legal
**Arquivo:** `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.html`
- Adicionar linhas verticais tracejadas na barra de progresso:
  - Linha **50%** (limite individual § 3º) — cor laranja
  - Linha **200%** (limite coletivo § 4º) — cor vermelha
- Exibir apenas para itens que já têm adesões autorizadas ou solicitações pendentes
- Colorir a barra de progresso de forma escalonada:
  - Verde: 0-50%
  - Amarelo: 50-100%
  - Laranja: 100-150%
  - Vermelho: >150%

#### 2.2 Cards de resumo com indicadores de risco
**Arquivo:** `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.html`
- Adicionar coluna "Risco" no card de cada item do saldo:
  - 🟢 Normal: < 50% utilizado
  - 🟡 Atenção: entre 50% e 80%
  - 🟠 Crítico: entre 80% e 100%
  - 🔴 Esgotado: >= 100%
- Exibir tooltip com detalhes dos limites legais ao passar o mouse

#### 2.3 Detalhamento do saldo por item
**Arquivo:** `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.html`
- Substituir a exibição simples de 4 colunas por um mini painel visual:
  - Gráfico de barras horizontal empilhado (Consumido | Aderido | Disponível)
  - Indicador "Limite Individual Restante" (50% - consumido_pelo_orgao)
  - Indicador "Limite Coletivo Restante" (200% - total_aderido)

#### 2.4 Estado vazio aprimorado
**Arquivo:** `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.html`
- Substituir "Nenhum saldo disponível" e "Nenhum item cadastrado" por ilustrações e CTAs

---

### FASE 3 — Aprimoramento do Fluxo de Adesões ✅

**Prioridade: ALTA** — Impacta o processo de trabalho

#### 3.1 Modal de autorização com validação visual
**Arquivo:** `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.ts`
- Substituir `prompt()` por um modal/modal-inline com:
  - Campo de quantidade autorizada com valor sugerido
  - Indicador de limite individual restante (50%) em tempo real
  - Indicador de limite coletivo restante (200%) em tempo real
  - Aviso visual se a quantidade exceder algum limite
  - Justificativa obrigatória se a autorização for parcial

#### 3.2 Badge global de adesões pendentes
**Arquivo:** `src/features/atas/pages/atas/atas-page.component.ts` + html
- Adicionar badge no card da ata na listagem mostrando quantas adesões pendentes existem
- Adicionar contador no sidebar ou no topo da página de atas

#### 3.3 Filtro de adesões na listagem de atas
**Arquivo:** `src/features/atas/pages/atas/atas-page.component.ts`
- Adicionar indicador visual nas linhas da tabela de atas que têm adesões pendentes
- Permitir filtrar por atas com pendências

#### 3.4 Histórico de adesões por órgão
**Arquivo:** `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.html`
- Na aba de Adesões, ao clicar em um órgão, expandir mostrando o histórico de adesões daquele órgão para outros itens da mesma ata

---

### FASE 4 — Dashboard e Alertas ✅

**Prioridade: MÉDIA** — Melhora a visibilidade gerencial

#### 4.1 Card de atas a vencer no dashboard
**Arquivo:** `src/features/dashboard/`
- Criar componente similar ao `expiring-contracts.component.ts` mas para atas
- Exibir atas com vigência próxima do fim (<= 60, <= 30, <= 15 dias)
- Link para navegar até a ata específica

#### 4.2 Card de adesões pendentes no dashboard
- Criar card mostrando total de solicitações de adesão pendentes
- Link direto para a ata com pendências
- Badge com contagem total

#### 4.3 Card de atas com saldo crítico
- Exibir atas cujo percentual de utilização > 80%
- Similar ao `low-budget-card.component.ts` mas para atas

---

### FASE 5 — Exportação e Relatórios ✅

**Prioridade: MÉDIA**

#### 5.1 Corrigir relatório PDF
**Arquivo:** `src/features/atas/services/ata-pdf.service.ts`
- Nota legal com percentuais corretos (50% individual, 200% coletivo)
- Adicionar coluna de limites legais na tabela
- Adicionar indicador de risco por item

#### 5.2 Exportar para CSV/Excel
**Arquivo:** `src/features/atas/services/ata-export.service.ts` (novo)
- Botão "Exportar CSV" no painel de saldo
- Botão "Exportar CSV" na listagem de atas
- Incluir dados de saldo, consumo e adesões

---

### FASE 6 — Banco de Dados e Views ✅

**Prioridade: MÉDIA**

#### 6.1 View de limites de adesão por item
**Arquivo:** `supabase/migrations/` (nova migration)
- Criar view ou atualizar `vw_ata_saldo_item` para incluir:
  - `limite_individual_disponivel` (50% - consumido_por_orgao)
  - `limite_coletivo_disponivel` (200% - total_aderido)
- Facilitar as consultas de validação no frontend

#### 6.2 View de adesões pendentes consolidadas
- Criar view para consulta rápida de pendências por ata/item
- Alimentar badges e dashboard cards

---

## Cronograma Sugerido

| Fase | Duração | Depende de |
|------|---------|------------|
| Fase 1 — Correção Legal | 2 dias | — |
| Fase 2 — Melhorias Visuais | 4 dias | Fase 1 |
| Fase 3 — Fluxo de Adesões | 3 dias | Fase 1 |
| Fase 4 — Dashboard | 3 dias | Fase 3 |
| Fase 5 — Exportação | 2 dias | Fase 2 |
| Fase 6 — Banco de Dados | 2 dias | — (pode ser paralelo) |
| **Total estimado** | **~16 dias** | |

---

## Arquivos modificados/criados (implementado)

### Modificados:
- `src/features/atas/services/saldo-ata.service.ts` — correção limites (200% coletivo, rastreamento por órgão)
- `src/features/atas/services/ata-pdf.service.ts` — nota legal Art. 86
- `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.ts` — modal adesões, helpers risco
- `src/features/atas/components/ata-saldo-panel/ata-saldo-panel.component.html` — visuais, limites, modais
- `src/features/atas/pages/atas/atas-page.component.ts` — badges pendentes, export CSV
- `src/features/atas/pages/atas/atas-page.component.html` — badges pendentes, botão CSV
- `src/features/dashboard/pages/dashboard/dashboard-page.component.ts` — ata alerts metrics
- `src/features/dashboard/pages/dashboard/dashboard-page.component.html` — ata alerts card
- `src/shared/models/ata.model.ts` — campos `limite_individual`, `limite_coletivo`, `saldo_adesao`
- `README.md` — documentação atualizada

### Criados:
- `src/features/atas/services/ata-export.service.ts` — export CSV
- `src/features/dashboard/components/ata-alerts-card.component.ts` — card dashboard
- `supabase/migrations/036_create_vw_ata_saldo_limites.sql` — views de limite
