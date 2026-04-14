-- Migration to add contract_type to dotacoes and update view

-- 1. Add contract_type column to dotacoes table
ALTER TABLE public.dotacoes ADD COLUMN IF NOT EXISTS contract_type TEXT;

-- 2. Update vw_saldo_dotacoes to include contract_type from contratos
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
    d.contract_type,
    d.created_at,
    d.updated_at
FROM public.dotacoes d
LEFT JOIN public.contratos c ON d.contract_id = c.id;

-- 3. Create index for contract_type in dotacoes (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_dotacoes_contract_type ON public.dotacoes(contract_type);

COMMENT ON COLUMN public.dotacoes.contract_type IS 'Tipo do contrato: serviço ou material';
