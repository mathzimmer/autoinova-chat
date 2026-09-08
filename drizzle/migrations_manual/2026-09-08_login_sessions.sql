-- Auditoria de acesso: registra cada sessão de login de um membro da equipe.
-- Guarda quando entrou (loginAt), quando saiu (logoutAt), última atividade
-- (lastSeenAt), IP e user-agent. "Online agora" = sessão sem logoutAt e com
-- lastSeenAt recente. Idempotente.
--
-- Rollback:
--   DROP TABLE IF EXISTS "loginSessions";

CREATE TABLE IF NOT EXISTS "loginSessions" (
  "id"           serial PRIMARY KEY,
  "teamMemberId" integer NOT NULL,
  "memberName"   varchar(255),
  "memberEmail"  varchar(320),
  "loginAt"      timestamp DEFAULT now() NOT NULL,
  "lastSeenAt"   timestamp DEFAULT now() NOT NULL,
  "logoutAt"     timestamp,
  "endReason"    varchar(30),
  "ip"           varchar(64),
  "userAgent"    varchar(400),
  "createdAt"    timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "loginSessions_member_idx"  ON "loginSessions" ("teamMemberId");
CREATE INDEX IF NOT EXISTS "loginSessions_open_idx"    ON "loginSessions" ("logoutAt");
CREATE INDEX IF NOT EXISTS "loginSessions_lastseen_idx" ON "loginSessions" ("lastSeenAt");
