-- Gatilhos de CRM para fluxos: etiqueta adicionada/removida e entrada em etapa do funil.
-- ALTER TYPE ... ADD VALUE é idempotente com IF NOT EXISTS (Postgres 12+).
ALTER TYPE "flow_trigger" ADD VALUE IF NOT EXISTS 'tag_added';
ALTER TYPE "flow_trigger" ADD VALUE IF NOT EXISTS 'tag_removed';
ALTER TYPE "flow_trigger" ADD VALUE IF NOT EXISTS 'funnel_stage_entered';
