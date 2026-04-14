# SICOP - Sistema de Contratos Públicos

Sistema web para gestão de contratos públicos com integração ao SIGEF (Sistema de Informação de Gestão e Fiscalização).

## Funcionalidades

- **Dashboard**: Métricas gerais, alertas de contratos próximos ao vencimento (≤90 dias), gráficos de distribuição
- **Gestão de Contratos**: Cadastro, edição, aditivos e acompanhamento
  - Abas: Vigentes, Finalizados, Rescindidos
  - Busca em todos os contratos (3+ caracteres)
  - Formulário com autocomplete de fornecedores
  - Campos: Unidade Gestora, Setor, Gestor do Contrato, Fiscais, Processo SEI, Link SEI
- **Controle Financeiro**: 
  - Visualização de Notas de Empenho via API SIGEF
  - Lançamentos de Empenho, Reforço, Anulação e Liquidação
  - Busca de Ordens Bancárias
- **Orçamento**: Controle de dotações orçamentárias com vinculação de NE
- **Fornecedores**: Cadastro e gestão de fornecedores
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
- **Tabelas**: contratos, aditivos, dotacoes, fornecedores, transacoes
- **Views**: vw_saldo_dotacoes, vw_contratos_vigencia

## License

MIT
