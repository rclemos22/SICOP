-- remove_manual_payments.sql
-- Remove todos os pagamentos manuais inseridos nos lançamentos de cada contrato.
--
-- O que faz:
--   1. Reseta parcelas_pagas_manual para array vazio em todos os contratos
--   2. Exclui transações marcadas como pagamento manual
--   3. Limpa campos de parcela manual em transações restantes
--
-- Para executar no SQL Editor do Supabase Dashboard.

BEGIN;

-- 1. Remover referências de parcelas pagas manualmente nos contratos
UPDATE public.contratos
SET parcelas_pagas_manual = '{}'
WHERE parcelas_pagas_manual IS NOT NULL
  AND parcelas_pagas_manual != '{}';

-- 2. Excluir transações que são pagamentos manuais
DELETE FROM public.transacoes
WHERE manual_payment = true;

-- 3. Limpar campos de parcela manual em transações que porventura
--    tenham esses campos preenchidos mas não são marcadas como manual
UPDATE public.transacoes
SET 
    parcela_valor = NULL,
    parcela_pago_em = NULL,
    manual_payment = false
WHERE manual_payment = true
   OR parcela_valor IS NOT NULL
   OR parcela_pago_em IS NOT NULL;

COMMIT;

-- 4. Verificar resultado
SELECT 'contratos com parcelas_pagas_manual preenchido:' as info,
       COUNT(*) as total
FROM public.contratos
WHERE parcelas_pagas_manual IS NOT NULL
  AND parcelas_pagas_manual != '{}';

SELECT 'transacoes com manual_payment = true:' as info,
       COUNT(*) as total
FROM public.transacoes
WHERE manual_payment = true;

SELECT 'transacoes com parcela_valor preenchido:' as info,
       COUNT(*) as total
FROM public.transacoes
WHERE parcela_valor IS NOT NULL;
