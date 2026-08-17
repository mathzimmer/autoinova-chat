-- Coach de Vendas (Fase B/C) — lições aprendidas de negócios ganhos/perdidos.
-- Alimentam as dicas ao vivo (o coach "aprende" com os casos da loja).
-- Idempotente.
--
-- Rollback:
--   DROP TABLE IF EXISTS "salesLessons";

CREATE TABLE IF NOT EXISTS "salesLessons" (
  "id"             serial PRIMARY KEY,
  "conversationId" integer,
  "sellerId"       integer,
  "kind"           varchar(10),          -- 'ganhou' | 'perdeu'
  "lesson"         text NOT NULL,
  "createdAt"      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_lessons_kind" ON "salesLessons" ("kind");
CREATE INDEX IF NOT EXISTS "idx_lessons_seller" ON "salesLessons" ("sellerId");
