// ─── Números de API Oficial adicionais (multi-número unificado no inbox) ──────
// Cada número registrado em whatsappNumbers vira uma "instância" com aba própria.
// As mensagens entram na tabela principal (channel whatsapp + instanceName =
// phoneNumberId) e a IA/fluxos respondem enviando pelo token daquele número.

import {
  mirrorOfficialMessage, getConversationById, listMessages, createMessage, getSetting,
  getAiAgentForInstance, getAiAgentForChannel, getDefaultAiAgent,
} from "./db";
import { processWhatsAppMedia } from "./media";
import { getMediaUrl } from "./whatsapp";
import { processFlowMessage } from "./flowEngine";
import { processAIMessage } from "./ai";
import { sendTextFromNumber, sendMediaFromNumber, markAsReadFromNumber, sendButtonsFromNumber, sendListFromNumber } from "./whatsappMultiNumber";
import { transcribeAudio } from "./_core/voiceTranscription";
import { emitNewMessage, emitConversationUpdate, emitTypingIndicator } from "./socket";

const BOT_NAME = "Auto Inova - IA";

/** Processa um webhook da Meta destinado a um número oficial registrado. */
export async function handleOfficialMessage(body: any, phoneNumberId: string): Promise<boolean> {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return false;

  const contact = value?.contacts?.[0];
  const phone = msg.from;
  const name = contact?.profile?.name || "Cliente";
  const whatsappMessageId = msg.id;

  let content = "";
  let messageType: "text" | "audio" | "image" | "document" | "video" = "text";
  let mediaUrl: string | undefined;
  let transcript: string | undefined;

  try {
    if (msg.type === "text") {
      content = msg.text?.body || "";
    } else if (msg.type === "audio") {
      messageType = "audio";
      const mediaId = msg.audio?.id;
      const mime = msg.audio?.mime_type;
      if (mediaId) {
        const s3 = await processWhatsAppMedia(mediaId, "audio", mime);
        mediaUrl = s3?.url || (await getMediaUrl(mediaId)) || undefined;
      }
      content = "[Mensagem de áudio]";
      if (mediaUrl) {
        try {
          const t = await transcribeAudio({ audioUrl: mediaUrl, language: "pt", prompt: "Transcrever mensagem de voz do cliente sobre veículos e automóveis" });
          if (t && "text" in t && t.text) { transcript = t.text; content = t.text; }
        } catch (e) { console.error("[Official] transcrição falhou:", e); }
      }
    } else if (msg.type === "image") {
      messageType = "image";
      const mediaId = msg.image?.id;
      const mime = msg.image?.mime_type;
      if (mediaId) { const s3 = await processWhatsAppMedia(mediaId, "image", mime); mediaUrl = s3?.url; }
      content = msg.image?.caption || "[Imagem recebida]";
    } else if (msg.type === "video") {
      messageType = "video";
      const mediaId = msg.video?.id;
      const mime = msg.video?.mime_type;
      if (mediaId) { const s3 = await processWhatsAppMedia(mediaId, "video" as any, mime); mediaUrl = s3?.url; }
      content = msg.video?.caption || "[Vídeo recebido]";
    } else if (msg.type === "document") {
      messageType = "document";
      const mediaId = msg.document?.id;
      const mime = msg.document?.mime_type;
      if (mediaId) { const s3 = await processWhatsAppMedia(mediaId, "document", mime); mediaUrl = s3?.url; }
      content = `[Documento: ${msg.document?.filename || "arquivo"}]`;
    } else if (msg.type === "interactive") {
      const it = msg.interactive?.type;
      content = it === "button_reply" ? (msg.interactive?.button_reply?.title || "")
        : it === "list_reply" ? (msg.interactive?.list_reply?.title || "")
        : `[Resposta interativa]`;
    } else {
      content = `[${msg.type}]`;
    }
  } catch (err) {
    console.error("[Official] erro ao parsear mensagem:", err);
  }

  if (whatsappMessageId) markAsReadFromNumber(phoneNumberId, whatsappMessageId).catch(() => {});

  const result = await mirrorOfficialMessage({
    phoneNumberId, phone, contactName: name, content, transcript,
    messageType, direction: "inbound", senderName: name || phone || "Cliente",
    mediaUrl, externalId: whatsappMessageId, timestamp: Date.now(),
  });

  if (result) {
    emitNewMessage(result.conversationId, result.message);
    emitConversationUpdate(result.conversationId, {});
    // Detecta origem do lead (portal/anúncio) e etiqueta
    try { const { applyLeadOrigin } = await import("./db"); applyLeadOrigin(result.conversationId, content).catch(() => {}); } catch { /* noop */ }
    runOfficialAI(result.conversationId, transcript || content, phoneNumberId).catch((e) =>
      console.error("[Official] runOfficialAI falhou:", e)
    );
  }
  return true;
}

/** IA + fluxos para uma conversa de número oficial, respondendo pelo token do número. */
export async function runOfficialAI(conversationId: number, customerMessage: string, phoneNumberId: string): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv || !conv.phone) return;

  // Fluxos rodam independente do aiActive (freio de emergência flows_global_enabled).
  // A IA "livre" é liberada mais abaixo, só se a conversa estiver com aiActive.
  const flowsEnabled = (await getSetting("flows_global_enabled")) !== "false";

  emitTypingIndicator(conversationId, true, BOT_NAME);
  try {
    // Remetente pelo token deste número (evita disparar a Matriz)
    const oSender = {
      text: (b: string) => sendTextFromNumber(phoneNumberId, conv.phone!, b),
      image: (url: string, caption?: string) => sendMediaFromNumber(phoneNumberId, conv.phone!, url, "image", caption),
      buttons: (b: string, buttons: Array<{ id: string; title: string }>) => sendButtonsFromNumber(phoneNumberId, conv.phone!, b, buttons),
      list: (b: string, buttonText: string, sections: any) => sendListFromNumber(phoneNumberId, conv.phone!, b, buttonText, sections),
    };

    if (flowsEnabled) {
      try {
        const flowResult = await processFlowMessage({ conversationId, phone: conv.phone, customerMessage, contactName: conv.contactName || undefined, sender: oSender });
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
          return;
        }
      } catch (flowErr) { console.error(`[Official] erro no fluxo, fallback IA:`, flowErr); }
    }

    // IA "livre" só entra se: aiActive E a conexão permitir (IA automática ligada) OU
    // a IA foi escolhida explicitamente (fluxo/atendente). Nunca mais "globalmente".
    const freshConv = await getConversationById(conversationId);
    const { isConnectionAiAllowed } = await import("./db");
    if (!freshConv?.aiActive || !(await isConnectionAiAllowed(freshConv))) return;

    let flowAiOptions: { agentId?: number | null } | undefined;
    if ((conv as any).agentId) {
      flowAiOptions = { agentId: (conv as any).agentId };
    } else {
      let picked = await getAiAgentForInstance(phoneNumberId);
      if (!picked) picked = await getAiAgentForChannel("whatsapp");
      if (!picked) picked = await getDefaultAiAgent();
      if (picked) flowAiOptions = { agentId: picked.id };
    }

    const recent = await listMessages(conversationId, 30);
    const aiResult = await processAIMessage(conv as any, recent, customerMessage, flowAiOptions);
    if (aiResult.response) {
      const botMsg = await createMessage({ conversationId, content: aiResult.response, senderType: "bot", senderName: BOT_NAME, messageType: "text" });
      emitNewMessage(conversationId, botMsg);
      await sendTextFromNumber(phoneNumberId, conv.phone, aiResult.response);

      if (aiResult.interactiveMessages && aiResult.interactiveMessages.length > 0) {
        for (const im of aiResult.interactiveMessages) {
          if (im.type === "image" && (im as any).imageUrl) {
            const url = (im as any).imageUrl as string;
            const caption = (im as any).caption || (im as any).body || "";
            const imgMsg = await createMessage({ conversationId, content: caption || "[Imagem do veículo]", senderType: "bot", senderName: BOT_NAME, messageType: "image", metadata: { mediaUrl: url, caption } });
            emitNewMessage(conversationId, imgMsg);
            await sendMediaFromNumber(phoneNumberId, conv.phone, url, "image", caption);
          }
        }
      }
    }
  } finally {
    emitTypingIndicator(conversationId, false, BOT_NAME);
  }
}
