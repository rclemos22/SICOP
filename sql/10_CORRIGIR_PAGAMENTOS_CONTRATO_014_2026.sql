-- =============================================================
-- 10_CORRIGIR_PAGAMENTOS_CONTRATO_014_2026.sql
--
-- Contrato 014/2026 — NE 2026NE000040
-- Problema: Total Pago de R$ 16.291.531,78 muito acima da
-- dotação de R$ 196.750,00, indicando OBs de outras NEs
-- incorretamente vinculadas a esta NE no cache.
--
-- Ações:
--   1. Diagnóstico das OBs e transações atuais
--   2. Backup antes da limpeza
--   3. Remove OBs do cache (sigef_ordens_bancarias) para esta NE
--   4. Remove OBs do mirror (import_sigef_ob) para esta NE
--   5. Remove transações LIQUIDATION desta NE
--   6. Recalcula totais da dotação e do contrato
--   7. Reseta sigef_sync_periods para re-download
-- =============================================================

BEGIN;

-- =============================================================
-- 0. DIAGNÓSTICO — estado atual
-- =============================================================
SELECT '=== DIAGNOSTICO ANTES DA CORRECAO ===' AS etapa;

-- 0a. OBs no cache para NE 2026NE000040
SELECT 'OBs no cache (sigef_ordens_bancarias) para NE 2026NE000040:' AS info;
SELECT nuordembancaria, nudocumento, vltotal, dtpagamento, cdsituacaoordembancaria
FROM public.sigef_ordens_bancarias
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040'
ORDER BY vltotal DESC;

SELECT COUNT(*) AS total_obs_cache, COALESCE(SUM(vltotal), 0) AS soma_total
FROM public.sigef_ordens_bancarias
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

-- 0b. OBs no mirror para NE 2026NE000040
SELECT 'OBs no mirror (import_sigef_ob) para NE 2026NE000040:' AS info;
SELECT nuordembancaria, nudocumento, vltotal, dtpagamento, cdsituacaoordembancaria
FROM public.import_sigef_ob
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040'
ORDER BY vltotal DESC;

SELECT COUNT(*) AS total_obs_mirror, COALESCE(SUM(vltotal), 0) AS soma_total
FROM public.import_sigef_ob
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

-- 0c. Transacoes LIQUIDATION para esta NE
SELECT 'Transacoes LIQUIDATION para NE 2026NE000040:' AS info;
SELECT id, sigef_id, description, amount, date, document_number, ob_number
FROM public.transacoes
WHERE UPPER(TRIM(commitment_id)) = '2026NE000040'
  AND type = 'LIQUIDATION'
ORDER BY amount DESC;

SELECT COUNT(*) AS total_trans_liq, COALESCE(SUM(amount), 0) AS soma_total
FROM public.transacoes
WHERE UPPER(TRIM(commitment_id)) = '2026NE000040'
  AND type = 'LIQUIDATION';

-- 0d. Dotacao atual para esta NE
SELECT 'Dotacao atual:' AS info;
SELECT id, dotacao, valor_dotacao, total_empenhado, total_pago, total_cancelado, saldo_disponivel, contract_id
FROM public.dotacoes
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

-- 0e. Contrato 014/2026
SELECT 'Contrato 014/2026:' AS info;
SELECT id, contrato, contratada, total_empenhado, total_pago, saldo_a_pagar
FROM public.contratos
WHERE contrato LIKE '%014/2026%' OR contrato LIKE '%014%2026%';

-- =============================================================
-- 1. BACKUP
-- =============================================================
SELECT '--- 1. Criando backup dos registros afetados ---' AS etapa;

CREATE TABLE IF NOT EXISTS backup_10_sigef_ordens_bancarias AS
SELECT * FROM public.sigef_ordens_bancarias
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

CREATE TABLE IF NOT EXISTS backup_10_import_sigef_ob AS
SELECT * FROM public.import_sigef_ob
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

CREATE TABLE IF NOT EXISTS backup_10_transacoes_liq AS
SELECT * FROM public.transacoes
WHERE UPPER(TRIM(commitment_id)) = '2026NE000040'
  AND type = 'LIQUIDATION';

SELECT 'Backup concluido (backup_10_*)' AS resultado;

-- =============================================================
-- 2. REMOVER OBs DO CACHE (sigef_ordens_bancarias)
-- =============================================================
SELECT '--- 2. Removendo OBs do cache (sigef_ordens_bancarias) ---' AS etapa;

DELETE FROM public.sigef_ordens_bancarias
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

SELECT 'OBs removidas do cache' AS resultado;

-- =============================================================
-- 3. REMOVER OBs DO MIRROR (import_sigef_ob)
-- =============================================================
SELECT '--- 3. Removendo OBs do mirror (import_sigef_ob) ---' AS etapa;

DELETE FROM public.import_sigef_ob
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

SELECT 'OBs removidas do mirror' AS resultado;

-- =============================================================
-- 4. REMOVER TRANSAÇÕES LIQUIDATION DESTA NE
-- =============================================================
SELECT '--- 4. Removendo transacoes LIQUIDATION da NE 2026NE000040 ---' AS etapa;

DELETE FROM public.transacoes
WHERE UPPER(TRIM(commitment_id)) = '2026NE000040'
  AND type = 'LIQUIDATION';

SELECT 'Transacoes LIQUIDATION removidas' AS resultado;

-- =============================================================
-- 5. RECALCULAR TOTAIS DA DOTAÇÃO
-- =============================================================
SELECT '--- 5. Recalculando totais da dotacao ---' AS etapa;

UPDATE public.dotacoes d
SET
  total_empenhado = GREATEST(0,
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE UPPER(TRIM(t.commitment_id)) = UPPER(TRIM(d.nunotaempenho))
        AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
    ), 0)
    -
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE UPPER(TRIM(t.commitment_id)) = UPPER(TRIM(d.nunotaempenho))
        AND t.type = 'CANCELLATION'
    ), 0)
  ),
  total_pago = COALESCE((
    SELECT SUM(ABS(amount))
    FROM public.transacoes t
    WHERE UPPER(TRIM(t.commitment_id)) = UPPER(TRIM(d.nunotaempenho))
      AND t.type = 'LIQUIDATION'
  ), 0),
  total_cancelado = COALESCE((
    SELECT SUM(ABS(amount))
    FROM public.transacoes t
    WHERE UPPER(TRIM(t.commitment_id)) = UPPER(TRIM(d.nunotaempenho))
      AND t.type = 'CANCELLATION'
  ), 0),
  saldo_disponivel = GREATEST(0, d.valor_dotacao - GREATEST(0,
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE UPPER(TRIM(t.commitment_id)) = UPPER(TRIM(d.nunotaempenho))
        AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
    ), 0)
    -
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE UPPER(TRIM(t.commitment_id)) = UPPER(TRIM(d.nunotaempenho))
        AND t.type = 'CANCELLATION'
    ), 0)
  )),
  updated_at = NOW()
WHERE UPPER(TRIM(d.nunotaempenho)) = '2026NE000040';

SELECT 'Totais da dotacao recalculados' AS resultado;

-- =============================================================
-- 6. RECALCULAR TOTAIS DO CONTRATO
-- =============================================================
SELECT '--- 6. Recalculando totais do contrato ---' AS etapa;

UPDATE public.contratos c
SET
  total_empenhado = GREATEST(0, (
    SELECT COALESCE(SUM(COALESCE(d.total_empenhado, 0) - COALESCE(d.total_cancelado, 0)), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  )),
  total_pago = (
    SELECT COALESCE(SUM(d.total_pago), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  ),
  saldo_a_pagar = GREATEST(0, (
    SELECT COALESCE(SUM(COALESCE(d.total_empenhado, 0) - COALESCE(d.total_cancelado, 0) - COALESCE(d.total_pago, 0)), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  )),
  data_ultimo_pagamento = (
    SELECT MAX(t.date)
    FROM public.transacoes t
    WHERE t.contract_id = c.id
      AND t.type = 'LIQUIDATION'
  ),
  updated_at = NOW()
WHERE c.id IN (
  SELECT DISTINCT d.contract_id
  FROM public.dotacoes d
  WHERE UPPER(TRIM(d.nunotaempenho)) = '2026NE000040'
);

SELECT 'Totais do contrato recalculados' AS resultado;

-- =============================================================
-- 7. RESETAR SYNC PERIODS PARA ESTA NE
-- =============================================================
SELECT '--- 7. Resetando sigef_sync_periods para re-download ---' AS etapa;

DELETE FROM public.sigef_sync_periods;

SELECT 'sigef_sync_periods limpos' AS resultado;

-- =============================================================
-- 8. DIAGNÓSTICO FINAL
-- =============================================================
SELECT '=== DIAGNOSTICO POS-CORRECAO ===' AS etapa;

SELECT 'sigef_ordens_bancarias para NE 2026NE000040:' AS info,
       COUNT(*) AS qtde, COALESCE(SUM(vltotal), 0) AS soma
FROM public.sigef_ordens_bancarias
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

SELECT 'import_sigef_ob para NE 2026NE000040:' AS info,
       COUNT(*) AS qtde, COALESCE(SUM(vltotal), 0) AS soma
FROM public.import_sigef_ob
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

SELECT 'transacoes LIQUIDATION para NE 2026NE000040:' AS info,
       COUNT(*) AS qtde, COALESCE(SUM(amount), 0) AS soma
FROM public.transacoes
WHERE UPPER(TRIM(commitment_id)) = '2026NE000040'
  AND type = 'LIQUIDATION';

SELECT 'dotacao apos correcao:' AS info;
SELECT id, dotacao, valor_dotacao, total_empenhado, total_pago, total_cancelado, saldo_disponivel
FROM public.dotacoes
WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040';

SELECT 'contrato apos correcao:' AS info;
SELECT id, contrato, total_empenhado, total_pago, saldo_a_pagar
FROM public.contratos
WHERE id IN (
  SELECT DISTINCT contract_id
  FROM public.dotacoes
  WHERE UPPER(TRIM(nunotaempenho)) = '2026NE000040'
);

COMMIT;

-- =============================================================
-- INSTRUÇÕES PÓS-CORREÇÃO
-- =============================================================
SELECT '=== CORRECAO CONCLUIDA ===' AS mensagem;
SELECT 'Execute VACUUM ANALYZE public.sigef_ordens_bancarias;' AS cmd;
SELECT 'Execute VACUUM ANALYZE public.import_sigef_ob;' AS cmd;
SELECT 'Execute VACUUM ANALYZE public.transacoes;' AS cmd;
SELECT '' AS sep;
SELECT 'PROXIMOS PASSOS:' AS passo;
SELECT '1. Va no contrato 014/2026 e clique "Sincronizar SIGEF"' AS passo;
SELECT '2. Faca o download seletivo para NE 2026NE000040' AS passo;
SELECT '3. Verifique se as OBs carregadas agora estao corretas' AS passo;
