-- Migration to add contract_type to dotacoes and fix view

-- 1. Add contract_type column to dotacoes table
ALTER TABLE public.dotacoes ADD COLUMN IF NOT EXISTS contract_type TEXT;

-- 2. Add missing numeric columns if they don't exist (for safety)
ALTER TABLE public.dotacoes ADD COLUMN IF NOT EXISTS total_empenhado NUMERIC(15,2);
ALTER TABLE public.dotacoes ADD COLUMN IF NOT EXISTS total_cancelado NUMERIC(15,2);
ALTER TABLE public.dotacoes ADD COLUMN IF NOT EXISTS total_pago NUMERIC(15,2);
ALTER TABLE public.dotacoes ADD COLUMN IF NOT EXISTS saldo_disponivel NUMERIC(15,2);

-- 3. Update vw_saldo_dotacoes to include contract_type
DROP VIEW IF EXISTS public.vw_saldo_dotacoes;
CREATE VIEW public.vw_saldo_dotacoes AS
SELECT 
    d.id,
    d.contract_id,
    d.numero_contrato,
    c.contratada,
    d.dotacao,
    d.credito,
    d.data_disponibilidade,
    d.unid_gestora,
    d.valor_dotacao,
    d.nunotaempenho,
    COALESCE(d.total_empenhado, 0) AS total_empenhado,
    COALESCE(d.total_cancelado, 0) AS total_cancelado,
    COALESCE(d.total_pago, 0) AS total_pago,
    COALESCE(d.saldo_disponivel, d.valor_dotacao) AS saldo_disponivel,
    COALESCE(d.contract_type, c.tipo) AS contract_type,
    d.created_at,
    d.updated_at
FROM public.dotacoes d
LEFT JOIN public.contratos c ON d.contract_id = c.id;

-- 4. Create index for contract_type in dotacoes
CREATE INDEX IF NOT EXISTS idx_dotacoes_contract_type ON public.dotacoes(contract_type);

COMMENT ON COLUMN public.dotacoes.contract_type IS 'Tipo do contrato: serviço ou material';
