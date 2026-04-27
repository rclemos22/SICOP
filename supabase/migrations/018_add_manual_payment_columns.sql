-- Adiciona colunas para controle de pagamento manual de parcelas
-- Estas colunas permitem marcar parcelas como pagas manualmente

ALTER TABLE public.transacoes 
ADD COLUMN IF NOT EXISTS parcela_valor NUMERIC(15,2);

ALTER TABLE public.transacoes 
ADD COLUMN IF NOT EXISTS parcela_pago_em DATE;

ALTER TABLE public.transacoes 
ADD COLUMN IF NOT EXISTS manual_payment BOOLEAN DEFAULT false;