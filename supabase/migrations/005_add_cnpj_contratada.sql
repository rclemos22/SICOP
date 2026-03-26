-- Criar colunas para armazenar nome e CNPJ da contratada vindos da tabela fornecedores
-- Execute este script no editor SQL do Supabase

-- 1. Adicionar coluna cnpj_contratada na tabela contratos
ALTER TABLE public.contratos 
ADD COLUMN IF NOT EXISTS cnpj_contratada TEXT;

COMMENT ON COLUMN public.contratos.cnpj_contratada IS 'CNPJ da empresa contratada (vindo da tabela fornecedores)';

-- 2. Adicionar coluna link_sei na tabela contratos (opcional)
ALTER TABLE public.contratos 
ADD COLUMN IF NOT EXISTS link_sei TEXT;

COMMENT ON COLUMN public.contratos.link_sei IS 'Link do processo SEI (opcional)';

-- 3. Verificar estrutura atual
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'contratos' 
ORDER BY ordinal_position;