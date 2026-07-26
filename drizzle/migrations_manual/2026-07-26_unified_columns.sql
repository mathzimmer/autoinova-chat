-- Novas colunas unificadas
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "remoteJid" varchar(100);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "phoneNumberId" varchar(64);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "connectionType" varchar(50);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "connectionId" integer;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "tags" jsonb;

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "direction" varchar(50);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "instanceId" integer;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "instanceName" varchar(100);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "rawPayload" jsonb;

-- Coluna WABA ID necessária para re-assinar webhooks
ALTER TABLE "whatsappNumbers" ADD COLUMN IF NOT EXISTS "wabaId" varchar(64);

-- Colunas ausentes detectadas no Drizzle schema vs Banco Físico do Supabase (aplicar na VPS se faltarem)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "agentId" integer;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "leadId" integer;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "platformUserId" varchar(255);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "windowExpired" smallint DEFAULT 0;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "contactEmail" varchar(320);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "contactNotes" text;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastCustomerMessageAt" bigint;

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "createdByInstance" varchar(100);

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "ownerId" integer;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "reactivations" integer DEFAULT 0 NOT NULL;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "reopenedAt" timestamp;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "isLead" boolean DEFAULT true NOT NULL;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "discardReason" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "creditApproved" boolean;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "quality" varchar(50);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualitySource" varchar(50);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualityReason" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "visitedStore" boolean;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "creditAmount" numeric(12,2);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "creditConditions" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "creditBank" varchar(100);

ALTER TABLE "activityLogs" ADD COLUMN IF NOT EXISTS "leadId" integer;
