-- Adiciona coluna processo_sei na tabela contratos
-- Execute este script no editor SQL do Supabase

ALTER TABLE public.contratos 
ADD COLUMN IF NOT EXISTS processo_sei TEXT;

COMMENT ON COLUMN public.contratos.processo_sei IS 'Número do processo SEI do contrato';