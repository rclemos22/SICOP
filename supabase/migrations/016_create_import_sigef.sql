-- Tabela para espelho de dados brutos do SIGEF
-- Objetivo: Armazenar o JSON sem tratamento para servir como fonte única de verdade

CREATE TABLE IF NOT EXISTS public.import_sigef (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(100) NOT NULL, -- nunotaempenho, nuordembancaria, etc.
  type VARCHAR(50) NOT NULL,       -- 'NE', 'OB', 'MOVIMENTOS_ANO', etc.
  raw_data JSONB NOT NULL,
  year INTEGER,
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uk_import_sigef UNIQUE (identifier, type)
);

CREATE INDEX IF NOT EXISTS idx_import_sigef_identifier ON public.import_sigef(identifier);
CREATE INDEX IF NOT EXISTS idx_import_sigef_type ON public.import_sigef(type);
CREATE INDEX IF NOT EXISTS idx_import_sigef_year ON public.import_sigef(year);

-- Habilitar RLS
ALTER TABLE public.import_sigef ENABLE ROW LEVEL SECURITY;

-- Política de acesso total (ajustar em produção)
CREATE POLICY "Allow all for import_sigef" ON public.import_sigef FOR ALL USING (true);
