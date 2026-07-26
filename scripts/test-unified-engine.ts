import "dotenv/config";
import { getDb } from "../server/db";
import { chatFlows, chatFlowNodes, conversations, users, knowledgeBase } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { findMatchingFlow } from "../server/flowEngine";
import { interpolateSystemVariables, getKnowledgeBaseContext } from "../server/ai";

async function runTest() {
  const db = await getDb();
  if (!db) {
    console.error("Banco de dados indisponível.");
    process.exit(1);
  }

  console.log("=== INICIANDO TESTES DE INTEGRAÇÃO DE AUTOMAÇÕES UNIFICADAS ===");

  // --- 1. Testar Roteamento de Fluxo por Instância ---
  console.log("\n1. Testando roteamento de fluxos por instância...");

  // Criar usuário temporário para vendedor
  const [testUser] = await db.insert(users).values({
    openId: "test_open_id_automations",
    name: "Vendedor Teste",
    email: "vendedor_teste@autoinova.com",
    role: "user",
  }).returning();

  // Criar conversa temporária pertencente a "instancia_teste_vendas" (Evolution)
  const [testConv] = await db.insert(conversations).values({
    phone: "5551988888888",
    contactName: "Mateus Comprador",
    channel: "evolution" as any,
    instanceName: "instancia_teste_vendas",
    connectionType: "evolution",
    routingState: "flow",
    assignedTo: testUser.id,
  }).returning();

  // Criar fluxo específico da Instância "instancia_teste_vendas"
  const [flowSpecific] = await db.insert(chatFlows).values({
    name: "Fluxo Específico da Instância",
    active: true,
    trigger: "keyword",
    triggerValue: "testar_fluxo",
    connectionType: "evolution",
    instanceName: "instancia_teste_vendas",
  }).returning();

  // Criar nó start para o fluxo
  await db.insert(chatFlowNodes).values({
    flowId: flowSpecific.id,
    nodeType: "start",
    data: {},
  });

  // Criar fluxo Global (com a mesma palavra-chave)
  const [flowGlobal] = await db.insert(chatFlows).values({
    name: "Fluxo Global do Sistema",
    active: true,
    trigger: "keyword",
    triggerValue: "testar_fluxo",
  }).returning();

  // Criar nó start para o fluxo global
  await db.insert(chatFlowNodes).values({
    flowId: flowGlobal.id,
    nodeType: "start",
    data: {},
  });

  console.log(`Criados: Fluxo Específico (ID: ${flowSpecific.id}) e Fluxo Global (ID: ${flowGlobal.id})`);

  // Caso 1: Conversa pertence à instância "instancia_teste_vendas". Deve casar o fluxo específico!
  const matchedFlowForSpecific = await findMatchingFlow(
    testConv.id,
    "Quero testar_fluxo agora",
    false,
    false
  );
  console.log(`Matched flow para conversa específica: ${matchedFlowForSpecific} (Esperado: ${flowSpecific.id})`);
  if (matchedFlowForSpecific !== flowSpecific.id) {
    throw new Error("O roteamento não preferenciou o fluxo da instância específica!");
  }
  console.log("✅ Roteamento específico por instância funcionando!");

  // Caso 2: Conversa com canal neutro/global. Deve casar o fluxo global!
  const [neutralConv] = await db.insert(conversations).values({
    phone: "5551977777777",
    contactName: "Comprador Neutro",
    channel: "whatsapp" as any,
    routingState: "flow",
  }).returning();

  const matchedFlowForGlobal = await findMatchingFlow(
    neutralConv.id,
    "Quero testar_fluxo agora",
    false,
    false
  );
  console.log(`Matched flow para conversa neutra: ${matchedFlowForGlobal} (Esperado: ${flowGlobal.id})`);
  if (matchedFlowForGlobal !== flowGlobal.id) {
    throw new Error("O roteamento de fluxo global falhou para conversa neutra!");
  }
  console.log("✅ Roteamento global de fluxo funcionando!");

  // --- 2. Testar Substituição de Variáveis Dinâmicas no Prompt ---
  console.log("\n2. Testando substituição de variáveis dinâmicas...");
  const promptTemplate = "Olá {{cliente_nome}}! Eu sou o vendedor {{vendedor_nome}} da loja {{loja_nome}}. Nosso endereço é {{loja_endereco}} e funcionamos das {{horario_funcionamento}}.";

  const interpolated = await interpolateSystemVariables(promptTemplate, testConv);
  console.log("Template original:", promptTemplate);
  console.log("Template interpolado:", interpolated);

  if (!interpolated.includes("Mateus Comprador")) throw new Error("cliente_nome não foi interpolado!");
  if (!interpolated.includes("Vendedor Teste")) throw new Error("vendedor_nome não foi interpolado!");
  console.log("✅ Interpolação de variáveis dinâmicas funcionando!");

  // --- 3. Testar Busca na Base de Conhecimento (RAG) ---
  console.log("\n3. Testando RAG / Busca na Base de Conhecimento...");
  // Inserir FAQ temporário
  const [kbFaq] = await db.insert(knowledgeBase).values({
    category: "faq",
    title: "Qual o horário de funcionamento?",
    content: "Nossa loja funciona de Segunda a Sexta das 8h às 19h e Sábado das 9h às 13h.",
    isActive: true,
  }).returning();

  const kbContext = await getKnowledgeBaseContext("Oi, qual o horario de voces?");
  console.log("Contexto de Conhecimento retornado:", kbContext);
  if (!kbContext.includes("8h às 19h")) {
    throw new Error("A Base de Conhecimento não encontrou o FAQ correspondente!");
  }
  console.log("✅ RAG / Base de Conhecimento funcionando!");

  // --- Limpeza ---
  console.log("\n4. Limpando dados de teste...");
  await db.delete(chatFlowNodes).where(eq(chatFlowNodes.flowId, flowSpecific.id));
  await db.delete(chatFlowNodes).where(eq(chatFlowNodes.flowId, flowGlobal.id));
  await db.delete(chatFlows).where(eq(chatFlows.id, flowSpecific.id));
  await db.delete(chatFlows).where(eq(chatFlows.id, flowGlobal.id));
  await db.delete(conversations).where(eq(conversations.id, testConv.id));
  await db.delete(conversations).where(eq(conversations.id, neutralConv.id));
  await db.delete(users).where(eq(users.id, testUser.id));
  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, kbFaq.id));
  console.log("🧹 Limpeza concluída com sucesso!");

  console.log("\n=== TODOS OS TESTES PASSARAM COM SUCESSO! ===");
  process.exit(0);
}

runTest().catch(err => {
  console.error("Erro inesperado no teste:", err);
  process.exit(1);
});
