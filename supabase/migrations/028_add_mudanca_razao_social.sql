-- 028_add_mudanca_razao_social.sql
-- Adiciona suporte ao tipo de aditivo "Mudança de Razão Social"

-- 1. Insere o novo tipo de aditivo na tabela tipo_aditivo
INSERT INTO tipo_aditivo (nome, descricao)
SELECT 'MUDANCA_RAZAO_SOCIAL', 'Mudança de razão social da contratada'
WHERE NOT EXISTS (
  SELECT 1 FROM tipo_aditivo WHERE nome = 'MUDANCA_RAZAO_SOCIAL'
);

-- 2. Adiciona colunas para armazenar a nova razão social e CNPJ na tabela aditivos
ALTER TABLE aditivos ADD COLUMN IF NOT EXISTS nova_razao_social VARCHAR(255);
ALTER TABLE aditivos ADD COLUMN IF NOT EXISTS novo_cnpj VARCHAR(20);
