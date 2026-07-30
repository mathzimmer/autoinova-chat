-- PR #0 — Índices e Foreign Keys (fundação, risco baixo).
-- Índices aceleram as queries mais quentes; FKs garantem integridade.
-- As FKs são adicionadas como NOT VALID: NÃO checam linhas existentes (evita
-- falha por órfãos antigos), mas passam a valer para novas escritas e cascatas.

-- ── Índices ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON "messages" ("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_leads_conversation    ON "leads" ("conversationId");
CREATE INDEX IF NOT EXISTS idx_leads_phone           ON "leads" ("phone");
CREATE INDEX IF NOT EXISTS idx_conversations_phone   ON "conversations" ("phone");
CREATE INDEX IF NOT EXISTS idx_conversations_lead    ON "conversations" ("leadId");
CREATE INDEX IF NOT EXISTS idx_contacts_phone        ON "contacts" ("phone");

-- ── Foreign Keys (idempotentes via guarda em pg_constraint) ───
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_messages_conversation') THEN
    ALTER TABLE "messages"
      ADD CONSTRAINT fk_messages_conversation
      FOREIGN KEY ("conversationId") REFERENCES "conversations"(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_opportunities_lead') THEN
    ALTER TABLE "leadOpportunities"
      ADD CONSTRAINT fk_opportunities_lead
      FOREIGN KEY ("leadId") REFERENCES "leads"(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
