-- =============================================================
-- 12_SANITIZACAO_COMPLETA_SIGEF.sql
--
-- Remove COMPLETAMENTE todos os dados do SIGEF (mirror, cache,
-- transacoes) mantendo apenas contratos, dotações e aditivos.
--
-- OBJETIVO: Eliminar NE/OB inconsistentes ou orfãs antes de
--           uma nova sincronia limpa.
--
-- ATENÇÃO: Antes de re-sincronizar, verifique o DIAGNÓSTICO e
-- corrija dotações que apontam para NEs erradas ou de outra UG.
--
-- FLUXO:
--   1. Backup completo
--   2. Diagnóstico das dotações (identifica NEs problemáticas)
--   3. Remove LIQUIDATION + transações órfãs
--   4. Limpa cache estruturado (sigef_notas_empenho, movimentos, OBs)
--   5. Limpa mirror (import_sigef_ne, import_sigef_ob)
--   6. Zera totais financeiros (dotacoes + contratos)
--   7. Reseta sigef_sync_periods
--   8. Diagnóstico final
-- =============================================================

BEGIN;

-- =============================================================
-- 1. BACKUP
-- =============================================================
SELECT '--- 1. Backup completo dos dados SIGEF ---' AS etapa;

CREATE TABLE IF NOT EXISTS backup_12_transacoes AS SELECT * FROM public.transacoes;
CREATE TABLE IF NOT EXISTS backup_12_sigef_notas_empenho AS SELECT * FROM public.sigef_notas_empenho;
CREATE TABLE IF NOT EXISTS backup_12_sigef_ne_movimentos AS SELECT * FROM public.sigef_ne_movimentos;
CREATE TABLE IF NOT EXISTS backup_12_sigef_ordens_bancarias AS SELECT * FROM public.sigef_ordens_bancarias;
CREATE TABLE IF NOT EXISTS backup_12_import_sigef_ne AS SELECT * FROM public.import_sigef_ne;
CREATE TABLE IF NOT EXISTS backup_12_import_sigef_ob AS SELECT * FROM public.import_sigef_ob;
CREATE TABLE IF NOT EXISTS backup_12_sigef_sync_periods AS SELECT * FROM public.sigef_sync_periods;

SELECT 'Backup concluido (backup_12_*)' AS resultado;

-- =============================================================
-- 2. DIAGNÓSTICO — DOTAÇÕES E NEs
-- =============================================================
SELECT '=== DIAGNOSTICO DE CONSISTENCIA ===' AS etapa;

-- 2a. Dotações por contrato (mostra UGs)
SELECT '--- 2a. Dotações por contrato ---' AS secao;
SELECT
  c.id AS contrato_id,
  c.contrato,
  c.unid_gestora AS ug_contrato,
  d.id AS dotacao_id,
  d.dotacao,
  d.unid_gestora AS ug_dotacao,
  d.nunotaempenho,
  d.valor_dotacao
FROM public.dotacoes d
INNER JOIN public.contratos c ON c.id = d.contract_id
WHERE d.nunotaempenho IS NOT NULL AND d.nunotaempenho != ''
ORDER BY c.contrato, d.dotacao;

-- 2b. Dotações sem contrato (órfãs)
SELECT '--- 2b. Dotacoes orfas (sem contrato valido) ---' AS secao;
SELECT
  d.id AS dotacao_id,
  d.dotacao,
  d.contract_id,
  d.nunotaempenho,
  d.unid_gestora,
  d.valor_dotacao
FROM public.dotacoes d
LEFT JOIN public.contratos c ON c.id = d.contract_id
WHERE c.id IS NULL
  AND d.nunotaempenho IS NOT NULL
  AND d.nunotaempenho != '';

-- 2c. Contratos sem dotações
SELECT '--- 2c. Contratos sem dotacoes ---' AS secao;
SELECT id, contrato, contratada, unid_gestora
FROM public.contratos c
WHERE NOT EXISTS (
  SELECT 1 FROM public.dotacoes d WHERE d.contract_id = c.id
);

-- 2d. NEs no cache que NAO estao em nenhuma dotacao com contrato valido
SELECT '--- 2d. NEs no cache sem vinculo valido com contrato ---' AS secao;
SELECT DISTINCT ne.nunotaempenho, ne.cdunidadegestora
FROM public.sigef_notas_empenho ne
WHERE NOT EXISTS (
  SELECT 1 FROM public.dotacoes d
  INNER JOIN public.contratos c ON c.id = d.contract_id
  WHERE UPPER(TRIM(d.nunotaempenho)) = UPPER(TRIM(ne.nunotaempenho))
);

-- 2e. Resumo antes da limpeza
SELECT '--- 2e. Resumo antes da limpeza ---' AS secao;
SELECT 'transacoes' AS tabela, COUNT(*) FROM public.transacoes
UNION ALL
SELECT 'sigef_notas_empenho', COUNT(*) FROM public.sigef_notas_empenho
UNION ALL
SELECT 'sigef_ne_movimentos', COUNT(*) FROM public.sigef_ne_movimentos
UNION ALL
SELECT 'sigef_ordens_bancarias', COUNT(*) FROM public.sigef_ordens_bancarias
UNION ALL
SELECT 'import_sigef_ne', COUNT(*) FROM public.import_sigef_ne
UNION ALL
SELECT 'import_sigef_ob', COUNT(*) FROM public.import_sigef_ob;

-- =============================================================
-- 3. REMOVER TODAS AS TRANSAÇÕES FINANCEIRAS
-- =============================================================
SELECT '--- 3. Removendo todas as transacoes financeiras ---' AS etapa;

DELETE FROM public.transacoes;

SELECT 'transacoes limpa' AS resultado;

-- =============================================================
-- 4. LIMPAR CACHE ESTRUTURADO
-- =============================================================
SELECT '--- 4. Limpando cache estruturado ---' AS etapa;

DELETE FROM public.sigef_ordens_bancarias;
DELETE FROM public.sigef_ne_movimentos;
DELETE FROM public.sigef_notas_empenho;

SELECT 'cache estruturado limpo' AS resultado;

-- =============================================================
-- 5. LIMPAR MIRROR
-- =============================================================
SELECT '--- 5. Limpando mirror ---' AS etapa;

DELETE FROM public.import_sigef_ob;
DELETE FROM public.import_sigef_ne;

SELECT 'mirror limpo' AS resultado;

-- =============================================================
-- 6. ZERAR TOTAIS FINANCEIROS
-- =============================================================
SELECT '--- 6. Zerando totais financeiros ---' AS etapa;

-- 6a. Dotações
UPDATE public.dotacoes
SET
  total_empenhado = 0,
  total_cancelado = 0,
  total_pago = 0,
  saldo_disponivel = valor_dotacao,
  updated_at = NOW();

-- 6b. Contratos
UPDATE public.contratos
SET
  total_empenhado = 0,
  total_pago = 0,
  saldo_a_pagar = 0,
  data_ultimo_pagamento = NULL,
  updated_at = NOW();

SELECT 'totais zerados' AS resultado;

-- =============================================================
-- 7. RESETAR SIGEF_SYNC_PERIODS
-- =============================================================
SELECT '--- 7. Resetando sigef_sync_periods ---' AS etapa;

DELETE FROM public.sigef_sync_periods;

SELECT 'sync_periods limpo' AS resultado;

-- =============================================================
-- 8. DIAGNÓSTICO FINAL
-- =============================================================
SELECT '=== DIAGNOSTICO POS-LIMPEZA ===' AS etapa;

SELECT 'transacoes' AS tabela, COUNT(*) FROM public.transacoes
UNION ALL
SELECT 'sigef_notas_empenho', COUNT(*) FROM public.sigef_notas_empenho
UNION ALL
SELECT 'sigef_ne_movimentos', COUNT(*) FROM public.sigef_ne_movimentos
UNION ALL
SELECT 'sigef_ordens_bancarias', COUNT(*) FROM public.sigef_ordens_bancarias
UNION ALL
SELECT 'import_sigef_ne', COUNT(*) FROM public.import_sigef_ne
UNION ALL
SELECT 'import_sigef_ob', COUNT(*) FROM public.import_sigef_ob
UNION ALL
SELECT 'contratos (preservado)', COUNT(*) FROM public.contratos
UNION ALL
SELECT 'dotacoes (preservado)', COUNT(*) FROM public.dotacoes;

COMMIT;

-- =============================================================
-- 9. INSTRUÇÕES PÓS-LIMPEZA
-- =============================================================
SELECT '=== SANITIZACAO CONCLUIDA ===' AS mensagem;

SELECT 'ANTES DE RE-SINCRONIZAR, revise o DIAGNOSTICO acima e:' AS passo;
SELECT '  - Exclua dotacoes orfas (secao 2b) que nao tem contrato valido' AS passo;
SELECT '  - Verifique se as UG da dotacao batem com a UG do contrato (secao 2a)' AS passo;
SELECT '  - Crie dotacoes para contratos sem nenhuma (secao 2c)' AS passo;
SELECT '' AS sep;
SELECT 'APOS REVISAR AS DOTACOES:' AS passo;
SELECT '1. Execute VACUUM ANALYZE nas 6 tabelas limpas' AS passo;
SELECT '2. Va em /sigef-sync e clique "Download Inicial"' AS passo;
SELECT '3. Apos concluir, clique "Atualizar Todos"' AS passo;
SELECT '4. Verifique contrato por contrato no Dashboard' AS passo;
