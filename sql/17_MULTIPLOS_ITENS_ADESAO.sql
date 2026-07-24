-- 17_MULTIPLOS_ITENS_ADESAO.sql
-- Permite múltiplos itens por solicitação de adesão (carona)
-- Remove CNPJ do formulário (mantido no banco para compatibilidade retroativa)
-- 
-- Executar no SQL Editor do Supabase
-- Data: Julho 2026

-- 1. Criar tabela de itens da adesão (junction table)
CREATE TABLE IF NOT EXISTS ata_adesao_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adesao_id UUID NOT NULL REFERENCES ata_adesoes(id) ON DELETE CASCADE,
  ata_item_id UUID NOT NULL REFERENCES ata_itens(id) ON DELETE SET NULL,
  quantidade_solicitada NUMERIC(15,2) NOT NULL,
  quantidade_autorizada NUMERIC(15,2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_ata_adesao_itens_adesao_id ON ata_adesao_itens(adesao_id);
CREATE INDEX IF NOT EXISTS idx_ata_adesao_itens_ata_item_id ON ata_adesao_itens(ata_item_id);

-- 2b. UNIQUE constraint para evitar duplicatas (adesao_id + ata_item_id)
-- Deve existir antes do INSERT com ON CONFLICT abaixo
ALTER TABLE ata_adesao_itens
  DROP CONSTRAINT IF EXISTS uk_ata_adesao_itens;
ALTER TABLE ata_adesao_itens
  ADD CONSTRAINT uk_ata_adesao_itens
  UNIQUE (adesao_id, ata_item_id);

-- 3. Migrar dados existentes da tabela ata_adesoes para ata_adesao_itens
-- Preserva todo o histórico: cada registro existente vira um item na nova tabela
-- Usa ON CONFLICT para ser idempotente (não criar duplicatas se re-executado)
INSERT INTO ata_adesao_itens (adesao_id, ata_item_id, quantidade_solicitada, quantidade_autorizada)
SELECT id, ata_item_id, quantidade_solicitada, quantidade_autorizada
FROM ata_adesoes
WHERE ata_item_id IS NOT NULL
ON CONFLICT (adesao_id, ata_item_id) DO NOTHING;

-- 4. Tornar colunas antigas nullable para permitir inserções sem item específico (multi-item)
ALTER TABLE ata_adesoes ALTER COLUMN ata_item_id DROP NOT NULL;
ALTER TABLE ata_adesoes ALTER COLUMN quantidade_solicitada DROP NOT NULL;
ALTER TABLE ata_adesoes ALTER COLUMN cnpj_orgao DROP NOT NULL;

-- 4b. NÃO dropar colunas antigas (ata_item_id, quantidade_solicitada, quantidade_autorizada, cnpj_orgao)
-- Mantidas para compatibilidade retroativa com dados históricos e relatórios já gerados
-- O novo código usará a tabela ata_adesao_itens; o código legado ainda consegue ler as colunas antigas

-- 5. Views de saldo recriadas para incluir a nova tabela nos cálculos
DROP VIEW IF EXISTS vw_ata_saldo_item CASCADE;
CREATE VIEW vw_ata_saldo_item AS
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
  GREATEST(0, (ia.quantidade_registrada * 2.0) - COALESCE(ad.total_aderido, 0)) AS saldo_adesao_total,
  CASE
    WHEN ia.quantidade_registrada > 0
    THEN ROUND((COALESCE(ad.total_aderido, 0) / (ia.quantidade_registrada * 2.0)) * 100, 2)
    ELSE 0
  END AS percentual_utilizado,
  ia.quantidade_registrada * 0.5 AS limite_individual,
  ia.quantidade_registrada * 2.0 AS limite_coletivo,
  GREATEST(0, (ia.quantidade_registrada * 2.0) - COALESCE(ad.total_aderido, 0)) AS saldo_adesao,
  ia.numero_ata,
  ia.numero_processo,
  ia.ata_status
FROM itens_ata ia
LEFT JOIN consumo c ON c.ata_item_id = ia.item_id
LEFT JOIN adesao ad ON ad.ata_item_id = ia.item_id;

-- 6. Recriar view de resumo
DROP VIEW IF EXISTS vw_ata_saldo_resumo CASCADE;
CREATE VIEW vw_ata_saldo_resumo AS
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
    THEN ROUND((SUM(quantidade_aderida) / (SUM(quantidade_registrada) * 2.0)) * 100, 2)
    ELSE 0
  END AS percentual_geral
FROM vw_ata_saldo_item
GROUP BY ata_id;
