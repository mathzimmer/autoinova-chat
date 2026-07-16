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
import { zernioReply, zernioSendMedia, zernioSendButtons, zernioSendList } from "./zernioService";
import { emitNewMessage, emitTypingIndicator } from "./socket";
import { getDebounceDelay } from "./messageDebounce";

const BOT_NAME = "Auto Inova - IA";

// ─── Debounce por conversa ────────────────────────────────────────────────────
// Cliente que manda 3 mensagens em rajada (ex.: "id", "Valor", "Vamor") acionava
// o fluxo 3x → saudação/carro/imagens repetidos. Agrupamos as mensagens numa
// janela curta e disparamos o processamento UMA vez com o texto combinado.
const zernioBuffers = new Map<number, { timer: ReturnType<typeof setTimeout>; parts: string[] }>();

export function runZernioAI(conversationId: number, customerMessage: string): void {
  const delay = getDebounceDelay();
  const existing = zernioBuffers.get(conversationId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.parts.push(customerMessage);
    console.log(`[ZernioAI] Conversa ${conversationId}: ${existing.parts.length} mensagens agrupadas, resetando timer (${delay}ms)`);
  } else {
    zernioBuffers.set(conversationId, { timer: null as any, parts: [customerMessage] });
    console.log(`[ZernioAI] Conversa ${conversationId}: iniciando debounce (${delay}ms)`);
  }
  const entry = zernioBuffers.get(conversationId)!;
  entry.timer = setTimeout(() => {
    const grouped = entry.parts.join("\n").trim();
    zernioBuffers.delete(conversationId);
    processZernioConversation(conversationId, grouped).catch((e) =>
      console.error(`[ZernioAI] Conversa ${conversationId}: erro no processamento:`, e)
    );
  }, delay);
}

async function processZernioConversation(conversationId: number, customerMessage: string): Promise<void> {
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
    // Remetente Zernio: o motor de fluxo envia por aqui (evita disparar a Matriz)
    const zSender = {
      text: (b: string) => zernioReply(zConvId, b, accountId),
      image: (url: string, caption?: string) => zernioSendMedia(zConvId, url, "image", accountId, caption),
      buttons: (b: string, buttons: Array<{ id: string; title: string }>) => zernioSendButtons(zConvId, b, buttons, accountId),
      list: (b: string, buttonText: string, sections: any) => zernioSendList(zConvId, b, buttonText, sections, accountId),
    };

    // ── 1) Fluxo programado ── (o fluxo ENVIA via zSender; aqui só persistimos+emitimos)
    if (flowsEnabled) {
      try {
        const flowResult = await processFlowMessage({
          conversationId,
          phone: conv.phone || "",
          customerMessage,
          contactName: conv.contactName || undefined,
          sender: zSender,
        });
        if (flowResult.handled) {
          for (const response of flowResult.responses) {
            const botMsg = await createMessage({ conversationId, content: response, senderType: "bot", senderName: BOT_NAME, messageType: "text" });
            emitNewMessage(conversationId, botMsg);
          }
          for (const img of flowResult.imageMessages) {
            const imgMsg = await createMessage({ conversationId, content: img.caption || "[Imagem]", senderType: "bot", senderName: BOT_NAME, messageType: "image", metadata: { mediaUrl: img.imageUrl, caption: img.caption } });
            emitNewMessage(conversationId, imgMsg);
          }
          for (const im of flowResult.interactiveMessages) {
            const body = (im as any).data?.body || "";
            const imMsg = await createMessage({ conversationId, content: body || "[Mensagem interativa]", senderType: "bot", senderName: BOT_NAME, messageType: "text", metadata: { interactiveType: im.type, interactiveData: (im as any).data } });
            emitNewMessage(conversationId, imMsg);
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
