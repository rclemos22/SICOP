-- ============================================================
-- 21_ADD_UNIQUE_SIGEF_ID_TRANSACOES.sql
-- ============================================================
-- O upsert em transacoes usa onConflict: 'sigef_id', mas:
-- 1) Nao havia UNIQUE constraint em sigef_id
-- 2) A tabela transacoes nao tinha PRIMARY KEY (PGRST204)
-- Ambos sao necessarios para o upsert do PostgREST funcionar.
-- ============================================================

-- 0. Diagnostico: constraints atuais
SELECT '=== CONSTRAINTS ATUAIS ===' AS etapa;
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.transacoes'::regclass;

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

-- 3. Garantir que id e NOT NULL e preencher UUIDs faltantes
UPDATE public.transacoes SET id = gen_random_uuid()::text WHERE id IS NULL;
ALTER TABLE public.transacoes ALTER COLUMN id SET NOT NULL;

-- 4. Adicionar PRIMARY KEY em id (se nao existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transacoes'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.transacoes ADD PRIMARY KEY (id);
    RAISE NOTICE 'PRIMARY KEY adicionada em transacoes(id).';
  ELSE
    RAISE NOTICE 'PRIMARY KEY ja existe em transacoes.';
  END IF;
END $$;

-- 5. Adicionar UNIQUE constraint em sigef_id (se ja existir, ignora)
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
    RAISE NOTICE 'Constraint uk_transacoes_sigef_id ja existe.';
  END IF;
END $$;

-- 6. Forcar PostgREST a recarregar o schema
NOTIFY pgrst, 'reload schema';

-- 7. Verificar constraints resultantes
SELECT '=== CONSTRAINTS FINAIS ===' AS etapa;
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.transacoes'::regclass;
