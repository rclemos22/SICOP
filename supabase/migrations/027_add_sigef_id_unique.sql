-- 027_add_sigef_id_unique.sql
-- Adiciona constraint UNIQUE na coluna sigef_id da tabela transacoes.
-- Sem esta constraint, o upsert({ onConflict: 'sigef_id' }) silenciosamente
-- não insere/atualiza nenhum registro, deixando a tabela vazia.

-- 1. Remove duplicatas de sigef_id (caso existam de versões anteriores)
DELETE FROM transacoes WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY sigef_id ORDER BY updated_at DESC NULLS LAST) AS rn
    FROM transacoes WHERE sigef_id IS NOT NULL
  ) dup WHERE dup.rn > 1
);

-- 2. Adiciona a constraint UNIQUE
ALTER TABLE transacoes ADD CONSTRAINT uk_transacoes_sigef_id UNIQUE (sigef_id);
