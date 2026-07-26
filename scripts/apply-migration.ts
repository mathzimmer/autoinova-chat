import "dotenv/config";
import postgres from "postgres";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL não configurada no .env");
    process.exit(1);
  }

  console.log("Conectando ao banco de dados...");
  const sql = postgres(connectionString, { ssl: "require" });

  try {
    const migrationPath = path.resolve(__dirname, "../drizzle/migrations_manual/2026-07-26_unified_columns.sql");
    console.log(`Lendo arquivo de migração: ${migrationPath}`);
    const query = fs.readFileSync(migrationPath, "utf8");

    console.log("Aplicando migração manual no banco de dados...");
    await sql.unsafe(query);
    console.log("✅ Migração aplicada com sucesso!");
  } catch (err) {
    console.error("❌ Falha ao aplicar migração:", err);
  } finally {
    await sql.end();
  }
}

run();
