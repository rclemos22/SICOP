-- Adiciona coluna fornecedor_id na tabela contratos
-- Esta coluna cria a relação com a tabela fornecedores

ALTER TABLE public.contratos
ADD COLUMN IF NOT EXISTS fornecedor_id UUID REFERENCES public.fornecedores(id) ON DELETE SET NULL;

-- Adiciona índice para melhorar performance nas queries com FK
CREATE INDEX IF NOT EXISTS idx_contratos_fornecedor_id ON public.contratos(fornecedor_id);