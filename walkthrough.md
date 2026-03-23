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

A aplicação estará disponível em `http://localhost:3000`

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
6. **Nota de Empenho**: Consulta de notas de empenho por ano

## Funcionalidades Principadas

### Seletor de Ano
No header, há um seletor de ano que filtra todos os dados da aplicação conforme o ano fiscal selecionado.

### Dashboard
- Cards com métricas: Total de contratos, valor total, contratos ativos
- Alertas visuais para contratos próximos do vencimento (≤90 dias)

### Contratos
- Lista com filtros e busca
- Status: VIGENTE, FINALIZANDO (≤90 dias), RESCINDIDO
- Detalhes com abas: Visão Geral, Aditivos, Financeiro
- Formulário de criação/edição de contratos

### Integração SIGEF
- Autenticação automática com credenciais do ambiente
- Consulta de Notas de Empenho por ano
- Dados financeiros somente leitura (visualização)