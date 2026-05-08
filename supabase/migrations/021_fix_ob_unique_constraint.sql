-- 021_fix_ob_unique_constraint.sql
-- Corrige a constraint unique da tabela sigef_ordens_bancarias
-- para incluir nudocumento, alinhando com o upsert do código TypeScript

-- 1. Remove constraint antiga (se existir)
ALTER TABLE IF EXISTS public.sigef_ordens_bancarias DROP CONSTRAINT IF EXISTS uk_sigef_ob;

-- 2. Remove possíveis duplicatas que violariam a nova constraint
DELETE FROM public.sigef_ordens_bancarias
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY nuordembancaria, cdunidadegestora, COALESCE(nudocumento, '')
      ORDER BY last_sync DESC NULLS LAST
    ) AS rn
    FROM public.sigef_ordens_bancarias
  ) dup
  WHERE dup.rn > 1
);

-- 3. Adiciona nova constraint com nudocumento
ALTER TABLE IF EXISTS public.sigef_ordens_bancarias
  ADD CONSTRAINT uk_sigef_ob UNIQUE (nuordembancaria, cdunidadegestora, nudocumento);
