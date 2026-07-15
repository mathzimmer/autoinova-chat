-- Permite registrar conversões do site (sem lead no CRM) na tabela capiEvents.
-- Rodar no VPS: psql -U autoinova -d autoinova -f este_arquivo.sql
ALTER TABLE "capiEvents" ALTER COLUMN "leadId" DROP NOT NULL;
