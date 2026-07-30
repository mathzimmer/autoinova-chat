-- Decision log da máquina de estados (arquitetura "vendedor virtual", fase 1).
-- Cada mensagem classificada (NLU), transição de nó, ação executada, fallback e
-- expiração de sessão vira um evento auditável. Alimenta o painel "Saúde da
-- Jornada" no editor de fluxos (funil por nó, taxa de fallback, handoffs).
CREATE TABLE IF NOT EXISTS "flowEvents" (
  "id" serial PRIMARY KEY NOT NULL,
  "sessionId" integer NOT NULL,
  "conversationId" integer NOT NULL,
  "flowId" integer NOT NULL,
  "nodeId" integer,
  "event" varchar(60) NOT NULL,
  "payload" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "flowEvents_flowId_createdAt_idx" ON "flowEvents" ("flowId", "createdAt");
CREATE INDEX IF NOT EXISTS "flowEvents_conversationId_idx" ON "flowEvents" ("conversationId");
CREATE INDEX IF NOT EXISTS "flowEvents_sessionId_idx" ON "flowEvents" ("sessionId");
