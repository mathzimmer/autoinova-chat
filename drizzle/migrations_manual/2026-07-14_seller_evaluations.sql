-- Módulo de avaliação de vendedores (coaching IA)
-- Rodar no VPS: psql -U autoinova -d autoinova -f este_arquivo.sql
CREATE TABLE IF NOT EXISTS "sellerEvaluations" (
  "id"                  serial PRIMARY KEY,
  "memberId"            integer NOT NULL,
  "instanceName"        varchar(100),
  "periodDays"          integer NOT NULL DEFAULT 30,
  "score"               integer NOT NULL DEFAULT 0,
  "conversionScore"     integer NOT NULL DEFAULT 0,
  "speedScore"          integer NOT NULL DEFAULT 0,
  "conductScore"        integer NOT NULL DEFAULT 0,
  "valueScore"          integer NOT NULL DEFAULT 0,
  "activityScore"       integer NOT NULL DEFAULT 0,
  "leadsReceived"       integer NOT NULL DEFAULT 0,
  "leadsConverted"      integer NOT NULL DEFAULT 0,
  "avgFirstResponseSec" integer NOT NULL DEFAULT 0,
  "valueSoldCents"      bigint  NOT NULL DEFAULT 0,
  "leadsNoReply"        integer NOT NULL DEFAULT 0,
  "summary"             text,
  "strengths"           jsonb,
  "improvements"        jsonb,
  "tips"                jsonb,
  "createdAt"           timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sellerEvaluations_member_idx" ON "sellerEvaluations" ("memberId", "createdAt");
ALTER TABLE "sellerEvaluations" OWNER TO autoinova;
