import { getConversationById } from "./db";

export interface ChannelSender {
  text: (body: string) => Promise<any>;
  image: (url: string, caption?: string) => Promise<any>;
  buttons?: (body: string, buttons: Array<{ id: string; title: string }>) => Promise<any>;
  list?: (body: string, buttonText: string, sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>) => Promise<any>;
}

/**
 * Resolve o emissor correto (ChannelSender) para a conversa dada,
 * roteando automaticamente para a instância/canal correto (Evolution, Zernio,
 * Multi-Number ou a Matriz Oficial como fallback).
 */
export async function resolveChannelSender(conversationId: number): Promise<ChannelSender> {
  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    throw new Error(`Conversa ID ${conversationId} não encontrada.`);
  }

  const channel = conversation.channel;
  const phone = conversation.phone;
  const instanceName = conversation.instanceName;
  const meta = (conversation.metadata as any) || {};

  // ── 1. Zernio (coexistência) ──
  if (channel === "zernio") {
    const zConvId = meta.zernioConversationId as string | undefined;
    const zAccId = (meta.zernioAccountId as string | undefined) || instanceName || undefined;
    if (zConvId) {
      return {
        text: async (b) => { const { zernioReply } = await import("./zernioService"); return zernioReply(zConvId, b, zAccId); },
        image: async (url, caption) => { const { zernioSendMedia } = await import("./zernioService"); return zernioSendMedia(zConvId, url, "image", zAccId, caption); },
        buttons: async (b, buttons) => { const { zernioSendButtons } = await import("./zernioService"); return zernioSendButtons(zConvId, b, buttons, zAccId); },
        list: async (b, bt, sections) => { const { zernioSendList } = await import("./zernioService"); return zernioSendList(zConvId, b, bt, sections, zAccId); },
      };
    }
  }

  // ── 2. WhatsApp Multi-Number (Oficial adicional) ──
  if (channel === "whatsapp" && instanceName && phone) {
    return {
      text: async (b) => { const { sendTextFromNumber } = await import("./whatsappMultiNumber"); return sendTextFromNumber(instanceName, phone, b); },
      image: async (url, caption) => { const { sendMediaFromNumber } = await import("./whatsappMultiNumber"); return sendMediaFromNumber(instanceName, phone, url, "image", caption); },
      buttons: async (b, buttons) => { const { sendButtonsFromNumber } = await import("./whatsappMultiNumber"); return sendButtonsFromNumber(instanceName, phone, b, buttons); },
      list: async (b, bt, sections) => { const { sendListFromNumber } = await import("./whatsappMultiNumber"); return sendListFromNumber(instanceName, phone, b, bt, sections); },
    };
  }

  // ── 3. Evolution (vendedores) — sem botões nativos, degrada para texto ──
  if (channel === "evolution" && instanceName && phone) {
    const jid = (meta.evolutionLidJid as string) || (meta.evolutionRemoteJid as string) || `${phone}@s.whatsapp.net`;
    return {
      text: async (b) => { const { evolutionSendText } = await import("./evolutionService"); return evolutionSendText(instanceName, jid, b); },
      image: async (url, caption) => { const { evolutionSendMedia } = await import("./evolutionService"); return evolutionSendMedia(instanceName, jid, url, "image", caption); },
      buttons: async (b, buttons) => {
        const { evolutionSendText } = await import("./evolutionService");
        const txt = b + "\n\n" + buttons.map((x, i) => `${i + 1}️⃣ ${x.title}`).join("\n");
        return evolutionSendText(instanceName, jid, txt);
      },
      list: async (b, _bt, sections) => {
        const { evolutionSendText } = await import("./evolutionService");
        const rows = sections.flatMap(s => s.rows);
        const txt = b + "\n\n" + rows.map((r, i) => `${i + 1}️⃣ ${r.title}${r.description ? ` — ${r.description}` : ""}`).join("\n");
        return evolutionSendText(instanceName, jid, txt);
      },
    };
  }

  // ── 4. Matriz Oficial (WhatsApp padrão) — só se a Matriz estiver ATIVA ──
  // Sem instância própria + Matriz desativada = não usar o número padrão do .env.
  const { isMatrizActive } = await import("./matrizConfig");
  if (!(await isMatrizActive())) {
    throw new Error(
      `Conversa ${conversationId} não tem instância própria e a Matriz está desativada. ` +
      `Registre o número como instância (oficial/coexistência/Evolution/Zernio) para enviar.`,
    );
  }
  return {
    text: async (b) => { const { sendTextMessage } = await import("./whatsapp"); return sendTextMessage(phone, b); },
    image: async (url, caption) => { const { sendImageMessage } = await import("./whatsapp"); return sendImageMessage(phone, url, caption); },
    buttons: async (b, buttons) => { const { sendReplyButtons } = await import("./whatsapp"); return sendReplyButtons(phone, b, buttons); },
    list: async (b, bt, sections) => { const { sendListMessage } = await import("./whatsapp"); return sendListMessage(phone, b, bt, sections); },
  };
}
