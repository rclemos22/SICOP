# SICOP - Sistema de Contratos Públicos

Sistema web para gestão de contratos públicos com integração ao SIGEF (Sistema de Informação de Gestão e Fiscalização).

## Funcionalidades

- **Dashboard**: Métricas gerais, alertas de pagamentos em atraso, saldo de empenho baixo, contratos próximos ao vencimento (≤90 dias), gráficos de distribuição. Cards de alerta com layout lado a lado, expansão para ver todos os itens. Gráfico comparativo financeiro exibe todos os contratos ativos sem limite.
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
  - **Saldo por item**: Painel com barras de progresso (consumido vs registrado)
  - **Consumo Interno**: Registro de consumo pelo órgão gerenciador (até 100% do item)
  - **Adesões (Carona)**: Solicitação, autorização e rejeição com validação dos limites legais (Decreto 11.462/2023 — até 50% por órgão, 50% total)
  - **Relatório PDF**: Exportação do relatório de saldo com tabela por item, consolidação e base legal
- **Nota de Empenho**: Consulta de notas por número e unidade gestora
- **Ordem Bancária**: Consulta de OBs por número e unidade gestora
- **Sincronização SIGEF**: Persiste transações do SIGEF no banco local para preservar vínculos de parcelas

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

## Estrutura do Projeto

```
src/
├── core/services/       # Serviços (SIGEF, Supabase, Context)
├── features/            # Páginas e componentes por módulo
│   ├── atas/            # Gestão de atas de licitação
│   │   ├── pages/       # atas
│   │   ├── components/  # ata-form, ata-saldo-panel
│   │   └── services/    # ata.service.ts, saldo-ata.service.ts, ata-pdf.service.ts
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
- **Tabelas**: contratos, aditivos, dotacoes, fornecedores, transacoes, atas, ata_itens, ata_consumo_interno, ata_adesoes
- **Views**: vw_saldo_dotacoes, vw_contratos_vigencia, vw_atas_resumo, vw_ata_saldo_item, vw_ata_saldo_resumo
- **Migrations**: `supabase/migrations/` (aplicar no SQL Editor do Supabase)

### Migrations Recentes

| # | Arquivo | Descrição |
|---|---------|-----------|
| 033 | `033_atualizar_valor_mensal_contratos.sql` | Atualiza `contratos.valor_mensal` com base no aditivo vigente mais recente |
| 034 | `034_recalcular_totais_liquidos_contratos.sql` | Recalcula `total_empenhado` e `saldo_a_pagar` descontando anulações |

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
