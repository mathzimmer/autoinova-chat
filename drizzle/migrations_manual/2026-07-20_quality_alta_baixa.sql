-- Qualidade agora é ALTA/BAIXA e SÓ o vendedor define.
-- 1) Converte os valores antigos marcados pelo vendedor
UPDATE "leads" SET "quality" = 'alta'  WHERE "quality" = 'bom'  AND "qualitySource" = 'vendedor';
UPDATE "leads" SET "quality" = 'baixa' WHERE "quality" = 'ruim' AND "qualitySource" = 'vendedor';

-- 2) Limpa o que a IA tinha decidido (ela não julga mais qualidade)
UPDATE "leads"
   SET "quality" = NULL, "qualitySource" = NULL, "qualityReason" = NULL
 WHERE "qualitySource" = 'ia';

-- 3) Sobra qualquer valor legado fora do padrão → limpa
UPDATE "leads" SET "quality" = NULL WHERE "quality" NOT IN ('alta', 'baixa');
