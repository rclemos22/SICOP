-- Adiciona colunas que faltam na tabela contratos
-- unid_gestora, setor_id, gestor_contrato, fiscal_admin, fiscal_tecnico

ALTER TABLE public.contratos
ADD COLUMN IF NOT EXISTS unid_gestora TEXT,
ADD COLUMN IF NOT EXISTS setor_id TEXT,
ADD COLUMN IF NOT EXISTS gestor_contrato TEXT,
ADD COLUMN IF NOT EXISTS fiscal_admin TEXT,
ADD COLUMN IF NOT EXISTS fiscal_tecnico TEXT;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_contratos_unid_gestora ON public.contratos(unid_gestora);
CREATE INDEX IF NOT EXISTS idx_contratos_setor_id ON public.contratos(setor_id);