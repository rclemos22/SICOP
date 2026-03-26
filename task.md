# SICOP - Sistema de Contratos Públicos

## Tarefa do Projeto

Desenvolver um sistema web para gestão de contratos públicos que permita:

- **Gestão de Contratos**: Cadastro, acompanhamento e visualização de contratos com fornecedores
- **Controle Financeiro**: Acompanhamento de Notas de Empenho, liquidações e pagamentos via integração SIGEF
- **Gestão Orçamentária**: Controle de dotações e dotação suplementar
- **Cadastro de Fornecedores**: Gestão de fornecedores do setor público
- **Dashboard**: Visão geral com métricas e alertas de contratos próximos ao vencimento

## Requisitos Funcionais

1. Cadastro e edição de contratos com informações: número, contratada, objeto, valor anual, vigência
2. Registro de aditivos (alteração de prazo e valor) com edição e exclusão
3. Integração com API SIGEF para Notas de Empenho
4. Visualização de transações financeiras (empenho, pagamento, cancelamento)
5. Alertas automáticos para contratos com menos de 90 dias restantes
6. Selector de ano fiscal para filtragem de dados
7. Interface responsiva com sidebar de navegação
8. **Gestão de Dotações**: Cadastro, edição e exclusão de dotações vinculadas a contratos
9. **Vinculação de NE**: Associar Notas de Empenho às dotações via API SIGEF
10. **Controle por Unidade Gestora**: Suporte a UG 080101 (DPEMA) e 080901 (FADEP)

## Novas Funcionalidades Implementadas

### Tipos de Aditivo
- **ADITIVO_PRAZO**: Aditivo que altera apenas o prazo de vigência
- **ADITIVO_PRAZO_VALOR**: Aditivo que altera prazo e valor simultaneamente
- **ADITIVO_VALOR**: Aditivo que altera apenas o valor
- **ADITIVO_OBJETO**: Aditivo que altera o objeto do contrato
- **DISTRATO**: Rescisão antecipada do contrato
- **PRORROGACAO**: Prorrogação de vigência (legado)
- **ALTERACAO**: Alteração geral (legado)

### Cálculo de Vigência Efetiva do Contrato
- O sistema calcula `data_fim_efetiva`, `dias_restantes` e `status_efetivo` baseado nos aditivos
- Para tipos ADITIVO_PRAZO e ADITIVO_PRAZO_VALOR, usa a `nova_vigencia` do aditivo mais recente
- O status efetivo (VIGENTE/FINALIZANDO/RESCINDIDO) considera a nova data de término

### Relacionamento com tipo_aditivo
- Tabela `tipo_aditivo` armazena os tipos disponíveis de aditivos
- Tabela `aditivos` possui foreign key `tipo_id` para `tipo_aditivo`
- O tipo do aditivo é obtido via relação `tipo_aditivo(nome)` no Supabase

### Acompanhamento de Dotações e Empenho
- Cada dotação vinculada a um contrato pode ter uma Nota de Empenho (NE) associada
- Ao entrar na página de detalhes do contrato, o sistema busca automaticamente os valores de engajamento na API SIGEF
- O card de dotação exibe:
  - **Dotação**: Valor planejado da dotação
  - **Empenhado**: Valor extraído do campo `vlnotaempenho` da API SIGEF
  - **Saldo (D - E)**: Diferença entre dotação e engajado (pode ser negativo = vermelho)
- Barra de progresso showing % utilizado da dotação
- Consulta à API ocorre apenas uma vez ao entrar na página (não refaz em mudanças de estado)

### KPIs de Dotação (aba Orçamentária)
- **Total Empenhado**: Soma dos valores de engajamento das dotações do ano atual
- **Total Pago**: Soma dos valores pagos (implementado com 0)
- **Saldo Dotação**: Soma dos saldos (Dotação - Empenhado) das dotações do ano atual

### Formulário de Contratos - Mapeamento de Campos
| Campo Formulário | Coluna Banco |
|-----------------|--------------|
| Número do Contrato | `contrato` |
| Nº Processo SEI | `processo_sei` |
| Link Processo SEI | `link_sei` (opcional) |
| Fornecedor | `contratada` (via nome_fantasia) |
| CNPJ | `cnpj_contratada` (via cnpj) |
| Objeto do Contrato | `objeto` |
| Data Início | `data_inicio` |
| Data Fim | `data_fim` |
| Valor Global | `valor_anual` |
| Unidade Gestora | `unid_gestora` |
| Setor Responsável | `setor_id` |
| Status | `status` |
| Gestor do Contrato | `gestor_contrato` |
| Fiscal Administrativo | `fiscal_admin` |
| Fiscal Técnico | `fiscal_tecnico` |
| Fornecedor ID | `fornecedor_id` (FK) |

O formulário também possui autocomplete de fornecedores que preenche automaticamente o nome (nome_fantasia) e CNPJ.

### Edição de Contratos
- O botão **Editar** está disponível na página de detalhes do contrato
- Ao clicar, abre o formulário com os dados do contrato preenchidos
- Permite atualizar todos os campos incluindo gestores, fiscais, processo SEI, link SEI
- O sistema detecta se é criação ou edição e chama a API correta (addContract/updateContract)

### Página de Contratos
- Abas: **Vigentes**, **Finalizados**, **Rescindidos**
- Busca com 3+ caracteres que pesquisa em todos os contratos independente da aba
- Botão de filtros desabilitado temporariamente

### Aditivos
- **Criar** novos aditivos vinculados a contratos
- **Editar** aditivos existentes
- **Excluir** aditivos do banco de dados
- Atualização automática do card de Vigência baseada na `nova_vigencia`

### Interface
- Correção de cores no modo escuro para todos os formulários
- Uso de paleta **slate** para consistência visual
- Placeholders e textos visíveis no modo escuro

## Status: Concluído

Todas as funcionalidades listadas acima foram implementadas.