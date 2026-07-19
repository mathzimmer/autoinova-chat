-- Qualidade do lead (bom/ruim) — define o que é reportado à Meta (CAPI)
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "quality"       varchar(10);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualitySource" varchar(20);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualityReason" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "visitedStore"  boolean;
