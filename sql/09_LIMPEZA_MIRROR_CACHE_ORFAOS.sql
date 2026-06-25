-- =============================================================
-- 09_LIMPEZA_MIRROR_CACHE_ORFAOS.sql
--
-- Remove do mirror (import_sigef_ne/ob) e cache estruturado
-- (sigef_notas_empenho, sigef_ne_movimentos, sigef_ordens_bancarias)
-- TODOS os registros de NE e OB que NÃO estão vinculados a
-- nenhum contrato cadastrado no sistema.
--
-- FLUXO:
--   1. Backup das tabelas mirror e cache
--   2. Identifica NEs vinculadas a contratos (via dotacoes.nunotaempenho)
--   3. Estatísticas antes da limpeza
--   4. Remove registros órfãos do cache estruturado
--   5. Remove registros órfãos do mirror
--   6. Remove transacoes órfãs
--   7. Reseta sigef_sync_periods para forçar re-download
--   8. Diagnóstico final
--
-- EXECUTE APÓS confirmar que todos os contratos e dotações
-- estão corretamente cadastrados no sistema.
-- =============================================================

BEGIN;

-- =============================================================
-- 1. BACKUP DAS TABELAS MIRROR E CACHE
-- =============================================================
SELECT '--- 1. Criando backup das tabelas mirror e cache ---' AS etapa;

CREATE TABLE IF NOT EXISTS backup_09_import_sigef_ne AS SELECT * FROM public.import_sigef_ne;
CREATE TABLE IF NOT EXISTS backup_09_import_sigef_ob AS SELECT * FROM public.import_sigef_ob;
CREATE TABLE IF NOT EXISTS backup_09_sigef_notas_empenho AS SELECT * FROM public.sigef_notas_empenho;
CREATE TABLE IF NOT EXISTS backup_09_sigef_ne_movimentos AS SELECT * FROM public.sigef_ne_movimentos;
CREATE TABLE IF NOT EXISTS backup_09_sigef_ordens_bancarias AS SELECT * FROM public.sigef_ordens_bancarias;
CREATE TABLE IF NOT EXISTS backup_09_sigef_sync_periods AS SELECT * FROM public.sigef_sync_periods;

SELECT 'Backups criados: backup_09_*' AS resultado;

-- =============================================================
-- 2. IDENTIFICAR NEs VINCULADAS A CONTRATOS
-- =============================================================
SELECT '--- 2. Identificando NEs vinculadas a contratos ---' AS etapa;

CREATE TEMP TABLE temp_nes_vinculadas AS
SELECT DISTINCT d.unid_gestora, TRIM(UPPER(d.nunotaempenho)) AS nunotaempenho
FROM public.dotacoes d
INNER JOIN public.contratos c ON c.id = d.contract_id
WHERE d.nunotaempenho IS NOT NULL AND d.nunotaempenho != '';

SELECT COUNT(*) AS total_nes_vinculadas_a_contratos FROM temp_nes_vinculadas;

-- =============================================================
-- 3. ESTATÍSTICAS ANTES DA LIMPEZA
-- =============================================================
SELECT '--- 3. Registros antes da limpeza ---' AS etapa;

SELECT 'sigef_notas_empenho' AS tabela, COUNT(*)::TEXT AS registros FROM public.sigef_notas_empenho
UNION ALL
SELECT 'sigef_ne_movimentos', COUNT(*)::TEXT FROM public.sigef_ne_movimentos
UNION ALL
SELECT 'sigef_ordens_bancarias', COUNT(*)::TEXT FROM public.sigef_ordens_bancarias
UNION ALL
SELECT 'import_sigef_ne', COUNT(*)::TEXT FROM public.import_sigef_ne
UNION ALL
SELECT 'import_sigef_ob', COUNT(*)::TEXT FROM public.import_sigef_ob;

-- =============================================================
-- 4. REMOVER REGISTROS ÓRFÃOS DO CACHE ESTRUTURADO
-- =============================================================
SELECT '--- 4. Removendo registros orfaos do cache estruturado ---' AS etapa;

-- 4a. sigef_notas_empenho
DELETE FROM public.sigef_notas_empenho ne
WHERE NOT EXISTS (
  SELECT 1 FROM temp_nes_vinculadas t
  WHERE t.nunotaempenho = TRIM(UPPER(ne.nunotaempenho))
);
SELECT 'sigef_notas_empenho' AS tabela, COUNT(*) AS removidos
FROM public.sigef_notas_empenho ne
WHERE NOT EXISTS (
  SELECT 1 FROM temp_nes_vinculadas t
  WHERE t.nunotaempenho = TRIM(UPPER(ne.nunotaempenho))
);
-- (NOTA: o SELECT acima mostra 0 porque o DELETE já rodou; usamos para log)

-- 4b. sigef_ne_movimentos
DELETE FROM public.sigef_ne_movimentos m
WHERE NOT EXISTS (
  SELECT 1 FROM temp_nes_vinculadas t
  WHERE t.nunotaempenho = TRIM(UPPER(m.nunotaempenho))
);

-- 4c. sigef_ordens_bancarias
DELETE FROM public.sigef_ordens_bancarias ob
WHERE ob.nunotaempenho IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM temp_nes_vinculadas t
     WHERE t.nunotaempenho = TRIM(UPPER(ob.nunotaempenho))
   );

-- =============================================================
-- 5. REMOVER REGISTROS ÓRFÃOS DO MIRROR
-- =============================================================
SELECT '--- 5. Removendo registros orfaos do mirror ---' AS etapa;

-- 5a. import_sigef_ne
DELETE FROM public.import_sigef_ne ne
WHERE NOT EXISTS (
  SELECT 1 FROM temp_nes_vinculadas t
  WHERE t.nunotaempenho = TRIM(UPPER(ne.nunotaempenho))
);

-- 5b. import_sigef_ob
DELETE FROM public.import_sigef_ob ob
WHERE ob.nunotaempenho IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM temp_nes_vinculadas t
     WHERE t.nunotaempenho = TRIM(UPPER(ob.nunotaempenho))
   );

-- =============================================================
-- 6. REMOVER TRANSAÇÕES ÓRFÃS (sem NE vinculada a contrato)
-- =============================================================
SELECT '--- 6. Removendo transacoes orfaas ---' AS etapa;

DELETE FROM public.transacoes t
WHERE t.commitment_id IS NOT NULL
  AND t.commitment_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM temp_nes_vinculadas tne
    WHERE tne.nunotaempenho = TRIM(UPPER(t.commitment_id))
  );

-- =============================================================
-- 7. RESETAR SIGEF_SYNC_PERIODS
-- =============================================================
SELECT '--- 7. Resetando sigef_sync_periods para forcar re-download ---' AS etapa;

DELETE FROM public.sigef_sync_periods;

-- =============================================================
-- 8. LIMPAR TABELA TEMPORÁRIA
-- =============================================================
DROP TABLE IF EXISTS temp_nes_vinculadas;

-- =============================================================
-- 9. DIAGNÓSTICO FINAL
-- =============================================================
SELECT '--- 9. Registros apos limpeza ---' AS etapa;

SELECT 'sigef_notas_empenho' AS tabela, COUNT(*)::TEXT AS registros_restantes FROM public.sigef_notas_empenho
UNION ALL
SELECT 'sigef_ne_movimentos', COUNT(*)::TEXT FROM public.sigef_ne_movimentos
UNION ALL
SELECT 'sigef_ordens_bancarias', COUNT(*)::TEXT FROM public.sigef_ordens_bancarias
UNION ALL
SELECT 'import_sigef_ne', COUNT(*)::TEXT FROM public.import_sigef_ne
UNION ALL
SELECT 'import_sigef_ob', COUNT(*)::TEXT FROM public.import_sigef_ob
UNION ALL
SELECT 'sigef_sync_periods', COUNT(*)::TEXT FROM public.sigef_sync_periods;

COMMIT;

-- =============================================================
-- 10. INSTRUÇÕES PÓS-LIMPEZA
-- =============================================================
SELECT '=== LIMPEZA CONCLUIDA ===' AS mensagem;

SELECT 'EXECUTE AGORA OS COMANDOS ABAIXO (fora da transacao):' AS instrucao;
SELECT '  VACUUM ANALYZE public.import_sigef_ne;' AS cmd;
SELECT '  VACUUM ANALYZE public.import_sigef_ob;' AS cmd;
SELECT '  VACUUM ANALYZE public.sigef_notas_empenho;' AS cmd;
SELECT '  VACUUM ANALYZE public.sigef_ne_movimentos;' AS cmd;
SELECT '  VACUUM ANALYZE public.sigef_ordens_bancarias;' AS cmd;
SELECT '  VACUUM ANALYZE public.transacoes;' AS cmd;

SELECT '=== PROXIMOS PASSOS ===' AS mensagem;
SELECT '1. Execute o download bulk (bota "Sincronizar SIGEF" > "Download Inicial")' AS passo;
SELECT '   O sigef-bulk-sync.service.ts ja filtra apenas NEs de dotacoes via _getRegisteredNEs()' AS passo;
SELECT '2. Apos o bulk, execute "Atualizar Todos" (syncAllContractsFinance)' AS passo;
SELECT '3. Verifique os contratos individualmente' AS passo;
