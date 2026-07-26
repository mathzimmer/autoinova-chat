import "dotenv/config";
import { getDb, mirrorEvolutionMessage, mirrorWNMessage } from "../server/db";
import { evolutionInstances, whatsappNumbers, conversations, messages } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function runTest() {
  const db = await getDb();
  if (!db) {
    console.error("Banco de dados indisponível.");
    process.exit(1);
  }

  console.log("=== INICIANDO TESTE DE ESCRITA DUPLA ===");

  console.log("1. Preparando instâncias de teste...");
  
  // Limpeza preventiva
  try {
    await db.delete(evolutionInstances).where(eq(evolutionInstances.instanceName, "teste_evo_inst"));
    await db.delete(whatsappNumbers).where(eq(whatsappNumbers.phoneNumberId, "1234567890_test"));
  } catch (err) {
    console.warn("Aviso na limpeza preventiva:", err);
  }
  
  // Criar instância temporária do Evolution
  const [evoInst] = await db.insert(evolutionInstances).values({
    instanceName: "teste_evo_inst",
    instanceId: "123456",
    status: "connected",
    phone: "5551999999999",
  }).returning();

  // Criar instância temporária do WhatsApp Multi-Number
  const [wnInst] = await db.insert(whatsappNumbers).values({
    phoneNumberId: "1234567890_test",
    displayName: "Teste Oficial",
    phoneDisplay: "5551999999999",
    isActive: true,
  }).returning();

  console.log(`Evo Instance ID: ${evoInst.id}, WN Instance ID: ${wnInst.id}`);

  const testId = Date.now().toString();

  // --- Executando Teste 1: Evolution Mirroring ---
  console.log("\n--- Executando Teste 1: Evolution Mirroring ---");
  console.log("Chamando mirrorEvolutionMessage...");
  const evoMirrorResult = await mirrorEvolutionMessage({
    instanceName: "teste_evo_inst",
    phone: "5551999999999",
    remoteJid: "5551999999999@s.whatsapp.net",
    contactName: "Cliente Teste",
    content: "Mensagem de teste Evolution",
    messageType: "text",
    direction: "inbound",
    senderName: "Cliente Teste",
    externalId: `test_msg_${testId}`,
    timestamp: Date.now(),
    rawPayload: { testKey: "testValueEvolution" },
  });

  if (!evoMirrorResult) {
    throw new Error("mirrorEvolutionMessage retornou null (esperado: objeto de sucesso)");
  }
  console.log("✅ mirrorEvolutionMessage retornou sucesso:", evoMirrorResult);

  // Verificar se a conversa foi salva nas colunas de unificação
  const evoConvDb = (await db.select().from(conversations).where(eq(conversations.id, evoMirrorResult.conversationId)).limit(1))[0];
  console.log("Conversa Unificada Criada:", {
    id: evoConvDb.id,
    phone: evoConvDb.phone,
    channel: evoConvDb.channel,
    remoteJid: evoConvDb.remoteJid,
    connectionType: evoConvDb.connectionType,
    connectionId: evoConvDb.connectionId,
  });

  if (evoConvDb.connectionType !== "evolution" || evoConvDb.connectionId !== evoInst.id) {
    throw new Error("Campos de conexão da conversa Evolution não conferem!");
  }
  console.log("   👉 Campos de unificação na tabela 'conversations' gravados com sucesso!");

  // Verificar se a mensagem foi salva nas colunas de unificação
  const evoMsgDb = (await db.select().from(messages).where(eq(messages.id, evoMirrorResult.message.id)).limit(1))[0];
  console.log("Mensagem Unificada Criada:", {
    id: evoMsgDb.id,
    content: evoMsgDb.content,
    direction: evoMsgDb.direction,
    instanceId: evoMsgDb.instanceId,
    instanceName: evoMsgDb.instanceName,
    rawPayload: evoMsgDb.rawPayload,
  });

  if (evoMsgDb.direction !== "inbound" || evoMsgDb.instanceId !== evoInst.id || evoMsgDb.instanceName !== "teste_evo_inst") {
    throw new Error("Campos de conexão da mensagem Evolution não conferem!");
  }
  console.log("   👉 Campos de unificação na tabela 'messages' gravados com sucesso!");

  // --- Executando Teste 2: WhatsApp Multi-Number Mirroring ---
  console.log("\n--- Executando Teste 2: WhatsApp Multi-Number Mirroring ---");
  console.log("Chamando mirrorWNMessage...");
  const wnMirrorResult = await mirrorWNMessage({
    whatsappNumberId: wnInst.id,
    phoneNumberId: "1234567890_test",
    customerPhone: "5551999999999",
    contactName: "Cliente Teste Oficial",
    content: "Mensagem de teste Oficial",
    messageType: "text",
    direction: "inbound",
    senderName: "Cliente Teste Oficial",
    externalId: `wn_test_wn_msg_${testId}`,
    timestamp: Date.now(),
    rawPayload: { testKey: "testValueOficial" },
  });

  if (!wnMirrorResult) {
    throw new Error("mirrorWNMessage retornou null (esperado: objeto de sucesso)");
  }
  console.log("✅ mirrorWNMessage retornou sucesso:", wnMirrorResult);

  // Verificar se a conversa foi salva nas colunas de unificação
  const wnConvDb = (await db.select().from(conversations).where(eq(conversations.id, wnMirrorResult.conversationId)).limit(1))[0];
  console.log("Conversa Unificada Criada (WN):", {
    id: wnConvDb.id,
    phone: wnConvDb.phone,
    channel: wnConvDb.channel,
    phoneNumberId: wnConvDb.phoneNumberId,
    connectionType: wnConvDb.connectionType,
    connectionId: wnConvDb.connectionId,
  });

  if (wnConvDb.connectionType !== "tech_provider" || wnConvDb.connectionId !== wnInst.id) {
    throw new Error("Campos de conexão da conversa Multi-Number não conferem!");
  }
  console.log("   👉 Campos de unificação na tabela 'conversations' gravados com sucesso!");

  // Verificar se a mensagem foi salva nas colunas de unificação
  const wnMsgDb = (await db.select().from(messages).where(eq(messages.id, wnMirrorResult.message.id)).limit(1))[0];
  console.log("Mensagem Unificada Criada (WN):", {
    id: wnMsgDb.id,
    content: wnMsgDb.content,
    direction: wnMsgDb.direction,
    instanceId: wnMsgDb.instanceId,
    instanceName: wnMsgDb.instanceName,
    rawPayload: wnMsgDb.rawPayload,
  });

  if (wnMsgDb.direction !== "inbound" || wnMsgDb.instanceId !== wnInst.id || wnMsgDb.instanceName !== "1234567890_test") {
    throw new Error("Campos de conexão da mensagem Multi-Number não conferem!");
  }
  console.log("   👉 Campos de unificação na tabela 'messages' gravados com sucesso!");

  console.log("\n4. Limpando dados de teste...");
  await db.delete(messages).where(eq(messages.id, evoMirrorResult.message.id));
  await db.delete(messages).where(eq(messages.id, wnMirrorResult.message.id));
  await db.delete(conversations).where(eq(conversations.id, evoMirrorResult.conversationId));
  await db.delete(conversations).where(eq(conversations.id, wnMirrorResult.conversationId));
  await db.delete(evolutionInstances).where(eq(evolutionInstances.id, evoInst.id));
  await db.delete(whatsappNumbers).where(eq(whatsappNumbers.id, wnInst.id));

  console.log("🧹 Limpeza concluída!");
  console.log("\n=== FIM DO TESTE ===");
  process.exit(0);
}

runTest().catch(err => {
  console.error("Erro inesperado no teste:", err);
  process.exit(1);
});
