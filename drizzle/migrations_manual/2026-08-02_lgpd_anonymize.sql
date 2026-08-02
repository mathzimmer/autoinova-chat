-- PR #9 — LGPD: marca de anonização no customer (soft-anonymize preserva métricas)
-- Idempotente: seguro reexecutar.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "anonymizedAt" timestamp;
