-- Script para criar e popular a tabela tipo_aditivo no Supabase
-- Execute este script no editor SQL do Supabase

-- 1. Verificar se a tabela existe e suas colunas
DO $$
DECLARE
    table_exists BOOLEAN;
    has_nome BOOLEAN;
    has_descricao BOOLEAN;
    has_ativo BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tipo_aditivo' AND table_schema = 'public') INTO table_exists;
    
    IF NOT table_exists THEN
        -- Criar tabela com todas as colunas
        CREATE TABLE public.tipo_aditivo (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            nome TEXT NOT NULL UNIQUE,
            descricao TEXT,
            ativo BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        RAISE NOTICE 'Tabela tipo_aditivo criada';
    ELSE
        RAISE NOTICE 'Tabela tipo_aditivo ja existe';
        
        -- Verificar colunas existentes
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tipo_aditivo' AND column_name = 'nome') INTO has_nome;
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tipo_aditivo' AND column_name = 'descricao') INTO has_descricao;
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tipo_aditivo' AND column_name = 'ativo') INTO has_ativo;
        
        RAISE NOTICE 'Colunas: nome: %, descricao: %, ativo: %', has_nome, has_descricao, has_ativo;
        
        -- Adicionar colunas faltantes
        IF NOT has_nome THEN
            ALTER TABLE public.tipo_aditivo ADD COLUMN nome TEXT NOT NULL UNIQUE;
        END IF;
        
        IF NOT has_descricao THEN
            ALTER TABLE public.tipo_aditivo ADD COLUMN descricao TEXT;
        END IF;
        
        IF NOT has_ativo THEN
            ALTER TABLE public.tipo_aditivo ADD COLUMN ativo BOOLEAN DEFAULT true;
        END IF;
    END IF;
END $$;

-- Habilitar Row Level Security
ALTER TABLE public.tipo_aditivo ENABLE ROW LEVEL SECURITY;

-- Política de acesso
DROP POLICY IF EXISTS "Allow all access to tipo_aditivo" ON public.tipo_aditivo;
CREATE POLICY "Allow all access to tipo_aditivo" ON public.tipo_aditivo FOR ALL USING (true) WITH CHECK (true);

-- 2. Popular tabela de tipos de aditivo apenas se vazia
INSERT INTO public.tipo_aditivo (nome, descricao, ativo) 
SELECT 'ADITIVO_PRAZO', 'Aditivo de Prazo', true WHERE NOT EXISTS (SELECT 1 FROM public.tipo_aditivo WHERE nome = 'ADITIVO_PRAZO');
INSERT INTO public.tipo_aditivo (nome, descricao, ativo) 
SELECT 'ADITIVO_PRAZO_VALOR', 'Aditivo de Prazo e Valor', true WHERE NOT EXISTS (SELECT 1 FROM public.tipo_aditivo WHERE nome = 'ADITIVO_PRAZO_VALOR');
INSERT INTO public.tipo_aditivo (nome, descricao, ativo) 
SELECT 'DISTRATO', 'Distrato', true WHERE NOT EXISTS (SELECT 1 FROM public.tipo_aditivo WHERE nome = 'DISTRATO');
INSERT INTO public.tipo_aditivo (nome, descricao, ativo) 
SELECT 'ADITIVO_VALOR', 'Aditivo de Valor', true WHERE NOT EXISTS (SELECT 1 FROM public.tipo_aditivo WHERE nome = 'ADITIVO_VALOR');
INSERT INTO public.tipo_aditivo (nome, descricao, ativo) 
SELECT 'ADITIVO_OBJETO', 'Aditivo de Objeto', true WHERE NOT EXISTS (SELECT 1 FROM public.tipo_aditivo WHERE nome = 'ADITIVO_OBJETO');

-- 3. Verificar dados inseridos
SELECT * FROM public.tipo_aditivo;