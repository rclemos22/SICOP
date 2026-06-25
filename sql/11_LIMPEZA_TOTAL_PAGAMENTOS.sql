-- =============================================================
-- 11_LIMPEZA_TOTAL_PAGAMENTOS.sql
--
-- Remove TODOS os dados de pagamento (OB/LIQUIDATION) de todos
-- os contratos para permitir recarga correta via sincronia SIGEF.
--
-- PRESERVA: Empenhos, Reforcos, Anulacoes (COMMITMENT, REINFORCEMENT,
-- CANCELLATION), NEs, movimentos de NE, dotações.
--
-- REMOVE: LIQUIDATION transactions, OBs do cache e mirror,
--          zera total_pago em dotacoes e contratos.
--
-- FLUXO:
--   1. Backup
--   2. Diagnostico antes
--   3. Remove LIQUIDATION de transacoes
--   4. Remove OBs de sigef_ordens_bancarias
--   5. Remove OBs de import_sigef_ob
--   6. Zera total_pago em dotacoes
--   7. Recalcula totais dos contratos (sem pagamentos)
--   8. Reseta sigef_sync_periods
--   9. Diagnostico depois
-- =============================================================

BEGIN;

-- =============================================================
-- 1. BACKUP
-- =============================================================
SELECT '--- 1. Backup dos dados de pagamento ---' AS etapa;

CREATE TABLE IF NOT EXISTS backup_11_transacoes_liq AS
SELECT * FROM public.transacoes WHERE type = 'LIQUIDATION';

CREATE TABLE IF NOT EXISTS backup_11_sigef_ordens_bancarias AS
SELECT * FROM public.sigef_ordens_bancarias;

CREATE TABLE IF NOT EXISTS backup_11_import_sigef_ob AS
SELECT * FROM public.import_sigef_ob;

SELECT 'Backups criados: backup_11_*' AS resultado;

-- =============================================================
-- 2. DIAGNÓSTICO ANTES
-- =============================================================
SELECT '--- 2. Diagnostico antes da limpeza ---' AS etapa;

SELECT 'transacoes LIQUIDATION' AS tabela, COUNT(*) AS registros FROM public.transacoes WHERE type = 'LIQUIDATION'
UNION ALL
SELECT 'sigef_ordens_bancarias', COUNT(*) FROM public.sigef_ordens_bancarias
UNION ALL
SELECT 'import_sigef_ob', COUNT(*) FROM public.import_sigef_ob
UNION ALL
SELECT 'sigef_notas_empenho (preservado)', COUNT(*) FROM public.sigef_notas_empenho
UNION ALL
SELECT 'sigef_ne_movimentos (preservado)', COUNT(*) FROM public.sigef_ne_movimentos
UNION ALL
SELECT 'import_sigef_ne (preservado)', COUNT(*) FROM public.import_sigef_ne;

SELECT 'Contratos com total_pago > 0:' AS info;
SELECT id, contrato, contratada, total_empenhado, total_pago, saldo_a_pagar
FROM public.contratos
WHERE COALESCE(total_pago, 0) > 0
ORDER BY total_pago DESC;

SELECT 'Soma total de pagamentos antes:' AS info;
SELECT COALESCE(SUM(amount), 0) AS soma_liquidations FROM public.transacoes WHERE type = 'LIQUIDATION';

-- =============================================================
-- 3. REMOVER TODAS AS LIQUIDATION DE transacoes
-- =============================================================
SELECT '--- 3. Removendo todas as LIQUIDATION de transacoes ---' AS etapa;

DELETE FROM public.transacoes WHERE type = 'LIQUIDATION';

GET DIAGNOSTICS v_liq_removed = ROW_COUNT;
-- (Nota: v_liq_removed e' apenas informativo no log PL/pgSQL)
SELECT 'Transacoes LIQUIDATION removidas' AS resultado;

-- =============================================================
-- 4. REMOVER TODAS AS OBs DO CACHE (sigef_ordens_bancarias)
-- =============================================================
SELECT '--- 4. Removendo todas as OBs do cache (sigef_ordens_bancarias) ---' AS etapa;

DELETE FROM public.sigef_ordens_bancarias;

SELECT 'sigef_ordens_bancarias limpa' AS resultado;

-- =============================================================
-- 5. REMOVER TODAS AS OBs DO MIRROR (import_sigef_ob)
-- =============================================================
SELECT '--- 5. Removendo todas as OBs do mirror (import_sigef_ob) ---' AS etapa;

DELETE FROM public.import_sigef_ob;

SELECT 'import_sigef_ob limpa' AS resultado;

-- =============================================================
-- 6. ZERAR total_pago NAS DOTAÇÕES
-- =============================================================
SELECT '--- 6. Zerando total_pago nas dotacoes ---' AS etapa;

UPDATE public.dotacoes
SET
  total_pago = 0,
  saldo_disponivel = GREATEST(0, valor_dotacao - GREATEST(0, COALESCE(total_empenhado, 0) - COALESCE(total_cancelado, 0))),
  updated_at = NOW();

SELECT 'total_pago zerado em todas as dotacoes' AS resultado;

-- =============================================================
-- 7. RECALCULAR TOTAIS DOS CONTRATOS (SEM PAGAMENTOS)
-- =============================================================
SELECT '--- 7. Recalculando totais dos contratos ---' AS etapa;

UPDATE public.contratos c
SET
  total_empenhado = GREATEST(0, (
    SELECT COALESCE(SUM(COALESCE(d.total_empenhado, 0) - COALESCE(d.total_cancelado, 0)), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  )),
  total_pago = 0,
  saldo_a_pagar = GREATEST(0, (
    SELECT COALESCE(SUM(COALESCE(d.total_empenhado, 0) - COALESCE(d.total_cancelado, 0) - COALESCE(d.total_pago, 0)), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  )),
  data_ultimo_pagamento = NULL,
  updated_at = NOW()
WHERE EXISTS (
  SELECT 1 FROM public.dotacoes d WHERE d.contract_id = c.id
);

SELECT 'Totais dos contratos recalculados (total_pago zerado)' AS resultado;

-- =============================================================
-- 8. RESETAR SIGEF_SYNC_PERIODS
-- =============================================================
SELECT '--- 8. Resetando sigef_sync_periods ---' AS etapa;

DELETE FROM public.sigef_sync_periods;

SELECT 'sigef_sync_periods limpo' AS resultado;

-- =============================================================
-- 9. DIAGNÓSTICO DEPOIS
-- =============================================================
SELECT '--- 9. Diagnostico depois da limpeza ---' AS etapa;

SELECT 'transacoes LIQUIDATION' AS tabela, COUNT(*) AS registros FROM public.transacoes WHERE type = 'LIQUIDATION'
UNION ALL
SELECT 'sigef_ordens_bancarias', COUNT(*) FROM public.sigef_ordens_bancarias
UNION ALL
SELECT 'import_sigef_ob', COUNT(*) FROM public.import_sigef_ob
UNION ALL
SELECT 'sigef_notas_empenho (preservado)', COUNT(*) FROM public.sigef_notas_empenho
UNION ALL
SELECT 'sigef_ne_movimentos (preservado)', COUNT(*) FROM public.sigef_ne_movimentos
UNION ALL
SELECT 'import_sigef_ne (preservado)', COUNT(*) FROM public.import_sigef_ne
UNION ALL
SELECT 'transacoes COMMITMENT+REINFORCEMENT+CANCELLATION (preservado)',
       COUNT(*) FROM public.transacoes WHERE type IN ('COMMITMENT', 'REINFORCEMENT', 'CANCELLATION');

SELECT 'Contratos apos limpeza:' AS info;
SELECT id, contrato, contratada, total_empenhado, total_pago, saldo_a_pagar
FROM public.contratos
ORDER BY total_empenhado DESC;

COMMIT;

-- =============================================================
-- 10. INSTRUÇÕES PÓS-LIMPEZA
-- =============================================================
SELECT '=== LIMPEZA TOTAL DE PAGAMENTOS CONCLUIDA ===' AS mensagem;

SELECT 'Execute VACUUM ANALYZE nas tabelas:' AS instrucao;
SELECT '  VACUUM ANALYZE public.transacoes;' AS cmd;
SELECT '  VACUUM ANALYZE public.sigef_ordens_bancarias;' AS cmd;
SELECT '  VACUUM ANALYZE public.import_sigef_ob;' AS cmd;

SELECT '' AS sep;
SELECT 'PROXIMOS PASSOS:' AS passo;
SELECT '1. Va na pagina de Sincronizacao SIGEF (/sigef-sync)' AS passo;
SELECT '2. Clique "Download Inicial" (bulk sync baixara apenas NEs cadastradas)' AS passo;
SELECT '3. Apos concluir, clique "Atualizar Todos" (syncAllContractsFinance)' AS passo;
SELECT '4. Verifique os contratos no Dashboard e na pagina financeira' AS passo;
SELECT '5. Confira se NE, OB, PP, NL estao corretos para cada contrato' AS passo;
