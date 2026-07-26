import "dotenv/config";
import { getDb } from "../server/db";
import { conversations, messages, evolutionConversations, evolutionMessages, whatsappNumberConversations, whatsappNumberMessages } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

async function runBackfill() {
  const db = await getDb();
  if (!db) {
    console.error("Banco de dados indisponível.");
    process.exit(1);
  }

  console.log("=== INICIANDO CARGA HISTÓRICA (BACKFILL) ===");

  // --- 1. Evolution Conversations Backfill ---
  console.log("\n1. Carregando conversas do Evolution...");
  const evoConvs = await db.select().from(evolutionConversations);
  console.log(`Encontradas ${evoConvs.length} conversas no Evolution.`);

  let evoConvCopied = 0;
  let evoMsgCopied = 0;

  for (const evoConv of evoConvs) {
    try {
      // Verificar se já existe na tabela unificada (por channel=evolution e instanceName + remoteJid)
      let convRecord = (await db.select().from(conversations).where(and(
        eq(conversations.channel, "evolution" as any),
        eq(conversations.instanceName, evoConv.instanceName),
        eq(conversations.remoteJid, evoConv.remoteJid),
      )).limit(1))[0];

      if (!convRecord) {
        // Copiar conversa
        const inserted = await db.insert(conversations).values({
          phone: evoConv.phone || "5551999999999", // fallback seguro
          contactName: evoConv.contactName || null,
          contactPhoto: evoConv.contactPhoto || null,
          channel: "evolution" as any,
          instanceName: evoConv.instanceName,
          status: evoConv.status as any,
          unreadCount: evoConv.unreadCount || 0,
          lastMessageAt: evoConv.lastMessageAt || Date.now(),
          lastMessagePreview: evoConv.lastMessagePreview || "",
          metadata: evoConv.notes ? { notes: evoConv.notes } : undefined,
          // Novos campos
          remoteJid: evoConv.remoteJid,
          connectionType: "evolution",
          connectionId: evoConv.instanceId,
          tags: evoConv.tags || [],
        }).returning();
        convRecord = inserted[0];
        evoConvCopied++;
      }

      // Agora copiar as mensagens dessa conversa
      const evoMsgs = await db.select().from(evolutionMessages).where(eq(evolutionMessages.conversationId, evoConv.id));
      for (const evoMsg of evoMsgs) {
        // Evitar duplicar mensagens por externalId
        const extId = evoMsg.messageId ? `evo_${evoMsg.messageId}` : undefined;
        let msgRecord;
        if (extId) {
          msgRecord = (await db.select().from(messages).where(eq(messages.externalId, extId)).limit(1))[0];
        }

        if (!msgRecord) {
          const typeMap: Record<string, string> = { sticker: "image", reaction: "text" };
          const mappedType = typeMap[evoMsg.messageType] || evoMsg.messageType;

          await db.insert(messages).values({
            conversationId: convRecord.id,
            content: evoMsg.content || "",
            senderType: evoMsg.direction === "inbound" ? "customer" : "agent",
            senderName: evoMsg.senderName || (evoMsg.direction === "inbound" ? "Cliente" : "Atendente"),
            messageType: mappedType as any,
            metadata: evoMsg.mediaUrl ? { mediaUrl: evoMsg.mediaUrl } : undefined,
            externalId: extId,
            status: evoMsg.status as any,
            // Novos campos
            direction: evoMsg.direction,
            instanceId: evoMsg.instanceId,
            instanceName: evoMsg.instanceName,
          });
          evoMsgCopied++;
        }
      }
    } catch (err) {
      console.error(`Erro ao migrar conversa Evolution ID ${evoConv.id}:`, err);
    }
  }

  console.log(`Concluído Evolution: ${evoConvCopied} conversas e ${evoMsgCopied} mensagens copiadas/sincronizadas.`);

  // --- 2. WhatsApp Multi-Number Backfill ---
  console.log("\n2. Carregando conversas do WhatsApp Multi-Number...");
  const wnConvs = await db.select().from(whatsappNumberConversations);
  console.log(`Encontradas ${wnConvs.length} conversas no WhatsApp Multi-Number.`);

  let wnConvCopied = 0;
  let wnMsgCopied = 0;

  for (const wnConv of wnConvs) {
    try {
      // Verificar se já existe na tabela unificada (por channel=whatsapp e phoneNumberId + customerPhone)
      let convRecord = (await db.select().from(conversations).where(and(
        eq(conversations.channel, "whatsapp" as any),
        eq(conversations.phoneNumberId, wnConv.phoneNumberId),
        eq(conversations.phone, wnConv.customerPhone),
      )).limit(1))[0];

      if (!convRecord) {
        // Copiar conversa
        const inserted = await db.insert(conversations).values({
          phone: wnConv.customerPhone,
          contactName: wnConv.contactName || null,
          contactPhoto: wnConv.contactPhoto || null,
          channel: "whatsapp" as any,
          instanceName: wnConv.phoneNumberId, // phoneNumberId é o identificador
          status: wnConv.status as any,
          unreadCount: wnConv.unreadCount || 0,
          lastMessageAt: wnConv.lastMessageAt || Date.now(),
          lastMessagePreview: wnConv.lastMessagePreview || "",
          metadata: wnConv.notes ? { notes: wnConv.notes } : undefined,
          // Novos campos
          phoneNumberId: wnConv.phoneNumberId,
          connectionType: "tech_provider",
          connectionId: wnConv.whatsappNumberId,
          tags: wnConv.tags || [],
        }).returning();
        convRecord = inserted[0];
        wnConvCopied++;
      }

      // Agora copiar as mensagens dessa conversa
      const wnMsgs = await db.select().from(whatsappNumberMessages).where(eq(whatsappNumberMessages.conversationId, wnConv.id));
      for (const wnMsg of wnMsgs) {
        const extId = wnMsg.externalMessageId ? `wn_${wnMsg.externalMessageId}` : undefined;
        let msgRecord;
        if (extId) {
          msgRecord = (await db.select().from(messages).where(eq(messages.externalId, extId)).limit(1))[0];
        }

        if (!msgRecord) {
          const typeMap: Record<string, string> = { sticker: "image", reaction: "text" };
          const mappedType = typeMap[wnMsg.messageType] || wnMsg.messageType;

          await db.insert(messages).values({
            conversationId: convRecord.id,
            content: wnMsg.content || "",
            senderType: wnMsg.direction === "inbound" ? "customer" : "agent",
            senderName: wnMsg.senderName || (wnMsg.direction === "inbound" ? "Cliente" : "Atendente"),
            messageType: mappedType as any,
            metadata: wnMsg.mediaUrl ? { mediaUrl: wnMsg.mediaUrl } : undefined,
            externalId: extId,
            status: wnMsg.status as any,
            // Novos campos
            direction: wnMsg.direction,
            instanceId: wnMsg.whatsappNumberId,
            instanceName: wnConv.phoneNumberId,
            rawPayload: wnMsg.rawPayload,
          });
          wnMsgCopied++;
        }
      }
    } catch (err) {
      console.error(`Erro ao migrar conversa Multi-Number ID ${wnConv.id}:`, err);
    }
  }

  console.log(`Concluído Multi-Number: ${wnConvCopied} conversas e ${wnMsgCopied} mensagens copiadas/sincronizadas.`);
  console.log("\n=== CARGA HISTÓRICA CONCLUÍDA COM SUCESSO ===");
  process.exit(0);
}

runBackfill().catch(err => {
  console.error("Erro inesperado no backfill:", err);
  process.exit(1);
});
