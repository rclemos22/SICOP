-- =============================================================
-- 22_LIMPEZA_TRANSACOES_DUPLICADAS_SIGEF.sql
--
-- Remove transações legadas duplicadas geradas pela transição
-- do sigef_id antigo (ex: cache-com-NE) para o formato indexado
-- (ex: cache-com-NE-0).
--
-- Afeta os contratos: 069/2025, 062/2024, 073/2026, 037/2026
-- =============================================================

BEGIN;

SELECT '--- 1. Removendo transações legadas duplicadas do SIGEF ---' AS etapa;

DELETE FROM public.transacoes t1
WHERE t1.sigef_id SIMILAR TO 'cache-(com|ref|can)-[^-]+'
  AND EXISTS (
    SELECT 1 
    FROM public.transacoes t2 
    WHERE t2.contract_id = t1.contract_id 
      AND t2.commitment_id = t1.commitment_id 
      AND t2.type = t1.type 
      AND t2.amount = t1.amount
      AND t2.sigef_id LIKE t1.sigef_id || '-%'
  );

SELECT '--- 2. Notificando PostgREST para recarregar o schema ---' AS etapa;
NOTIFY pgrst, 'reload schema';

COMMIT;
