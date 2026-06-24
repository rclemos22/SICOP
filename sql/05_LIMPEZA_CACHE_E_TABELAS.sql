-- =============================================================
-- 05_LIMPEZA_CACHE_E_TABELAS.sql
--
-- Script final de consolidação do banco após as modificações:
--
-- 1. Remove tabelas de backup legadas (backup_2025_*)
-- 2. Remove tabelas mirror não mais utilizadas (import_sigef)
-- 3. Remove entradas de cache antigo do SIGEF (cache-mov-%,
--    cache-aggr-%, cache-ob-%) que o próprio código já deleta
-- 4. Recalcula totais financeiros de dotacoes e contratos
-- 5. Verifica consistência dos dados
-- 6. Reclama espaço com VACUUM
--
-- Execute APÓS os scripts 01-04 e as migrations do Supabase.
-- =============================================================

BEGIN;

-- =============================================================
-- 1. REMOVER TABELAS DE BACKUP LEGADAS
--    backup_2025_06_20 e backup_2025_06_22
--    Criadas durante debugging de sync, nunca referenciadas
--    no código TypeScript.
-- =============================================================
SELECT '--- 1. Removendo tabelas de backup legadas ---' AS etapa;

DROP TABLE IF EXISTS public.backup_2025_06_20_transacoes CASCADE;
DROP TABLE IF EXISTS public.backup_2025_06_22_transacoes CASCADE;

-- =============================================================
-- 2. REMOVER TABELA MIRROR LEGADA
--    import_sigef (singular) foi substituída por
--    import_sigef_ne e import_sigef_ob. Nenhuma referência
--    no código TypeScript atual.
-- =============================================================
SELECT '--- 2. Removendo tabela mirror legada ---' AS etapa;

DROP TABLE IF EXISTS public.import_sigef CASCADE;

-- =============================================================
-- 3. REMOVER CACHE ANTIGO DO SIGEF EM transacoes
--    Remove entradas com sigef_id no formato OBSOLETO:
--      cache-mov-%   (movimentos)  → código deleta em sync
--      cache-aggr-%  (agregados)   → código deleta em sync
--      cache-ob-%    (ordens bancárias) → código deleta em sync
--
--    MANTÉM entradas no NOVO formato:
--      cache-com-%   (COMMITMENT)
--      cache-ref-%   (REINFORCEMENT)
--      cache-can-%   (CANCELLATION)
--      cache-liq-%   (LIQUIDATION)
-- =============================================================
SELECT '--- 3. Removendo cache antigo (cache-mov/aggr/ob) ---' AS etapa;

DELETE FROM public.transacoes
WHERE sigef_id LIKE 'cache-mov-%'
   OR sigef_id LIKE 'cache-aggr-%'
   OR sigef_id LIKE 'cache-ob-%';

-- =============================================================
-- 4. RECALCULAR TOTAIS DAS DOTAÇÕES
--    Fórmula unificada:
--      total_empenhado = max(0, COMMITMENT + REINFORCEMENT - CANCELLATION)
--      total_pago      = LIQUIDATION
--      saldo_disponivel = max(0, valor_dotacao - total_empenhado)
-- =============================================================
SELECT '--- 4. Recalculando totais das dotacoes ---' AS etapa;

UPDATE public.dotacoes d
SET
  total_empenhado = GREATEST(0,
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.commitment_id = d.nunotaempenho
        AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
    ), 0)
    -
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.commitment_id = d.nunotaempenho
        AND t.type = 'CANCELLATION'
    ), 0)
  ),
  total_pago = COALESCE((
    SELECT SUM(ABS(amount))
    FROM public.transacoes t
    WHERE t.commitment_id = d.nunotaempenho
      AND t.type = 'LIQUIDATION'
  ), 0),
  saldo_disponivel = GREATEST(0,
    d.valor_dotacao
    - GREATEST(0,
        COALESCE((
          SELECT SUM(ABS(amount))
          FROM public.transacoes t
          WHERE t.commitment_id = d.nunotaempenho
            AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
        ), 0)
        -
        COALESCE((
          SELECT SUM(ABS(amount))
          FROM public.transacoes t
          WHERE t.commitment_id = d.nunotaempenho
            AND t.type = 'CANCELLATION'
        ), 0)
      )
  ),
  updated_at = NOW()
WHERE d.nunotaempenho IS NOT NULL;

-- =============================================================
-- 5. RECALCULAR TOTAIS DOS CONTRATOS
--    Agrega os valores corrigidos das dotações.
-- =============================================================
SELECT '--- 5. Recalculando totais dos contratos ---' AS etapa;

UPDATE public.contratos c
SET
  total_empenhado = (
    SELECT COALESCE(SUM(d.total_empenhado), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  ),
  total_pago = (
    SELECT COALESCE(SUM(d.total_pago), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  ),
  saldo_a_pagar = GREATEST(0,
    (
      SELECT COALESCE(SUM(d.total_empenhado), 0)
      FROM public.dotacoes d
      WHERE d.contract_id = c.id
    )
    -
    (
      SELECT COALESCE(SUM(d.total_pago), 0)
      FROM public.dotacoes d
      WHERE d.contract_id = c.id
    )
  ),
  data_ultimo_pagamento = (
    SELECT MAX(t.date)
    FROM public.transacoes t
    WHERE t.contract_id = c.id
      AND t.type = 'LIQUIDATION'
  ),
  updated_at = NOW()
WHERE EXISTS (
  SELECT 1 FROM public.dotacoes d WHERE d.contract_id = c.id
);

-- =============================================================
-- 6. VERIFICAR CONSISTÊNCIA
-- =============================================================
SELECT '--- 6. Verificando consistencia ---' AS etapa;

-- 6a. Cache antigo residual
SELECT 'cache antigo residual (deveria ser 0)' AS verificacao,
       COUNT(*) AS total
FROM public.transacoes
WHERE sigef_id LIKE 'cache-mov-%'
   OR sigef_id LIKE 'cache-aggr-%'
   OR sigef_id LIKE 'cache-ob-%';

-- 6b. Dotações com total_empenhado negativo
SELECT 'dotacoes com total_empenhado negativo' AS verificacao,
       COUNT(*) AS total
FROM public.dotacoes
WHERE total_empenhado < 0;

-- 6c. Dotações com divergência
SELECT 'dotacoes com divergencia' AS verificacao,
       d.id, d.nunotaempenho, d.contract_id,
       d.total_empenhado AS atual,
       GREATEST(0,
         COALESCE((
           SELECT SUM(ABS(amount))
           FROM public.transacoes t
           WHERE t.commitment_id = d.nunotaempenho
             AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
         ), 0)
         -
         COALESCE((
           SELECT SUM(ABS(amount))
           FROM public.transacoes t
           WHERE t.commitment_id = d.nunotaempenho
             AND t.type = 'CANCELLATION'
         ), 0)
       ) AS esperado
FROM public.dotacoes d
WHERE d.nunotaempenho IS NOT NULL
  AND d.total_empenhado != GREATEST(0,
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.commitment_id = d.nunotaempenho
        AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
    ), 0)
    -
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.commitment_id = d.nunotaempenho
        AND t.type = 'CANCELLATION'
    ), 0)
  );

-- 6d. Contratos com saldo_a_pagar divergente
SELECT 'contratos com saldo_a_pagar divergente' AS verificacao,
       c.id, c.contrato,
       c.total_empenhado, c.total_pago, c.saldo_a_pagar,
       GREATEST(0, c.total_empenhado - c.total_pago) AS saldo_esperado
FROM public.contratos c
WHERE c.total_empenhado > 0
  AND c.saldo_a_pagar != GREATEST(0, c.total_empenhado - c.total_pago);

-- 6e. Tabelas legadas que ainda existem
SELECT 'tabelas legadas ainda existentes' AS verificacao,
       table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name LIKE 'backup_%'
    OR table_name = 'import_sigef'
    OR table_name = 'sigef_sync_log'
  );

-- 6f. Views esperadas
SELECT 'views esperadas (devem existir)' AS verificacao,
       table_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN (
    'vw_saldo_dotacoes',
    'vw_recent_payments',
    'vw_atas_resumo',
    'vw_ata_saldo_item',
    'vw_ata_saldo_resumo',
    'vw_ob_por_contrato',
    'vw_obs_nao_sincronizadas',
    'vw_transacoes_vs_obs'
  );

-- =============================================================
-- 7. RELATÓRIO DE TAMANHO DAS TABELAS
-- =============================================================
SELECT '--- 7. Tamanho das tabelas apos limpeza ---' AS etapa;

SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS tamanho
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT LIKE 'backup_%'
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;

COMMIT;

SELECT '=== PARTE 1 CONCLUIDA ===' AS mensagem;
SELECT 'Execute agora 06_VACUUM_ANALYZE.sql para reclamar espaco.' AS instrucao;
