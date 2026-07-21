-- =============================================================
-- 13_FIX_ATAS_FORNECEDOR_E_ITENS.sql
--
-- Corrige dois bugs na gestão de Atas de Licitação:
--
-- 1. Nome do fornecedor não salvo
--    Adiciona coluna fornecedor_nome na tabela atas e popula
--    os registros existentes via JOIN com fornecedores.
--
-- 2. Edição de ATA apaga consumo interno e adesões
--    Remove ON DELETE CASCADE das FKs de ata_consumo_interno
--    e ata_adesoes que referenciam ata_itens, evitando que
--    DELETE em ata_itens cascade-delete dados relacionados.
-- =============================================================

BEGIN;

-- =============================================================
-- 1. ADICIONAR COLUNA fornecedor_nome
-- =============================================================
SELECT '--- 1. Adicionando coluna fornecedor_nome ---' AS etapa;

ALTER TABLE public.atas ADD COLUMN IF NOT EXISTS fornecedor_nome VARCHAR(255);

-- Popular registros existentes a partir da tabela de fornecedores
UPDATE public.atas a
SET fornecedor_nome = f.razao_social
FROM public.fornecedores f
WHERE a.fornecedor_id = f.id
  AND a.fornecedor_nome IS NULL;

SELECT COUNT(*) || ' registros de atas atualizados com fornecedor_nome' AS resultado
FROM public.atas WHERE fornecedor_nome IS NOT NULL;

SELECT COUNT(*) || ' registros de atas AINDA sem fornecedor_nome' AS resultado
FROM public.atas WHERE fornecedor_nome IS NULL;

-- =============================================================
-- 2. REMOVER ON DELETE CASCADE DAS FKs
-- =============================================================
SELECT '--- 2. Removendo ON DELETE CASCADE das FKs ---' AS etapa;

-- 2a. FK ata_consumo_interno.ata_item_id → ata_itens.id
DO $$
DECLARE
  constraint_name_var TEXT;
BEGIN
  SELECT tc.constraint_name INTO constraint_name_var
  FROM information_schema.table_constraints tc
  JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
  WHERE tc.table_name = 'ata_consumo_interno'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND rc.delete_rule = 'CASCADE';

  IF constraint_name_var IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ata_consumo_interno DROP CONSTRAINT ' || constraint_name_var;
    EXECUTE 'ALTER TABLE public.ata_consumo_interno ADD CONSTRAINT ' || constraint_name_var ||
            ' FOREIGN KEY (ata_item_id) REFERENCES public.ata_itens(id) ON DELETE SET NULL';
    RAISE NOTICE 'FK % alterada: CASCADE → SET NULL', constraint_name_var;
  ELSE
    RAISE NOTICE 'Nenhuma FK com CASCADE encontrada em ata_consumo_interno';
  END IF;
END $$;

-- 2b. FK ata_adesoes.ata_item_id → ata_itens.id  
DO $$
DECLARE
  constraint_name_var TEXT;
BEGIN
  SELECT tc.constraint_name INTO constraint_name_var
  FROM information_schema.table_constraints tc
  JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
  WHERE tc.table_name = 'ata_adesoes'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND rc.delete_rule = 'CASCADE';

  IF constraint_name_var IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ata_adesoes DROP CONSTRAINT ' || constraint_name_var;
    EXECUTE 'ALTER TABLE public.ata_adesoes ADD CONSTRAINT ' || constraint_name_var ||
            ' FOREIGN KEY (ata_item_id) REFERENCES public.ata_itens(id) ON DELETE SET NULL';
    RAISE NOTICE 'FK % alterada: CASCADE → SET NULL', constraint_name_var;
  ELSE
    RAISE NOTICE 'Nenhuma FK com CASCADE encontrada em ata_adesoes';
  END IF;
END $$;

-- =============================================================
-- 3. ATUALIZAR VIEW vw_atas_resumo (se necessário)
--    Como a view faz SELECT a.*, a nova coluna será incluída
--    automaticamente. Apenas recriamos para garantir.
-- =============================================================
SELECT '--- 3. Recriando vw_atas_resumo ---' AS etapa;

DROP VIEW IF EXISTS public.vw_atas_resumo CASCADE;
CREATE VIEW public.vw_atas_resumo AS
SELECT
  a.*,
  COUNT(ai.id) AS qtd_itens
FROM public.atas a
LEFT JOIN public.ata_itens ai ON ai.ata_id = a.id
GROUP BY a.id;

-- =============================================================
-- 4. VERIFICAR ESTADO FINAL
-- =============================================================
SELECT '--- 4. Verificando correcao ---' AS etapa;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'atas' AND column_name = 'fornecedor_nome';

SELECT tc.table_name, tc.constraint_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name IN ('ata_consumo_interno', 'ata_adesoes')
  AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name, tc.constraint_name;

SELECT table_name AS view_name
FROM information_schema.views
WHERE table_schema = 'public' AND table_name = 'vw_atas_resumo';

COMMIT;

SELECT '=== CORRECAO CONCLUIDA ===' AS mensagem;
