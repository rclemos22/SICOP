# Plano de Implementação: Correção do Status de Vigência dos Contratos

Este plano descreve as alterações necessárias para corrigir a lógica de status de vigência, garantindo que contratos expirados sejam identificados corretamente como "ENCERRADO" em vez de "FINALIZANDO".

## User Review Required

> [!IMPORTANT]
> A alteração afetará a forma como os contratos são filtrados e exibidos na listagem. Contratos que já passaram da data de término não aparecerão mais na aba "Vigentes" por padrão, mas sim na aba "Encerrados" (ou através do filtro de status correspondente).

## Proposed Changes

### 1. Banco de Dados (SQL)

Atualizar a View que calcula os status dinamicamente.

#### [MODIFY] [SQL View: `vw_contratos_vigencia`](file:///d:/Documents/Antigravity/SICOP/supabase/migrations/012_ajustar_relacionamentos.sql)
- Modificar a lógica do `CASE` para diferenciar contratos expirados de contratos que estão apenas "finalizando".
- **Nova Lógica SQL:**
  ```sql
  CASE 
      WHEN c.status = 'RESCINDIDO' THEN 'RESCINDIDO'
      WHEN c.data_fim < CURRENT_DATE THEN 'ENCERRADO'
      WHEN (c.data_fim - CURRENT_DATE) <= 90 THEN 'FINALIZANDO'
      ELSE 'VIGENTE'
  END as status_efetivo
  ```

### 2. Modelo de Dados (TypeScript)

Atualizar as definições de tipos para suportar o novo status.

#### [MODIFY] [contract.model.ts](file:///d:/Documents/Antigravity/SICOP/src/shared/models/contract.model.ts)
- Adicionar `ENCERRADO = 'ENCERRADO'` ao enum `ContractStatus`.
- Atualizar a função utilitária `getEffectiveStatus()` para refletir a mesma lógica do banco de dados.

### 3. Frontend e Filtros

Garantir que a listagem de contratos lide corretamente com a nova categoria.

#### [MODIFY] [contracts-page.component.ts](file:///d:/Documents/Antigravity/SICOP/src/features/contracts/pages/contracts/contracts-page.component.ts)
- Revisar a lógica de filtragem para garantir que a aba "Vigentes" inclua apenas `VIGENTE` e `FINALIZANDO`.
- Garantir que a aba de contratos encerrados/expirados utilize o novo status `ENCERRADO`.

## Open Questions

- Deseja que o nome do status para contratos que passaram da data seja "ENCERRADO", "VENCIDO" ou "CONCLUÍDO"? (Vou assumir **ENCERRADO** como padrão, mas posso alterar).

## Verification Plan

### Automated/SQL Tests
- Executar query na view `vw_contratos_vigencia` para verificar se contratos com `data_fim` no passado retornam `ENCERRADO`.
- Verificar se contratos com vigor em 30 dias retornam `FINALIZANDO`.

### Manual Verification
1. Acessar a tela de **Contratos**.
2. Verificar se contratos antigos agora exibem o status "ENCERRADO".
3. Testar os filtros de status na barra lateral para confirmar se as novas categorias funcionam conforme o esperado.
