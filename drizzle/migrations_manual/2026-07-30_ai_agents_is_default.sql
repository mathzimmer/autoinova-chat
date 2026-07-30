-- PR A1: "modo livre vira agente". O agente padrão da loja passa a ser uma linha
-- em aiAgents marcada como isDefault (antes era só o setting default_agent_id).
-- Backfill: marca como isDefault o agente apontado pelo setting legado, se houver.
ALTER TABLE "aiAgents" ADD COLUMN IF NOT EXISTS "isDefault" boolean NOT NULL DEFAULT false;

-- Backfill best-effort a partir do setting default_agent_id (se existir e for válido)
UPDATE "aiAgents" a
SET "isDefault" = true
WHERE a.id = (
  SELECT NULLIF(s.value, '')::int
  FROM "settings" s
  WHERE s."settingKey" = 'default_agent_id'
  LIMIT 1
)
AND a.active = true;
