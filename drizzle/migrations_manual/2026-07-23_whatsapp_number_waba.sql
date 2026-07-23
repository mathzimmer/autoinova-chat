-- Números oficiais (Cloud API): guarda o WABA ID para poder assinar o webhook do
-- app (POST /{waba_id}/subscribed_apps) e re-assinar/depurar quando necessário.
ALTER TABLE "whatsappNumbers" ADD COLUMN IF NOT EXISTS "wabaId" varchar(64);
