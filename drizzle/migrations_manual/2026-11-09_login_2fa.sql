-- 2FA por WhatsApp no login da equipe.
-- Telefone do membro (destino do código) + tabela de códigos OTP.
ALTER TABLE "teamMembers" ADD COLUMN IF NOT EXISTS "whatsapp" varchar(32);

CREATE TABLE IF NOT EXISTS "loginOtps" (
  "id"           serial PRIMARY KEY,
  "teamMemberId" integer NOT NULL,
  "codeHash"     varchar(128) NOT NULL,
  "expiresAt"    timestamp NOT NULL,
  "attempts"     integer NOT NULL DEFAULT 0,
  "consumedAt"   timestamp,
  "createdAt"    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "loginOtps_member_idx" ON "loginOtps" ("teamMemberId");
