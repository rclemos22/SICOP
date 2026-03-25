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
│   └── nota-empenho/        # Consulta NE via SIGEF
├── shared/
│   ├── components/          # Componentes reutilizáveis
│   ├── models/              # TypeScript interfaces
│   └── utils/               # Funções utilitárias
└── environments/             # Configurações por ambiente
```

## Modelos de Dados Principais

### Contract
- `id`, `contrato`, `contratada`, `fornecedor_id`
- `data_inicio`, `data_fim`
- `valor_anual`, `status`, `setor_id`, `unid_gestora`
- `objeto`
- `gestor_contrato`, `fiscal_admin`, `fiscal_tecnico`
- `data_fim_efetiva`, `dias_restantes`, `status_efetivo`

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

### NotaEmpenho (SIGEF - API)
- `nunotaempenho`, `cdunidadegestora`, `cdgestao`, `cdcredor`
- `dtlancamento`, `tipo`, `cdnaturezadespesa`, `vlnotaempenho`
- `demodalidadeempenho`, `nuprocesso`, `dehistorico`, etc.

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

**Importante**: O tipo do aditivo é obtido via relação `tipo_aditivo(nome)` no Supabase.

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

### Dados Financeiros SIGEF
- Total Empenhado = Soma(Empenhos) - Soma(Cancelamentos)
- Total Pago = Soma(Pagamentos)
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

### 2. Gestão de Contratos
1. Lista com abas: Vigentes, Finalizados, Rescindidos
2. Busca com 3+ caracteres em todos os contratos
3. Formulário com autocomplete de fornecedores
4. Campos: UG, Setor, Gestor, Fiscais

### 3. Gestão de Aditivos
1. Criar, editar, excluir aditivos
2. Seleção de tipo: ADITIVO_PRAZO, ADITIVO_PRAZO_VALOR, etc.
3. Campo nova_vigencia aparece para tipos com prazo
4. Atualização automática do card com nova vigência efetiva

### 4. Gestão de Dotações
1. Acessar contrato → aba Dotações
2. Criar nova dotação ou editar existente
3. Vincular Nota de Empenho (busca via SIGEF)
4. Sistema exibe saldo, total emprenado

### 5. Lançamentos Financeiros
1. Exibe NE vinculada na tabela de lançamentos
2. Totais: Empenhado, Pago, Saldo a Pagar

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