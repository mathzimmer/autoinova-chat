-- Dono (vendedor) da instância Zernio — restringe o inbox do vendedor à instância dele.
ALTER TABLE "zernioInstances" ADD COLUMN IF NOT EXISTS "assignedUserId" integer;
