-- PR #7 — Tabela customers (pessoa canônica) + colunas customerId.
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
--
-- IMPORTANTE: esta migration cria APENAS a estrutura. O backfill (criar os
-- customers a partir de leads/contacts e vincular) roda DEPOIS via endpoint
-- admin `customers.dryRunBackfill` (relatório de duplicados) e
-- `customers.runBackfill` — nunca direto aqui, para você revisar antes.
--
-- Rollback:
--   ALTER TABLE leads DROP COLUMN IF EXISTS "customerId";
--   ALTER TABLE conversations DROP COLUMN IF EXISTS "customerId";
--   ALTER TABLE contacts DROP COLUMN IF EXISTS "customerId";
--   DROP TABLE IF EXISTS customers;

CREATE TABLE IF NOT EXISTS customers (
  "id"             serial PRIMARY KEY,
  "canonicalPhone" varchar(20) NOT NULL,
  "name"           varchar(255),
  "fullName"       varchar(255),
  "email"          varchar(320),
  "cpf"            varchar(11),
  "birthDate"      date,
  "city"           varchar(255),
  "consentAt"      timestamp,
  "consentSource"  varchar(50),
  "createdAt"      timestamp NOT NULL DEFAULT now(),
  "updatedAt"      timestamp NOT NULL DEFAULT now()
);

-- Uma pessoa por telefone canônico
CREATE UNIQUE INDEX IF NOT EXISTS "customers_canonical_phone_uidx" ON customers ("canonicalPhone");

-- FKs lógicas (nullable — link progressivo, não quebra nada existente)
ALTER TABLE leads         ADD COLUMN IF NOT EXISTS "customerId" integer;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "customerId" integer;
ALTER TABLE contacts      ADD COLUMN IF NOT EXISTS "customerId" integer;

CREATE INDEX IF NOT EXISTS "leads_customerId_idx"         ON leads ("customerId");
CREATE INDEX IF NOT EXISTS "conversations_customerId_idx" ON conversations ("customerId");
CREATE INDEX IF NOT EXISTS "contacts_customerId_idx"      ON contacts ("customerId");
