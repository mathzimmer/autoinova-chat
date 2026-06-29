/**
 * Script de seed: cria o primeiro usuário admin no banco de dados local.
 * Uso: pnpm tsx scripts/seed-admin.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { teamMembers } from "../drizzle/schema";
import crypto from "crypto";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definido no .env");

  const client = postgres(url);
  const db = drizzle(client);

  const email    = "admin@autoinova.com";
  const password = "Admin@2024";
  const name     = "Administrador";

  const existing = await db.select().from(teamMembers).limit(1);
  if (existing.length > 0) {
    console.log("✅ Já existe pelo menos um membro cadastrado. Nada criado.");
    console.log(`   Email:  ${existing[0].email}`);
    console.log("   Para criar mais usuários use o painel em /team");
    await client.end();
    return;
  }

  await db.insert(teamMembers).values({
    name,
    email,
    passwordHash: hashPassword(password),
    cargo: "admin",
    status: "ativo",
  });

  console.log("✅ Usuário admin criado com sucesso!");
  console.log(`   Email:    ${email}`);
  console.log(`   Senha:    ${password}`);
  console.log("   ⚠️  Altere a senha após o primeiro login em /team");

  await client.end();
}

main().catch(err => {
  console.error("❌ Erro ao criar admin:", err);
  process.exit(1);
});
