-- Atualiza a função de cálculo de valor pago para ser case-insensitive 
-- e incluir todos os status de pagamento confirmados ou em processamento final.
CREATE OR REPLACE FUNCTION public.fn_calcular_valor_pago(
  p_cdunidadegestora INTEGER,
  p_nunotaempenho VARCHAR
) RETURNS NUMERIC(15,2) AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(vltotal)
     FROM sigef_ordens_bancarias
     WHERE cdunidadegestora = p_cdunidadegestora
       AND nunotaempenho = p_nunotaempenho
       AND LOWER(cdsituacaoordembancaria) IN (
         'cb', 
         'confirmada banco', 
         'creditado', 
         'emitida', 
         'processada', 
         'registrada', 
         'ordem bancaria emitida', 
         'pagamento efetuado'
       )),
    0
  );
END;
$$ LANGUAGE plpgsql;
