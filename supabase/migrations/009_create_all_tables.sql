-- Migration para criar as tabelas básicas do SICOP

-- Tabela de fornecedores
CREATE TABLE IF NOT EXISTS public.fornecedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razao_social TEXT NOT NULL,
    nome_fantasia TEXT,
    cnpj TEXT UNIQUE,
    email TEXT,
    telefone TEXT,
    categoria TEXT,
    endereco TEXT,
    status TEXT DEFAULT 'ACTIVE',
    desde TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de contratos
CREATE TABLE IF NOT EXISTS public.contratos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contrato TEXT NOT NULL,
    processo_sei TEXT,
    link_sei TEXT,
    contratada TEXT,
    cnpj_contratada TEXT,
    fornecedor_id UUID REFERENCES public.fornecedores(id) ON DELETE SET NULL,
    data_inicio DATE,
    data_fim DATE,
    valor_anual NUMERIC(15,2),
    status TEXT DEFAULT 'VIGENTE',
    setor_id TEXT,
    unid_gestora TEXT,
    objeto TEXT,
    gestor_contrato TEXT,
    fiscal_admin TEXT,
    fiscal_tecnico TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de setores
CREATE TABLE IF NOT EXISTS public.setores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    descricao TEXT,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de tipo_aditivo
CREATE TABLE IF NOT EXISTS public.tipo_aditivo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL UNIQUE,
    descricao TEXT,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de aditivos
CREATE TABLE IF NOT EXISTS public.aditivos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contratos(id) ON DELETE CASCADE,
    tipo_id UUID REFERENCES public.tipo_aditivo(id),
    numero_contrato TEXT,
    numero_aditivo TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'ALTERACAO',
    data_assinatura DATE,
    nova_vigencia DATE,
    valor_aditivo NUMERIC(15,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de dotações
CREATE TABLE IF NOT EXISTS public.dotacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contratos(id) ON DELETE CASCADE,
    numero_contrato TEXT,
    dotacao TEXT,
    credito TEXT,
    data_disponibilidade DATE,
    unid_gestora TEXT,
    valor_dotacao NUMERIC(15,2),
    nunotaempenho TEXT,
    total_empenhado NUMERIC(15,2),
    total_pago NUMERIC(15,2),
    saldo_disponivel NUMERIC(15,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS nas tabelas
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_aditivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aditivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dotacoes ENABLE ROW LEVEL SECURITY;

-- Políticas RLS (IF NOT EXISTS)
DROP POLICY IF EXISTS "fornecedores_all" ON public.fornecedores;
DROP POLICY IF EXISTS "contratos_all" ON public.contratos;
DROP POLICY IF EXISTS "setores_all" ON public.setores;
DROP POLICY IF EXISTS "tipo_aditivo_all" ON public.tipo_aditivo;
DROP POLICY IF EXISTS "aditivos_all" ON public.aditivos;
DROP POLICY IF EXISTS "dotacoes_all" ON public.dotacoes;

CREATE POLICY "fornecedores_all" ON public.fornecedores FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "contratos_all" ON public.contratos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "setores_all" ON public.setores FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tipo_aditivo_all" ON public.tipo_aditivo FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "aditivos_all" ON public.aditivos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "dotacoes_all" ON public.dotacoes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);