-- =============================================================
-- 00_CRIAR_TABELAS_FALTANTES.sql
--
-- Cria tabelas que existem no banco mas não possuem definição
-- SQL no repositório. Essencial para recriação do schema do zero.
-- =============================================================

-- =============================================================
-- sigef_sync_periods
-- Usada por: SigefBulkSyncService, SigefSyncService
-- Gerencia quais períodos já foram sincronizados.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.sigef_sync_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_inicio TEXT NOT NULL,
  periodo_fim TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('NE', 'OB')),
  total_registros INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'error')),
  error_msg TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uk_sync_period UNIQUE (periodo_inicio, periodo_fim, tipo)
);

CREATE INDEX IF NOT EXISTS idx_sync_periods_status
  ON public.sigef_sync_periods(status);

CREATE INDEX IF NOT EXISTS idx_sync_periods_tipo_status
  ON public.sigef_sync_periods(tipo, status);
