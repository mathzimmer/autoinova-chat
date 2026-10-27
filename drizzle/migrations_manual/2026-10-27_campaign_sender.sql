-- Campanhas: número oficial de envio (phone_number_id). Null = número padrão do .env.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "senderPhoneNumberId" varchar(64);
