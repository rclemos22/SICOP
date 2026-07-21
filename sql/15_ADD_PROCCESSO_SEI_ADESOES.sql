-- Migration 15: Adicionar coluna processo_sei em ata_adesoes
ALTER TABLE ata_adesoes ADD COLUMN IF NOT EXISTS processo_sei TEXT;
