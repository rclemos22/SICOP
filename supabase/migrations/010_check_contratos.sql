-- Verificar e corrigir permissões da tabela contratos
-- Primeiro ver se a tabela existe e tem dados
SELECT id, contrato, objeto FROM public.contratos WHERE contrato = '087/2025' LIMIT 1;

-- Se não retornar, verificar se a tabela existe
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contratos';

-- Verificar políticas existentes na tabela
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'contratos';