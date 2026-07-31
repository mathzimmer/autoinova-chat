-- PR A2 — Mata o prompt legado (chatFlows.aiPrompt) e o nível de canal da cadeia de agentes.
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
--
-- O que faz:
--   0) Backup da tabela chatFlows em chatFlows_backup_a2 (segurança antes do DROP)
--   1) Cada fluxo com aiPrompt e SEM agente vinculado vira um agente "Legado — <fluxo>"
--      (includeCoreLayers=false, mesmas tools de estoque) e o fluxo passa a apontar para ele
--   2) Nível de canal → instância: cada instância Evolution SEM agente herda o agente
--      do canal whatsapp (se existir); conflitos (instância já com agente) são preservados
--   3) Remove as settings channel_*_agent_id
--   4) Dropa a coluna chatFlows.aiPrompt
--
-- Rollback: restaurar a partir de chatFlows_backup_a2 e recriar a coluna:
--   ALTER TABLE "chatFlows" ADD COLUMN "aiPrompt" text;
--   UPDATE "chatFlows" f SET "aiPrompt" = b."aiPrompt" FROM "chatFlows_backup_a2" b WHERE b.id = f.id;

-- 0) Backup
CREATE TABLE IF NOT EXISTS "chatFlows_backup_a2" AS SELECT * FROM "chatFlows";

-- 1) Fluxos com aiPrompt e sem agentId → agente "Legado — <fluxo>" vinculado
DO $$
DECLARE
  f RECORD;
  newId INT;
BEGIN
  FOR f IN
    SELECT id, name, "aiPrompt"
    FROM "chatFlows"
    WHERE "aiPrompt" IS NOT NULL
      AND btrim("aiPrompt") <> ''
      AND "agentId" IS NULL
  LOOP
    INSERT INTO "aiAgents" ("name", "description", "systemPrompt", "includeCoreLayers", "model", "enabledTools", "active")
    VALUES (
      LEFT('Legado — ' || f."name", 255),
      'Agente criado a partir do prompt legado do fluxo "' || f."name" || '" (PR A2).',
      f."aiPrompt",
      false,
      'gpt-4o-mini',
      '["buscar_veiculos","buscar_veiculo_por_id","apresentar_veiculo","resumo_estoque","atualizar_lead","enviar_botoes","enviar_lista"]'::jsonb,
      true
    )
    RETURNING id INTO newId;

    UPDATE "chatFlows" SET "agentId" = newId WHERE id = f.id;
  END LOOP;
END $$;

-- 2) Canal → instância: instâncias sem agente herdam o agente do canal whatsapp
INSERT INTO settings ("settingKey", "value")
SELECT 'instance_' || i."instanceName" || '_agent_id', s."value"
FROM "evolutionInstances" i, settings s
WHERE s."settingKey" = 'channel_whatsapp_agent_id'
  AND s."value" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM settings x
    WHERE x."settingKey" = 'instance_' || i."instanceName" || '_agent_id'
      AND x."value" <> ''
  );

-- 3) Remove settings de canal (o nível deixou de existir na cadeia)
DELETE FROM settings
WHERE "settingKey" IN ('channel_whatsapp_agent_id', 'channel_instagram_agent_id', 'channel_facebook_agent_id');

-- 4) Drop da coluna legada
ALTER TABLE "chatFlows" DROP COLUMN IF EXISTS "aiPrompt";
