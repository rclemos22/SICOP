-- =============================================================
-- 01_OTIMIZACAO_INDICES.sql
--
-- Adiciona índices faltantes identificados pela análise de
-- consultas do código TypeScript.
--
-- Os índices são criados com IF NOT EXISTS para serem
-- idempotentes.
-- =============================================================

-- ===================================
-- 1. dotacoes
--    Consultas: getBudgetsByContractId (.eq('contract_id', ...)),
--               BulkSyncService (.not('nunotaempenho', 'is', null))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_dotacoes_contract_id
  ON public.dotacoes(contract_id);

CREATE INDEX IF NOT EXISTS idx_dotacoes_nunotaempenho
  ON public.dotacoes(nunotaempenho);

CREATE INDEX IF NOT EXISTS idx_dotacoes_unid_gestora
  ON public.dotacoes(unid_gestora);

-- ===================================
-- 2. transacoes
--    Consultas: updateContractTotals (.eq('contract_id', ...)),
--               syncSigefTransactions (.eq('contract_id', ...).eq('commitment_id', ...)),
--               upsert por sigef_id
-- ===================================
CREATE INDEX IF NOT EXISTS idx_transacoes_contract_id
  ON public.transacoes(contract_id);

CREATE INDEX IF NOT EXISTS idx_transacoes_contract_type
  ON public.transacoes(contract_id, type);

CREATE INDEX IF NOT EXISTS idx_transacoes_commitment_id
  ON public.transacoes(commitment_id);

CREATE INDEX IF NOT EXISTS idx_transacoes_sigef_id
  ON public.transacoes(sigef_id);

CREATE INDEX IF NOT EXISTS idx_transacoes_date
  ON public.transacoes(date DESC);

-- ===================================
-- 3. sigef_ne_movimentos
--    Consultas: _loadTransactionsFromCache (.gte/.lte dtlancamento),
--               getNeMovimentos (.eq('nunotaempenho', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_sigef_ne_mov_dtlancamento
  ON public.sigef_ne_movimentos(dtlancamento);

CREATE INDEX IF NOT EXISTS idx_sigef_ne_mov_ug_ne
  ON public.sigef_ne_movimentos(cdunidadegestora, nunotaempenho);

-- ===================================
-- 4. sigef_ordens_bancarias
--    Consultas: _loadTransactionsFromCache (.gte/.lte dtpagamento),
--               getOrdensBancariasPorNe (.eq('nunotaempenho', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_sigef_ob_dtpagamento
  ON public.sigef_ordens_bancarias(dtpagamento);

CREATE INDEX IF NOT EXISTS idx_sigef_ob_ne_ug
  ON public.sigef_ordens_bancarias(nunotaempenho, cdunidadegestora);

-- ===================================
-- 5. sigef_notas_empenho
--    Consultas: getNotaEmpenho (.eq('nunotaempenho', ...).eq('cdunidadegestora', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_sigef_ne_ug_numero
  ON public.sigef_notas_empenho(cdunidadegestora, nunotaempenho);

-- ===================================
-- 6. aditivos
--    Consultas: fetchAllAditivos, getAditivosPorContractId (.eq('contract_id', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_aditivos_contract_id
  ON public.aditivos(contract_id);

CREATE INDEX IF NOT EXISTS idx_aditivos_tipo
  ON public.aditivos(tipo);

-- ===================================
-- 7. import_sigef (legado)
--    Consultas: getRawMirror (.eq('identifier', ...).eq('type', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_import_sigef_id_type
  ON public.import_sigef(identifier, type);

-- ===================================
-- 8. import_sigef_ne
--    Consultas: getNesByNumber (.eq('nunotaempenho', ...)),
--               getNeMovementsRaw (.eq('nunotaempenho', ...).eq('cdunidadegestora', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_import_sigef_ne_ug
  ON public.import_sigef_ne(cdunidadegestora);

-- ===================================
-- 9. import_sigef_ob
--    Consultas: getObsByNe (.eq('nunotaempenho', ...)),
--               getObsRawByNeGlobal (.eq('nunotaempenho', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_import_sigef_ob_ne
  ON public.import_sigef_ob(nunotaempenho);

CREATE INDEX IF NOT EXISTS idx_import_sigef_ob_ug
  ON public.import_sigef_ob(cdunidadegestora);

-- ===================================
-- 10. ata_itens
--     Consultas: getItensByAtaId (.eq('ata_id', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ata_itens_ata_id
  ON public.ata_itens(ata_id);

-- ===================================
-- 11. ata_consumo_interno
--     Consultas: listarConsumos (.eq('ata_id', ...), .eq('ata_item_id', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ata_consumo_ata_item_id
  ON public.ata_consumo_interno(ata_item_id);

CREATE INDEX IF NOT EXISTS idx_ata_consumo_ata_id
  ON public.ata_consumo_interno(ata_id);

-- ===================================
-- 12. ata_adesoes
--     Consultas: listarAdesoes (.eq('ata_item_id', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ata_adesoes_ata_item_id
  ON public.ata_adesoes(ata_item_id);

CREATE INDEX IF NOT EXISTS idx_ata_adesoes_ata_id
  ON public.ata_adesoes(ata_id);

CREATE INDEX IF NOT EXISTS idx_ata_adesoes_status
  ON public.ata_adesoes(status);

-- ===================================
-- 13. sigef_sync_periods
--     Consultas: _isPeriodRecentlyComplete (.eq('periodo_inicio', ...).eq('tipo', ...))
--               getSyncSummary (.order('periodo_inicio', ...))
-- ===================================
CREATE INDEX IF NOT EXISTS idx_sync_periods_tipo_status
  ON public.sigef_sync_periods(tipo, status);

CREATE INDEX IF NOT EXISTS idx_sync_periods_periodo_inicio
  ON public.sigef_sync_periods(periodo_inicio);

-- ===================================
-- Relatório de índices criados
-- ===================================
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'dotacoes', 'transacoes', 'sigef_ne_movimentos', 'sigef_ordens_bancarias',
    'sigef_notas_empenho', 'aditivos', 'import_sigef', 'import_sigef_ne',
    'import_sigef_ob', 'ata_itens', 'ata_consumo_interno', 'ata_adesoes',
    'sigef_sync_periods'
  )
ORDER BY tablename, indexname;
