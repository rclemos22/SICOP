-- Habilita RLS e cria políticas para a tabela contratos

-- Permite insert para todos os usuários autenticados (usando a service role key)
CREATE POLICY "Permite insert contratos" ON public.contratos
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- Permite select para todos
CREATE POLICY "Permite select contratos" ON public.contratos
FOR SELECT TO anon, authenticated
USING (true);

-- Permite update para todos
CREATE POLICY "Permite update contratos" ON public.contratos
FOR UPDATE TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Permite delete para todos
CREATE POLICY "Permite delete contratos" ON public.contratos
FOR DELETE TO anon, authenticated
USING (true);