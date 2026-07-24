-- 18_FIX_DUPLICATAS_ITENS_ADESAO.sql
-- Remove duplicatas em ata_adesao_itens e adiciona UNIQUE constraint
-- 
-- Problema: a migration 17 inseria dados sem ON CONFLICT, e se executada
-- múltiplas vezes criava registros duplicados em ata_adesao_itens para
-- a mesma combinação (adesao_id, ata_item_id).
--
-- Executar no SQL Editor do Supabase APÓS a migration 17.
-- Data: Julho 2026

-- 1. Diagnóstico: exibir todas as duplicatas
WITH duplicatas AS (
  SELECT
    adesao_id,
    ata_item_id,
    COUNT(*) AS total,
    array_agg(id ORDER BY created_at) AS ids
  FROM ata_adesao_itens
  GROUP BY adesao_id, ata_item_id
  HAVING COUNT(*) > 1
)
SELECT
  d.adesao_id,
  d.ata_item_id,
  d.total,
  d.ids,
  a.razao_orgao,
  a.status,
  a.data_solicitacao
FROM duplicatas d
LEFT JOIN ata_adesoes a ON a.id = d.adesao_id
ORDER BY a.data_solicitacao DESC;

-- 2. Remover duplicatas: manter apenas o registro mais antigo (primeiro created_at)
-- Isso preserva o dado original e elimina as réplicas geradas por re-execução da migration
DELETE FROM ata_adesao_itens
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY adesao_id, ata_item_id
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM ata_adesao_itens
  ) ranked
  WHERE rn > 1
);

-- 3. Adicionar UNIQUE constraint para prevenir duplicatas no futuro
-- Usando NOT VALID + VALIDATE para evitar lock prolongado em produção
ALTER TABLE ata_adesao_itens
  DROP CONSTRAINT IF EXISTS uk_ata_adesao_itens;

ALTER TABLE ata_adesao_itens
  ADD CONSTRAINT uk_ata_adesao_itens
  UNIQUE (adesao_id, ata_item_id);

-- 4. Verificar que não restaram duplicatas
SELECT adesao_id, ata_item_id, COUNT(*)
FROM ata_adesao_itens
GROUP BY adesao_id, ata_item_id
HAVING COUNT(*) > 1;
