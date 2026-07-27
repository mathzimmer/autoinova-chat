-- Condições "Somente se" nos fluxos (grupos E/OU).
ALTER TABLE "chatFlows" ADD COLUMN IF NOT EXISTS "conditions" jsonb;
