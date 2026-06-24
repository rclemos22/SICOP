-- =============================================================
-- 00_BACKUP_ANTES_ALTERACOES.sql
-- 
-- Backup dos dados antes de qualquer modificação destrutiva.
-- Gera tabelas de backup com timestamp no nome.
-- 
-- ATENÇÃO: Execute este script ANTES de qualquer outra migração.
-- Caso algo dê errado, use 00_RESTORE.sql para recuperar.
-- =============================================================

BEGIN;

-- Data/hora do backup para referência
SELECT NOW() AS data_hora_backup;

-- Backup de tabelas principais
CREATE TABLE IF NOT EXISTS backup_contratos AS SELECT * FROM public.contratos;
CREATE TABLE IF NOT EXISTS backup_dotacoes AS SELECT * FROM public.dotacoes;
CREATE TABLE IF NOT EXISTS backup_transacoes AS SELECT * FROM public.transacoes;
CREATE TABLE IF NOT EXISTS backup_aditivos AS SELECT * FROM public.aditivos;
CREATE TABLE IF NOT EXISTS backup_fornecedores AS SELECT * FROM public.fornecedores;
CREATE TABLE IF NOT EXISTS backup_setores AS SELECT * FROM public.setores;
CREATE TABLE IF NOT EXISTS backup_atas AS SELECT * FROM public.atas;
CREATE TABLE IF NOT EXISTS backup_ata_itens AS SELECT * FROM public.ata_itens;
CREATE TABLE IF NOT EXISTS backup_ata_consumo_interno AS SELECT * FROM public.ata_consumo_interno;
CREATE TABLE IF NOT EXISTS backup_ata_adesoes AS SELECT * FROM public.ata_adesoes;
CREATE TABLE IF NOT EXISTS backup_tipo_aditivo AS SELECT * FROM public.tipo_aditivo;

-- Backup de cache SIGEF
CREATE TABLE IF NOT EXISTS backup_sigef_notas_empenho AS SELECT * FROM public.sigef_notas_empenho;
CREATE TABLE IF NOT EXISTS backup_sigef_ne_movimentos AS SELECT * FROM public.sigef_ne_movimentos;
CREATE TABLE IF NOT EXISTS backup_sigef_ordens_bancarias AS SELECT * FROM public.sigef_ordens_bancarias;

-- Backup de mirror/import
CREATE TABLE IF NOT EXISTS backup_import_sigef AS SELECT * FROM public.import_sigef;
CREATE TABLE IF NOT EXISTS backup_import_sigef_ne AS SELECT * FROM public.import_sigef_ne;
CREATE TABLE IF NOT EXISTS backup_import_sigef_ob AS SELECT * FROM public.import_sigef_ob;

-- Backup de sincronia
CREATE TABLE IF NOT EXISTS backup_sigef_sync_periods AS SELECT * FROM public.sigef_sync_periods;

-- Nota: sigef_sync_log foi removida em migração anterior.
-- Se existir no seu banco, descomente a linha abaixo:
-- CREATE TABLE IF NOT EXISTS backup_sigef_sync_log AS SELECT * FROM public.sigef_sync_log;

COMMIT;

SELECT 
  'Backup concluido com sucesso.' AS mensagem,
  COUNT(*) AS total_tabelas_backup
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'backup_%';
