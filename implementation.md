# SICOP - Implementation Details

## Stack Tecnológico

- **Framework**: Angular 21 (standalone components)
- **Styling**: Tailwind CSS
- **Database**: Supabase (dados locais)
- **API Integration**: SIGEF (Sistema de Informação de Gestão e Fiscalização)
- **Build Tool**: Vite
- **Charts**: D3.js

## Estrutura de Diretórios

```
src/
├── app.component.ts          # Componente raiz com roteamento
├── core/
│   └── services/
│       ├── sigef.service.ts  # Integração API SIGEF
│       ├── supabase.service.ts # Banco de dados
│       ├── app-context.service.ts # Estado global (ano)
│       └── error-handler.service.ts
├── features/
│   ├── dashboard/            # Página inicial com métricas
│   ├── contracts/            # Gestão de contratos
│   ├── financial/            # Dados financeiros
│   ├── budget/               # Orçamento
│   ├── suppliers/           # Fornecedores
│   └── nota-empenho/        # Consulta NE
├── shared/
│   ├── components/           # Componentes reutilizáveis
│   ├── models/               # TypeScript interfaces
│   └── utils/                # Funções utilitárias
└── environments/             # Configurações por ambiente
```

## Modelos de Dados Principais

### Contract
- `id`, `contrato`, `contratada`, `data_inicio`, `data_fim`
- `valor_anual`, `status`, `setor_id`, `objeto`
- `data_fim_efetiva`, `dias_restantes`, `status_efetivo`

### Aditivo
- `id`, `contract_id`, `numero_aditivo`, `tipo`
- `data_assinatura`, `nova_vigencia`, `valor_aditivo`

### NotaEmpenho (SIGEF)
- `nuempenho`, `nmcredor`, `dtemissao`, `vlremessa`
- `vlliquidado`, `vlpago`, `dsnaturezadespesa`, etc.

## Regras de Negócio

### Status de Contrato
- **VIGENTE**: Contrato com mais de 90 dias restantes
- **FINALIZANDO**: Contrato com ≤90 dias restantes
- **RESCINDIDO**: Contrato rescindido

### Valor Atualizado do Contrato
```typescript
valorAtualizado = valorAnualOriginal + sum(Aditivos.valor_aditivo)
```

### Dados Financeiros SIGEF
- Total Empenhado = Soma(Empenhos) - Soma(Cancelamentos)
- Total Pago = Soma(Pagamentos)
- Saldo = Total Empenhado - Total Pago

## Variáveis de Ambiente (.env)

```
SIGEF_API_URL=URL da API SIGEF
SIGEF_USERNAME=usuário
SIGEF_PASSWORD=senha
SUPABASE_URL=URL do projeto Supabase
SUPABASE_KEY=chave anon do Supabase
```

## Executando Tests

O projeto utiliza ferramentas nativas do Angular. Para validação:
```bash
npm run build
```