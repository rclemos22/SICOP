-- =============================================================
-- 06_VACUUM_ANALYZE.sql
--
-- Reclama espaço após a limpeza.
-- Execute SEPARADAMENTE (fora de transação) após 05_LIMPEZA.
-- O VACUUM não pode rodar dentro de transaction block.
-- =============================================================

VACUUM ANALYZE public.transacoes;
VACUUM ANALYZE public.dotacoes;
VACUUM ANALYZE public.contratos;

SELECT '=== VACUUM ANALYZE CONCLUIDO ===' AS mensagem;
