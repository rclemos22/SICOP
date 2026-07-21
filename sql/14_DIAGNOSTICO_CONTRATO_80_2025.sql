-- =============================================================
-- 14_DIAGNOSTICO_CONTRATO_80_2025.sql
--
-- Diagnóstico para contrato 80/2025:
-- 1. Verifica dados do contrato (totais armazenados)
-- 2. Verifica transações no banco (transacoes)
-- 3. Verifica dados no cache SIGEF (sigef_*)
-- 4. Verifica dados no espelho (import_sigef_*)
-- 5. Compara totais calculados vs armazenados
-- 6. Corrige disparidades (se houver)
--
-- ATENÇÃO: Execute com cuidado em produção.
-- A correção é segura (usando transação), mas revise os dados primeiro.
-- =============================================================

-- 1. IDENTIFICAR O CONTRATO
SELECT '--- 1. Dados do Contrato ---' AS etapa;

SELECT id, contrato, contratada, total_empenhado, total_pago, saldo_a_pagar,
       data_ultimo_pagamento, parcelas_pagas_manual
FROM contratos
WHERE contrato = '80/2025';

-- 2. DOTAÇÕES (BUDGETS) VINCULADAS
SELECT '--- 2. Dotações do Contrato ---' AS etapa;

SELECT d.id, d.dotacao, d.nunotaempenho, d.unid_gestora, d.valor_dotacao,
       d.total_empenhado, d.total_cancelado, d.total_pago, d.saldo_disponivel
FROM dotacoes d
JOIN contratos c ON d.contract_id = c.id
WHERE c.contrato = '80/2025';

-- 3. TRANSAÇÕES NO BANCO
SELECT '--- 3. Transacoes no Banco ---' AS etapa;

SELECT t.id, t.type, t.amount, t.date, t.commitment_id, t.sigef_id,
       t.document_number, t.ob_number, t.parcela_referencia,
       t.parcela_pago_em, t.manual_payment
FROM transacoes t
JOIN contratos c ON t.contract_id = c.id
WHERE c.contrato = '80/2025'
ORDER BY t.date;

-- 4. TOTAIS CALCULADOS DAS TRANSAÇÕES
SELECT '--- 4. Totais Calculados das Transacoes ---' AS etapa;

SELECT
  SUM(CASE WHEN t.type IN ('COMMITMENT', 'REINFORCEMENT') THEN t.amount ELSE 0 END) AS total_empenhado_calculado,
  SUM(CASE WHEN t.type = 'CANCELLATION' THEN t.amount ELSE 0 END) AS total_cancelado_calculado,
  SUM(CASE WHEN t.type = 'LIQUIDATION' THEN t.amount ELSE 0 END) AS total_pago_calculado,
  GREATEST(0,
    SUM(CASE WHEN t.type IN ('COMMITMENT', 'REINFORCEMENT') THEN t.amount ELSE 0 END) -
    SUM(CASE WHEN t.type = 'CANCELLATION' THEN t.amount ELSE 0 END) -
    SUM(CASE WHEN t.type = 'LIQUIDATION' THEN t.amount ELSE 0 END)
  ) AS saldo_a_pagar_calculado
FROM transacoes t
JOIN contratos c ON t.contract_id = c.id
WHERE c.contrato = '80/2025';

-- 5. VERIFICAR DISPARIDADE: transacoes vs contratos
SELECT '--- 5. Disparidade: Transacoes vs Contrato ---' AS etapa;

WITH calculado AS (
  SELECT
    SUM(CASE WHEN t.type IN ('COMMITMENT', 'REINFORCEMENT') THEN t.amount ELSE 0 END) AS total_emp_calc,
    SUM(CASE WHEN t.type = 'LIQUIDATION' THEN t.amount ELSE 0 END) AS total_pago_calc,
    GREATEST(0,
      SUM(CASE WHEN t.type IN ('COMMITMENT', 'REINFORCEMENT') THEN t.amount ELSE 0 END) -
      SUM(CASE WHEN t.type IN ('CANCELLATION') THEN t.amount ELSE 0 END) -
      SUM(CASE WHEN t.type = 'LIQUIDATION' THEN t.amount ELSE 0 END)
    ) AS saldo_calc
  FROM transacoes t
  JOIN contratos c ON t.contract_id = c.id
  WHERE c.contrato = '80/2025'
)
SELECT c.contrato,
       c.total_empenhado AS total_empenhado_armazenado,
       calc.total_emp_calc AS total_empenhado_calculado,
       c.total_empenhado - calc.total_emp_calc AS diferenca_empenhado,
       c.total_pago AS total_pago_armazenado,
       calc.total_pago_calc AS total_pago_calculado,
       c.total_pago - calc.total_pago_calc AS diferenca_pago
FROM contratos c
CROSS JOIN calculado calc
WHERE c.contrato = '80/2025';

-- 6. CACHE SIGEF: Notas de Empenho
SELECT '--- 6. Cache SIGEF: Notas de Empenho ---' AS etapa;

SELECT ne.nunotaempenho, ne.cdunidadegestora, ne.cdcredor, ne.dehistorico,
       ne.vlnotaempenho, ne.dtlancamento
FROM sigef_notas_empenho ne
JOIN dotacoes d ON d.nunotaempenho = ne.nunotaempenho
JOIN contratos c ON d.contract_id = c.id
WHERE c.contrato = '80/2025';

-- 7. CACHE SIGEF: Movimentos NE
SELECT '--- 7. Cache SIGEF: Movimentos NE ---' AS etapa;

SELECT m.nunotaempenho, m.cdevento, m.cdunidadegestora,
       m.vlnotaempenho, m.dtlancamento
FROM sigef_ne_movimentos m
JOIN dotacoes d ON d.nunotaempenho = m.nunotaempenho
JOIN contratos c ON d.contract_id = c.id
WHERE c.contrato = '80/2025'
ORDER BY m.nunotaempenho, m.dtlancamento;

-- 8. CACHE SIGEF: Ordens Bancárias
SELECT '--- 8. Cache SIGEF: Ordens Bancarias ---' AS etapa;

SELECT ob.nunotaempenho, ob.nuordembancaria, ob.vltotal, ob.dtpagamento,
       ob.cdsituacaoordembancaria, ob.nudocumento, ob.cdunidadegestora
FROM sigef_ordens_bancarias ob
JOIN dotacoes d ON d.nunotaempenho = ob.nunotaempenho
JOIN contratos c ON d.contract_id = c.id
WHERE c.contrato = '80/2025'
ORDER BY ob.dtpagamento;

-- 9. ESPELHO (MIRROR): OBs (para comparar com cache)
SELECT '--- 9. Mirror: OBs do Contrato ---' AS etapa;

SELECT io.nunotaempenho, io.nuordembancaria, io.vltotal, io.dtpagamento,
       io.cdsituacaoordembancaria, io.nudocumento, io.cdunidadegestora
FROM import_sigef_ob io
JOIN dotacoes d ON d.nunotaempenho = io.nunotaempenho
JOIN contratos c ON d.contract_id = c.id
WHERE c.contrato = '80/2025'
ORDER BY io.dtpagamento;

-- 10. RESUMO: Cache faltando vs Mirror
SELECT '--- 10. Resumo: Registros faltando no Cache vs Mirror ---' AS etapa;

SELECT
  d.nunotaempenho,
  CASE WHEN m_ne.id IS NOT NULL THEN 'SIM' ELSE 'NAO' END AS tem_cache_ne,
  CASE WHEN m_mov.id IS NOT NULL THEN 'SIM' ELSE 'NAO' END AS tem_cache_mov,
  CASE WHEN m_ob.id IS NOT NULL THEN 'SIM' ELSE 'NAO' END AS tem_cache_ob,
  CASE WHEN i_ne.id IS NOT NULL THEN 'SIM' ELSE 'NAO' END AS tem_mirror_ne,
  CASE WHEN i_ob.id IS NOT NULL THEN 'SIM' ELSE 'NAO' END AS tem_mirror_ob
FROM dotacoes d
JOIN contratos c ON d.contract_id = c.id
LEFT JOIN sigef_notas_empenho m_ne ON m_ne.nunotaempenho = d.nunotaempenho
LEFT JOIN sigef_ne_movimentos m_mov ON m_mov.nunotaempenho = d.nunotaempenho
LEFT JOIN sigef_ordens_bancarias m_ob ON m_ob.nunotaempenho = d.nunotaempenho
LEFT JOIN import_sigef_ne i_ne ON i_ne.nunotaempenho = d.nunotaempenho
LEFT JOIN import_sigef_ob i_ob ON i_ob.nunotaempenho = d.nunotaempenho
WHERE c.contrato = '80/2025'
GROUP BY d.nunotaempenho, m_ne.id, m_mov.id, m_ob.id, i_ne.id, i_ob.id
ORDER BY d.nunotaempenho;

-- =============================================================
-- CORREÇÃO (se necessário)
-- =============================================================
-- Se houver disparidade, execute o bloco abaixo para corrigir
-- forçando o recálculo dos totais a partir das transações.

BEGIN;

-- Verifica disparidade de novo (dentro da transação)
WITH calculado AS (
  SELECT
    t.contract_id,
    SUM(CASE WHEN t.type IN ('COMMITMENT', 'REINFORCEMENT') THEN t.amount ELSE 0 END) AS total_emp_calc,
    SUM(CASE WHEN t.type = 'LIQUIDATION' THEN t.amount ELSE 0 END) AS total_pago_calc,
    GREATEST(0,
      SUM(CASE WHEN t.type IN ('COMMITMENT', 'REINFORCEMENT') THEN t.amount ELSE 0 END) -
      SUM(CASE WHEN t.type IN ('CANCELLATION') THEN t.amount ELSE 0 END) -
      SUM(CASE WHEN t.type = 'LIQUIDATION' THEN t.amount ELSE 0 END)
    ) AS saldo_calc,
    MAX(CASE WHEN t.type = 'LIQUIDATION' THEN t.date ELSE NULL END) AS ultimo_pagamento
  FROM transacoes t
  JOIN contratos c ON t.contract_id = c.id
  WHERE c.contrato = '80/2025'
  GROUP BY t.contract_id
)
UPDATE contratos c
SET
  total_empenhado = calc.total_emp_calc,
  total_pago = calc.total_pago_calc,
  saldo_a_pagar = calc.saldo_calc,
  data_ultimo_pagamento = calc.ultimo_pagamento
FROM calculado calc
WHERE c.id = calc.contract_id
AND c.contrato = '80/2025';

-- Se precisar recarregar dados do SIGEF para este contrato,
-- execute no código (botão de sincronia na UI) ou via:
-- SELECT recarregar_cache_para_contrato('80/2025');
-- (função não existe — usar a UI do sistema)

COMMIT;

SELECT '--- CORRECAO CONCLUIDA ---' AS mensagem;
