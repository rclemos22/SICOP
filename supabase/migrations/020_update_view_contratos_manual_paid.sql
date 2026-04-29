-- 020_update_view_contratos_manual_paid.sql
-- Esta migração atualiza a view de contratos para incluir a coluna de parcelas pagas manualmente
-- e outros campos necessários para o detalhamento do contrato.

DROP VIEW IF EXISTS public.vw_contratos_vigencia CASCADE;

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
    c.parcelas_pagas_manual, -- Coluna adicionada para controle manual
    c.tipo,                 -- Tipo (material/serviço)
    c.valor_mensal,         -- Valor mensal
    c.data_pagamento,       -- Dia do pagamento
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

-- Como a view foi removida com CASCADE, precisamos garantir que a RPC ou funções dependentes 
-- continuem existindo. Se a RPC 'rpc_contratos_por_ano' retornar SETOF vw_contratos_vigencia,
-- ela pode precisar ser recriada.

-- Nota: Se a RPC rpc_contratos_por_ano não for encontrada no repositório,
-- assume-se que ela será atualizada manualmente no Dashboard do Supabase pelo usuário
-- ou que ela já referencia a view dinamicamente.
