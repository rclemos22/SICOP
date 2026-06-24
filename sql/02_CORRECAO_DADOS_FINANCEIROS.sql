-- =============================================================
-- 02_CORRECAO_DADOS_FINANCEIROS.sql
--
-- Corrige dados existentes para refletir a nova fórmula unificada:
--   total_empenhado = COMMITMENT + REINFORCEMENT - CANCELLATION
--   total_pago      = LIQUIDATION
--   saldo_a_pagar   = total_empenhado - total_pago
--
-- ANTES de executar, rode 00_BACKUP_ANTES_ALTERACOES.sql
-- =============================================================

BEGIN;

-- =============================================================
-- 1. CORRIGIR dotacoes.total_empenhado
--
-- A fórmula anterior era: total_empenhado = COMMITMENT + REINFORCEMENT
-- (sem subtrair cancelamentos). Agora deve ser:
-- total_empenhado = max(0, COMMITMENT + REINFORCEMENT - CANCELLATION)
-- =============================================================

UPDATE public.dotacoes d
SET 
  total_empenhado = GREATEST(0, 
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.commitment_id = d.nunotaempenho
        AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
    ), 0)
    -
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.commitment_id = d.nunotaempenho
        AND t.type = 'CANCELLATION'
    ), 0)
  ),
  saldo_disponivel = GREATEST(0, 
    d.valor_dotacao 
    - GREATEST(0, 
        COALESCE((
          SELECT SUM(ABS(amount))
          FROM public.transacoes t
          WHERE t.commitment_id = d.nunotaempenho
            AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
        ), 0)
        -
        COALESCE((
          SELECT SUM(ABS(amount))
          FROM public.transacoes t
          WHERE t.commitment_id = d.nunotaempenho
            AND t.type = 'CANCELLATION'
        ), 0)
      )
  ),
  updated_at = NOW()
WHERE d.nunotaempenho IS NOT NULL;

-- =============================================================
-- 2. CORRIGIR contratos.total_empenhado, total_pago, saldo_a_pagar
--
-- Recalcula os totais dos contratos agregando as dotações corrigidas.
-- =============================================================

UPDATE public.contratos c
SET
  total_empenhado = (
    SELECT COALESCE(SUM(d.total_empenhado), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  ),
  total_pago = (
    SELECT COALESCE(SUM(d.total_pago), 0)
    FROM public.dotacoes d
    WHERE d.contract_id = c.id
  ),
  saldo_a_pagar = GREATEST(0,
    (
      SELECT COALESCE(SUM(d.total_empenhado), 0)
      FROM public.dotacoes d
      WHERE d.contract_id = c.id
    )
    -
    (
      SELECT COALESCE(SUM(d.total_pago), 0)
      FROM public.dotacoes d
      WHERE d.contract_id = c.id
    )
  ),
  data_ultimo_pagamento = (
    SELECT MAX(t.date)
    FROM public.transacoes t
    WHERE t.contract_id = c.id
      AND t.type = 'LIQUIDATION'
  )
WHERE EXISTS (
  SELECT 1 FROM public.dotacoes d WHERE d.contract_id = c.id
);

-- =============================================================
-- 3. VERIFICAR CONSISTÊNCIA
-- =============================================================

-- 3a. Dotações com total_empenhado negativo (não deveria existir após correção)
SELECT 'dotacoes com total_empenhado negativo' AS verificacao,
       COUNT(*) AS total
FROM public.dotacoes
WHERE total_empenhado < 0;

-- 3b. Dotações onde total_empenhado != transacoes calculado
SELECT 'dotacoes com divergencia em total_empenhado' AS verificacao,
       d.id, d.nunotaempenho,
       d.total_empenhado AS atual,
       (
         COALESCE((
           SELECT SUM(ABS(amount))
           FROM public.transacoes t
           WHERE t.commitment_id = d.nunotaempenho
             AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
         ), 0)
         -
         COALESCE((
           SELECT SUM(ABS(amount))
           FROM public.transacoes t
           WHERE t.commitment_id = d.nunotaempenho
             AND t.type = 'CANCELLATION'
         ), 0)
       ) AS esperado
FROM public.dotacoes d
WHERE d.nunotaempenho IS NOT NULL
  AND d.total_empenhado != (
    GREATEST(0,
      COALESCE((
        SELECT SUM(ABS(amount))
        FROM public.transacoes t
        WHERE t.commitment_id = d.nunotaempenho
          AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
      ), 0)
      -
      COALESCE((
        SELECT SUM(ABS(amount))
        FROM public.transacoes t
        WHERE t.commitment_id = d.nunotaempenho
          AND t.type = 'CANCELLATION'
      ), 0)
    )
  );

-- 3c. Contratos com saldo_a_pagar != total_empenhado - total_pago
SELECT 'contratos com saldo_a_pagar divergente' AS verificacao,
       c.id, c.contrato,
       c.total_empenhado, c.total_pago, c.saldo_a_pagar,
       GREATEST(0, c.total_empenhado - c.total_pago) AS saldo_esperado
FROM public.contratos c
WHERE c.total_empenhado > 0
  AND c.saldo_a_pagar != GREATEST(0, c.total_empenhado - c.total_pago);

COMMIT;

SELECT 'Correcao concluida. Verifique os resultados das consultas de verificacao acima.' AS mensagem;
