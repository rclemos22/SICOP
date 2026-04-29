-- Adiciona coluna para armazenar parcelas marcadas como pagas manualmente
-- Isso permite que o usuário marque parcelas como pagas sem criar lançamentos financeiros
ALTER TABLE contratos 
ADD COLUMN IF NOT EXISTS parcelas_pagas_manual TEXT[] DEFAULT '{}';
