-- ============================================================
-- DIAGNÓSTICO DE DIVERGÊNCIAS DE PAGAMENTO (Fase 1)
-- ============================================================
-- Identifica contratos onde total_pago difere da soma real
-- das transações LIQUIDATION na tabela transacoes.
-- ============================================================

-- 1. Contratos com divergência total_pago vs soma LIQUIDATIONs
WITH liquidations AS (
  SELECT contract_id, COALESCE(SUM(amount), 0) AS sum_liq
  FROM transacoes
  WHERE type = 'LIQUIDATION'
  GROUP BY contract_id
)
SELECT c.id, c.numero, c.contratante_nome,
       c.total_empenhado, c.total_pago, c.saldo_a_pagar,
       COALESCE(l.sum_liq, 0) AS sum_liquidations,
       (c.total_pago - COALESCE(l.sum_liq, 0)) AS diff_pago,
       (c.total_empenhado - c.total_pago) AS saldo_calculado,
       c.saldo_a_pagar
FROM contratos c
LEFT JOIN liquidations l ON l.contract_id = c.id
WHERE c.total_pago != COALESCE(l.sum_liq, 0)
ORDER BY ABS(c.total_pago - COALESCE(l.sum_liq, 0)) DESC;

-- 2. OBs pagas no cache SEM LIQUIDATION correspondente
SELECT ob.nuordembancaria, ob.nunotaempenho,
       ob.vltotal, ob.cdsituacaoordembancaria,
       ob.cdunidadegestora, ob.dtpagamento
FROM sigef_ordens_bancarias ob
WHERE ob.nunotaempenho IS NOT NULL
  AND ob.cdsituacaoordembancaria ILIKE ANY(ARRAY[
    '%paga%','%pago%','%emitida%','%creditado%',
    '%efetivada%','%liquidada%','%concluída%',
    '%concluida%','%cb%','%processada%','%registrada%',
    '%ordem bancaria emitida%','%pagamento efetuado%'
  ])
  AND NOT EXISTS (
    SELECT 1 FROM transacoes t
    WHERE t.ob_number = ob.nuordembancaria
      AND t.type = 'LIQUIDATION'
  )
ORDER BY ob.dtpagamento DESC;

-- 3. Contratos sem nenhuma transação LIQUIDATION mas com total_pago > 0
SELECT c.id, c.numero, c.contratante_nome, c.total_pago
FROM contratos c
WHERE c.total_pago > 0
  AND NOT EXISTS (
    SELECT 1 FROM transacoes t
    WHERE t.contract_id = c.id AND t.type = 'LIQUIDATION'
  );

-- 4. OBs no cache agrupadas por nunotaempenho com total por NE
SELECT nunotaempenho, cdunidadegestora,
       COUNT(*) AS qtd_obs,
       SUM(vltotal) AS total_obs,
       STRING_AGG(nuordembancaria, ', ') AS obs_numeros
FROM sigef_ordens_bancarias
WHERE cdsituacaoordembancaria ILIKE ANY(ARRAY[
    '%paga%','%pago%','%emitida%','%creditado%',
    '%efetivada%','%liquidada%','%concluída%',
    '%concluida%','%cb%','%processada%','%registrada%'
  ])
GROUP BY nunotaempenho, cdunidadegestora
ORDER BY total_obs DESC;

-- 5. NEs do cache sem dotação correspondente (órfãos)
SELECT DISTINCT mov.nunotaempenho, mov.cdunidadegestora
FROM sigef_ne_movimentos mov
WHERE NOT EXISTS (
  SELECT 1 FROM dotacoes d
  WHERE d.nunotaempenho = mov.nunotaempenho
)
ORDER BY mov.nunotaempenho;
