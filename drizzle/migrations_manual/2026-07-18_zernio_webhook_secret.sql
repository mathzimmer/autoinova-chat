-- Secret de webhook por instância Zernio (permite várias contas Zernio no mesmo CRM)
ALTER TABLE "zernioInstances" ADD COLUMN IF NOT EXISTS "webhookSecret" text;
