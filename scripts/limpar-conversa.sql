-- Limpa TODO o histórico de um telefone para reiniciar o teste "do zero".
-- Número alvo: 5551997566259 (cobre as 4 variações de formato).
-- DESTRUTIVO. Rode o bloco de PREVIEW primeiro; se os números fizerem sentido,
-- rode o bloco de DELETE (está numa transação — ou apaga tudo, ou nada).

-- ╔══════════════════════════════════════════════════════════════╗
-- ║ PREVIEW — quantas linhas seriam afetadas (não apaga nada)      ║
-- ╚══════════════════════════════════════════════════════════════╝
WITH p(digits) AS (VALUES ('5551997566259'),('555197566259'),('51997566259'),('5197566259')),
     conv AS (SELECT id FROM conversations WHERE regexp_replace(phone,'\D','','g') IN (SELECT digits FROM p)),
     lead AS (SELECT id FROM leads WHERE regexp_replace(phone,'\D','','g') IN (SELECT digits FROM p))
SELECT
  (SELECT count(*) FROM conv)                                             AS conversas,
  (SELECT count(*) FROM messages WHERE "conversationId" IN (SELECT id FROM conv)) AS mensagens,
  (SELECT count(*) FROM lead)                                             AS leads,
  (SELECT count(*) FROM "chatFlowSessions" WHERE "conversationId" IN (SELECT id FROM conv)) AS sessoes_fluxo,
  (SELECT count(*) FROM "conversationInsights" WHERE "conversationId" IN (SELECT id FROM conv)) AS insights,
  (SELECT count(*) FROM "sellerAssignments" WHERE "conversationId" IN (SELECT id FROM conv)) AS atribuicoes;

-- ╔══════════════════════════════════════════════════════════════╗
-- ║ DELETE — apaga tudo (descomente/rode quando confirmar acima)  ║
-- ╚══════════════════════════════════════════════════════════════╝
BEGIN;

CREATE TEMP TABLE _p(digits text) ON COMMIT DROP;
INSERT INTO _p VALUES ('5551997566259'),('555197566259'),('51997566259'),('5197566259');

CREATE TEMP TABLE _conv ON COMMIT DROP AS
  SELECT id FROM conversations WHERE regexp_replace(phone,'\D','','g') IN (SELECT digits FROM _p);
CREATE TEMP TABLE _lead ON COMMIT DROP AS
  SELECT id FROM leads WHERE regexp_replace(phone,'\D','','g') IN (SELECT digits FROM _p);

-- Filhos por conversationId
DELETE FROM "activityLogs"          WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "aiDecisions"           WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "aiLogs"                WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "capiEvents"            WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "chatFlowSessions"      WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "conversationAssignments" WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "conversationInsights"  WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "conversationLabels"    WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "conversationReminders" WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "csatRatings"           WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "evolutionMessages"     WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "followUpLogs"          WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "leadSummaries"         WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "messages"              WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "rescueAttempts"        WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "scheduledMessages"     WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "sellerAssignments"     WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "teamNotifications"     WHERE "conversationId" IN (SELECT id FROM _conv);
DELETE FROM "whatsappNumberMessages" WHERE "conversationId" IN (SELECT id FROM _conv);

-- Filhos por leadId
DELETE FROM "leadOpportunities"     WHERE "leadId" IN (SELECT id FROM _lead);
DELETE FROM "leadSummaries"         WHERE "leadId" IN (SELECT id FROM _lead);
DELETE FROM "activityLogs"          WHERE "leadId" IN (SELECT id FROM _lead);
DELETE FROM "capiEvents"            WHERE "leadId" IN (SELECT id FROM _lead);
DELETE FROM "rescueAttempts"        WHERE "leadId" IN (SELECT id FROM _lead);

-- Registros do próprio telefone
DELETE FROM "contacts"              WHERE regexp_replace(phone,'\D','','g') IN (SELECT digits FROM _p);
DELETE FROM "campaignDispatches"    WHERE regexp_replace(phone,'\D','','g') IN (SELECT digits FROM _p);
DELETE FROM "templateSends"         WHERE regexp_replace(phone,'\D','','g') IN (SELECT digits FROM _p);
DELETE FROM "evolutionConversations" WHERE regexp_replace(phone,'\D','','g') IN (SELECT digits FROM _p);

-- Pais (por último)
DELETE FROM "leads"                 WHERE id IN (SELECT id FROM _lead);
DELETE FROM "conversations"         WHERE id IN (SELECT id FROM _conv);

COMMIT;
