# SICOP - Sistema de Contratos Públicos

Sistema web para gestão de contratos públicos com integração ao SIGEF (Sistema de Informação de Gestão e Fiscalização).

## Funcionalidades

- **Dashboard**: Métricas gerais, alertas de pagamentos em atraso, saldo de empenho baixo, contratos próximos ao vencimento (≤120 dias), gráficos de distribuição. Cards de alerta com layout lado a lado, expansão para ver todos os itens. Gráfico comparativo financeiro exibe todos os contratos ativos sem limite.
- **Gestão de Contratos**: Cadastro, edição, aditivos e acompanhamento
  - Abas: Vigentes, Finalizados, Rescindidos
  - Busca em todos os contratos (3+ caracteres)
  - Formulário com autocomplete de fornecedores
  - Campos: Unidade Gestora, Setor, Gestor do Contrato, Fiscais, Processo SEI, Link SEI
  - Tipos de aditivo: Prazo, Valor, Prazo+Valor, Objeto, Distrato, Mudança de Razão Social
  - Aditivo "Mudança de Razão Social" altera nome/CNPJ da contratada com data de início programada
- **Controle Financeiro**: 
  - Visualização de Notas de Empenho via API SIGEF
  - Lançamentos de Empenho, Reforço, Anulação e Liquidação com vínculo a contrato e dotação orçamentária
  - Busca de Ordens Bancárias
- **Orçamento**: Controle de dotações orçamentárias com vinculação de NE
- **Fornecedores**: Cadastro e gestão de fornecedores
- **Atas de Licitação**: Gestão de atas de registro de preço
  - Cadastro de atas com itens, fornecedor e vigência
  - **Saldo por item**: Painel com barras de progresso com indicadores de limite legal (50% individual, 200% coletivo), badge de risco (Normal/Atenção/Crítico/Esgotado)
  - **Consumo Interno**: Registro de consumo pelo órgão gerenciador (até 100% do item)
  - **Adesões (Carona)**: Solicitação, autorização e rejeição com validação dos limites legais (Art. 86, Lei 14.133/2021 — § 3º até 50% por órgão, § 4º até 200% total)
  - **Modal de Autorização**: Substitui prompt() por modal com validação em tempo real dos limites legais por órgão
  - **Badge de Pendências**: Indicador visual de adesões pendentes na listagem de atas
  - **Relatório PDF**: Exportação do relatório de saldo com limites legais e nota legal atualizada
  - **Exportação CSV**: Exportação do saldo por item e da listagem de atas
  - **Dashboard**: Card de alertas de atas (vencimento ≤60 dias, adesões pendentes) com navegação direta
- **Nota de Empenho**: Consulta de notas por número e unidade gestora
- **Ordem Bancária**: Consulta de OBs por número e unidade gestora
- **Sincronização SIGEF**: Persiste transações do SIGEF no banco local para preservar vínculos de parcelas
  - Página dedicada de sincronização (`/sigef-sync`) com fila de tasks e progresso
  - `SyncHistoryService`: log persistente em localStorage de todas as operações de sync
  - `DashboardRefreshSchedulerService`: atualização silenciosa dos cards a cada 20min (apenas cache local, sem API)
  - **Sincronização manual**: API oficial consumida apenas sob demanda via botão "Sincronizar SIGEF"
  - Ciclos automáticos desativados — nenhuma chamada à API oficial é feita em segundo plano
  - Circuit-breaker com cooldown exponencial (30s-5min) contra timeouts da API
  - Botão "Reconectar" no cabeçalho para renovar token de acesso

## Campos do Contrato

| Campo | Coluna Banco |
|-------|--------------|
| Número do Contrato | `contrato` |
| Nº Processo SEI | `processo_sei` |
| Link Processo SEI | `link_sei` |
| Fornecedor | `contratada` |
| CNPJ | `cnpj_contratada` |
| Objeto | `objeto` |
| Data Início | `data_inicio` |
| Data Fim | `data_fim` |
| Dia Pagamento | `data_pagamento` |
| Valor Global | `valor_anual` |
| Valor Mensal | `valor_mensal` |
| Unidade Gestora | `unid_gestora` |
| Setor | `setor_id` |
| Tipo | `tipo` (serviço/material) |

## Tech Stack

- Angular 21 (standalone components)
- Tailwind CSS
- Supabase (banco de dados)
- API SIGEF (dados governamentais)
- D3.js (visualizações)
- jsPDF + jspdf-autotable (geração de relatórios PDF)
- Vite (build tool)

## Getting Started

### Pré-requisitos

- Node.js 18+
- npm ou yarn

### Instalação

```bash
npm install
```

### Configuração

As variáveis de ambiente estão configuradas em `src/environments/environment.ts`.

### Executar Desenvolvimento

```bash
npm run dev
```

Acesse: `http://localhost:4200`

### Build Produção

```bash
npm run build
```

## Integração SIGEF

### Unidades Gestoras
- **080101** - DPEMA (Defensoria Pública do Estado do Maranhão)
- **080901** - FADEP (Fundo de Aparência da Defensoria Pública)

### Proxy
O Angular proxy redireciona `/sigef-api/*` para `https://api.seplan.ma.gov.br/api/v1/*`

### Autenticação SIGEF
- Login automático com credenciais do `environment.ts` ao iniciar
- Tokens (access + refresh) persistidos no `localStorage` do navegador
- Botão "Reconectar" no cabeçalho: **tenta refresh primeiro** (`/token/refresh/`), se falhar faz login completo
- `revalidateToken()` → `ensureAuthenticated(true)`: sempre tenta `refreshAccessToken()` primeiro (fix: `!force` removido em `sigef.service.ts:441`)

## Estrutura do Projeto

```
src/
├── core/services/       # Serviços (SIGEF, Supabase, Context)
│   ├── sigef.service.ts          # API SIGEF (chamadas, retry, backoff, fila serial)
│   ├── sigef-cache.service.ts    # Cache local (sigef_ne_movimentos, sigef_ordens_bancarias)
│   ├── sigef-mirror.service.ts   # Espelho bruto da API (import_sigef_*)
│   ├── sigef-bulk-sync.service.ts # Download bulk com anti-flood e cooldown
│   ├── sigef-sync.service.ts     # Orquestração mirror → cache → signals
│   ├── sigef-scheduler.service.ts # Sincronização manual (ciclos automáticos desativados)
│   ├── sync-history.service.ts   # Log persistente de sincronização (localStorage)
│   ├── dashboard-refresh-scheduler.service.ts # Refresh silencioso dos cards
│   ├── app-context.service.ts    
│   └── supabase.service.ts
├── features/            # Páginas e componentes por módulo
│   ├── atas/            # Gestão de atas de licitação
│   │   ├── pages/       # atas
│   │   ├── components/  # ata-form, ata-saldo-panel
│   │   └── services/    # ata.service.ts, saldo-ata.service.ts, ata-pdf.service.ts, ata-export.service.ts
│   ├── budget/          # Gestão de dotações
│   ├── contracts/       # Gestão de contratos
│   │   ├── pages/       # contracts, contract-details
│   │   ├── components/  # contract-card, contract-form, aditivo-form
│   │   └── services/    # contract.service.ts
│   ├── dashboard/       # Dashboard com métricas
│   ├── financial/        # Dados financeiros
│   ├── nota-empenho/    # Consulta NE via SIGEF
│   ├── ordem-bancaria/  # Consulta OB via SIGEF
│   └── suppliers/       # Gestão de fornecedores
├── shared/              # Modelos, utils, componentes reutilizáveis
└── environments/        # Configurações por ambiente
```

## Banco de Dados

- **Supabase**: https://xhowiwekqliqfckndupo.supabase.co
- **Tabelas**: contratos, aditivos, dotacoes, fornecedores, transacoes, atas, ata_itens, ata_consumo_interno, ata_adesoes, sigef_notas_empenho, sigef_ne_movimentos, sigef_ordens_bancarias, import_sigef_ne, import_sigef_ob, sigef_sync_periods
- **Views**: vw_saldo_dotacoes, vw_recent_payments, vw_atas_resumo, vw_ata_saldo_item (com limites legais: limite_individual, limite_coletivo, saldo_adesao), vw_ata_saldo_resumo, vw_ob_por_contrato, vw_obs_nao_sincronizadas, vw_transacoes_vs_obs
- **Migrations**: `supabase/migrations/` (aplicar no SQL Editor do Supabase)

### Migrations Recentes

| # | Arquivo | Descrição |
|---|---------|-----------|
| 033 | `033_atualizar_valor_mensal_contratos.sql` | Atualiza `contratos.valor_mensal` com base no aditivo vigente mais recente |
| 034 | `034_recalcular_totais_liquidos_contratos.sql` | Recalcula `total_empenhado` e `saldo_a_pagar` descontando anulações |
| 036 | `036_create_vw_ata_saldo_limites.sql` | Atualiza `vw_ata_saldo_item` com colunas de limites legais (Art. 86): `limite_individual` (50%), `limite_coletivo` (200%), `saldo_adesao` |
| 999 | `999_atualizacao_unidade_gestora_e_views.sql` | Adiciona `unidade_gestora_label`, recria `vw_recent_payments` com dados de UG, cria views de diagnóstico |

### Scripts de Manutenção (sql/)

| # | Arquivo | Descrição |
|---|---------|-----------|
| 01 | `01_OTIMIZACAO_INDICES.sql` | Cria índices faltantes para otimização de consultas |
| 02 | `02_CORRECAO_DADOS_FINANCEIROS.sql` | Recalcula totais de dotações e contratos com fórmula unificada |
| 03 | `03_LIMPEZA_OBJETOS_NAO_UTILIZADOS.sql` | Remove views, funções e tabelas legadas não referenciadas no código |
| 04 | `04_DEFINIR_VIEWS_FALTANTES.sql` | Cria views referenciadas no código mas sem definição no repositório |
| 05 | `05_LIMPEZA_CACHE_E_TABELAS.sql` | Remove tabelas backup legadas, cache antigo (cache-mov/aggr/ob), recalcula totais |
| 06 | `06_VACUUM_ANALYZE.sql` | Reclama espaço após limpeza (executar fora de transação via psql) |
| 07 | `07_FIX_RLS_E_VIEWS.sql` | Corrige erro 500: desabilita RLS nas tabelas de cache do SIGEF, recria views com definições corretas |
| 08 | `08_DIAGNOSTICO_VINCULACOES.sql` | Diagnostica e corrige vinculações entre contratos, dotações e transações |
| 09 | `09_LIMPEZA_MIRROR_CACHE_ORFAOS.sql` | Remove do mirror/cache todas as NE/OB não vinculadas a contratos cadastrados; reseta sync_periods |
| 10 | `10_CORRIGIR_PAGAMENTOS_CONTRATO_014_2026.sql` | Corrige pagamentos incorretos do contrato 014/2026: remove OBs órfãs, recalcula totais |
| 11 | `11_LIMPEZA_TOTAL_PAGAMENTOS.sql` | Remove TODOS os pagamentos (OB/LIQUIDATION) de todos os contratos para recarga limpa via SIGEF |
| 12 | `12_SANITIZACAO_COMPLETA_SIGEF.sql` | Remove COMPLETAMENTE mirror, cache e transacoes do SIGEF; zera totais; diagnóstico de dotações orfãs |

### Tabela `aditivos`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | UUID | PK |
| contrato_id | UUID | FK → contratos |
| tipo_id | UUID | FK → tipo_aditivo |
| numero | INTEGER | Número sequencial do aditivo |
| data_inicio_nova | DATE | Nova data de início (aditivos de prazo) |
| data_fim_novo | DATE | Nova data de fim (aditivos de prazo) |
| valor_adicional | DECIMAL | Valor adicional (aditivos de valor) |
| novo_objeto | TEXT | Novo objeto (aditivos de objeto) |
| nova_razao_social | VARCHAR(255) | Nova razão social (aditivos MUDANCA_RAZAO_SOCIAL) |
| novo_cnpj | VARCHAR(20) | Novo CNPJ (aditivos MUDANCA_RAZAO_SOCIAL) |
| data_inicio_novo | DATE | Data de início da mudança |
| observacao | TEXT | Observações |
| created_at | TIMESTAMP | Data de criação |
| updated_at | TIMESTAMP | Data de atualização |

## License

MIT
