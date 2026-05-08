-- Tabelas para cache de dados SIGEF
-- Objetivo: Evitar consultas excessivas à API do SIGEF

-- ============================================
-- Tabela de Notas de Empenho cacheadas
-- ============================================
CREATE TABLE IF NOT EXISTS public.sigef_notas_empenho (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Chave primária composta: unid_gestora + nunotaempenho_original
  cdunidadegestora INTEGER NOT NULL,
  nunotaempenho VARCHAR(20) NOT NULL,
  
  -- Dados da NE
  cdgestao INTEGER,
  cdcredor VARCHAR(20),
  cdtipocredor VARCHAR(10),
  cdtipocredorpessoa VARCHAR(10),
  cdugfavorecida INTEGER,
  cdorgao INTEGER,
  cdsubacao INTEGER,
  cdfuncao INTEGER,
  cdsubfuncao INTEGER,
  cdprograma INTEGER,
  cdacao INTEGER,
  localizagasto VARCHAR(10),
  cdnaturezadespesa VARCHAR(20),
  cdfonte VARCHAR(30),
  cdmodalidade INTEGER,
  
  -- Valores
  vlnotaempenho NUMERIC(15,2) DEFAULT 0,
  nuquantidade INTEGER,
  
  -- Datas e referências
  dtlancamento DATE,
  tipo VARCHAR(50),
  nuprocesso VARCHAR(30),
  nuneoriginal VARCHAR(20),
  dehistorico TEXT,
  
  -- Controle
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uk_sigef_ne UNIQUE (cdunidadegestora, nunotaempenho)
);

-- Índice para buscas
CREATE INDEX IF NOT EXISTS idx_sigef_ne_ug ON public.sigef_notas_empenho(cdunidadegestora);
CREATE INDEX IF NOT EXISTS idx_sigef_ne_numero ON public.sigef_notas_empenho(nunotaempenho);
CREATE INDEX IF NOT EXISTS idx_sigef_ne_credor ON public.sigef_notas_empenho(cdcredor);
CREATE INDEX IF NOT EXISTS idx_sigef_ne_ano ON public.sigef_notas_empenho(substring(nunotaempenho from 1 for 4));

-- ============================================
-- Tabela de Movimentos de NE (eventos)
-- Eventos: 400010=Empenho, 400011=Reforço, 400012=Anulação
-- ============================================
CREATE TABLE IF NOT EXISTS public.sigef_ne_movimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Chave: UG + NE original + evento
  cdunidadegestora INTEGER NOT NULL,
  nunotaempenho VARCHAR(20) NOT NULL,
  cdevento INTEGER NOT NULL,
  
  -- Dados do movimento
  nudocumento VARCHAR(30),
  cdcredor VARCHAR(20),
  cdorgao INTEGER,
  cdsubacao INTEGER,
  cdfuncao INTEGER,
  cdsubfuncao INTEGER,
  cdprograma INTEGER,
  cdacao INTEGER,
  cdnaturezadespesa VARCHAR(20),
  cdfonte VARCHAR(30),
  cdmodalidade INTEGER,
  
  vlnotaempenho NUMERIC(15,2) DEFAULT 0,
  dtlancamento DATE,
  dehistorico TEXT,
  
  -- Controle
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uk_sigef_ne_movimento UNIQUE (cdunidadegestora, nunotaempenho, cdevento, dtlancamento)
);

CREATE INDEX IF NOT EXISTS idx_sigef_ne_mov_ug ON public.sigef_ne_movimentos(cdunidadegestora);
CREATE INDEX IF NOT EXISTS idx_sigef_ne_mov_ne ON public.sigef_ne_movimentos(nunotaempenho);
CREATE INDEX IF NOT EXISTS idx_sigef_ne_mov_evento ON public.sigef_ne_movimentos(cdevento);

-- ============================================
-- Tabela de Ordens Bancárias cacheadas
-- ============================================
CREATE TABLE IF NOT EXISTS public.sigef_ordens_bancarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Chave primária
  nuordembancaria VARCHAR(30) NOT NULL,
  cdunidadegestora INTEGER NOT NULL,
  
  -- NE vinculada (pode ter múltiplas OBs para uma NE)
  nunotaempenho VARCHAR(20),
  
  -- Dados da OB
  cdgestao INTEGER,
  cdevento INTEGER,
  nudocumento VARCHAR(30),
  cdcredor VARCHAR(20),
  cdtipocredor VARCHAR(10),
  cdugfavorecida INTEGER,
  cdorgao INTEGER,
  cdsubacao INTEGER,
  cdfuncao INTEGER,
  cdsubfuncao INTEGER,
  cdprograma INTEGER,
  cdacao INTEGER,
  localizagasto VARCHAR(10),
  cdnaturezadespesa VARCHAR(20),
  cdfonte VARCHAR(30),
  cdmodalidade INTEGER,
  
  -- Valores
  vltotal NUMERIC(15,2) DEFAULT 0,
  
  -- Datas
  dtlancamento DATE,
  dtpagamento DATE,
  
  -- Situação
  cdsituacaoordembancaria VARCHAR(20),
  situacaopreparacaopagamento VARCHAR(50),
  tipoordembancaria VARCHAR(50),
  tipopreparacaopagamento VARCHAR(50),
  
  -- Descrição
  deobservacao TEXT,
  definalidade TEXT,
  
  -- Responsável
  usuario_responsavel VARCHAR(100),
  
  -- Controle
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uk_sigef_ob UNIQUE (nuordembancaria, cdunidadegestora, nudocumento)
);

CREATE INDEX IF NOT EXISTS idx_sigef_ob_ug ON public.sigef_ordens_bancarias(cdunidadegestora);
CREATE INDEX IF NOT EXISTS idx_sigef_ob_numero ON public.sigef_ordens_bancarias(nuordembancaria);
CREATE INDEX IF NOT EXISTS idx_sigef_ob_ne ON public.sigef_ordens_bancarias(nunotaempenho);
CREATE INDEX IF NOT EXISTS idx_sigef_ob_situacao ON public.sigef_ordens_bancarias(cdsituacaoordembancaria);
CREATE INDEX IF NOT EXISTS idx_sigef_ob_data ON public.sigef_ordens_bancarias(dtlancamento);

-- ============================================
-- Funções para cálculos automáticos
-- ============================================

-- Função para calcular valor engajado de uma NE (original + reforços - anulações)
CREATE OR REPLACE FUNCTION public.fn_calcular_valor_empenhado(
  p_cdunidadegestora INTEGER,
  p_nunotaempenho VARCHAR
) RETURNS NUMERIC(15,2) AS $$
DECLARE
  v_valor NUMERIC(15,2) := 0;
BEGIN
  -- Soma: eventos 400010 (empenho) + 400011 (reforço)
  SELECT COALESCE(SUM(vlnotaempenho), 0)
  INTO v_valor
  FROM sigef_ne_movimentos
  WHERE cdunidadegestora = p_cdunidadegestora
    AND nunotaempenho = p_nunotaempenho
    AND cdevento IN (400010, 400011);
  
  -- Subtrai: evento 400012 (anulação)
  v_valor := v_valor - COALESCE(
    (SELECT SUM(vlnotaempenho)
     FROM sigef_ne_movimentos
     WHERE cdunidadegestora = p_cdunidadegestora
       AND nunotaempenho = p_nunotaempenho
       AND cdevento = 400012),
    0
  );
  
  RETURN v_valor;
END;
$$ LANGUAGE plpgsql;

-- Função para calcular valor pago de uma NE (soma das OBs confirmadas)
CREATE OR REPLACE FUNCTION public.fn_calcular_valor_pago(
  p_cdunidadegestora INTEGER,
  p_nunotaempenho VARCHAR
) RETURNS NUMERIC(15,2) AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(vltotal)
     FROM sigef_ordens_bancarias
     WHERE cdunidadegestora = p_cdunidadegestora
       AND nunotaempenho = p_nunotaempenho
       AND cdsituacaoordembancaria IN ('CB', 'confirmada banco', 'creditado')),
    0
  );
END;
$$ LANGUAGE plpgsql;

-- Função para calcular saldo a pagar (empenhado - pago)
CREATE OR REPLACE FUNCTION public.fn_calcular_saldo_pagar(
  p_cdunidadegestora INTEGER,
  p_nunotaempenho VARCHAR
) RETURNS NUMERIC(15,2) AS $$
BEGIN
  RETURN fn_calcular_valor_empenhado(p_cdunidadegestora, p_nunotaempenho) 
       - fn_calcular_valor_pago(p_cdunidadegestora, p_nunotaempenho);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- View para resumo de NE com cálculos
-- ============================================
CREATE OR REPLACE VIEW public.vw_sigef_ne_resumo AS
SELECT 
  ne.cdunidadegestora,
  ne.nunotaempenho,
  ne.cdcredor,
  ne.dtlancamento,
  ne.vlnotaempenho as valor_original,
  ne.cdnaturezadespesa,
  ne.cdfonte,
  fn_calcular_valor_empenhado(ne.cdunidadegestora, ne.nunotaempenho) as valor_empenhado,
  fn_calcular_valor_pago(ne.cdunidadegestora, ne.nunotaempenho) as valor_pago,
  fn_calcular_saldo_pagar(ne.cdunidadegestora, ne.nunotaempenho) as saldo_pagar
FROM sigef_notas_empenho ne;

-- ============================================
-- policies RLS (ajuste conforme necessidade)
-- ============================================
ALTER TABLE public.sigef_notas_empenho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigef_ne_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigef_ordens_bancarias ENABLE ROW LEVEL SECURITY;

-- Policy para permitir tudo (ajuste em produção)
DROP POLICY IF EXISTS "Allow all for sigef_notas_empenho" ON public.sigef_notas_empenho;
CREATE POLICY "Allow all for sigef_notas_empenho" ON public.sigef_notas_empenho FOR ALL USING (true);
DROP POLICY IF EXISTS "Allow all for sigef_ne_movimentos" ON public.sigef_ne_movimentos;
CREATE POLICY "Allow all for sigef_ne_movimentos" ON public.sigef_ne_movimentos FOR ALL USING (true);
DROP POLICY IF EXISTS "Allow all for sigef_ordens_bancarias" ON public.sigef_ordens_bancarias;
CREATE POLICY "Allow all for sigef_ordens_bancarias" ON public.sigef_ordens_bancarias FOR ALL USING (true);

-- ============================================
-- Tabela de controle de sincronização
-- ============================================
CREATE TABLE IF NOT EXISTS public.sigef_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela VARCHAR(50) NOT NULL,
  registro_id VARCHAR(100),
  status VARCHAR(20) NOT NULL, -- 'success', 'error', 'pending'
  mensagem TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sigef_sync_log_tabela ON public.sigef_sync_log(tabela, created_at DESC);