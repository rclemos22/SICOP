-- 025_part3_initial_update.sql
-- PARTE 3: Atualização inicial dos totais
-- Execute isto SOMENTE DEPOIS das migrations 022, 023, 024

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Atualizar todos os contratos que têm dotações
  FOR r IN SELECT DISTINCT contract_id FROM dotacoes WHERE contract_id IS NOT NULL LOOP
    PERFORM public.fn_atualizar_contrato_por_id(r.contract_id);
  END LOOP;
END $$;
