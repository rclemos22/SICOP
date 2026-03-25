-- Adiciona Foreign Key entre aditivos e tipo_aditivo
-- Execute este script no editor SQL do Supabase

-- 1. Adicionar coluna tipo_id se não existir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'aditivos' AND column_name = 'tipo_id'
    ) THEN
        ALTER TABLE public.aditivos ADD COLUMN tipo_id UUID;
    END IF;
END $$;

-- 2. Criar Foreign Key
ALTER TABLE public.aditivos
ADD CONSTRAINT fk_aditivos_tipo_aditivo
FOREIGN KEY (tipo_id) REFERENCES public.tipo_aditivo(id) ON DELETE SET NULL;

-- 3. Popular o campo tipo_id com os valores corretos baseados no tipo atual
-- Isso assume que a coluna 'tipo' existe e tem os valores corretos
UPDATE public.aditivos a
SET tipo_id = t.id
FROM public.tipo_aditivo t
WHERE a.tipo = t.nome AND a.tipo_id IS NULL;

-- 4. Verificar relacionamentos criados
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_name = 'aditivos';