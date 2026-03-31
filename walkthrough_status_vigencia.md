# Walkthrough: Correção do Status de Vigência

Implementei a correção na lógica de status para que contratos vencidos sejam identificados como **ENCERRADO**, em vez de permanecerem como "Finalizando". Essa alteração foi aplicada de forma que afeta todos os contratos atuais e futuros.

## Mudanças Realizadas

### 1. Modelo de Dados e Lógica de Negócio
#### [contract.model.ts](file:///d:/Documents/Antigravity/SICOP/src/shared/models/contract.model.ts)
- **Novo Status:** Adicionei o valor `ENCERRADO` ao enum `ContractStatus`.
- **Refatoração da Função:** A função `getEffectiveStatus` agora prioriza o status `RESCINDIDO`, seguido por `ENCERRADO` (se a data fim passou), e só depois `FINALIZANDO` (se faltar 90 dias ou menos).

### 2. Interface do Usuário (UI)
#### [status-badge.component.ts](file:///d:/Documents/Antigravity/SICOP/src/shared/components/status-badge/status-badge.component.ts)
- **Visualização:** O componente de badge agora reconhece o status `ENCERRADO`, exibindo o rótulo "Encerrado" com uma estilização cinza neutra, diferenciando-o visualmente dos contratos vigentes (verde) ou rescindidos (vermelho).

### 3. Banco de Dados (SQL)
#### [014_fix_status_vigencia.sql](file:///d:/Documents/Antigravity/SICOP/supabase/migrations/014_fix_status_vigencia.sql)
- **View do Banco:** Criei um novo arquivo de migração que atualiza a view `vw_contratos_vigencia`. A lógica do banco agora está em perfeita sincronia com o frontend, garantindo que qualquer consulta direta ao banco também reflita o status real de vigência.

> [!IMPORTANT]
> Devido a uma instabilidade momentânea na conexão com o servidor MCP do Supabase, não foi possível aplicar a migração SQL automaticamente. 
> **Por favor, execute o conteúdo do arquivo [014_fix_status_vigencia.sql](file:///d:/Documents/Antigravity/SICOP/supabase/migrations/014_fix_status_vigencia.sql) no seu editor SQL do Supabase para atualizar a View no banco de dados.**

## Verificação
- A aba "Vigentes" na tela de contratos agora filtrará corretamente apenas os contratos que ainda estão dentro do prazo.
- Contratos antigos aparecerão com a etiqueta cinza "Encerrado".
