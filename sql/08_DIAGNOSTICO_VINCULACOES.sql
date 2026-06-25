-- =============================================================
-- 08_DIAGNOSTICO_VINCULACOES.sql
--
-- Diagnóstico e correção das vinculações entre:
--   contratos <-> dotacoes <-> transacoes
--
-- USO:
--   1. Execute o bloco de DIAGNÓSTICO primeiro
--   2. Revise os resultados
--   3. Execute o bloco de CORREÇÃO se aplicável
-- =============================================================

BEGIN;

-- =============================================================
-- PARTE 1: DIAGNÓSTICO
-- =============================================================

SELECT '=== 1. CONTRATOS CADASTRADOS ===' AS secao;
SELECT 
  c.id,
  c.contrato,
  c.contratada,
  c.status,
  c.unid_gestora,
  c.total_empenhado,
  c.total_pago,
  c.saldo_a_pagar,
  c.valor_anual,
  (SELECT COUNT(*) FROM public.dotacoes d WHERE d.contract_id = c.id) AS qtd_dotacoes,
  (SELECT COUNT(*) FROM public.transacoes t WHERE t.contract_id = c.id) AS qtd_transacoes
FROM public.contratos c
ORDER BY c.contrato;

SELECT '=== 2. DOTAÇÕES SEM CONTRATO VÁLIDO ===' AS secao;
SELECT 
  d.id AS dotacao_id,
  d.dotacao,
  d.numero_contrato,
  d.contract_id,
  d.nunotaempenho,
  d.valor_dotacao,
  d.total_empenhado,
  d.total_pago
FROM public.dotacoes d
LEFT JOIN public.contratos c ON c.id = d.contract_id
WHERE c.id IS NULL
ORDER BY d.dotacao;

SELECT '=== 3. TRANSAÇÕES SEM CONTRATO VÁLIDO ===' AS secao;
SELECT 
  t.id AS transacao_id,
  t.contract_id,
  t.commitment_id,
  t.type,
  t.amount,
  t.date,
  t.description
FROM public.transacoes t
LEFT JOIN public.contratos c ON c.id = t.contract_id
WHERE c.id IS NULL
ORDER BY t.date DESC;

SELECT '=== 4. DOTAÇÕES COM NE MAS SEM CONTRACT_ID ===' AS secao;
SELECT 
  id AS dotacao_id,
  dotacao,
  numero_contrato,
  contract_id,
  nunotaempenho,
  valor_dotacao
FROM public.dotacoes
WHERE contract_id IS NULL
  AND nunotaempenho IS NOT NULL
  AND nunotaempenho != '';

SELECT '=== 5. TRANSAÇÕES COM NE MAS SEM CONTRACT_ID ===' AS secao;
SELECT 
  id AS transacao_id,
  contract_id,
  commitment_id,
  type,
  amount,
  date
FROM public.transacoes
WHERE contract_id IS NULL
  AND commitment_id IS NOT NULL
  AND commitment_id != ''
ORDER BY date DESC;

SELECT '=== 6. DOTAÇÕES COM NE DUPLICADA EM MÚLTIPLOS CONTRATOS ===' AS secao;
SELECT 
  d1.nunotaempenho,
  d1.id AS dotacao1_id,
  d1.contract_id AS contrato1_id,
  c1.contrato AS contrato1_numero,
  d2.id AS dotacao2_id,
  d2.contract_id AS contrato2_id,
  c2.contrato AS contrato2_numero
FROM public.dotacoes d1
JOIN public.dotacoes d2 ON d2.nunotaempenho = d1.nunotaempenho AND d2.id != d1.id
LEFT JOIN public.contratos c1 ON c1.id = d1.contract_id
LEFT JOIN public.contratos c2 ON c2.id = d2.contract_id
WHERE d1.nunotaempenho IS NOT NULL AND d1.nunotaempenho != '';

SELECT '=== 7. CONTRATOS COM MÚLTIPLAS UGs DIFERENTES ===' AS secao;
SELECT 
  d.contract_id,
  c.contrato,
  COUNT(DISTINCT d.unid_gestora) AS qtd_ugs,
  STRING_AGG(DISTINCT d.unid_gestora, ', ') AS ugs
FROM public.dotacoes d
JOIN public.contratos c ON c.id = d.contract_id
GROUP BY d.contract_id, c.contrato
HAVING COUNT(DISTINCT d.unid_gestora) > 1;

SELECT '=== 8. CONTRATOS COM TOTAL_EMPENHADO DIVERGENTE (soma das dotações) ===' AS secao;
SELECT 
  c.id,
  c.contrato,
  c.total_empenhado AS total_empenhado_contrato,
  COALESCE((SELECT SUM(total_empenhado) FROM public.dotacoes d WHERE d.contract_id = c.id), 0) AS total_empenhado_dotacoes,
  c.total_pago AS total_pago_contrato,
  COALESCE((SELECT SUM(total_pago) FROM public.dotacoes d WHERE d.contract_id = c.id), 0) AS total_pago_dotacoes,
  ABS(c.total_empenhado - COALESCE((SELECT SUM(total_empenhado) FROM public.dotacoes d WHERE d.contract_id = c.id), 0)) AS diferenca_empenhado
FROM public.contratos c
WHERE c.total_empenhado != COALESCE((SELECT SUM(total_empenhado) FROM public.dotacoes d WHERE d.contract_id = c.id), 0)
   OR c.total_pago != COALESCE((SELECT SUM(total_pago) FROM public.dotacoes d WHERE d.contract_id = c.id), 0);

SELECT '=== 9. TRANSAÇÕES ÓRFÃS (sem NE e sem contrato) ===' AS secao;
SELECT 
  id,
  contract_id,
  commitment_id,
  type,
  amount,
  date,
  description
FROM public.transacoes
WHERE (commitment_id IS NULL OR commitment_id = '')
  AND contract_id IS NULL;

-- =============================================================
-- PARTE 2: CORREÇÃO (descomente para aplicar)
-- =============================================================

-- ATENÇÃO: Revise os resultados do diagnóstico ANTES de aplicar
-- qualquer correção. As consultas abaixo são sugestões que
-- dependem do contexto específico dos dados.

/*

-- 2a. Corrigir dotações sem contract_id: tenta vincular pelo número_contrato
UPDATE public.dotacoes d
SET contract_id = c.id,
    numero_contrato = c.contrato
FROM public.contratos c
WHERE d.contract_id IS NULL
  AND d.numero_contrato IS NOT NULL
  AND d.numero_contrato != ''
  AND (d.numero_contrato = c.contrato 
       OR c.contrato LIKE '%' || d.numero_contrato || '%'
       OR d.numero_contrato LIKE '%' || c.contrato || '%')
  AND d.contract_id IS DISTINCT FROM c.id;

-- 2b. Corrigir transações sem contract_id: tenta vincular via NE (vw_saldo_dotacoes)
UPDATE public.transacoes t
SET contract_id = v.contract_id
FROM public.vw_saldo_dotacoes v
WHERE t.contract_id IS NULL
  AND t.commitment_id IS NOT NULL
  AND t.commitment_id != ''
  AND t.commitment_id = v.nunotaempenho
  AND v.contract_id IS NOT NULL
  AND t.contract_id IS DISTINCT FROM v.contract_id;

-- 2c. Recalcular totais dos contratos baseado nas transações
--     (usar com cautela - pode sobrescrever ajustes manuais)
UPDATE public.contratos c
SET
  total_empenhado = COALESCE((
    SELECT SUM(ABS(amount))
    FROM public.transacoes t
    WHERE t.contract_id = c.id
      AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
  ), 0) - COALESCE((
    SELECT SUM(ABS(amount))
    FROM public.transacoes t
    WHERE t.contract_id = c.id
      AND t.type = 'CANCELLATION'
  ), 0),
  total_pago = COALESCE((
    SELECT SUM(ABS(amount))
    FROM public.transacoes t
    WHERE t.contract_id = c.id
      AND t.type = 'LIQUIDATION'
  ), 0),
  saldo_a_pagar = GREATEST(0,
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.contract_id = c.id
        AND t.type IN ('COMMITMENT', 'REINFORCEMENT')
    ), 0) - COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.contract_id = c.id
        AND t.type = 'CANCELLATION'
    ), 0)
    -
    COALESCE((
      SELECT SUM(ABS(amount))
      FROM public.transacoes t
      WHERE t.contract_id = c.id
        AND t.type = 'LIQUIDATION'
    ), 0)
  ),
  data_ultimo_pagamento = (
    SELECT MAX(t.date)
    FROM public.transacoes t
    WHERE t.contract_id = c.id
      AND t.type = 'LIQUIDATION'
  )
WHERE EXISTS (
  SELECT 1 FROM public.transacoes t WHERE t.contract_id = c.id
);

*/

COMMIT;

SELECT '=== DIAGNÓSTICO CONCLUÍDO ===' AS mensagem;
