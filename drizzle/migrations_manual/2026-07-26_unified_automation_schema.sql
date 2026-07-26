DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'routing_state') THEN
    CREATE TYPE "routing_state" AS ENUM ('flow', 'ai_agent', 'human');
  END IF;
END$$;

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "routingState" "routing_state" DEFAULT 'flow' NOT NULL;

ALTER TABLE "chatFlows" ADD COLUMN IF NOT EXISTS "connectionType" varchar;
ALTER TABLE "chatFlows" ADD COLUMN IF NOT EXISTS "connectionId" integer;
ALTER TABLE "chatFlows" ADD COLUMN IF NOT EXISTS "instanceName" varchar(100);

CREATE TABLE IF NOT EXISTS "knowledgeBase" (
  "id" serial PRIMARY KEY,
  "category" varchar(100) NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
