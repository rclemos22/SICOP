-- Migration: 25_CLEANUP_MANUAL_PAY_TRANSACTIONS.sql
-- Descrição: Remove transações manuais fictícias (sigef_id 'manual-pay-%') da tabela transacoes,
--            garantindo que o histórico financeiro seja composto puramente por transações reais do SIGEF,
--            e recalcula os totais de total_empenhado, total_pago e saldo_a_pagar de todos os contratos.

BEGIN;

SELECT '--- Removing manual-pay fake transactions ---' AS etapa;

DELETE FROM public.transacoes
WHERE sigef_id LIKE 'manual-pay-%'
   OR manual_payment = true;

SELECT '--- Recalculando totais financeiros dos contratos ---' AS etapa;

WITH totais AS (
  SELECT
    contract_id,
    COALESCE(SUM(CASE WHEN type IN ('COMMITMENT', 'REINFORCEMENT') THEN ABS(amount) ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN type = 'CANCELLATION' THEN ABS(amount) ELSE 0 END), 0) AS calc_empenhado,
    COALESCE(SUM(CASE WHEN type = 'LIQUIDATION' THEN ABS(amount) ELSE 0 END), 0) AS calc_pago
  FROM public.transacoes
  WHERE contract_id IS NOT NULL
  GROUP BY contract_id
)
UPDATE public.contratos c
SET
  total_empenhado = GREATEST(0, COALESCE(t.calc_empenhado, 0)),
  total_pago = COALESCE(t.calc_pago, 0),
  updated_at = NOW()
FROM totais t
WHERE c.id = t.contract_id;

-- Para contratos sem transações no banco, zera os totais
UPDATE public.contratos
SET
  total_empenhado = 0,
  total_pago = 0,
  updated_at = NOW()
WHERE id NOT IN (SELECT DISTINCT contract_id FROM public.transacoes WHERE contract_id IS NOT NULL)
  AND status != 'EXCLUIDO';

NOTIFY pgrst, 'reload schema';

COMMIT;
