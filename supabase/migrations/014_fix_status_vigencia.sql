-- 014_fix_status_vigencia.sql
-- Essa migração corrige a lógica de status efetivo da view public.vw_contratos_vigencia
-- para diferenciar contratos expirados (ENCERRADO) de contratos que terminam em breve (FINALIZANDO).

DROP VIEW IF EXISTS public.vw_contratos_vigencia;

CREATE OR REPLACE VIEW public.vw_contratos_vigencia AS
SELECT 
    c.id,
    c.contrato,
    c.processo_sei,
    c.link_sei,
    c.contratada,
    c.cnpj_contratada,
    c.fornecedor_id,
    f.razao_social AS fornecedor_nome, 
    c.data_inicio,
    c.data_fim,
    c.valor_anual,
    c.status,
    c.setor_id,
    s.nome AS setor_nome, 
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
        WHEN c.data_fim < CURRENT_DATE THEN 'ENCERRADO'
        WHEN (c.data_fim - CURRENT_DATE) <= 90 THEN 'FINALIZANDO'
        ELSE 'VIGENTE'
    END as status_efetivo
FROM public.contratos c
LEFT JOIN public.fornecedores f ON f.id = c.fornecedor_id
LEFT JOIN public.setores s ON s.id = c.setor_id;
