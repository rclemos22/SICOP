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
2. Registro de aditivos (alteração de prazo e valor)
3. Integração com API SIGEF para Notas de Empenho
4. Visualização de transações financeiras (empenho, pagamento, cancelamento)
5. Alertas automáticos para contratos com menos de 90 dias restantes
6. Selector de ano fiscal para filtragem de dados
7. Interface responsiva com sidebar de navegação
8. **Gestão de Dotações**: Cadastro, edição e exclusão de dotações vinculadas a contratos
9. **Vinculação de NE**: Associar Notas de Empenho às dotações via API SIGEF
10. **Controle por Unidade Gestora**: Suporte a UG 080101 (DPEMA) e 080901 (FADEP)

## Status: Concluído

Todas as funcionalidades listadas acima foram implementadas e estão em produção.
