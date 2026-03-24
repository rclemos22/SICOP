-- Script para criação/atualização das tabelas de dotação no Supabase

-- 1. Adicionar coluna nunotaempenho se não existir na tabela
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'dotacoes' AND column_name = 'nunotaempenho'
    ) THEN
        ALTER TABLE public.dotacoes ADD COLUMN nunotaempenho TEXT;
    END IF;
END $$;

-- 2. Criar tabela de dotações (se não existir)
CREATE TABLE IF NOT EXISTS public.dotacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
    numero_contrato TEXT NOT NULL,
    dotacao TEXT NOT NULL,
    credito TEXT NOT NULL,
    data_disponibilidade DATE NOT NULL,
    unid_gestora TEXT NOT NULL,
    valor_dotacao NUMERIC(15,2) NOT NULL DEFAULT 0,
    nunotaempenho TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Garantir que a coluna existe (para casos onde a tabela já existe)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'dotacoes' AND column_name = 'nunotaempenho'
    ) THEN
        ALTER TABLE public.dotacoes ADD COLUMN nunotaempenho TEXT;
    END IF;
END $$;

-- 4. Habilitar Row Level Security
ALTER TABLE public.dotacoes ENABLE ROW LEVEL SECURITY;

-- 5. Criar política de acesso
DROP POLICY IF EXISTS "Allow all access to dotacoes" ON public.dotacoes;
CREATE POLICY "Allow all access to dotacoes" ON public.dotacoes FOR ALL USING (true) WITH CHECK (true);

-- 6. View simplificada (sem зависимості de movimentos_itens)
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
    0 AS total_empenhado,
    0 AS total_cancelado,
    0 AS total_pago,
    d.valor_dotacao AS saldo_disponivel,
    d.created_at,
    d.updated_at
FROM public.dotacoes d
LEFT JOIN public.contratos c ON d.contract_id = c.id;

-- 7. Criar índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_dotacoes_contract_id ON public.dotacoes(contract_id);
CREATE INDEX IF NOT EXISTS idx_dotacoes_unid_gestora ON public.dotacoes(unid_gestora);
CREATE INDEX IF NOT EXISTS idx_dotacoes_nunotaempenho ON public.dotacoes(nunotaempenho);

-- 8. Comentários para documentação
COMMENT ON TABLE public.dotacoes IS 'Tabela de dotações orçamentárias vinculadas a contratos';
COMMENT ON COLUMN public.dotacoes.nunotaempenho IS 'Número da Nota de Empenho vinculada (vinda do SIGEF)';
COMMENT ON VIEW public.vw_saldo_dotacoes IS 'View que apresenta as dotações com saldos (valores simplificados)';
