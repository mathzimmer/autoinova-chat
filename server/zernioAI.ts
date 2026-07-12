// ─── IA + Fluxos para conversas Zernio (coexistência oficial) ─────────────────
// Reusa o mesmo motor de fluxo (processFlowMessage) e de IA (processAIMessage)
// do canal oficial, mas envia a resposta pela API do Zernio. A seleção de agente
// segue a hierarquia: agente fixado na conversa → agente da instância (accountId)
// → agente do canal → agente padrão da loja.

import {
  getConversationById, listMessages, createMessage, getSetting,
  getAiAgentForInstance, getAiAgentForChannel, getDefaultAiAgent,
} from "./db";
import { processFlowMessage } from "./flowEngine";
import { processAIMessage } from "./ai";
import { zernioReply, zernioSendMedia } from "./zernioService";
import { emitNewMessage, emitTypingIndicator } from "./socket";

const BOT_NAME = "Auto Inova - IA";

export async function runZernioAI(conversationId: number, customerMessage: string): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv || conv.channel !== "zernio") return;
  if (!conv.aiActive) {
    console.log(`[ZernioAI] Conversa ${conversationId}: IA pausada, ignorando`);
    return;
  }

  const accountId = ((conv.metadata as any)?.zernioAccountId as string | undefined) || (conv as any).instanceName || undefined;
  const zConvId = (conv.metadata as any)?.zernioConversationId as string | undefined;
  if (!zConvId) {
    console.warn(`[ZernioAI] Conversa ${conversationId}: sem zernioConversationId, não é possível responder`);
    return;
  }

  // Toggles globais (mesmos do canal oficial)
  const aiEnabled = (await getSetting("ai_global_enabled")) !== "false";
  const flowsEnabled = (await getSetting("flows_global_enabled")) !== "false";
  if (!aiEnabled && !flowsEnabled) return;

  emitTypingIndicator(conversationId, true, BOT_NAME);
  try {
    // ── 1) Fluxo programado ──
    if (flowsEnabled) {
      try {
        const flowResult = await processFlowMessage({
          conversationId,
          phone: conv.phone || "",
          customerMessage,
          contactName: conv.contactName || undefined,
        });
        if (flowResult.handled) {
          for (const response of flowResult.responses) {
            const botMsg = await createMessage({ conversationId, content: response, senderType: "bot", senderName: BOT_NAME, messageType: "text" });
            emitNewMessage(conversationId, botMsg);
            await zernioReply(zConvId, response, accountId);
          }
          for (const img of flowResult.imageMessages) {
            const imgMsg = await createMessage({ conversationId, content: img.caption || "[Imagem]", senderType: "bot", senderName: BOT_NAME, messageType: "image", metadata: { mediaUrl: img.imageUrl, caption: img.caption } });
            emitNewMessage(conversationId, imgMsg);
            await zernioSendMedia(zConvId, img.imageUrl, "image", accountId, img.caption);
          }
          return; // fluxo tratou, não passa para a IA
        }
      } catch (flowErr) {
        console.error(`[ZernioAI] Conversa ${conversationId}: erro no fluxo, fallback IA:`, flowErr);
      }
    }

    if (!aiEnabled) return;

    // ── 2) Seleção de agente (fixado → instância → canal → padrão) ──
    let flowAiOptions: { agentId?: number | null } | undefined;
    if ((conv as any).agentId) {
      flowAiOptions = { agentId: (conv as any).agentId };
    } else {
      let picked = accountId ? await getAiAgentForInstance(accountId) : null;
      if (!picked) picked = await getAiAgentForChannel("zernio");
      if (!picked) picked = await getDefaultAiAgent();
      if (picked) flowAiOptions = { agentId: picked.id };
    }

    // ── 3) IA ──
    const recent = await listMessages(conversationId, 30);
    const aiResult = await processAIMessage(conv as any, recent, customerMessage, flowAiOptions);
    if (aiResult.response) {
      const botMsg = await createMessage({ conversationId, content: aiResult.response, senderType: "bot", senderName: BOT_NAME, messageType: "text" });
      emitNewMessage(conversationId, botMsg);
      await zernioReply(zConvId, aiResult.response, accountId);

      // Imagens de veículo sugeridas pela IA
      if (aiResult.interactiveMessages && aiResult.interactiveMessages.length > 0) {
        for (const im of aiResult.interactiveMessages) {
          if (im.type === "image" && (im as any).imageUrl) {
            const url = (im as any).imageUrl as string;
            const caption = (im as any).caption || (im as any).body || "";
            const imgMsg = await createMessage({ conversationId, content: caption || "[Imagem do veículo]", senderType: "bot", senderName: BOT_NAME, messageType: "image", metadata: { mediaUrl: url, caption } });
            emitNewMessage(conversationId, imgMsg);
            await zernioSendMedia(zConvId, url, "image", accountId, caption);
          }
        }
      }
    }
  } finally {
    emitTypingIndicator(conversationId, false, BOT_NAME);
  }
}
