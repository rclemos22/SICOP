-- 022_fix_duplicate_fks.sql
-- Remove FKs duplicados que causam ambiguidade no PostgREST.

-- 1. Listar todos os FKs para diagnóstico
SELECT
  con.conname::text AS constraint_name,
  con.conrelid::regclass::text AS source_table,
  a.attname::text AS source_column,
  confrelid::regclass::text AS target_table,
  af.attname::text AS target_column
FROM pg_constraint con
JOIN pg_attribute a ON a.attnum = ANY(con.conkey) AND a.attrelid = con.conrelid
JOIN pg_attribute af ON af.attnum = ANY(con.confkey) AND af.attrelid = con.confrelid
WHERE con.contype = 'f'
  AND con.conrelid::regclass::text IN ('transacoes', 'contratos', 'dotacoes', 'aditivos', 'fornecedores', 'setores')
  AND confrelid::regclass::text IN ('transacoes', 'contratos', 'dotacoes', 'aditivos', 'fornecedores', 'setores', 'tipo_aditivo')
ORDER BY 2, 4, 1;

-- 2. Remover FKs duplicados (mantém apenas a primeira por coluna+tabela)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    WITH fk_list AS (
      SELECT
        con.conname::text AS constraint_name,
        con.conrelid::regclass::text AS source_table,
        a.attname::text AS source_column,
        confrelid::regclass::text AS target_table,
        ROW_NUMBER() OVER (
          PARTITION BY con.conrelid::regclass, a.attname, confrelid::regclass
          ORDER BY con.conname
        ) AS rn
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attnum = ANY(con.conkey) AND a.attrelid = con.conrelid
      JOIN pg_attribute af ON af.attnum = ANY(con.confkey) AND af.attrelid = con.confrelid
      WHERE con.contype = 'f'
    )
    SELECT constraint_name, source_table, source_column, target_table
    FROM fk_list
    WHERE rn > 1
      AND source_table IN ('transacoes', 'contratos', 'dotacoes', 'aditivos', 'fornecedores', 'setores')
  ) LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.source_table, r.constraint_name);
    RAISE NOTICE 'DROP FK % ON %(%) -> %', r.constraint_name, r.source_table, r.source_column, r.target_table;
  END LOOP;
END $$;

-- 3. Garantir FK de transacoes para contratos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_attribute a ON a.attnum = ANY(con.conkey) AND a.attrelid = con.conrelid
    WHERE con.contype = 'f'
      AND con.conrelid = 'transacoes'::regclass
      AND a.attname = 'contract_id'
      AND confrelid = 'contratos'::regclass
  ) THEN
    ALTER TABLE transacoes
      ADD CONSTRAINT transacoes_contract_id_fkey
      FOREIGN KEY (contract_id) REFERENCES contratos(id) ON DELETE CASCADE;
    RAISE NOTICE 'FK transacoes_contract_id_fkey adicionada';
  END IF;
END $$;

-- 4. Garantir FK de dotacoes para contratos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_attribute a ON a.attnum = ANY(con.conkey) AND a.attrelid = con.conrelid
    WHERE con.contype = 'f'
      AND con.conrelid = 'dotacoes'::regclass
      AND a.attname = 'contract_id'
      AND confrelid = 'contratos'::regclass
  ) THEN
    ALTER TABLE dotacoes
      ADD CONSTRAINT dotacoes_contract_id_fkey
      FOREIGN KEY (contract_id) REFERENCES contratos(id) ON DELETE CASCADE;
    RAISE NOTICE 'FK dotacoes_contract_id_fkey adicionada';
  END IF;
END $$;
