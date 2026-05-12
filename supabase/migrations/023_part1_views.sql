-- 023_dashboard_views_and_auto_update.sql
-- Cria views essenciais para o dashboard e triggers de atualização automática

-- ============================================
-- ETAPA 1: Views (separado para evitar conflitos)
-- ============================================

-- Dropar views existentes
DROP VIEW IF EXISTS public.vw_saldo_dotacoes CASCADE;
DROP VIEW IF EXISTS public.vw_recent_payments CASCADE;

-- View vw_saldo_dotacoes
CREATE OR REPLACE VIEW public.vw_saldo_dotacoes AS
SELECT 
  d.id,
  d.contract_id,
  c.contrato AS numero_contrato,
  c.contratada,
  d.dotacao,
  d.credito,
  d.data_disponibilidade,
  d.unid_gestora,
  d.valor_dotacao,
  d.nunotaempenho,
  d.contract_type,
  COALESCE(d.total_empenhado, 0) AS total_empenhado,
  COALESCE(d.total_cancelado, 0) AS total_cancelado,
  COALESCE(d.total_pago, 0) AS total_pago,
  COALESCE(d.saldo_disponivel, 0) AS saldo_disponivel,
  d.updated_at,
  d.created_at
FROM dotacoes d
LEFT JOIN contratos c ON d.contract_id = c.id;

-- View vw_recent_payments para o dashboard
CREATE OR REPLACE VIEW public.vw_recent_payments AS
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
