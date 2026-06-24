-- =============================================================
-- 07_FIX_RLS_E_VIEWS.sql
--
-- Corrige erro 500 causado por RLS ativo sem policies:
--
-- 1. Desabilita RLS nas tabelas de cache do SIGEF
-- 2. Garante que as views estão com as definições corretas
--    (compatíveis com migrations 999 e 036)
-- 3. Verifica o estado final
-- =============================================================

BEGIN;

-- =============================================================
-- 1. DESABILITAR RLS NAS TABELAS DE CACHE
--    Script 03 removeu as policies mas manteve RLS ativo.
--    Com RLS habilitado e nenhuma policy, QUALQUER consulta
--    do Supabase (anon key) retorna permissão negada.
-- =============================================================
SELECT '--- 1. Desabilitando RLS nas tabelas de cache ---' AS etapa;

ALTER TABLE public.sigef_notas_empenho DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigef_ne_movimentos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigef_ordens_bancarias DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- 2. GARANTIR VIEWS CORRETAS
--    vw_recent_payments precisa refletir a versão da
--    migration 999 (com unidade_gestora_label, nudocumento).
-- =============================================================
SELECT '--- 2. Garantindo views corretas ---' AS etapa;

-- vw_saldo_dotacoes (usada por BudgetService, FinancialService)
DROP VIEW IF EXISTS public.vw_saldo_dotacoes CASCADE;
CREATE VIEW public.vw_saldo_dotacoes AS
SELECT
  d.id,
  d.contract_id,
  d.numero_contrato,
  c.contratada,
  d.dotacao,
  d.credito,
  d.data_disponibilidade,
  d.unid_gestora,
  d.valor_dotacao,
  COALESCE(d.total_empenhado, 0) AS total_empenhado,
  COALESCE(d.total_cancelado, 0) AS total_cancelado,
  COALESCE(d.total_pago, 0) AS total_pago,
  COALESCE(d.saldo_disponivel, GREATEST(0, d.valor_dotacao - COALESCE(d.total_empenhado, 0) + COALESCE(d.total_cancelado, 0))) AS saldo_disponivel,
  d.nunotaempenho,
  d.contract_type,
  c.contrato AS numero_contrato_label
FROM public.dotacoes d
LEFT JOIN public.contratos c ON c.id = d.contract_id;

-- vw_recent_payments (versão migration 999 com + colunas)
DROP VIEW IF EXISTS public.vw_recent_payments CASCADE;
CREATE VIEW public.vw_recent_payments AS
SELECT
  ob.id,
  ob.nuordembancaria,
  ob.nunotaempenho,
  ob.vltotal,
  ob.dtpagamento AS data_pagamento,
  ob.dtlancamento,
  ob.cdsituacaoordembancaria AS situacao,
  ob.deobservacao,
  d.contract_id,
  c.contrato,
  c.contratada,
  d.dotacao,
  d.unid_gestora AS cdunidadegestora,
  CASE d.unid_gestora
    WHEN '080101' THEN 'DPEMA'
    WHEN '080901' THEN 'FADEP'
    ELSE d.unid_gestora
  END AS unidade_gestora_label,
  ob.nudocumento
FROM sigef_ordens_bancarias ob
INNER JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
LEFT JOIN contratos c ON d.contract_id = c.id
WHERE ob.dtpagamento IS NOT NULL
  AND ob.vltotal > 0;

-- vw_atas_resumo
DROP VIEW IF EXISTS public.vw_atas_resumo CASCADE;
CREATE VIEW public.vw_atas_resumo AS
SELECT
  a.*,
  COUNT(ai.id) AS qtd_itens
FROM public.atas a
LEFT JOIN public.ata_itens ai ON ai.ata_id = a.id
GROUP BY a.id;

-- vw_ata_saldo_item (versão migration 036 com limites legais)
DROP VIEW IF EXISTS public.vw_ata_saldo_item CASCADE;
CREATE VIEW public.vw_ata_saldo_item AS
SELECT
  ai.id AS item_id,
  ai.ata_id,
  ai.numero_item,
  ai.descricao AS descricao_item,
  ai.unidade,
  ai.quantidade AS quantidade_registrada,
  ai.valor_unitario,
  COALESCE(ci.total_consumido, 0) AS quantidade_consumida_interna,
  COALESCE(ad.total_aderido, 0) AS quantidade_aderida,
  ai.quantidade - COALESCE(ci.total_consumido, 0) - COALESCE(ad.total_aderido, 0) AS saldo_disponivel,
  CASE
    WHEN ai.quantidade > 0 THEN
      ROUND(((COALESCE(ci.total_consumido, 0) + COALESCE(ad.total_aderido, 0)) / ai.quantidade) * 100, 2)
    ELSE 0
  END AS percentual_utilizado,
  a.numero_ata,
  a.numero_processo,
  a.status AS ata_status,
  ROUND(ai.quantidade * 0.5, 2) AS limite_individual,
  ROUND(ai.quantidade * 2.0, 2) AS limite_coletivo,
  GREATEST(0, ROUND((ai.quantidade * 2.0) - COALESCE(ad.total_aderido, 0), 2)) AS saldo_adesao
FROM ata_itens ai
JOIN atas a ON a.id = ai.ata_id
LEFT JOIN (
  SELECT ata_item_id, SUM(quantidade) AS total_consumido
  FROM ata_consumo_interno
  GROUP BY ata_item_id
) ci ON ci.ata_item_id = ai.id
LEFT JOIN (
  SELECT ata_item_id, SUM(quantidade_autorizada) AS total_aderido
  FROM ata_adesoes
  WHERE status = 'AUTORIZADA'
  GROUP BY ata_item_id
) ad ON ad.ata_item_id = ai.id;

-- vw_ata_saldo_resumo
DROP VIEW IF EXISTS public.vw_ata_saldo_resumo CASCADE;
CREATE VIEW public.vw_ata_saldo_resumo AS
SELECT
  a.id AS ata_id,
  a.numero_ata,
  a.numero_processo,
  a.status AS ata_status,
  COUNT(ai.id) AS total_itens,
  SUM(ai.quantidade) AS total_quantidade_registrada,
  COALESCE(SUM(ci.quantidade_consumida), 0) AS total_quantidade_consumida,
  COALESCE(SUM(ad.quantidade_aderida), 0) AS total_quantidade_aderida,
  GREATEST(0, SUM(ai.quantidade) - COALESCE(SUM(ci.quantidade_consumida), 0) - COALESCE(SUM(ad.quantidade_aderida), 0)) AS total_saldo_disponivel,
  CASE
    WHEN SUM(ai.quantidade) > 0
    THEN ROUND(((COALESCE(SUM(ci.quantidade_consumida), 0) + COALESCE(SUM(ad.quantidade_aderida), 0)) / SUM(ai.quantidade)) * 100, 2)
    ELSE 0
  END AS percentual_geral
FROM public.atas a
JOIN public.ata_itens ai ON ai.ata_id = a.id
LEFT JOIN (
  SELECT ata_item_id, SUM(quantidade) AS quantidade_consumida
  FROM public.ata_consumo_interno
  GROUP BY ata_item_id
) ci ON ci.ata_item_id = ai.id
LEFT JOIN (
  SELECT ata_item_id, SUM(COALESCE(quantidade_autorizada, quantidade_solicitada)) AS quantidade_aderida
  FROM public.ata_adesoes
  WHERE status = 'AUTORIZADA'
  GROUP BY ata_item_id
) ad ON ad.ata_item_id = ai.id
GROUP BY a.id, a.numero_ata, a.numero_processo, a.status;

-- vw_ob_por_contrato (da migration 999)
DROP VIEW IF EXISTS public.vw_ob_por_contrato CASCADE;
CREATE VIEW public.vw_ob_por_contrato AS
SELECT
  ob.id,
  ob.nuordembancaria,
  ob.nunotaempenho,
  ob.vltotal,
  ob.dtpagamento,
  ob.cdsituacaoordembancaria,
  ob.deobservacao,
  ob.nudocumento,
  d.id AS dotacao_id,
  d.contract_id,
  d.dotacao,
  c.contrato,
  c.contratada
FROM sigef_ordens_bancarias ob
LEFT JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
LEFT JOIN contratos c ON d.contract_id = c.id
ORDER BY ob.dtpagamento DESC NULLS LAST;

-- vw_obs_nao_sincronizadas (da migration 999)
DROP VIEW IF EXISTS public.vw_obs_nao_sincronizadas CASCADE;
CREATE VIEW public.vw_obs_nao_sincronizadas AS
SELECT
  ob.*,
  d.contract_id,
  d.dotacao,
  c.contrato,
  c.contratada
FROM sigef_ordens_bancarias ob
JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
JOIN contratos c ON d.contract_id = c.id
WHERE NOT EXISTS (
  SELECT 1 FROM transacoes t
  WHERE
    (t.sigef_id LIKE '%' || ob.nuordembancaria || '%'
     OR t.ob_number = ob.nuordembancaria
     OR (t.commitment_id = ob.nunotaempenho AND t.amount = ob.vltotal AND t.type = 'LIQUIDATION'))
    AND t.contract_id = d.contract_id
)
AND ob.vltotal > 0
ORDER BY ob.dtpagamento DESC NULLS LAST;

-- vw_transacoes_vs_obs (da migration 026)
DROP VIEW IF EXISTS public.vw_transacoes_vs_obs CASCADE;
CREATE VIEW public.vw_transacoes_vs_obs AS
SELECT
  'CACHE_SIGEF'::VARCHAR AS origem,
  ob.nuordembancaria,
  ob.nunotaempenho,
  ob.vltotal,
  ob.dtpagamento,
  ob.cdsituacaoordembancaria::VARCHAR AS situacao,
  ob.deobservacao,
  ob.nudocumento,
  c.contrato,
  c.id AS contract_id
FROM sigef_ordens_bancarias ob
LEFT JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
LEFT JOIN contratos c ON d.contract_id = c.id

UNION ALL

SELECT
  'TRANSACOES'::VARCHAR AS origem,
  t.ob_number AS nuordembancaria,
  t.commitment_id AS nunotaempenho,
  t.amount AS vltotal,
  t.date AS dtpagamento,
  t.type::VARCHAR AS situacao,
  t.description AS deobservacao,
  t.document_number AS nudocumento,
  c.contrato,
  t.contract_id
FROM transacoes t
LEFT JOIN contratos c ON t.contract_id = c.id
WHERE t.type = 'LIQUIDATION';

-- =============================================================
-- 3. VERIFICAR ESTADO FINAL
-- =============================================================
SELECT '--- 3. Verificando correcao ---' AS etapa;

SELECT 'RLS desabilitado' AS verificacao,
       tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('sigef_notas_empenho', 'sigef_ne_movimentos', 'sigef_ordens_bancarias');

SELECT 'views existentes' AS verificacao,
       table_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN (
    'vw_saldo_dotacoes', 'vw_recent_payments', 'vw_atas_resumo',
    'vw_ata_saldo_item', 'vw_ata_saldo_resumo', 'vw_ob_por_contrato',
    'vw_obs_nao_sincronizadas', 'vw_transacoes_vs_obs'
  )
ORDER BY table_name;

COMMIT;

SELECT '=== CORRECAO CONCLUIDA ===' AS mensagem;
