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
│   └── nota-empenho/        # Consulta NE via SIGEF
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

### Dotacao
- `id`, `contract_id`, `numero_contrato`, `dotacao`
- `credito`, `data_disponibilidade`, `unid_gestora`
- `valor_dotacao`, `nunotaempenho` (vínculo com NE)
- `total_empenhado`, `total_pago`, `saldo_disponivel`

### NotaEmpenho (SIGEF - API)
- `nunotaempenho`, `cdunidadegestora`, `cdgestao`, `cdcredor`
- `dtlancamento`, `tipo`, `cdnaturezadespesa`, `vlnotaempenho`
- `demodalidadeempenho`, `nuprocesso`, `dehistorico`, etc.

### Transaction
- `id`, `contract_id`, `description`, `commitment_id`, `date`
- `type`, `amount`, `nunotaempenho` (NE vinculada)

## Unidades Gestoras Suportadas

- **080101** - DPEMA (Defensoria Pública do Estado do Maranhão)
- **080901** - FADEP (Fundo de Aparência da Defensoria Pública)

## Regras de Negócio

### Status de Contrato
- **VIGENTE**: Contrato com mais de 90 dias restantes
- **FINALIZANDO**: Contrato com ≤90 dias restantes
- **RESCINDIDO**: Contrato rescindido

### Valor Atualizado do Contrato
```typescript
valorAtualizado = valorAnualOriginal + sum(Aditivos.valor_aditivo)
```

### Consulta de Notas de Empenho
- A busca considera **Unidade Gestora + Número da NE**
- O sistema itera pelas páginas da API para encontrar o registro correto
- Garante que NEs com mesmo número em UGs diferentes sejam diferenciadas

### Dados Financeiros SIGEF
- Total Empenhado = Soma(Empenhos) - Soma(Cancelamentos)
- Total Pago = Soma(Pagamentos)
- Saldo = Total Empenhado - Total Pago

## Proxy de Desenvolvimento

O Angular utiliza proxy para redirecionar requisições para a API SIGEF:

```json
{
  "/sigef-api": {
    "target": "https://api.seplan.ma.gov.br",
    "secure": false,
    "changeOrigin": true,
    "pathRewrite": {
      "^/sigef-api": "/api/v1"
    }
  }
}
```

**Nota**: O servidor deve rodar na porta 4200 para o proxy funcionar corretamente (`npm start`).

## Variáveis de Ambiente (.env)

```
SIGEF_API_URL=/sigef-api
SIGEF_USERNAME=defensoria
SIGEF_PASSWORD=Consumo2025
SUPABASE_URL=URL do projeto Supabase
SUPABASE_KEY=chave anon do Supabase
```

## Fluxo de Funcionalidades

### 1. Consulta de Nota de Empenho
1. Selecionar Unidade Gestora (080101 ou 080901)
2. Informar número da NE (ex: 2026NE000302)
3. Sistema consulta API SIGEF considerando UG + NE
4. Exibe dados da NE (valor, data, credor, histórico)

### 2. Gestão de Dotações
1. Acessar contrato → aba Dotações
2. Criar nova dotação ou editar existente
3. Vincular Nota de Empenho (busca via SIGEF)
4. Sistema exibe saldo, total empenhado

### 3. Lançamentos Financeiros
1. Exibe NE vinculada na tabela de lançamentos
2. Totais: Empenhado, Pago, Saldo a Pagar

## Executando Tests

O projeto utiliza ferramentas nativas do Angular. Para validação:
```bash
npm run build
```
