-- 026_auto_sync_transactions.sql
-- Sincronização automática: sigef_ordens_bancarias -> transacoes
-- VERSÃO CORRIGIDA: verifica colunas existentes

-- ============================================
-- 0. Verificar e adicionar colunas necessárias na tabela transacoes
-- ============================================
DO $$
BEGIN
    -- created_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transacoes' AND column_name='created_at') THEN
        ALTER TABLE transacoes ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;

    -- updated_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transacoes' AND column_name='updated_at') THEN
        ALTER TABLE transacoes ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;

    -- sigef_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transacoes' AND column_name='sigef_id') THEN
        ALTER TABLE transacoes ADD COLUMN sigef_id VARCHAR(100);
    END IF;

    -- ob_number
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transacoes' AND column_name='ob_number') THEN
        ALTER TABLE transacoes ADD COLUMN ob_number VARCHAR(50);
    END IF;

    -- document_number
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transacoes' AND column_name='document_number') THEN
        ALTER TABLE transacoes ADD COLUMN document_number VARCHAR(50);
    END IF;
END $$;

-- ============================================
-- VIEW 1: Diagnóstico - OBs por contrato
-- ============================================
CREATE OR REPLACE VIEW public.vw_ob_por_contrato AS
SELECT 
  ob.id,
  ob.nuordembancaria,
  ob.nunotaempenho,
  ob.vltotal,
  ob.dtpagamento,
  ob.cdsituacaoordembancaria,
  ob.deobservacao,
  ob.nudocumento,
  d.id AS dotacao_id,
  d.contract_id,
  d.dotacao,
  c.contrato,
  c.contratada
FROM sigef_ordens_bancarias ob
LEFT JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
LEFT JOIN contratos c ON d.contract_id = c.id
ORDER BY ob.dtpagamento DESC NULLS LAST;

-- ============================================
-- VIEW 2: Transações existentes vs OBs
-- ============================================
CREATE OR REPLACE VIEW public.vw_transacoes_vs_obs AS
SELECT 
  'CACHE_SIGEF'::VARCHAR AS origem,
  ob.nuordembancaria,
  ob.nunotaempenho,
  ob.vltotal,
  ob.dtpagamento,
  ob.cdsituacaoordembancaria::VARCHAR AS situacao,
  ob.deobservacao,
  ob.nudocumento,
  c.contrato,
  c.id AS contract_id
FROM sigef_ordens_bancarias ob
LEFT JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
LEFT JOIN contratos c ON d.contract_id = c.id

UNION ALL

SELECT 
  'TRANSACOES'::VARCHAR AS origem,
  t.ob_number AS nuordembancaria,
  t.commitment_id AS nunotaempenho,
  t.amount AS vltotal,
  t.date AS dtpagamento,
  t.type::VARCHAR AS situacao,
  t.description AS deobservacao,
  t.document_number AS nudocumento,
  c.contrato,
  t.contract_id
FROM transacoes t
LEFT JOIN contratos c ON t.contract_id = c.id
WHERE t.type = 'LIQUIDATION';

-- ============================================
-- VIEW 3: OBs NÃO sincronizadas
-- ============================================
CREATE OR REPLACE VIEW public.vw_obs_nao_sincronizadas AS
SELECT 
  ob.*,
  d.contract_id,
  d.dotacao,
  c.contrato,
  c.contratada
FROM sigef_ordens_bancarias ob
JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
JOIN contratos c ON d.contract_id = c.id
WHERE NOT EXISTS (
  SELECT 1 FROM transacoes t
  WHERE 
    (t.sigef_id LIKE '%' || ob.nuordembancaria || '%' 
     OR t.ob_number = ob.nuordembancaria
     OR (t.commitment_id = ob.nunotaempenho AND t.amount = ob.vltotal AND t.type = 'LIQUIDATION'))
    AND t.contract_id = d.contract_id
)
AND ob.vltotal > 0
ORDER BY ob.dtpagamento DESC NULLS LAST;
