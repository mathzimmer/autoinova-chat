-- PR #8 — tipos numéricos em leads + enum de funil compartilhado em leadOpportunities
-- 100% idempotente: seguro reexecutar (deploy.sh roda todas as migrations em ordem
-- e já envolve cada arquivo em transação própria).

-- 1) Colunas tipadas novas em leads (backfill abaixo)
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "tradeYearInt" integer;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "tradeKmInt" integer;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "downPaymentCents" integer;

-- 2) Backfill best-effort a partir das varchar legadas (espelha server/fieldParsing.ts)

-- Ano da troca: primeiro (19|20)xx da string, validado em 1950..2030
UPDATE "leads"
SET "tradeYearInt" = substring("tradeYear" from '(19|20)\d{2}')::integer
WHERE "tradeYearInt" IS NULL
  AND "tradeYear" ~ '(19|20)\d{2}'
  AND substring("tradeYear" from '(19|20)\d{2}')::integer BETWEEN 1950 AND 2030;

-- Km da troca: "150 mil" → 150000; senão só os dígitos (clamp p/ não estourar integer)
UPDATE "leads"
SET "tradeKmInt" = LEAST(
  NULLIF(regexp_replace("tradeKm", '\D', '', 'g'), '')::numeric
    * CASE WHEN "tradeKm" ~* 'mil'
            AND NULLIF(regexp_replace("tradeKm", '\D', '', 'g'), '')::numeric < 1000
        THEN 1000 ELSE 1 END,
  2147483647
)::integer
WHERE "tradeKmInt" IS NULL
  AND "tradeKm" IS NOT NULL
  AND NULLIF(regexp_replace("tradeKm", '\D', '', 'g'), '') IS NOT NULL;

-- Entrada em centavos: termina com ,\d{1,2} → dígitos já são centavos;
-- "mil" com n<1000 → n×100000; senão dígitos×100 (clamp p/ não estourar integer)
UPDATE "leads"
SET "downPaymentCents" = LEAST(
  CASE
    WHEN "downPayment" ~ ',\d{1,2}\s*$'
      THEN NULLIF(regexp_replace("downPayment", '\D', '', 'g'), '')::numeric
    WHEN "downPayment" ~* 'mil'
         AND NULLIF(regexp_replace("downPayment", '\D', '', 'g'), '')::numeric < 1000
      THEN NULLIF(regexp_replace("downPayment", '\D', '', 'g'), '')::numeric * 100000
    ELSE NULLIF(regexp_replace("downPayment", '\D', '', 'g'), '')::numeric * 100
  END,
  2147483647
)::integer
WHERE "downPaymentCents" IS NULL
  AND "downPayment" IS NOT NULL
  AND NULLIF(regexp_replace("downPayment", '\D', '', 'g'), '') IS NOT NULL;

-- 3) leadOpportunities.funnelStatus: varchar(50) → enum compartilhado funnel_status
-- Só converte se a coluna ainda NÃO for do tipo enum (idempotente).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leadOpportunities'
      AND column_name = 'funnelStatus'
      AND data_type <> 'USER-DEFINED'
  ) THEN
    -- o default varchar ('novo') não converte sozinho: derruba antes, recria depois
    ALTER TABLE "leadOpportunities" ALTER COLUMN "funnelStatus" DROP DEFAULT;
    -- valores fora do enum viram 'novo' (fallback seguro)
    ALTER TABLE "leadOpportunities"
      ALTER COLUMN "funnelStatus" TYPE funnel_status
      USING (
        CASE
          WHEN "funnelStatus" = ANY(ENUM_RANGE(NULL::funnel_status)::text[])
            THEN "funnelStatus"
          ELSE 'novo'
        END
      )::funnel_status;
    ALTER TABLE "leadOpportunities"
      ALTER COLUMN "funnelStatus" SET DEFAULT 'novo'::funnel_status;
  END IF;
END $$;
