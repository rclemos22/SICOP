-- =============================================================
-- 00_RESTORE_BACKUP.sql
-- 
-- Restaura os dados a partir das tabelas de backup criadas pelo
-- script 00_BACKUP_ANTES_ALTERACOES.sql.
-- 
-- ATENÇÃO: Este script SUBSTITUIRÁ os dados atuais pelos dados
-- do backup. Use apenas em caso de necessidade.
-- =============================================================

BEGIN;

-- Restaura tabelas principais (DELETE + INSERT)
DELETE FROM public.contratos;
INSERT INTO public.contratos SELECT * FROM backup_contratos;

DELETE FROM public.dotacoes;
INSERT INTO public.dotacoes SELECT * FROM backup_dotacoes;

DELETE FROM public.transacoes;
INSERT INTO public.transacoes SELECT * FROM backup_transacoes;

DELETE FROM public.aditivos;
INSERT INTO public.aditivos SELECT * FROM backup_aditivos;

DELETE FROM public.fornecedores;
INSERT INTO public.fornecedores SELECT * FROM backup_fornecedores;

DELETE FROM public.setores;
INSERT INTO public.setores SELECT * FROM backup_setores;

DELETE FROM public.atas;
INSERT INTO public.atas SELECT * FROM backup_atas;

DELETE FROM public.ata_itens;
INSERT INTO public.ata_itens SELECT * FROM backup_ata_itens;

DELETE FROM public.ata_consumo_interno;
INSERT INTO public.ata_consumo_interno SELECT * FROM backup_ata_consumo_interno;

DELETE FROM public.ata_adesoes;
INSERT INTO public.ata_adesoes SELECT * FROM backup_ata_adesoes;

DELETE FROM public.tipo_aditivo;
INSERT INTO public.tipo_aditivo SELECT * FROM backup_tipo_aditivo;

-- Restaura cache SIGEF
DELETE FROM public.sigef_notas_empenho;
INSERT INTO public.sigef_notas_empenho SELECT * FROM backup_sigef_notas_empenho;

DELETE FROM public.sigef_ne_movimentos;
INSERT INTO public.sigef_ne_movimentos SELECT * FROM backup_sigef_ne_movimentos;

DELETE FROM public.sigef_ordens_bancarias;
INSERT INTO public.sigef_ordens_bancarias SELECT * FROM backup_sigef_ordens_bancarias;

-- Restaura mirror
DELETE FROM public.import_sigef;
INSERT INTO public.import_sigef SELECT * FROM backup_import_sigef;

DELETE FROM public.import_sigef_ne;
INSERT INTO public.import_sigef_ne SELECT * FROM backup_import_sigef_ne;

DELETE FROM public.import_sigef_ob;
INSERT INTO public.import_sigef_ob SELECT * FROM backup_import_sigef_ob;

-- Restaura sincronia
DELETE FROM public.sigef_sync_periods;
INSERT INTO public.sigef_sync_periods SELECT * FROM backup_sigef_sync_periods;

-- Nota: sigef_sync_log foi removida em migração anterior.
-- Se existir no seu banco, descomente as linhas abaixo:
-- DELETE FROM public.sigef_sync_log;
-- INSERT INTO public.sigef_sync_log SELECT * FROM backup_sigef_sync_log;

COMMIT;

SELECT 'Restore concluido com sucesso.' AS mensagem;
