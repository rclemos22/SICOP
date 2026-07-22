-- =============================================================
-- 16_SEPARAR_SALDO_CONSUMO_ADESAO.sql
--
-- Objetivo: Separar o saldo disponível em duas categorias:
--   1. saldo_consumo_interno — o quanto o órgão gerenciador
--      ainda pode consumir (limite de 100% do registrado)
--   2. saldo_adesao_total — o quanto ainda pode ser aderido
--      por órgãos externos (limite coletivo de 200%)
--
-- A coluna saldo_disponivel original é mantida para
-- compatibilidade com código legado.
-- =============================================================

BEGIN;

-- =============================================================
-- 1. ATUALIZAR vw_ata_saldo_item
-- =============================================================
SELECT '--- 1. Atualizando vw_ata_saldo_item ---' AS etapa;

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

  -- Saldo físico disponível (legado, mantido para compatibilidade)
  GREATEST(0, ai.quantidade - COALESCE(ci.total_consumido, 0) - COALESCE(ad.total_aderido, 0)) AS saldo_disponivel,

  -- NOVO: Saldo disponível para consumo próprio (até 100% do registrado)
  GREATEST(0, ai.quantidade - COALESCE(ci.total_consumido, 0)) AS saldo_consumo_interno,

  -- NOVO: Saldo total disponível para adesões (limite coletivo 200% - já aderido)
  GREATEST(0, ROUND((ai.quantidade * 2.0) - COALESCE(ad.total_aderido, 0), 2)) AS saldo_adesao_total,

  -- Percentual utilizado (consumo interno + adesão sobre o registrado)
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

SELECT 'vw_ata_saldo_item recriada com colunas saldo_consumo_interno e saldo_adesao_total' AS resultado;

-- =============================================================
-- 2. ATUALIZAR vw_ata_saldo_resumo
-- =============================================================
SELECT '--- 2. Atualizando vw_ata_saldo_resumo ---' AS etapa;

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

  -- Saldo total disponível (legado)
  GREATEST(0, SUM(ai.quantidade) - COALESCE(SUM(ci.quantidade_consumida), 0) - COALESCE(SUM(ad.quantidade_aderida), 0)) AS total_saldo_disponivel,

  -- NOVO: Saldo total disponível para consumo próprio
  GREATEST(0, SUM(ai.quantidade) - COALESCE(SUM(ci.quantidade_consumida), 0)) AS total_saldo_consumo_interno,

  -- NOVO: Saldo total disponível para adesões (limite coletivo 200%)
  GREATEST(0, ROUND((SUM(ai.quantidade) * 2.0) - COALESCE(SUM(ad.quantidade_aderida), 0), 2)) AS total_saldo_adesao_total,

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

SELECT 'vw_ata_saldo_resumo recriada com colunas de saldo separadas' AS resultado;

-- =============================================================
-- 3. VERIFICAR ESTADO FINAL
-- =============================================================
SELECT '--- 3. Verificando colunas das views ---' AS etapa;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'vw_ata_saldo_item'
ORDER BY ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'vw_ata_saldo_resumo'
ORDER BY ordinal_position;

COMMIT;

SELECT '=== MIGRATION CONCLUIDA ===' AS mensagem;
