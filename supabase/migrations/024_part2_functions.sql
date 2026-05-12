-- 024_part2_functions.sql
-- PARTE 2: Funções e Triggers com SQL dinâmico

-- Função para atualizar contrato por ID (usa EXECUTE para verificação em tempo de execução)
CREATE OR REPLACE FUNCTION public.fn_atualizar_contrato_por_id(
  p_contract_id UUID
) RETURNS VOID AS $$
BEGIN
  EXECUTE format('
    UPDATE contratos c SET
      total_empenhado = (
        SELECT COALESCE(SUM(d.total_empenhado), 0)
        FROM dotacoes d
        WHERE d.contract_id = %L
      ),
      total_pago = (
        SELECT COALESCE(SUM(d.total_pago), 0)
        FROM dotacoes d
        WHERE d.contract_id = %L
      ),
      updated_at = NOW()
    WHERE c.id = %L
  ', p_contract_id, p_contract_id, p_contract_id);
END;
$$ LANGUAGE plpgsql;

-- Função trigger: atualizar quando OB/movimento muda
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

-- Função trigger: atualizar quando dotação muda
CREATE OR REPLACE FUNCTION public.fn_atualizar_contrato_por_dotacao()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.fn_atualizar_contrato_por_id(COALESCE(NEW.contract_id, OLD.contract_id));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Criar TRIGGERS
-- ============================================

-- Trigger para sigef_ne_movimentos
DROP TRIGGER IF EXISTS trg_atualizar_por_movimento ON public.sigef_ne_movimentos;
CREATE TRIGGER trg_atualizar_por_movimento
AFTER INSERT OR UPDATE OR DELETE ON public.sigef_ne_movimentos
FOR EACH ROW EXECUTE FUNCTION public.fn_atualizar_dotacoes_e_contratos();

-- Trigger para sigef_ordens_bancarias
DROP TRIGGER IF EXISTS trg_atualizar_por_ob ON public.sigef_ordens_bancarias;
CREATE TRIGGER trg_atualizar_por_ob
AFTER INSERT OR UPDATE OR DELETE ON public.sigef_ordens_bancarias
FOR EACH ROW EXECUTE FUNCTION public.fn_atualizar_dotacoes_e_contratos();

-- Trigger para dotacoes
DROP TRIGGER IF EXISTS trg_atualizar_contrato_dotacao ON public.dotacoes;
CREATE TRIGGER trg_atualizar_contrato_dotacao
AFTER INSERT OR UPDATE OR DELETE ON public.dotacoes
FOR EACH ROW EXECUTE FUNCTION public.fn_atualizar_contrato_por_dotacao();
