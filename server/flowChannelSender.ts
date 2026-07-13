// ─── Remetente de fluxo por canal ─────────────────────────────────────────────
// Constrói o objeto `sender` (usado pelo FlowContext) roteando para o canal certo
// da conversa: Matriz oficial, número oficial adicional, Zernio ou Evolution.
// Usado pelo motor de fluxo e pelo worker de "sem resposta".

type Sender = {
  text: (body: string) => Promise<any>;
  image: (url: string, caption?: string) => Promise<any>;
  buttons?: (body: string, buttons: Array<{ id: string; title: string }>) => Promise<any>;
  list?: (body: string, buttonText: string, sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>) => Promise<any>;
};

export function getFlowSender(conversation: any): Sender | undefined {
  const channel = conversation?.channel;
  const phone = conversation?.phone as string | undefined;
  const instanceName = conversation?.instanceName as string | undefined;
  const meta = (conversation?.metadata as any) || {};

  // ── Zernio (coexistência) ──
  if (channel === "zernio") {
    const zConvId = meta.zernioConversationId as string | undefined;
    const zAccId = (meta.zernioAccountId as string | undefined) || instanceName || undefined;
    if (!zConvId) return undefined;
    return {
      text: async (b) => { const { zernioReply } = await import("./zernioService"); return zernioReply(zConvId, b, zAccId); },
      image: async (url, caption) => { const { zernioSendMedia } = await import("./zernioService"); return zernioSendMedia(zConvId, url, "image", zAccId, caption); },
      buttons: async (b, buttons) => { const { zernioSendButtons } = await import("./zernioService"); return zernioSendButtons(zConvId, b, buttons, zAccId); },
      list: async (b, bt, sections) => { const { zernioSendList } = await import("./zernioService"); return zernioSendList(zConvId, b, bt, sections, zAccId); },
    };
  }

  // ── Número oficial adicional (channel whatsapp + instanceName) ──
  if (channel === "whatsapp" && instanceName && phone) {
    return {
      text: async (b) => { const { sendTextFromNumber } = await import("./whatsappMultiNumber"); return sendTextFromNumber(instanceName, phone, b); },
      image: async (url, caption) => { const { sendMediaFromNumber } = await import("./whatsappMultiNumber"); return sendMediaFromNumber(instanceName, phone, url, "image", caption); },
      buttons: async (b, buttons) => { const { sendButtonsFromNumber } = await import("./whatsappMultiNumber"); return sendButtonsFromNumber(instanceName, phone, b, buttons); },
      list: async (b, bt, sections) => { const { sendListFromNumber } = await import("./whatsappMultiNumber"); return sendListFromNumber(instanceName, phone, b, bt, sections); },
    };
  }

  // ── Evolution (número de vendedor) — sem botões nativos, degrada para texto ──
  if (channel === "evolution" && instanceName && phone) {
    const jid = (meta.evolutionLidJid as string) || (meta.evolutionRemoteJid as string) || phone;
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

  // ── Matriz oficial (channel whatsapp sem instância) → undefined = usa o padrão do fluxo ──
  return undefined;
}
