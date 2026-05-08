-- Atualiza contratos.valor_mensal com o novo_valor_mensal do aditivo mais recente
-- que define um novo valor mensal. Isso garante que contratos com aditivos de
-- reajuste reflitam automaticamente o valor mensal correto.

WITH aditivo_mais_recente AS (
  SELECT DISTINCT ON (a.contract_id)
    a.contract_id,
    a.novo_valor_mensal,
    a.data_inicio_novo,
    a.numero_aditivo
  FROM aditivos a
  WHERE a.novo_valor_mensal IS NOT NULL
  ORDER BY a.contract_id, a.data_assinatura DESC NULLS LAST, a.created_at DESC
)
UPDATE contratos c
SET
  valor_mensal = amr.novo_valor_mensal,
  updated_at = NOW()
FROM aditivo_mais_recente amr
WHERE c.id = amr.contract_id
  AND (
    c.valor_mensal IS DISTINCT FROM amr.novo_valor_mensal
    OR c.valor_mensal IS NULL
  );
