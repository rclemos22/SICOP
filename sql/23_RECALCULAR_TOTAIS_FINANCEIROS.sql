-- =============================================================
-- 23_RECALCULAR_TOTAIS_FINANCEIROS.sql
--
-- Recalcula os totais persistidos de `contratos` e `dotacoes` a partir
-- da tabela `transacoes` (fonte canônica), corrigindo valores
-- desatualizados que distorciam os cards do dashboard
-- (Saldo a Pagar, Previsto vs Pago, Comparativo por Contrato).
--
-- Ex.: contrato 087/2025 tinha total_empenhado = -522.820,08 (negativo!)
--      contrato 80/2025 tinha 6.054,76 (o correto é 115.277,77)
--      contrato 016/2021 tinha total_pago desatualizado em ~R$ 139k
--
-- Executar no SQL Editor do Supabase.
-- =============================================================

BEGIN;

-- ── 1. Diagnóstico: contratos divergentes antes da correção ──────────────
SELECT '--- DIAGNÓSTICO (antes da correção) ---' AS etapa;
WITH agg AS (
  SELECT
    contract_id,
    COALESCE(SUM(CASE WHEN type IN ('COMMITMENT','REINFORCEMENT') THEN amount ELSE 0 END), 0) AS empenho,
    COALESCE(SUM(CASE WHEN type = 'CANCELLATION' THEN amount ELSE 0 END), 0) AS cancelado,
    COALESCE(SUM(CASE WHEN type = 'LIQUIDATION' THEN amount ELSE 0 END), 0) AS pago
  FROM transacoes
  GROUP BY contract_id
)
SELECT c.contrato,
       c.total_empenhado AS stored_empenhado,
       GREATEST(0, a.empenho - a.cancelado) AS calc_empenhado,
       c.total_pago       AS stored_pago,
       a.pago             AS calc_pago,
       c.saldo_a_pagar    AS stored_saldo,
       GREATEST(0, GREATEST(0, a.empenho - a.cancelado) - a.pago) AS calc_saldo
FROM contratos c
JOIN agg a ON a.contract_id = c.id
WHERE ABS(c.total_empenhado - GREATEST(0, a.empenho - a.cancelado)) > 0.01
   OR ABS(c.total_pago - a.pago) > 0.01
ORDER BY c.contrato;

-- ── 2. Corrigir contratos ────────────────────────────────────────────────
WITH agg AS (
  SELECT
    contract_id,
    COALESCE(SUM(CASE WHEN type IN ('COMMITMENT','REINFORCEMENT') THEN amount ELSE 0 END), 0) AS empenho,
    COALESCE(SUM(CASE WHEN type = 'CANCELLATION' THEN amount ELSE 0 END), 0) AS cancelado,
    COALESCE(SUM(CASE WHEN type = 'LIQUIDATION' THEN amount ELSE 0 END), 0) AS pago,
    MAX(CASE WHEN type = 'LIQUIDATION' THEN date ELSE NULL END) AS ultimo_pagamento
  FROM transacoes
  GROUP BY contract_id
)
UPDATE contratos c
SET
  total_empenhado        = GREATEST(0, a.empenho - a.cancelado),
  total_pago             = a.pago,
  saldo_a_pagar          = GREATEST(0, GREATEST(0, a.empenho - a.cancelado) - a.pago),
  data_ultimo_pagamento  = a.ultimo_pagamento,
  updated_at             = NOW()
FROM agg a
WHERE c.id = a.contract_id;

-- ── 3. Corrigir dotações (empenhado líquido por NE + contrato) ───────────
WITH agg AS (
  SELECT
    d.id AS dotacao_id,
    COALESCE(SUM(CASE WHEN t.type IN ('COMMITMENT','REINFORCEMENT') THEN t.amount ELSE 0 END), 0) AS empenho,
    COALESCE(SUM(CASE WHEN t.type = 'CANCELLATION' THEN t.amount ELSE 0 END), 0) AS cancelado,
    COALESCE(SUM(CASE WHEN t.type = 'LIQUIDATION' THEN t.amount ELSE 0 END), 0) AS pago
  FROM dotacoes d
  JOIN transacoes t
    ON t.contract_id = d.contract_id
   AND t.commitment_id = d.nunotaempenho
  GROUP BY d.id
)
UPDATE dotacoes d
SET
  total_empenhado  = GREATEST(0, a.empenho - a.cancelado),
  total_cancelado  = a.cancelado,
  total_pago       = a.pago,
  saldo_disponivel = GREATEST(0, d.valor_dotacao - GREATEST(0, a.empenho - a.cancelado)),
  updated_at       = NOW()
FROM agg a
WHERE d.id = a.dotacao_id;

-- ── 4. Resumo pós-correção ───────────────────────────────────────────────
SELECT '--- RESULTADO (após correção) ---' AS etapa;
SELECT c.contrato, c.total_empenhado, c.total_pago, c.saldo_a_pagar
FROM contratos c
ORDER BY c.contrato;

SELECT '--- TOTAIS GLOBAIS ---' AS etapa;
SELECT
  SUM(total_empenhado) AS total_empenhado,
  SUM(total_pago)      AS total_pago,
  SUM(saldo_a_pagar)   AS saldo_a_pagar
FROM contratos
WHERE status IN ('VIGENTE','FINALIZANDO');

NOTIFY pgrst, 'reload schema';

COMMIT;
