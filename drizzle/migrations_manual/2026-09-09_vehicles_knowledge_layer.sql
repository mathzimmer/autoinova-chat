-- Vehicle Knowledge Layer — Fases 1 e 2 (ADITIVO, não destrói nada).
--
-- F1: colunas motor/potencia (já vêm no feed, eram descartadas), internalStatus
--     (status INTERNO, separado do `available` do feed — o sync NÃO mexe nele) e
--     índices de busca. F2: featuresCanon (tags canônicas de opcionais).
--
-- Importante: o sync (stockSync.ts) só faz UPDATE das colunas do feed, então
-- internalStatus é preservado a cada sincronização.
--
-- Rollback:
--   ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "motor";
--   ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "potencia";
--   ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "internalStatus";
--   ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "featuresCanon";

ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "motor"          varchar(60);
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "potencia"       varchar(30);
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "internalStatus" varchar(20) DEFAULT 'disponivel';
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "featuresCanon"  jsonb;

-- Índices de busca (o agente filtra por estes campos).
CREATE INDEX IF NOT EXISTS "vehicles_available_idx"     ON "vehicles" ("available");
CREATE INDEX IF NOT EXISTS "vehicles_price_idx"         ON "vehicles" ("price");
CREATE INDEX IF NOT EXISTS "vehicles_year_idx"          ON "vehicles" ("year");
CREATE INDEX IF NOT EXISTS "vehicles_mileage_idx"       ON "vehicles" ("mileage");
CREATE INDEX IF NOT EXISTS "vehicles_brand_idx"         ON "vehicles" ("brand");
CREATE INDEX IF NOT EXISTS "vehicles_transmission_idx"  ON "vehicles" ("transmission");
CREATE INDEX IF NOT EXISTS "vehicles_internalstatus_idx" ON "vehicles" ("internalStatus");
-- Composto: o filtro mais comum é "disponível dentro de uma faixa de preço".
CREATE INDEX IF NOT EXISTS "vehicles_available_price_idx" ON "vehicles" ("available", "price");
-- GIN para consultas por tag de opcional (featuresCanon @> '["teto_solar"]').
CREATE INDEX IF NOT EXISTS "vehicles_featurescanon_gin" ON "vehicles" USING gin ("featuresCanon");
