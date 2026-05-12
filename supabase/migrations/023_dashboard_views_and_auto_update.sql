-- 023_dashboard_views_and_auto_update.sql
-- Cria views essenciais para o dashboard e triggers de atualização automática

-- ============================================
-- 0. Dropar views existentes primeiro
-- ============================================
DROP VIEW IF EXISTS public.vw_saldo_dotacoes CASCADE;
DROP VIEW IF EXISTS public.vw_recent_payments CASCADE;

-- ============================================
-- 1. View vw_saldo_dotacoes (utilizada pelo BudgetService)
-- ============================================
CREATE OR REPLACE VIEW public.vw_saldo_dotacoes AS
SELECT 
  d.id,
  d.contract_id,
  c.contrato AS numero_contrato,
  c.contratada,
  d.dotacao,
  d.credito,
  d.data_disponibilidade,
  d.unid_gestora,
  d.valor_dotacao,
  d.nunotaempenho,
  d.contract_type,
  COALESCE(d.total_empenhado, 0) AS total_empenhado,
  COALESCE(d.total_cancelado, 0) AS total_cancelado,
  COALESCE(d.total_pago, 0) AS total_pago,
  COALESCE(d.saldo_disponivel, 0) AS saldo_disponivel,
  d.updated_at,
  d.created_at
FROM dotacoes d
LEFT JOIN contratos c ON d.contract_id = c.id;

-- ============================================
-- 2. View vw_recent_payments para o dashboard
-- Relaciona OBs -> Dotações -> Contratos
-- ============================================
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
  ob.cdunidadegestora,
  ob.nudocumento
FROM sigef_ordens_bancarias ob
INNER JOIN dotacoes d ON ob.nunotaempenho = d.nunotaempenho
LEFT JOIN contratos c ON d.contract_id = c.id
WHERE ob.dtpagamento IS NOT NULL
  AND ob.vltotal > 0;

-- ============================================
-- 3. Função para atualizar contrato (simples)
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_atualizar_contrato_por_id(
  p_contract_id VARCHAR
) RETURNS VOID AS $$
BEGIN
  UPDATE contratos c SET
    total_empenhado = (
      SELECT COALESCE(SUM(d.total_empenhado), 0)
      FROM dotacoes d
      WHERE d.contract_id = p_contract_id
    ),
    total_pago = (
      SELECT COALESCE(SUM(d.total_pago), 0)
      FROM dotacoes d
      WHERE d.contract_id = p_contract_id
    ),
    updated_at = NOW()
  WHERE c.id = p_contract_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. Função trigger: atualizar quando OB/movimento muda
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_atualizar_dotacoes_e_contratos()
RETURNS TRIGGER AS $$
DECLARE
  v_ne VARCHAR;
  r RECORD;
BEGIN
  -- Determinar qual NE foi afetada
  IF TG_TABLE_NAME = 'sigef_ne_movimentos' THEN
    v_ne := COALESCE(NEW.nunotaempenho, OLD.nunotaempenho, NEW.nuneoriginal, OLD.nuneoriginal);
  ELSIF TG_TABLE_NAME = 'sigef_ordens_bancarias' THEN
    v_ne := COALESCE(NEW.nunotaempenho, OLD.nunotaempenho);
  END IF;

  IF v_ne IS NOT NULL THEN
    -- Para cada contrato vinculado a esta NE
    FOR r IN 
      SELECT DISTINCT d.contract_id 
      FROM dotacoes d 
      WHERE d.nunotaempenho = v_ne AND d.contract_id IS NOT NULL
    LOOP
      PERFORM public.fn_atualizar_contrato_por_id(r.contract_id);
    END LOOP;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. Função trigger: atualizar quando dotação muda
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_atualizar_contrato_por_dotacao()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.fn_atualizar_contrato_por_id(COALESCE(NEW.contract_id, OLD.contract_id));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. Criar TRIGGERS
-- ============================================

-- Trigger para sigef_ne_movimentos (empenhos, reforços, anulações)
DROP TRIGGER IF EXISTS trg_atualizar_por_movimento ON public.sigef_ne_movimentos;
CREATE TRIGGER trg_atualizar_por_movimento
AFTER INSERT OR UPDATE OR DELETE ON public.sigef_ne_movimentos
FOR EACH ROW EXECUTE FUNCTION public.fn_atualizar_dotacoes_e_contratos();

-- Trigger para sigef_ordens_bancarias (pagamentos/OBs)
DROP TRIGGER IF EXISTS trg_atualizar_por_ob ON public.sigef_ordens_bancarias;
CREATE TRIGGER trg_atualizar_por_ob
AFTER INSERT OR UPDATE OR DELETE ON public.sigef_ordens_bancarias
FOR EACH ROW EXECUTE FUNCTION public.fn_atualizar_dotacoes_e_contratos();

-- Trigger para dotacoes
DROP TRIGGER IF EXISTS trg_atualizar_contrato_dotacao ON public.dotacoes;
CREATE TRIGGER trg_atualizar_contrato_dotacao
AFTER INSERT OR UPDATE OR DELETE ON public.dotacoes
FOR EACH ROW EXECUTE FUNCTION public.fn_atualizar_contrato_por_dotacao();

-- ============================================
-- 7. Atualização inicial
-- ============================================
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Atualizar todos os contratos que têm dotações
  FOR r IN SELECT DISTINCT contract_id FROM dotacoes WHERE contract_id IS NOT NULL LOOP
    PERFORM public.fn_atualizar_contrato_por_id(r.contract_id);
  END LOOP;
END $$;
