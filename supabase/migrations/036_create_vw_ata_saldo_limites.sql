-- 036_create_vw_ata_saldo_limites.sql
-- Atualiza vw_ata_saldo_item para incluir limites legais (Art. 86, Lei 14.133/2021)
-- § 3º: Limite individual = 50% da quantidade registrada
-- § 4º: Limite coletivo = 200% (dobro) da quantidade registrada

CREATE OR REPLACE VIEW vw_ata_saldo_item AS
SELECT
    ai.id                    AS item_id,
    ai.ata_id,
    ai.numero_item,
    ai.descricao             AS descricao_item,
    ai.unidade,
    ai.quantidade            AS quantidade_registrada,
    ai.valor_unitario,
    COALESCE(ci.total_consumido, 0)        AS quantidade_consumida_interna,
    COALESCE(ad.total_aderido, 0)          AS quantidade_aderida,
    ai.quantidade - COALESCE(ci.total_consumido, 0) - COALESCE(ad.total_aderido, 0)
                                         AS saldo_disponivel,
    CASE
        WHEN ai.quantidade > 0 THEN
            ROUND(
                ((COALESCE(ci.total_consumido, 0) + COALESCE(ad.total_aderido, 0)) / ai.quantidade) * 100,
                2
            )
        ELSE 0
    END                      AS percentual_utilizado,
    a.numero_ata,
    a.numero_processo,
    a.status                 AS ata_status,
    -- Limites legais (Art. 86, Lei 14.133/2021)
    ROUND(ai.quantidade * 0.5, 2)          AS limite_individual,
    ROUND(ai.quantidade * 2.0, 2)          AS limite_coletivo,
    GREATEST(0, ROUND((ai.quantidade * 2.0) - COALESCE(ad.total_aderido, 0), 2))
                                           AS saldo_adesao
FROM ata_itens ai
JOIN atas a ON a.id = ai.ata_id
LEFT JOIN (
    SELECT ata_item_id, SUM(quantidade) AS total_consumido
    FROM ata_consumo_interno
    GROUP BY ata_item_id
) ci ON ci.ata_item_id = ai.id
LEFT JOIN (
    SELECT ata_item_id, SUM(quantidade_autorizada) AS total_aderido
    FROM ata_adesoes
    WHERE status = 'AUTORIZADA'
    GROUP BY ata_item_id
) ad ON ad.ata_item_id = ai.id;
