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
7. **Ordem Bancária**: Consulta de ordens bancárias via API SIGEF

## Funcionalidades Principais

### Seletor de Ano
No header, há um seletor de ano que filtra todos os dados da aplicação conforme o ano fiscal selecionado.

### Dashboard
- Cards com métricas: Total de contratos, valor total, contratos ativos
- Gráfico de rosca de execução orçamentária (Empenhado vs Disponível)
- Gráfico de distribuição de contratos por status (Vigentes, Finalizando, Rescindidos)
- Lista de contratos próximos ao vencimento (≤90 dias)
- Tabela de últimos pagamentos

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

1. Clique em "Novo Contrato" ou vá até a página de detalhes do contrato e clique em "Editar"
2. Preencha os campos:
   - **Número do Contrato** (ex: 124/2024)
   - **Nº Processo SEI**
   - **Link Processo SEI** (opcional)
   - **Fornecedor**: Digite para buscar (autocomplete). O CNPJ é preenchido automaticamente. Se não encontrar, clique em "Cadastrar novo fornecedor"
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

**Nota**: O formulário detecta automaticamente se está em modo criação ou edição. Em modo edição, os campos são preenchidos com os dados existentes do contrato.

#### Detalhes do Contrato
A página de detalhes possui abas:
- **Visão Geral**: Dados do contrato, objeto, informações financeiras
- **Aditivos**: Lista de aditivos (criar, editar, excluir)
- **Dotações**: Dotações orçamentárias vinculadas
- **Financeiro**: Transações e Notas de Empenho

### Aditivos

#### Tipos de Aditivo
- **ADITIVO_PRAZO**: Altera apenas o prazo de vigência
- **ADITIVO_PRAZO_VALOR**: Altera prazo e valor simultaneamente
- **ADITIVO_VALOR**: Altera apenas o valor
- **ADITIVO_OBJETO**: Altera o objeto do contrato
- **DISTRATO**: Rescisão antecipada
- **ALTERACAO**: Alteração geral

#### Criar Aditivo
1. Na aba Aditivos do contrato, clique em "+ Aditivo"
2. Preencha:
   - **Número do Aditivo** (ex: 01/2026)
   - **Tipo**: Selecione o tipo de aditivo
   - **Data da Assinatura**
   - **Nova Vigência** (obrigatório para tipos de prazo)
   - **Valor do Aditivo**
3. Clique em "Adicionar"

#### Editar Aditivo
1. Na lista de aditivos, clique no ícone de editar (lápis)
2. Modifique os campos necessários
3. Clique em "Salvar"

#### Excluir Aditivo
1. Na lista de aditivos, clique no ícone de excluir (lixeira)
2. Confirme a exclusão

#### Impacto nos Cards de Contrato
Ao cadastrar um aditivo do tipo **ADITIVO_PRAZO** ou **ADITIVO_PRAZO_VALOR** com `nova_vigencia`, o sistema:
- Atualiza automaticamente `data_fim_efetiva` do contrato
- Recalcula `dias_restantes` baseado na nova data de término
- Atualiza o `status_efetivo` (VIGENTE ou FINALIZANDO) conforme os dias restantes

### Aba Dotações
- Criar nova dotação com formulário
- Editar dotação existente (clicar no ícone de edição)
- Excluir dotação
- Vincular Nota de Empenho via API SIGEF

#### Card de Dotação
Cada card de dotação exibe:
- **Dotação**: Valor planejado
- **Empenhado**: Valor que está engajado (buscado na API SIGEF via `vlnotaempenho`)
- **Saldo (D - E)**: Diferença entre dotação e engajado (verde se positivo, vermelho se negativo)
- Barra de progresso showing % utilizado
- Ao entrar na página, o sistema busca automaticamente o valor engajado para cada dotação com NE vinculada

### Aba Financeiro
- KPIs: Total Empenhado, Total Pago, Saldo a Pagar
- Tabela de lançamentos com coluna de Nota de Empenho
- Exibe NE vinculada a cada lançamento
- Tipos de lançamento: Empenho Inicial, Reforço, Anulação, Liquidação

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

### Consulta de Ordem Bancária
1. Selecione a **Unidade Gestora**:
   - **080101** - DPEMA
   - **080901** - FADEP
2. Digite o número da OB (ex: 2026OB000656)
3. O ano é extraído automaticamente dos 4 primeiros dígitos
4. Clique em "Buscar"
5. Sistema consulta API considerando UG + OB
6. Exibe dados: valor, data pagamento, credor, NE vinculada, situação

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
- `aditivos` - Aditivos de contratos (com FK para tipo_aditivo)
- `tipo_aditivo` - Tipos de aditivo disponíveis
- `dotacoes` - Dotações orçamentárias (com campo `nunotaempenho` para vinculação de NE)
- `fornecedores` - Cadastro de fornecedores
- `transacoes` - Transações financeiras
- `vw_saldo_dotacoes` - View com saldos das dotações
- `vw_contratos_vigencia` - View com contratos e vigência efetiva

### Integração com SIGEF
A API retorna Notas de Empenho com os campos:
- `nunotaempenho` - Número da NE
- `cdunidadegestora` - Código da UG
- `vlnotaempenho` - Valor
- `dtlancamento` - Data de lançamento
- `cdnaturezadespesa` - Natureza da despesa
- `demodalidadeempenho` - Modalidade
- `dehistorico` - Histórico da NE

A API retorna Ordens Bancárias com os campos:
- `nuordembancaria` - Número da OB
- `cdunidadegestora` - Código da UG
- `nunotaempenho` - NE vinculada
- `vltotal` - Valor
- `dtlancamento` - Data de lançamento
- `dtpagamento` - Data de pagamento
- `cdsituacaoordembancaria` - Situação
- `cdcredor` - Credor
