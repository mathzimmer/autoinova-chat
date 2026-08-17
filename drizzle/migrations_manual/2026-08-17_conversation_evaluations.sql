-- Coach de Vendas (Fase A) — avaliação POR CONVERSA do atendimento do vendedor.
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
--
-- Rollback:
--   DROP TABLE IF EXISTS "conversationEvaluations";

CREATE TABLE IF NOT EXISTS "conversationEvaluations" (
  "id"            serial PRIMARY KEY,
  "conversationId" integer NOT NULL,
  "sellerId"      integer,                       -- teamMembers.id (assignedTo); pode ser null
  "outcome"       varchar(20),                   -- 'ganho' | 'perdido' | 'encerrado'
  "scoreOverall"  integer NOT NULL DEFAULT 0,
  "scoreInicio"   integer NOT NULL DEFAULT 0,
  "scoreMeio"     integer NOT NULL DEFAULT 0,
  "scoreFim"      integer NOT NULL DEFAULT 0,
  "strengths"     jsonb,
  "errors"        jsonb,
  "tips"          jsonb,
  "reason"        text,                          -- por que ganhou/perdeu
  "summary"       text,
  "createdAt"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_conveval_conversation" ON "conversationEvaluations" ("conversationId");
CREATE INDEX IF NOT EXISTS "idx_conveval_seller" ON "conversationEvaluations" ("sellerId");
