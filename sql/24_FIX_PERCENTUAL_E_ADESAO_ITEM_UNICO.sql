-- Migration: 24_FIX_PERCENTUAL_E_ADESAO_ITEM_UNICO.sql
-- Descrição: Recria vw_ata_saldo_item e vw_ata_saldo_resumo com correção no percentual utilizado (consumo interno),
--            percentual de adesão e tratamento de item com 1 única unidade registrada como indisponível para carona (Art. 86 §3º Lei 14.133/2021).

BEGIN;

SELECT '--- Recriando vw_ata_saldo_item ---' AS etapa;

DROP VIEW IF EXISTS public.vw_ata_saldo_resumo CASCADE;
DROP VIEW IF EXISTS public.vw_ata_saldo_item CASCADE;

CREATE VIEW public.vw_ata_saldo_item AS
WITH
consumo AS (
  SELECT
    ci.ata_item_id,
    COALESCE(SUM(ci.quantidade), 0) AS total_consumido
  FROM ata_consumo_interno ci
  GROUP BY ci.ata_item_id
),
adesao AS (
  SELECT
    ai.ata_item_id,
    COALESCE(SUM(ai.quantidade_autorizada), 0) AS total_aderido
  FROM ata_adesao_itens ai
  JOIN ata_adesoes a ON a.id = ai.adesao_id
  WHERE a.status = 'AUTORIZADA'
  GROUP BY ai.ata_item_id
),
itens_ata AS (
  SELECT
    i.id AS item_id,
    i.ata_id,
    i.numero_item,
    i.descricao AS descricao_item,
    i.unidade,
    i.quantidade AS quantidade_registrada,
    i.valor_unitario,
    a.numero_ata,
    a.numero_processo,
    a.status AS ata_status
  FROM ata_itens i
  JOIN atas a ON a.id = i.ata_id
)
SELECT
  ia.item_id,
  ia.ata_id,
  ia.numero_item,
  ia.descricao_item,
  ia.unidade,
  ia.quantidade_registrada,
  ia.valor_unitario,
  COALESCE(c.total_consumido, 0) AS quantidade_consumida_interna,
  COALESCE(ad.total_aderido, 0) AS quantidade_aderida,
  GREATEST(0, ia.quantidade_registrada - COALESCE(c.total_consumido, 0)) AS saldo_disponivel,
  GREATEST(0, ia.quantidade_registrada - COALESCE(c.total_consumido, 0)) AS saldo_consumo_interno,
  -- Para item de 1 unidade, limite individual de 50% = 0.5 un, inviabilizando adesão. Saldo adesão total = 0.
  CASE
    WHEN ia.quantidade_registrada <= 1 THEN 0
    ELSE GREATEST(0, (ia.quantidade_registrada * 2.0) - COALESCE(ad.total_aderido, 0))
  END AS saldo_adesao_total,
  -- Percentual utilizado do Consumo Próprio/Interno sobre a quantidade registrada
  CASE
    WHEN ia.quantidade_registrada > 0
    THEN ROUND((COALESCE(c.total_consumido, 0) / ia.quantidade_registrada) * 100, 2)
    ELSE 0
  END AS percentual_utilizado,
  -- Limite individual de adesão (Art. 86 §3º: até 50%). Zero para item de 1 unidade.
  CASE
    WHEN ia.quantidade_registrada <= 1 THEN 0
    ELSE ia.quantidade_registrada * 0.5
  END AS limite_individual,
  -- Limite coletivo de adesão (Art. 86 §4º: até 200%). Zero para item de 1 unidade.
  CASE
    WHEN ia.quantidade_registrada <= 1 THEN 0
    ELSE ia.quantidade_registrada * 2.0
  END AS limite_coletivo,
  -- Saldo para adesão restante
  CASE
    WHEN ia.quantidade_registrada <= 1 THEN 0
    ELSE GREATEST(0, (ia.quantidade_registrada * 2.0) - COALESCE(ad.total_aderido, 0))
  END AS saldo_adesao,
  ia.numero_ata,
  ia.numero_processo,
  ia.ata_status
FROM itens_ata ia
LEFT JOIN consumo c ON c.ata_item_id = ia.item_id
LEFT JOIN adesao ad ON ad.ata_item_id = ia.item_id;

SELECT '--- Recriando vw_ata_saldo_resumo ---' AS etapa;

CREATE VIEW public.vw_ata_saldo_resumo AS
SELECT
  ata_id,
  MAX(numero_ata) AS numero_ata,
  MAX(numero_processo) AS numero_processo,
  MAX(ata_status) AS ata_status,
  COUNT(*) AS total_itens,
  SUM(quantidade_registrada) AS total_quantidade_registrada,
  SUM(quantidade_consumida_interna) AS total_quantidade_consumida,
  SUM(quantidade_aderida) AS total_quantidade_aderida,
  SUM(saldo_disponivel) AS total_saldo_disponivel,
  SUM(saldo_consumo_interno) AS total_saldo_consumo_interno,
  SUM(saldo_adesao_total) AS total_saldo_adesao_total,
  CASE
    WHEN SUM(quantidade_registrada) > 0
    THEN ROUND((SUM(quantidade_consumida_interna) / SUM(quantidade_registrada)) * 100, 2)
    ELSE 0
  END AS percentual_geral
FROM public.vw_ata_saldo_item
GROUP BY ata_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
