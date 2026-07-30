-- ============================================
-- DIAGNÓSTICO COMPLETO — Contrato 087/2025
-- ============================================
-- Executar no SQL Editor do Supabase
-- ============================================

-- 1. DADOS DO CONTRATO
SELECT '--- 1. DADOS DO CONTRATO ---' AS etapa;

SELECT id, contrato, status, total_empenhado, total_pago, saldo_a_pagar,
       parcelas_pagas_manual, valor_anual, valor_mensal, data_inicio, data_fim,
       unid_gestora, tipo
FROM contratos WHERE contrato = '087/2025';

-- 2. ADITIVOS
SELECT '--- 2. ADITIVOS ---' AS etapa;

SELECT a.id, a.numero_aditivo, ta.nome AS tipo, a.nova_vigencia, a.valor_aditivo,
       a.novo_valor_mensal, a.data_inicio_novo, a.data_assinatura
FROM aditivos a
LEFT JOIN tipo_aditivo ta ON a.tipo_id = ta.id
WHERE a.contract_id = (SELECT id FROM contratos WHERE contrato = '087/2025')
ORDER BY a.data_assinatura;

-- 3. DOTAÇÕES VINCULADAS
SELECT '--- 3. DOTAÇÕES ---' AS etapa;

SELECT id, dotacao, nunotaempenho, unid_gestora, valor_dotacao,
       total_empenhado, total_cancelado, total_pago, saldo_disponivel
FROM vw_saldo_dotacoes
WHERE contract_id = (SELECT id FROM contratos WHERE contrato = '087/2025');

-- 4. TRANSAÇÕES NO BANCO (transacoes)
SELECT '--- 4. TRANSAÇÕES (transacoes) ---' AS etapa;

SELECT id, type, amount, date, sigef_id, commitment_id,
       document_number, ob_number, parcela_referencia,
       manual_payment, parcela_valor, parcela_pago_em
FROM transacoes
WHERE contract_id = (SELECT id FROM contratos WHERE contrato = '087/2025')
ORDER BY date DESC;

-- 5. TOTAIS CALCULADOS PELAS TRANSAÇÕES
SELECT '--- 5. TOTAIS CALCULADOS ---' AS etapa;

SELECT
  COALESCE(SUM(CASE WHEN type IN ('COMMITMENT', 'REINFORCEMENT') THEN amount ELSE 0 END), 0) AS total_empenhado_bruto,
  COALESCE(SUM(CASE WHEN type = 'CANCELLATION' THEN amount ELSE 0 END), 0) AS total_anulado,
  COALESCE(SUM(CASE WHEN type IN ('COMMITMENT', 'REINFORCEMENT') THEN amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN type = 'CANCELLATION' THEN amount ELSE 0 END), 0) AS total_empenhado_liquido,
  COALESCE(SUM(CASE WHEN type = 'LIQUIDATION' THEN amount ELSE 0 END), 0) AS total_pago,
  GREATEST(0,
    COALESCE(SUM(CASE WHEN type IN ('COMMITMENT', 'REINFORCEMENT') THEN amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN type = 'CANCELLATION' THEN amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN type = 'LIQUIDATION' THEN amount ELSE 0 END), 0)
  ) AS saldo_a_pagar_calculado
FROM transacoes
WHERE contract_id = (SELECT id FROM contratos WHERE contrato = '087/2025');

-- 6. CACHE SIGEF — Movimentos de cada NE
SELECT '--- 6. CACHE: sigef_ne_movimentos ---' AS etapa;

SELECT m.cdunidadegestora, m.nunotaempenho, m.cdevento, m.vlnotaempenho,
       m.dtlancamento, m.nuneoriginal
FROM sigef_ne_movimentos m
WHERE m.nunotaempenho IN (
  SELECT d.nunotaempenho FROM dotacoes d
  JOIN contratos c ON d.contract_id = c.id
  WHERE c.contrato = '087/2025' AND d.nunotaempenho IS NOT NULL
)
ORDER BY m.nunotaempenho, m.dtlancamento;

-- 7. CACHE SIGEF — Ordens Bancárias de cada NE
SELECT '--- 7. CACHE: sigef_ordens_bancarias ---' AS etapa;

SELECT ob.cdunidadegestora, ob.nuordembancaria, ob.nunotaempenho,
       ob.vltotal, ob.dtpagamento, ob.cdsituacaoordembancaria,
       ob.nudocumento
FROM sigef_ordens_bancarias ob
WHERE ob.nunotaempenho IN (
  SELECT d.nunotaempenho FROM dotacoes d
  JOIN contratos c ON d.contract_id = c.id
  WHERE c.contrato = '087/2025' AND d.nunotaempenho IS NOT NULL
)
ORDER BY ob.dtpagamento;

-- 8. MIRROR — import_sigef_ne (dados brutos)
SELECT '--- 8. MIRROR: import_sigef_ne ---' AS etapa;

SELECT i.nunotaempenho, i.cdunidadegestora, i.dtlancamento,
       i.raw_data->>'cdevento' AS cdevento,
       i.raw_data->>'vlnotaempenho' AS vlnotaempenho
FROM import_sigef_ne i
WHERE i.nunotaempenho IN (
  SELECT d.nunotaempenho FROM dotacoes d
  JOIN contratos c ON d.contract_id = c.id
  WHERE c.contrato = '087/2025' AND d.nunotaempenho IS NOT NULL
)
ORDER BY i.nunotaempenho, i.dtlancamento;

-- 9. MIRROR — import_sigef_ob (dados brutos)
SELECT '--- 9. MIRROR: import_sigef_ob ---' AS etapa;

SELECT i.nuordembancaria, i.nunotaempenho, i.cdunidadegestora,
       i.vltotal, i.dtpagamento, i.cdsituacaoordembancaria,
       i.nudocumento
FROM import_sigef_ob i
WHERE i.nunotaempenho IN (
  SELECT d.nunotaempenho FROM dotacoes d
  JOIN contratos c ON d.contract_id = c.id
  WHERE c.contrato = '087/2025' AND d.nunotaempenho IS NOT NULL
)
ORDER BY i.dtpagamento;

-- 10. DISPARIDADE: transacoes vs cache (LIQUIDATION)
SELECT '--- 10. DISPARIDADE: transacoes vs cache ---' AS etapa;

SELECT
  COALESCE(t.total_pago_transacoes, 0) AS total_pago_transacoes,
  COALESCE(c.total_pago_cache, 0) AS total_pago_cache,
  COALESCE(t.total_pago_transacoes, 0) - COALESCE(c.total_pago_cache, 0) AS diferenca
FROM (
  SELECT COALESCE(SUM(amount), 0) AS total_pago_transacoes
  FROM transacoes
  WHERE contract_id = (SELECT id FROM contratos WHERE contrato = '087/2025')
    AND type = 'LIQUIDATION'
) t
CROSS JOIN (
  SELECT COALESCE(SUM(ob.vltotal), 0) AS total_pago_cache
  FROM sigef_ordens_bancarias ob
  WHERE ob.cdsituacaoordembancaria ILIKE '%paga%'
    AND ob.nunotaempenho IN (
      SELECT d.nunotaempenho FROM dotacoes d
      JOIN contratos c ON d.contract_id = c.id
      WHERE c.contrato = '087/2025' AND d.nunotaempenho IS NOT NULL
    )
) c;
