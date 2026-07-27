import "dotenv/config";
import { getDb, upsertSetting, getSetting } from "../server/db";
import { conversations, users, labels, conversationLabels } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { applyAutoTagging } from "../server/ai";

async function runTest() {
  const db = await getDb();
  if (!db) {
    console.error("Banco indisponível.");
    process.exit(1);
  }

  console.log("=== TESTANDO PARAMETRIZAÇÃO DA IA DO CRM & AUTO-TAGGING ===");

  // 1. Salvar configuração personalizada da IA do CRM
  const testConfig = {
    temperatureMap: {
      novo: "frio",
      interesse_definido: "morno",
      dados_pessoais: "muito_quente",
    },
    autoTags: [
      { keyword: "financiar", tag: "Simulação Financiamento" },
      { keyword: "usado", tag: "Com Troca" },
    ],
    timelineLogging: {
      logStageChange: true,
      logDataCollected: true,
      logOnSellerTransfer: true,
      noteStyle: "detalhado",
    },
    stockRules: {
      preferSameStore: true,
      requirePhoto: false,
      autoSearchOnVehicleInterest: true,
    },
  };

  await upsertSetting("ai_crm_config", JSON.stringify(testConfig), 1);
  console.log("✅ Configuração ai_crm_config salva com sucesso no banco de dados.");

  // 2. Ler e validar configuração
  const rawSaved = await getSetting("ai_crm_config");
  const parsed = JSON.parse(rawSaved || "{}");
  if (parsed.temperatureMap?.dados_pessoais !== "muito_quente") {
    throw new Error("Falha ao salvar temperatureMap customizado!");
  }
  console.log("✅ Configuração lida com sucesso do banco.");

  // 3. Testar Auto-Etiquetagem por palavra-chave na conversa
  const [testConv] = await db.insert(conversations).values({
    phone: "5551966666666",
    contactName: "Cliente Teste CRM IA",
    channel: "whatsapp" as any,
  }).returning();

  console.log(`Conversa de teste criada (ID: ${testConv.id})`);

  // Simular mensagem do cliente contendo "financiar" e "usado"
  await applyAutoTagging(testConv.id, "Quero financiar um carro e tenho um usado na troca");

  // Verificar se as etiquetas foram criadas e associadas
  const assigned = await db.select({ labelId: conversationLabels.labelId })
    .from(conversationLabels)
    .where(eq(conversationLabels.conversationId, testConv.id));

  console.log(`Etiquetas atribuídas à conversa: ${assigned.length}`);
  if (assigned.length !== 2) {
    throw new Error(`Esperava 2 etiquetas atribuídas automaticamente, mas encontrou ${assigned.length}`);
  }
  console.log("✅ Auto-etiquetagem por palavra-chave funcionou com sucesso!");

  // Limpeza
  await db.delete(conversationLabels).where(eq(conversationLabels.conversationId, testConv.id));
  await db.delete(conversations).where(eq(conversations.id, testConv.id));
  console.log("🧹 Dados temporários de teste limpos.");

  console.log("\n=== TODOS OS TESTES PASSARAM COM SUCESSO! ===");
  process.exit(0);
}

runTest().catch(err => {
  console.error("Erro no teste de parametrização CRM IA:", err);
  process.exit(1);
});
