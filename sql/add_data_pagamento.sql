-- Adicionar coluna data_pagamento na tabela contratos
ALTER TABLE public.contratos 
ADD COLUMN IF NOT EXISTS data_pagamento INTEGER;

-- Comentário para documentar o campo
COMMENT ON COLUMN public.contratos.data_pagamento IS 'Dia do mês para controle de pagamentos (1-31)';

-- Atualizar registros existentes com NULL se não tiverem valor
UPDATE public.contratos SET data_pagamento = NULL WHERE data_pagamento IS NULL;