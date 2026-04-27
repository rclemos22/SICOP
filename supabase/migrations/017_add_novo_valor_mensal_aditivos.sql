-- Adiciona colunas para novo valor mensal e data de início do aditivo
-- Estas colunas armazenam o novo valor a ser pago a partir da data de início do aditivo

ALTER TABLE public.aditivos 
ADD COLUMN IF NOT EXISTS novo_valor_mensal NUMERIC(15,2);

ALTER TABLE public.aditivos 
ADD COLUMN IF NOT EXISTS data_inicio_novo DATE;