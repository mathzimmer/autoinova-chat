-- PR A3: estado "handed_off" (atendimento transferido pela IA para o vendedor).
-- Diferente de "human" (assumido manualmente pelo operador) e de aiActive=false.
ALTER TYPE "routing_state" ADD VALUE IF NOT EXISTS 'handed_off';
