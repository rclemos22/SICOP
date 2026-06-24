-- =============================================================
-- 04_DEFINIR_VIEWS_FALTANTES.sql
--
-- Define/Cria as views que são referenciadas no código TypeScript
-- mas não possuem definição SQL no repositório.
--
-- ATENÇÃO: Se as views já existirem no banco, este script irá
-- recriá-las (CREATE OR REPLACE). Execute com cuidado.
-- =============================================================

-- =============================================================
-- 1. vw_saldo_dotacoes
--    Usada por: BudgetService, FinancialService
--    Colunas esperadas: id, contract_id, numero_contrato, contratada,
--                       dotacao, credito, data_disponibilidade,
--                       unid_gestora, valor_dotacao, total_empenhado,
--                       total_cancelado, total_pago, saldo_disponivel,
--                       nunotaempenho, contract_type
-- =============================================================
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

-- =============================================================
-- 2. vw_recent_payments
--    Usada por: DashboardService.loadRecentPayments
--    Colunas esperadas: id, contrato, contratada, nuordembancaria,
--                       data_pagamento, vltotal, situacao
-- =============================================================
DROP VIEW IF EXISTS public.vw_recent_payments CASCADE;
CREATE VIEW public.vw_recent_payments AS
SELECT 
  ob.id,
  c.contrato,
  c.contratada,
  ob.nuordembancaria,
  ob.dtpagamento AS data_pagamento,
  ob.vltotal,
  ob.cdsituacaoordembancaria AS situacao
FROM public.sigef_ordens_bancarias ob
JOIN public.dotacoes d ON d.nunotaempenho = ob.nunotaempenho
JOIN public.contratos c ON c.id = d.contract_id
WHERE ob.dtpagamento IS NOT NULL
  AND ob.cdsituacaoordembancaria IS NOT NULL;

-- =============================================================
-- 3. vw_atas_resumo
--    Usada por: AtaService
--    Colunas esperadas: colunas de atas + qtd_itens
-- =============================================================
DROP VIEW IF EXISTS public.vw_atas_resumo CASCADE;
CREATE VIEW public.vw_atas_resumo AS
SELECT 
  a.*,
  COUNT(ai.id) AS qtd_itens
FROM public.atas a
LEFT JOIN public.ata_itens ai ON ai.ata_id = a.id
GROUP BY a.id;

-- =============================================================
-- 4. vw_ata_saldo_item
--    Usada por: SaldoAtaService
--    Colunas esperadas: item_id, ata_id, numero_item, descricao_item,
--                       unidade, quantidade_registrada, valor_unitario,
--                       quantidade_consumida_interna, quantidade_aderida,
--                       saldo_disponivel, percentual_utilizado,
--                       numero_ata, numero_processo, ata_status
-- =============================================================
DROP VIEW IF EXISTS public.vw_ata_saldo_item CASCADE;
CREATE VIEW public.vw_ata_saldo_item AS
SELECT 
  ai.id AS item_id,
  a.id AS ata_id,
  ai.numero_item,
  ai.descricao AS descricao_item,
  ai.unidade,
  ai.quantidade AS quantidade_registrada,
  ai.valor_unitario,
  COALESCE(ci.quantidade_consumida, 0) AS quantidade_consumida_interna,
  COALESCE(ad.quantidade_aderida, 0) AS quantidade_aderida,
  GREATEST(0, ai.quantidade - COALESCE(ci.quantidade_consumida, 0) - COALESCE(ad.quantidade_aderida, 0)) AS saldo_disponivel,
  CASE 
    WHEN ai.quantidade > 0 
    THEN ROUND(((COALESCE(ci.quantidade_consumida, 0) + COALESCE(ad.quantidade_aderida, 0)) / ai.quantidade) * 100, 2)
    ELSE 0 
  END AS percentual_utilizado,
  a.numero_ata,
  a.numero_processo,
  a.status AS ata_status,
  ROUND(ai.quantidade * 0.5, 2) AS limite_individual,
  ROUND(ai.quantidade * 2.0, 2) AS limite_coletivo,
  GREATEST(0, ai.quantidade - COALESCE(ci.quantidade_consumida, 0)) AS saldo_adesao
FROM public.ata_itens ai
JOIN public.atas a ON a.id = ai.ata_id
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
) ad ON ad.ata_item_id = ai.id;

-- =============================================================
-- 5. vw_ata_saldo_resumo
--    Usada por: SaldoAtaService.loadResumo
--    Colunas esperadas: ata_id, numero_ata, numero_processo, ata_status,
--                       total_itens, total_quantidade_registrada,
--                       total_quantidade_consumida, total_quantidade_aderida,
--                       total_saldo_disponivel, percentual_geral
-- =============================================================
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

COMMIT;

SELECT 'Views recriadas com sucesso.' AS mensagem;
