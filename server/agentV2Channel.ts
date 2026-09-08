/**
 * Canal do AGENTE v2 no WhatsApp (número marcado como mode = "agent_v2").
 *
 * Isolado do ai.ts/flowEngine: quem responde é o runtime novo (agentV2). Recebe a
 * mensagem, monta o histórico da conversa, roda o agente e envia a resposta
 * (texto + fotos) pelo TOKEN do próprio número. Espelha tudo no inbox do CRM.
 *
 * Use só num NÚMERO DE TESTE — não afeta os outros números nem conversas existentes.
 */
import { mirrorOfficialMessage, listMessages, createMessage, getConversationById } from "./db";
import { sendTextFromNumber, sendMediaFromNumber, markAsReadFromNumber } from "./whatsappMultiNumber";
import { runAgentV2Turn, type ChatTurn } from "./agentV2";
import { emitNewMessage } from "./socket";

const BOT_NAME = "IA (v2)";

export async function handleAgentV2Message(body: any, phoneNumberId: string): Promise<boolean> {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return false;

  const contact = value?.contacts?.[0];
  const phone = msg.from;
  const name = contact?.profile?.name || "Cliente";
  const whatsappMessageId = msg.id;

  // Parse enxuto: texto, interativo, legenda de imagem; áudio/outros viram placeholder.
  let content = "";
  let messageType: "text" | "image" | "audio" = "text";
  if (msg.type === "text") content = msg.text?.body || "";
  else if (msg.type === "interactive") {
    const it = msg.interactive?.type;
    content = it === "button_reply" ? (msg.interactive?.button_reply?.title || "")
      : it === "list_reply" ? (msg.interactive?.list_reply?.title || "")
      : "[resposta interativa]";
  } else if (msg.type === "image") { messageType = "image"; content = msg.image?.caption || "[imagem enviada pelo cliente]"; }
  else if (msg.type === "audio") { messageType = "audio"; content = "[mensagem de áudio]"; }
  else content = `[${msg.type}]`;

  if (whatsappMessageId) markAsReadFromNumber(phoneNumberId, whatsappMessageId).catch(() => {});

  // Espelha a mensagem do cliente no inbox (cria/atualiza a conversa).
  const mirror = await mirrorOfficialMessage({
    phoneNumberId, phone, contactName: name, content,
    messageType: messageType as any, direction: "inbound",
    senderName: name || phone || "Cliente", externalId: whatsappMessageId, timestamp: Date.now(),
  } as any);
  if (!mirror) return false;
  const conversationId = mirror.conversationId;
  emitNewMessage(conversationId, mirror.message);

  const conv = await getConversationById(conversationId);
  if (!conv || !conv.phone) return true;

  // Monta histórico (exclui a mensagem atual, que vai como `message`).
  const recent = await listMessages(conversationId, 24);
  const ordered = [...recent].sort((a: any, b: any) => (a.id || 0) - (b.id || 0));
  const history: ChatTurn[] = ordered
    .filter((m: any) => m.senderType === "customer" || m.senderType === "bot")
    .map((m: any) => ({ role: m.senderType === "customer" ? "user" : "assistant", content: m.content || "" }));
  if (history.length && history[history.length - 1].role === "user" && history[history.length - 1].content === content) {
    history.pop();
  }

  let out;
  try {
    out = await runAgentV2Turn({ sessionId: String(conversationId), history: history.slice(-20), message: content });
  } catch (e) {
    console.error("[AgentV2Channel] runAgentV2Turn falhou:", e);
    return true;
  }

  // Envia CADA mensagem separada (bolhas) pelo token do número + espelha no inbox.
  const parts = (out.messages && out.messages.length ? out.messages : (out.reply ? [out.reply] : []));
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    try { await sendTextFromNumber(phoneNumberId, conv.phone, part); } catch (e) { console.error("[AgentV2Channel] envio texto falhou:", e); }
    const bm = await createMessage({ conversationId, content: part, senderType: "bot", senderName: BOT_NAME, messageType: "text" });
    emitNewMessage(conversationId, bm);
    if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 600)); // ritmo natural
  }
  for (const img of out.images || []) {
    try { await sendMediaFromNumber(phoneNumberId, conv.phone, img.url, "image", img.caption); } catch (e) { console.error("[AgentV2Channel] envio foto falhou:", e); }
    const im = await createMessage({ conversationId, content: img.caption || "[Imagem do veículo]", senderType: "bot", senderName: BOT_NAME, messageType: "image", metadata: { mediaUrl: img.url, caption: img.caption } });
    emitNewMessage(conversationId, im);
  }

  return true;
}
