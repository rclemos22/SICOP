-- ============================================================
-- 21_ADD_UNIQUE_SIGEF_ID_TRANSACOES.sql
-- ============================================================
-- O upsert em transacoes usa onConflict: 'sigef_id', mas não
-- havia UNIQUE constraint na coluna, causando HTTP 400.
-- ============================================================

-- 1. Diagnóstico: busca duplicatas em sigef_id
SELECT '=== DUPLICATAS EM sigef_id ===' AS etapa;
SELECT sigef_id, COUNT(*) AS qtd
FROM public.transacoes
WHERE sigef_id IS NOT NULL
GROUP BY sigef_id
HAVING COUNT(*) > 1;

-- 2. Se houver duplicatas, remover registros mais recentes (maior id),
--    mantendo o registro mais antigo por sigef_id.
WITH dup AS (
  SELECT id, sigef_id,
         ROW_NUMBER() OVER (PARTITION BY sigef_id ORDER BY id ASC) AS rn
  FROM public.transacoes
  WHERE sigef_id IS NOT NULL
)
DELETE FROM public.transacoes
WHERE id IN (SELECT id FROM dup WHERE rn > 1);

-- 3. Adicionar UNIQUE constraint (se já existir, ignora)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transacoes'::regclass
      AND conname = 'uk_transacoes_sigef_id'
  ) THEN
    ALTER TABLE public.transacoes
      ADD CONSTRAINT uk_transacoes_sigef_id UNIQUE (sigef_id);
    RAISE NOTICE 'Constraint uk_transacoes_sigef_id adicionada.';
  ELSE
    RAISE NOTICE 'Constraint uk_transacoes_sigef_id já existe.';
  END IF;
END $$;

-- 4. Verificar
SELECT '=== CONSTRAINT ADICIONADA ===' AS etapa;
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.transacoes'::regclass
  AND conname = 'uk_transacoes_sigef_id';
