# SICOP - Sistema de Contratos Públicos

Sistema web para gestão de contratos públicos com integração ao SIGEF (Sistema de Informação de Gestão e Fiscalização).

## Funcionalidades

- **Dashboard**: Métricas gerais e alertas de contratos próximos ao vencimento
- **Gestão de Contratos**: Cadastro, edição, aditivos e acompanhamento
- **Controle Financeiro**: Visualização de Notas de Empenho via API SIGEF
- **Orçamento**: Controle de dotações orçamentárias
- **Fornecedores**: Cadastro e gestão de fornecedores
- **Nota de Empenho**: Consulta de notas por ano fiscal

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

Crie um arquivo `.env` com as variáveis:

```
SIGEF_API_URL=sua_url_api
SIGEF_USERNAME=seu_usuario
SIGEF_PASSWORD=sua_senha
SUPABASE_URL=sua_url_supabase
SUPABASE_KEY=sua_chave
```

### Executar Desenvolvimento

```bash
npm run dev
```

Acesse: `http://localhost:3000`

### Build Produção

```bash
npm run build
```

## Estrutura do Projeto

```
src/
├── core/services/       # Serviços (SIGEF, Supabase, Context)
├── features/            # Páginas e componentes por módulo
├── shared/              # Modelos, utils, componentes reutilizáveis
└── environments/        # Configurações por ambiente
```

## License

MIT