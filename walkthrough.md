# SICOP - Walkthrough

## Primeiros Passos

### Instalação

```bash
npm install
```

### Executar Ambiente de Desenvolvimento

```bash
npm run dev
```

A aplicação estará disponível em `http://localhost:4200`

**Nota**: O proxy para a API SIGEF está configurado nesta porta. Verifique se a porta 4200 está disponível.

### Build de Produção

```bash
npm run build
```

## Navegação

A aplicação possui uma sidebar com os seguintes itens:

1. **Dashboard**: Visão geral com métricas e alertas
2. **Contratos**: Lista de contratos, detalhes e formulários
3. **Financeiro**: Dados de Notas de Empenho (dados integrados via SIGEF)
4. **Orçamento**: Gestão de dotações orçamentárias
5. **Fornecedores**: Cadastro e gestão de fornecedores
6. **Nota de Empenho**: Consulta de notas de engajho via API SIGEF

## Funcionalidades Principais

### Seletor de Ano
No header, há um seletor de ano que filtra todos os dados da aplicação conforme o ano fiscal selecionado.

### Dashboard
- Cards com métricas: Total de contratos, valor total, contratos ativos
- Alertas visuais para contratos próximos do vencimento (≤90 dias)

### Contratos

#### Lista de Contratos
- Abas para filtrar por status:
  - **Vigentes**: Contratos ativos (não rescindidos e não expirados)
  - **Finalizados**: Contratos expirados
  - **Rescindidos**: Contratos rescindidos
- Busca com 3+ caracteres que pesquisa em TODOS os contratos independente da aba
- Layout em grid ou lista

#### Formulário de Contrato
Para criar ou editar um contrato:

1. Clique em "Novo Contrato"
2. Preencha os campos:
   - **Número do Contrato** (ex: 124/2024)
   - **Nº Processo SEI**
   - **Fornecedor**: Digite para buscar (autocomplete). Se não encontrar, clique em "Cadastrar novo fornecedor"
   - **Objeto do Contrato**
   - **Data de Início** e **Data de Fim**
   - **Valor Global (R$)**
   - **Unidade Gestora**: 080101 - DPEMA ou 080901 - FADEP
   - **Setor Responsável**: GABINETE, JURIDICO, ADMINISTRATIVO, etc.
   - **Status Inicial**
   - **Gestor do Contrato** (opcional)
   - **Fiscal Administrativo** (opcional)
   - **Fiscal Técnico** (opcional)
3. Clique em "Salvar"

#### Detalhes do Contrato
A página de detalhes possui abas:
- **Visão Geral**: Dados do contrato, objeto, informações financeiras
- **Aditivos**: Lista de aditivos (criar, editar, excluir)
- **Dotações**: Dotações orçamentárias vinculadas
- **Financeiro**: Transações e Notas de Empenho

### Aditivos

#### Criar Aditivo
1. Na aba Aditivos do contrato, clique em "+ Aditivo"
2. Preencha:
   - **Número do Aditivo** (ex: 01/2026)
   - **Tipo**: Alteração (Valor/Objeto) ou Prorrogação de Prazo
   - **Data da Assinatura**
   - **Nova Vigência** (obrigatório apenas para Prorrogação)
   - **Valor do Aditivo**
3. Clique em "Adicionar"

#### Editar Aditivo
1. Na lista de aditivos, clique no ícone de editar (lápis)
2. Modifique os campos necessários
3. Clique em "Salvar"

#### Excluir Aditivo
1. Na lista de aditivos, clique no ícone de excluir (lixeira)
2. Confirme a exclusão

### Aba Dotações
- Criar nova dotação com formulário
- Editar dotação existente (clicar no ícone de edição)
- Excluir dotação
- Vincular Nota de Empenho via API SIGEF

### Aba Financeiro
- KPIs: Total Empenhado, Total Pago, Saldo a Pagar
- Tabela de lançamentos com coluna de Nota de Empenho
- Exibe NE vinculada a cada lançamento

## Integração SIGEF

### Autenticação
- Automática com credenciais do ambiente
- Token armazenado em memória
- Refresh automático quando expirado

### Consulta de Nota de Empenho
1. Selecione a **Unidade Gestora**:
   - **080101** - DPEMA
   - **080901** - FADEP
2. Digite o número da NE (ex: 2026NE000302)
3. Clique em "Buscar"
4. Sistema consulta API considerando UG + NE
5. Exibe dados: valor, data, credor, processo, natureza da despesa, histórico

#### Vincular NE à Dotação
1. Acesse contrato → aba Dotações
2. Crie ou edite uma dotação
3. No campo "Vincular Nota de Empenho", digite o número da NE
4. Clique em "Buscar"
5. Sistema verifica a NE na API considerando a UG selecionada
6. Se encontrada, exibe resumo da NE e vincula ao salvar

## Estrutura de Dados

### Proxy para API SIGEF
Requisições para `/sigef-api/*` são redirecionadas para `https://api.seplan.ma.gov.br/api/v1/*`

### Tabelas do Supabase
- `contratos` - Cadastro de contratos
- `aditivos` - Aditivos de contratos
- `dotacoes` - Dotações orçamentárias (com campo `nunotaempenho` para vinculação de NE)
- `fornecedores` - Cadastro de fornecedores
- `vw_saldo_dotacoes` - View com saldos das dotações

### Integração com SIGEF
A API retorna Notas de Empenho com os campos:
- `nunotaempenho` - Número da NE
- `cdunidadegestora` - Código da UG
- `vlnotaempenho` - Valor
- `dtlancamento` - Data de lançamento
- `cdnaturezadespesa` - Natureza da despesa
- `demodalidadeempenho` - Modalidade
- `dehistorico` - Histórico da NE
