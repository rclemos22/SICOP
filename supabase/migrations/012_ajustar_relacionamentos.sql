-- 1. Alterar a coluna setor_id de TEXT para UUID em contratos
-- Caso existam valores textuais quebrados, eles serão convertidos para nulos ou tentaremos fazer cast.
-- Como é um ambiente de dev/prototipação, podemos tentar converter via USING e lidar com erros.
DROP VIEW IF EXISTS public.vw_contratos_vigencia;

ALTER TABLE public.contratos 
  ALTER COLUMN setor_id TYPE UUID USING (
    CASE 
      WHEN setor_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN setor_id::UUID 
      ELSE NULL 
    END
  );

-- Opcional: Recriar FK de setor_id se não existir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'contratos_setor_id_fkey'
    ) THEN
        ALTER TABLE public.contratos 
        ADD CONSTRAINT contratos_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.setores(id) ON DELETE SET NULL;
    END IF;
END $$;


-- 2. Recriar a view com os JOINs para setores e fornecedores

CREATE OR REPLACE VIEW public.vw_contratos_vigencia AS
SELECT 
    c.id,
    c.contrato,
    c.processo_sei,
    c.link_sei,
    c.contratada,
    c.cnpj_contratada,
    c.fornecedor_id,
    f.razao_social AS fornecedor_nome, -- alias do fornecedor
    c.data_inicio,
    c.data_fim,
    c.valor_anual,
    c.status,
    c.setor_id,
    s.nome AS setor_nome, -- alias do setor
    c.unid_gestora,
    c.objeto,
    c.gestor_contrato,
    c.fiscal_admin,
    c.fiscal_tecnico,
    c.created_at,
    c.updated_at,
    c.data_fim as data_fim_efetiva,
    (c.data_fim - CURRENT_DATE)::integer as dias_restantes,
    CASE 
        WHEN c.status = 'RESCINDIDO' THEN 'RESCINDIDO'
        WHEN (c.data_fim - CURRENT_DATE) <= 90 THEN 'FINALIZANDO'
        ELSE 'VIGENTE'
    END as status_efetivo
FROM public.contratos c
LEFT JOIN public.fornecedores f ON f.id = c.fornecedor_id
LEFT JOIN public.setores s ON s.id = c.setor_id;
