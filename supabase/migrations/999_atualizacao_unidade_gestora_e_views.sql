-- ============================================
-- SCRIPT DE ATUALIZACAO: Unidade Gestora e Views
-- ============================================

-- ============================================
-- 1. BACKFILL: Atualizar unidade_gestora_label nos registros existentes
-- ============================================

-- Primeiro, verificar se a coluna existe
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transacoes' AND column_name='unidade_gestora_label') THEN
        ALTER TABLE transacoes ADD COLUMN unidade_gestora_label VARCHAR(50);
    END IF;
END $$;

-- Atualizar registros existentes fazendo join com dotacoes
UPDATE transacoes t
SET unidade_gestora_label = CASE 
    WHEN d.unid_gestora = '080101' THEN 'DPEMA'
    WHEN d.unid_gestora = '080901' THEN 'FADEP'
    ELSE d.unid_gestora
  END
FROM dotacoes d
WHERE t.commitment_id = d.nunotaempenho
  AND t.unidade_gestora_label IS NULL;

-- ============================================
-- 2. ATUALIZAR VIEW vw_recent_payments com unidade_gestora_label
-- ============================================

DROP VIEW IF EXISTS public.vw_recent_payments CASCADE;

CREATE OR REPLACE VIEW public.vw_recent_payments AS
SELECT 
  ob.id,
  ob.nuordembancaria,
  ob.nunotaempenho,
  ob.vltotal,
  ob.dtpagamento AS data_pagamento,
  ob.dtlancamento,
  ob.cdsituacaoordembancaria AS situacao,
  ob.deobservacao,
  d.contract_id,
  c.contrato,
  c.contratada,
  d.dotacao,
  d.unid_gestora AS cdunidadegestora,
  CASE d.unid_gestora
    WHEN '080101' THEN 'DPEMA'
    WHEN '080901' THEN 'FADEP'
    ELSE d.unid_gestora
  END AS unidade_gestora_label,
  ob.nudocumento
FROM sigef_ordens_bancarias ob
INNER JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
LEFT JOIN contratos c ON d.contract_id = c.id
WHERE ob.dtpagamento IS NOT NULL
  AND ob.vltotal > 0;

-- ============================================
-- 3. Verificar/Adicionar colunas financeiras na tabela contratos
-- ============================================

DO $$
BEGIN
    -- total_empenhado
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='total_empenhado') THEN
        ALTER TABLE contratos ADD COLUMN total_empenhado NUMERIC(15,2) DEFAULT 0;
    END IF;

    -- total_pago
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='total_pago') THEN
        ALTER TABLE contratos ADD COLUMN total_pago NUMERIC(15,2) DEFAULT 0;
    END IF;

    -- saldo_a_pagar
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='saldo_a_pagar') THEN
        ALTER TABLE contratos ADD COLUMN saldo_a_pagar NUMERIC(15,2) DEFAULT 0;
    END IF;

    -- data_ultimo_pagamento
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='data_ultimo_pagamento') THEN
        ALTER TABLE contratos ADD COLUMN data_ultimo_pagamento DATE;
    END IF;

    -- updated_at (contratos)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='updated_at') THEN
        ALTER TABLE contratos ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;

    -- updated_at (transacoes)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transacoes' AND column_name='updated_at') THEN
        ALTER TABLE transacoes ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;

    -- sigef_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transacoes' AND column_name='sigef_id') THEN
        ALTER TABLE transacoes ADD COLUMN sigef_id VARCHAR(100);
    END IF;
END $$;

-- ============================================
-- 4. Views de diagnostico
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
