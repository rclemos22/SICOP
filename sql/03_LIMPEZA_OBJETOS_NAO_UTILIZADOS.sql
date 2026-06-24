-- =============================================================
-- 03_LIMPEZA_OBJETOS_NAO_UTILIZADOS.sql
--
-- Remove objetos do banco que NÃO são referenciados em nenhum
-- arquivo TypeScript do sistema:
--
-- Tabelas:
--   - sigef_sync_log       (criada em sigef_cache.sql, nunca usada no código)
-- 
-- Views:
--   - vw_sigef_ne_resumo   (criada em sigef_cache.sql, cálculos feitos em memória)
--   - vw_contratos_vigencia (mencionada em docs mas nunca usada no código)
--
-- Funções:
--   - fn_calcular_valor_empenhado  (usada apenas pela view acima)
--   - fn_calcular_valor_pago       (usada apenas pela view acima)
--   - fn_calcular_saldo_pagar      (usada apenas pela view acima)
--
-- ATENÇÃO: Execute 00_BACKUP_ANTES_ALTERACOES.sql ANTES.
--          Execute 04_DEFINIR_VIEWS_FALTANTES.sql DEPOIS.
-- =============================================================

BEGIN;

-- =============================================================
-- 1. REMOVER VIEWS não utilizadas
-- =============================================================

DROP VIEW IF EXISTS public.vw_sigef_ne_resumo CASCADE;
DROP VIEW IF EXISTS public.vw_contratos_vigencia CASCADE;

-- =============================================================
-- 2. REMOVER FUNÇÕES não utilizadas
-- =============================================================

DROP FUNCTION IF EXISTS public.fn_calcular_valor_empenhado(
  p_cdunidadegestora INTEGER,
  p_nunotaempenho VARCHAR
) CASCADE;

DROP FUNCTION IF EXISTS public.fn_calcular_valor_pago(
  p_cdunidadegestora INTEGER,
  p_nunotaempenho VARCHAR
) CASCADE;

DROP FUNCTION IF EXISTS public.fn_calcular_saldo_pagar(
  p_cdunidadegestora INTEGER,
  p_nunotaempenho VARCHAR
) CASCADE;

-- =============================================================
-- 3. REMOVER TABELA não utilizada
-- =============================================================

DROP TABLE IF EXISTS public.sigef_sync_log CASCADE;

-- =============================================================
-- 4. REMOVER POLICIES RLS órfãs (das tabelas removidas)
-- =============================================================

DROP POLICY IF EXISTS "Allow all for sigef_notas_empenho" ON public.sigef_notas_empenho;
DROP POLICY IF EXISTS "Allow all for sigef_ne_movimentos" ON public.sigef_ne_movimentos;
DROP POLICY IF EXISTS "Allow all for sigef_ordens_bancarias" ON public.sigef_ordens_bancarias;

-- =============================================================
-- 5. VERIFICAR ESPAÇO LIBERADO
-- =============================================================

SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS tamanho
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;

COMMIT;

SELECT 'Limpeza concluida.' AS mensagem;
