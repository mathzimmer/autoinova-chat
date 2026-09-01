-- Meta Business Agent — marca um número oficial como gerido pelo agente da Meta.
-- mode = 'normal' (padrão, IA do CRM responde) | 'meta_agent' (só observa + handoff).
-- Idempotente.
--
-- Rollback:
--   ALTER TABLE "whatsappNumbers" DROP COLUMN IF EXISTS "mode";

ALTER TABLE "whatsappNumbers" ADD COLUMN IF NOT EXISTS "mode" varchar(20) DEFAULT 'normal';
