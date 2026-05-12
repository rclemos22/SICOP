-- 022_add_contract_financial_columns.sql
-- Adiciona colunas financeiras na tabela contratos

-- Verificar e adicionar colunas se não existirem
DO $$
BEGIN
    -- total_empenhado
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='total_empenhado') THEN
        ALTER TABLE contratos ADD COLUMN total_empenhado NUMERIC(15,2) DEFAULT 0;
    END IF;

    -- total_pago
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='total_pago') THEN
        ALTER TABLE contratos ADD COLUMN total_pago NUMERIC(15,2) DEFAULT 0;
    END IF;

    -- saldo_a_pagar
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='saldo_a_pagar') THEN
        ALTER TABLE contratos ADD COLUMN saldo_a_pagar NUMERIC(15,2) DEFAULT 0;
    END IF;

    -- data_ultimo_pagamento
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='data_ultimo_pagamento') THEN
        ALTER TABLE contratos ADD COLUMN data_ultimo_pagamento DATE;
    END IF;

    -- updated_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='updated_at') THEN
        ALTER TABLE contratos ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_contratos_total_empenhado ON contratos(total_empenhado);
CREATE INDEX IF NOT EXISTS idx_contratos_total_pago ON contratos(total_pago);
