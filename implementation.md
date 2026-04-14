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
│   ├── contracts/           # Gestão de contratos
│   │   ├── pages/           # Páginas (contracts, contract-details)
│   │   ├── components/      # Componentes (contract-card, contract-form, aditivo-form, etc.)
│   │   └── services/        # Services (contract.service.ts)
│   ├── financial/           # Dados financeiros
│   ├── budget/              # Orçamento (dotações)
│   ├── suppliers/           # Fornecedores
│   ├── nota-empenho/        # Consulta NE via SIGEF
│   └── ordem-bancaria/      # Consulta OB via SIGEF
├── shared/
│   ├── components/          # Componentes reutilizáveis
│   ├── models/              # TypeScript interfaces
│   └── utils/               # Funções utilitárias
└── environments/             # Configurações por ambiente
```

## Modelos de Dados Principais

### Contract
- `id`, `contrato`, `processo_sei`, `link_sei`, `contratada`, `cnpj_contratada`, `fornecedor_id`
- `data_inicio`, `data_fim`
- `valor_anual`, `valor_mensal`, `status`, `setor_id`, `unid_gestora`
- `objeto`
- `gestor_contrato`, `fiscal_admin`, `fiscal_tecnico`
- `data_fim_efetiva`, `dias_restantes`, `status_efetivo`
- `tipo` ('serviço' | 'material')
- `data_pagamento` (dia do mês para pagamentos)
- `total_empenhado`, `total_pago`, `saldo_a_pagar`, `data_ultimo_pagamento`

### Aditivo
- `id`, `contract_id`, `numero_aditivo`, `tipo`
- `data_assinatura`, `nova_vigencia`, `valor_aditivo`

### TipoAditivo
- `id`, `nome` (ADITIVO_PRAZO, ADITIVO_PRAZO_VALOR, DISTRATO, etc.)
- `descricao`, `ativo`

### Dotacao
- `id`, `contract_id`, `numero_contrato`, `dotacao`
- `credito`, `data_disponibilidade`, `unid_gestora`
- `valor_dotacao`, `nunotaempenho` (vínculo com NE)
- `total_empenhado`, `total_pago`, `saldo_disponivel`

### Supplier
- `id`, `razao_social`, `nome_fantasia`, `cnpj`
- `email`, `telefone`, `categoria`, `endereco`
- `status` (ACTIVE, INACTIVE, BLOCKED), `desde`

### Transaction
- `id`, `contract_id`, `description`, `commitment_id`
- `date`, `type`, `amount`, `department`
- `budget_description`, `nunotaempenho`, `dotacao_id`

### NotaEmpenho (SIGEF - API)
- `nunotaempenho`, `cdunidadegestora`, `cdgestao`, `cdcredor`
- `dtlancamento`, `tipo`, `cdnaturezadespesa`, `vlnotaempenho`
- `demodalidadeempenho`, `nuprocesso`, `dehistorico`, etc.

### OrdemBancaria (SIGEF - API)
- `nuordembancaria`, `cdunidadegestora`, `cdgestao`, `cdevento`
- `nunotaempenho`, `cdcredor`, `vltotal`
- `dtlancamento`, `dtpagamento`, `cdsituacaoordembancaria`
- `deobservacao`, `definalidade`

## Unidades Gestoras Suportadas

- **080101** - DPEMA (Defensoria Pública do Estado do Maranhão)
- **080901** - FADEP (Fundo de Aparência da Defensoria Pública)

## Setores Disponíveis

- GABINETE
- JURIDICO
- ADMINISTRATIVO
- FINANCEIRO
- COMPRAS
- TECNOLOGIA
- RECURSOS_HUMANOS
- LICITAÇÕES

## Tipos de Aditivo

| Tipo | Descrição | Altera Prazo | Altera Valor |
|------|-----------|--------------|--------------|
| ADITIVO_PRAZO | Aditivo de Prazo | ✅ | ❌ |
| ADITIVO_PRAZO_VALOR | Aditivo de Prazo e Valor | ✅ | ✅ |
| ADITIVO_VALOR | Aditivo de Valor | ❌ | ✅ |
| ADITIVO_OBJETO | Aditivo de Objeto | ❌ | ❌ |
| DISTRATO | Distrato | ❌ | ❌ |
| PRORROGACAO | Prorrogação (legado) | ✅ | ❌ |
| ALTERACAO | Alteração (legado) | ❌ | ❌ |

## Regras de Negócio

### Status de Contrato
- **VIGENTE**: Contrato com mais de 90 dias restantes
- **FINALIZANDO**: Contrato com ≤90 dias restantes
- **RESCINDIDO**: Contrato rescindido

### Cálculo de Vigência Efetiva

O sistema recalcula automaticamente a vigência efetiva do contrato quando há aditivos:

```typescript
// 1. Identificar aditivos que alteram o prazo
const aditivosComVigencia = aditivos.filter(a => {
  const tipo = a.tipo.toUpperCase();
  return a.nova_vigencia && (tipo.includes('PRAZO') || tipo === 'PRORROGACAO');
});

// 2. Usar a data de vigência mais recente
const dataFimEfetiva = aditivosComVigencia[0]?.nova_vigencia || dataFimOriginal;

// 3. Recalcular dias restantes
const diasRestantes = Math.ceil((dataFimEfetiva - hoje) / dias);

// 4. Atualizar status efetivo
const statusEfetivo = diasRestantes <= 90 ? 'FINALIZANDO' : 'VIGENTE';
```

### Acompanhamento de Dotações e Empenho

O sistema busca automaticamente os valores de engajamento das dotações via API SIGEF:

```typescript
// 1. Para cada dotação com NE vinculada
if (budget.nunotaempenho) {
  // 2. Buscar detalhes da NE na API
  const neDetails = await sigefService.getNotaEmpenhoByNumber(
    currentYear,
    budget.nunotaempenho,
    budget.unid_gestora
  );
  
  // 3. Extrair vlnotaempenho
  const vlEmpenhado = neDetails.vlnotaempenho || 0;
  
  // 4. Calcular saldo = Dotação - Empenhado
  const saldo = budget.valor_dotacao - vlEmpenhado;
}
```

**Regras de Negócio:**
- A consulta à API ocorre **apenas uma vez** ao entrar na página de detalhes
- Não há re-atualização automática para evitar sobrecarga da API SIGEF
- O saldo pode ser negativo (vermelho) indicando necessidade de reforço
- Filtro por ano: apenas dotações do ano atual são somadas nos KPIs
- Pagamentos de anos anteriores podem ser buscado em anos posteriores (ex: NE de 2025 pode ter OB em 2026)

### Tipos de Transação Financeira
- **COMMITMENT** - Empenho Inicial
- **REINFORCEMENT** - Reforço de Empenho
- **CANCELLATION** - Anulação de Empenho
- **LIQUIDATION** - Pagamento (Ordem Bancária)

### Abas de Contratos
- **Vigentes**: Contratos não rescindidos e não expirados (com filtro por ano de exercício)
- **Finalizados**: Contratos expirados (mostra todos independente do ano)
- **Rescindidos**: Contratos rescindidos (mostra todos independente do ano)

### Busca de Contratos
- Quando o usuário digita 3+ caracteres, a busca retorna TODOS os contratos independente da aba selecionada
- A busca pesquisa por: número do contrato, nome da contratada, status

### Valor Atualizado do Contrato
```typescript
valorAtualizado = valorAnualOriginal + sum(Aditivos.valor_aditivo)
```

### Gestão de Aditivos
- CRUD completo: Create, Read, Update, Delete
- Ao salvar/excluir aditivo, atualiza automaticamente a lista de aditivos
- Campos: número, tipo, data assinatura, nova vigência, valor

### Consulta de Notas de Empenho
- A busca considera **Unidade Gestora + Número da NE**
- O sistema itera pelas páginas da API para encontrar o registro correto
- Garante que NEs com mesmo número em UGs diferentes sejam diferenciadas

### Consulta de Ordens Bancárias
- A busca considera **Unidade Gestora + Número da OB**
- O ano é extraído automaticamente dos 4 primeiros dígitos do número da OB
- O sistema itera pelas páginas da API para encontrar o registro correto

### Dados Financeiros SIGEF
- Total Empenhado = Soma(Empenhos) - Soma(Cancelamentos)
- Total Pago = Soma(Pagamentos via OB)
- Saldo = Total Empenhado - Total Pago

### Gestão de Dotações
- CRUD completo de dotações vinculadas a contratos
- Campo `nunotaempenho` opcional para vincular NE
- View `vw_saldo_dotacoes` para consulta com saldos

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

**Nota**: O servidor deve rodar na porta 4200 para o proxy funcionar corretamente (`npm run dev`).

## Configuração do Banco (Supabase)

### Tabela tipo_aditivo
```sql
CREATE TABLE public.tipo_aditivo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL UNIQUE,
    descricao TEXT,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Tabela aditivos (com FK)
```sql
CREATE TABLE public.aditivos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contratos(id) ON DELETE CASCADE,
    tipo_id UUID REFERENCES public.tipo_aditivo(id),
    numero_contrato TEXT,
    numero_aditivo TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'ALTERACAO',
    data_assinatura DATE,
    nova_vigencia DATE,
    valor_aditivo NUMERIC(15,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### View vw_contratos_vigencia
```sql
CREATE VIEW public.vw_contratos_vigencia AS
SELECT 
    c.*,
    c.data_fim AS data_fim_efetiva,
    -- Calculation handled in frontend based on additives
    NULL AS dias_restantes,
    NULL AS status_efetivo
FROM public.contratos c;
```

## Fluxo de Funcionalidades

### 1. Consulta de Nota de Empenho
1. Selecionar Unidade Gestora (080101 ou 080901)
2. Informar número da NE (ex: 2026NE000302)
3. Sistema consulta API SIGEF considerando UG + NE
4. Exibe dados da NE (valor, data, credor, histórico)

### 2. Consulta de Ordem Bancária
1. Selecionar Unidade Gestora (080101 ou 080901)
2. Informar número da OB (ex: 2026OB000656)
3. Sistema extrai ano automaticamente (2026) dos 4 primeiros dígitos
4. Sistema consulta API SIGEF considerando UG + OB
5. Exibe dados da OB (valor, data pagamento, credor, NE vinculada, situação)

### 3. Gestão de Contratos
1. Lista com abas: Vigentes, Finalizados, Rescindidos
2. Busca com 3+ caracteres em todos os contratos
3. Formulário com autocomplete de fornecedores
4. Campos: UG, Setor, Gestor, Fiscais

### 4. Gestão de Aditivos
1. Criar, editar, excluir aditivos
2. Seleção de tipo: ADITIVO_PRAZO, ADITIVO_PRAZO_VALOR, DISTRATO, etc.
3. Campo nova_vigencia aparece para tipos com prazo
4. Atualização automática do card com nova vigência efetiva

### 5. Gestão de Dotações
1. Acessar contrato → aba Dotações
2. Criar nova dotação ou editar existente
3. Vincular Nota de Empenho (busca via SIGEF)
4. Sistema exibe saldo, total engajado

### 6. Lançamentos Financeiros
1. Exibe NE vinculada na tabela de lançamentos
2. Tipos: Empenho Inicial, Reforço, Anulação, Liquidação
3. Totais: Empenhado, Pago, Saldo a Pagar

## Executando Tests

O projeto utiliza ferramentas nativas do Angular. Para validação:
```bash
npm run build
```

## Migrações do Banco

### 001_create_dotacoes.sql
- Criação da tabela dotacoes

### 002_create_setores_e_tipos_aditivo.sql
- Criação da tabela tipo_aditivo
- População dos tipos: ADITIVO_PRAZO, ADITIVO_PRAZO_VALOR, DISTRATO, ADITIVO_VALOR, ADITIVO_OBJETO

### 003_add_fk_aditivos_tipo_aditivo.sql
- Adiciona coluna tipo_id na tabela aditivos
- Cria Foreign Key entre aditivos e tipo_aditivo
- Popula tipo_id baseado no campo tipo existente

## Funcionalidades Recentes

### Sincronização de Transações SIGEF

O sistema agora persiste transações do SIGEF no banco de dados local, permitindo:

1. **Aglomeração de OBs**: OBs da mesma NE com a mesma observação (ex: Pagamento Líquido + Impostos) são combinadas em uma única transação
2. **Preservação de Vínculos**: Parcelas vinculadas manualmente são mantidas após sincronização
3. **Limpeza de Legados**: Transações individuais antigas são removidas automaticamente

```typescript
// Sincroniza transações para um contrato específico
await financialService.syncSigefTransactions(contractId);

// Sincroniza todos os contratos do sistema
await financialService.syncAllSystemContracts();
```

### IDs de Transação

- Movimentos: `cache-mov-{ne}-{evento}-{idx}`
- OBs individuais: `cache-ob-{ob}-{doc}`
- OBs agrupadas: `cache-aggr-{ne}-{firstDoc}`

### Atualização de Total Pago após Vincular OB

Ao vincular uma OB a uma parcela, o sistema agora recalcula automaticamente os valores do SIGEF para atualizar o `total_pago` nos cards de dotações.

### Alerta de Saldo de Empenho Baixo

Novo card no dashboard que alerta quando o saldo de empenho (total_empenhado) é igual ou menor que 150% do valor estimado mensal do contrato. Este alerta ajuda a identificar dotações que podem precisar de reforço.
