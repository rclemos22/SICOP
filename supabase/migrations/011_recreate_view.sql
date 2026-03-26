-- Recriar a view com a estrutura correta
DROP VIEW IF EXISTS public.vw_contratos_vigencia;

CREATE OR REPLACE VIEW public.vw_contratos_vigencia AS
SELECT 
    id,
    contrato,
    processo_sei,
    link_sei,
    contratada,
    cnpj_contratada,
    fornecedor_id,
    data_inicio,
    data_fim,
    valor_anual,
    status,
    setor_id,
    unid_gestora,
    objeto,
    gestor_contrato,
    fiscal_admin,
    fiscal_tecnico,
    created_at,
    updated_at,
    data_fim as data_fim_efetiva,
    (data_fim - CURRENT_DATE)::integer as dias_restantes,
    CASE 
        WHEN status = 'RESCINDIDO' THEN 'RESCINDIDO'
        WHEN (data_fim - CURRENT_DATE) <= 90 THEN 'FINALIZANDO'
        ELSE 'VIGENTE'
    END as status_efetivo
FROM public.contratos;

-- Verificar se a view retorna dados
SELECT id, contrato, objeto FROM public.vw_contratos_vigencia WHERE contrato = '087/2025';