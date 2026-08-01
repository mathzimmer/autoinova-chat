-- PR #6 — Motor único de reengajamento: tabela reengagementAttempts + backfill.
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
--
-- Substitui followUpLogs (motor followUp — morto, nunca era iniciado) e
-- rescueAttempts (motor rescueJob) como fonte de verdade das tentativas.
-- Os legados continuam existindo para consulta histórica; o motor novo (v2)
-- só liga quando reengagement_config.enabled = true (feature flag).

-- 1) Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reengagement_strategy') THEN
    CREATE TYPE reengagement_strategy AS ENUM ('flow', 'ai_message', 'template');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reengagement_status') THEN
    CREATE TYPE reengagement_status AS ENUM ('sent', 'failed', 'responded', 'cancelled');
  END IF;
END $$;

-- 2) Tabela
CREATE TABLE IF NOT EXISTS "reengagementAttempts" (
  "id"               serial PRIMARY KEY,
  "conversationId"   integer NOT NULL,
  "leadId"           integer,
  "attemptNumber"    integer NOT NULL DEFAULT 1,
  "strategy"         reengagement_strategy NOT NULL,
  "reengagementStatus" reengagement_status NOT NULL DEFAULT 'sent',
  "flowId"           integer,
  "message"          text,
  "error"            text,
  "sentAt"           timestamp NOT NULL DEFAULT now(),
  "respondedAt"      timestamp,
  "createdAt"        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "reengAttempts_conv_idx"  ON "reengagementAttempts" ("conversationId");
CREATE INDEX IF NOT EXISTS "reengAttempts_sentAt_idx" ON "reengagementAttempts" ("sentAt");

-- 3) Backfill — histórico dos motores legados (melhor esforço; ignora se já rodou)
INSERT INTO "reengagementAttempts" ("conversationId", "leadId", "attemptNumber", "strategy", "reengagementStatus", "message", "sentAt", "createdAt")
SELECT f."conversationId", NULL, f."attemptNumber", 'ai_message', 'sent', f."message", f."sentAt", f."sentAt"
FROM "followUpLogs" f
WHERE NOT EXISTS (SELECT 1 FROM "reengagementAttempts" r WHERE r."conversationId" = f."conversationId" AND r."sentAt" = f."sentAt");

INSERT INTO "reengagementAttempts" ("conversationId", "leadId", "attemptNumber", "strategy", "reengagementStatus", "flowId", "sentAt", "respondedAt", "createdAt")
SELECT a."conversationId", a."leadId", a."attemptNumber", 'flow',
       CASE a."rescueStatus" WHEN 'responded' THEN 'responded' ELSE 'sent' END,
       a."flowId", a."sentAt", a."respondedAt", a."sentAt"
FROM "rescueAttempts" a
WHERE NOT EXISTS (SELECT 1 FROM "reengagementAttempts" r WHERE r."conversationId" = a."conversationId" AND r."sentAt" = a."sentAt");
