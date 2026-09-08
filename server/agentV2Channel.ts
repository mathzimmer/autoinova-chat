/**
 * Canal do AGENTE v2 no WhatsApp (número com mode = "agent_v2").
 *
 * Isolado do ai.ts/flowEngine. Recebe as mensagens, ESPERA um instante (debounce)
 * pra agrupar mensagens que chegam juntas (ex: várias fotos) e responde UMA vez.
 * Envia fotos sem legenda primeiro, depois o texto em bolhas. Espelha no inbox.
 *
 * Use só num NÚMERO DE TESTE — não afeta os outros números nem conversas existentes.
 */
import { mirrorOfficialMessage, listMessages, createMessage, getConversationById, getMessageByExternalId, upsertLead, assignSellerRoundRobin } from "./db";
import { sendTextFromNumber, sendMediaFromNumber, markAsReadFromNumber } from "./whatsappMultiNumber";
import { sendSellerNotification, getMediaUrl } from "./whatsapp";
import { processWhatsAppMedia } from "./media";
import { transcribeAudio } from "./_core/voiceTranscription";
import { runAgentV2Turn, type ChatTurn } from "./agentV2";
import { emitNewMessage } from "./socket";

const BOT_NAME = "IA (v2)";
const DEBOUNCE_MS = 6000; // agrupa mensagens que chegam nesse intervalo

const timers = new Map<number, ReturnType<typeof setTimeout>>();
const pending = new Map<number, { phoneNumberId: string; phone: string }>();

export async function handleAgentV2Message(body: any, phoneNumberId: string): Promise<boolean> {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return false;

  const contact = value?.contacts?.[0];
  const phone = msg.from;
  const name = contact?.profile?.name || "Cliente";
  const whatsappMessageId = msg.id;

  let content = "";
  let messageType: "text" | "image" | "audio" = "text";
  if (msg.type === "text") content = msg.text?.body || "";
  else if (msg.type === "interactive") {
    const it = msg.interactive?.type;
    content = it === "button_reply" ? (msg.interactive?.button_reply?.title || "")
      : it === "list_reply" ? (msg.interactive?.list_reply?.title || "")
      : "[resposta interativa]";
  } else if (msg.type === "image") { messageType = "image"; content = msg.image?.caption || "[imagem enviada pelo cliente]"; }
  else if (msg.type === "audio") {
    messageType = "audio";
    content = "[mensagem de áudio]";
    try {
      const mediaId = msg.audio?.id; const mime = msg.audio?.mime_type;
      if (mediaId) {
        const s3 = await processWhatsAppMedia(mediaId, "audio", mime);
        const url = s3?.url || (await getMediaUrl(mediaId)) || undefined;
        if (url) {
          const t = await transcribeAudio({ audioUrl: url, language: "pt", prompt: "Mensagem de voz de cliente sobre compra/troca/financiamento de veículos." });
          if (t && "text" in t && (t as any).text) content = (t as any).text; // usa a transcrição como texto
        }
      }
    } catch (e) { console.error("[AgentV2Channel] transcrição de áudio falhou:", e); }
  }
  else content = `[${msg.type}]`;

  // Reply/quote do WhatsApp: o cliente respondeu a uma mensagem específica.
  // Busca o texto citado e injeta como contexto (ex: respondeu ao carro de 2016).
  if (msg.context?.id) {
    try {
      const quoted = await getMessageByExternalId(msg.context.id);
      if (quoted?.content) content = `[Respondendo à mensagem: "${String(quoted.content).replace(/\*/g, "").slice(0, 180)}"] ${content}`.trim();
    } catch { /* noop */ }
  }

  if (whatsappMessageId) markAsReadFromNumber(phoneNumberId, whatsappMessageId).catch(() => {});

  const mirror = await mirrorOfficialMessage({
    phoneNumberId, phone, contactName: name, content,
    messageType: messageType as any, direction: "inbound",
    senderName: name || phone || "Cliente", externalId: whatsappMessageId, timestamp: Date.now(),
  } as any);
  if (!mirror) return false;
  const conversationId = mirror.conversationId;
  emitNewMessage(conversationId, mirror.message);

  // Debounce: (re)agenda a resposta. Se chegar outra mensagem antes de disparar,
  // o timer reinicia e tudo é respondido de uma vez só.
  pending.set(conversationId, { phoneNumberId, phone });
  const existing = timers.get(conversationId);
  if (existing) clearTimeout(existing);
  timers.set(conversationId, setTimeout(() => {
    timers.delete(conversationId);
    const info = pending.get(conversationId);
    pending.delete(conversationId);
    if (info) respondAgentV2(conversationId, info.phoneNumberId, info.phone).catch((e) => console.error("[AgentV2Channel] resposta falhou:", e));
  }, DEBOUNCE_MS));

  return true;
}

/** Roda o agente UMA vez, juntando as mensagens não respondidas do cliente. */
async function respondAgentV2(conversationId: number, phoneNumberId: string, phone: string): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv || !conv.phone) return;

  const recent = await listMessages(conversationId, 40);
  const ordered = [...recent].sort((a: any, b: any) => (a.id || 0) - (b.id || 0));

  // Batch = mensagens do cliente depois da última resposta do bot.
  let lastBotIdx = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].senderType === "bot" || ordered[i].senderType === "agent") { lastBotIdx = i; break; }
  }
  const batch = ordered.slice(lastBotIdx + 1).filter((m: any) => m.senderType === "customer");
  if (batch.length === 0) return; // nada novo a responder

  // Junta o batch numa "mensagem atual" (várias fotos viram uma coisa só).
  const imgs = batch.filter((m: any) => m.messageType === "image").length;
  const textos = batch.filter((m: any) => m.messageType !== "image").map((m: any) => m.content).filter(Boolean);
  let messageText = textos.join("\n").trim();
  if (imgs > 0) messageText = `${messageText ? messageText + "\n" : ""}[o cliente enviou ${imgs} ${imgs === 1 ? "foto" : "fotos"}]`.trim();
  if (!messageText) messageText = batch[batch.length - 1].content || "";

  // Histórico = tudo antes do batch.
  const history: ChatTurn[] = ordered
    .slice(0, lastBotIdx + 1)
    .filter((m: any) => m.senderType === "customer" || m.senderType === "bot")
    .map((m: any) => ({ role: m.senderType === "customer" ? "user" : "assistant", content: m.content || "" }));

  let out;
  try {
    out = await runAgentV2Turn({ sessionId: String(conversationId), history: history.slice(-20), message: messageText });
  } catch (e) {
    console.error("[AgentV2Channel] runAgentV2Turn falhou:", e);
    return;
  }

  // FOTOS primeiro (sem legenda), depois o TEXTO em bolhas.
  for (const img of out.images || []) {
    try { await sendMediaFromNumber(phoneNumberId, phone, img.url, "image", img.caption || undefined); } catch (e) { console.error("[AgentV2Channel] envio foto falhou:", e); }
    const im = await createMessage({ conversationId, content: "[Imagem do veículo]", senderType: "bot", senderName: BOT_NAME, messageType: "image", metadata: { mediaUrl: img.url } });
    emitNewMessage(conversationId, im);
    await new Promise((r) => setTimeout(r, 300)); // pequeno intervalo entre fotos
  }
  if ((out.images || []).length) await new Promise((r) => setTimeout(r, 1500)); // deixa as fotos assentarem antes do texto

  const parts = (out.messages && out.messages.length ? out.messages : (out.reply ? [out.reply] : []));
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    try { await sendTextFromNumber(phoneNumberId, phone, part); } catch (e) { console.error("[AgentV2Channel] envio texto falhou:", e); }
    const bm = await createMessage({ conversationId, content: part, senderType: "bot", senderName: BOT_NAME, messageType: "text" });
    emitNewMessage(conversationId, bm);
    if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 250));
  }

  // HANDOFF real: grava o lead, roteia pro vendedor da LOJA do carro e notifica.
  if (out.handoff) {
    try {
      const L: any = out.lead || {};
      const vehTitle = out.shownVehicles?.find((x) => x.id === L.veiculoId)?.title;
      await upsertLead({
        conversationId, phone,
        name: L.nome, city: L.cidade,
        vehicleId: L.veiculoId,
        vehicleInterest: vehTitle || L.veiculoInteresse,
        hasTrade: L.temTroca,
        tradeVehicle: L.trocaModelo, tradeYear: L.trocaAno, tradeKm: L.trocaKm,
        paymentMethod: L.pagamento, downPayment: L.finEntrada,
        notes: out.handoff.resumo,
        funnelStatus: "encaminhado_vendedor",
      } as any);

      const assigned = await assignSellerRoundRobin(conversationId, { phone, contactName: conv.contactName || undefined });
      if (assigned?.seller?.phone) {
        await sendSellerNotification(assigned.seller.phone, {
          sellerName: assigned.seller.name,
          customerName: conv.contactName || L.nome || "Cliente",
          customerPhone: phone,
          vehicleInterest: vehTitle || L.veiculoInteresse || "",
          conversationSummary: out.handoff.resumo,
          storeLocation: assigned.storeLocation,
        });
        console.log(`[AgentV2Channel] Lead atribuído a ${assigned.seller.name} (${assigned.storeLocation}) e notificado.`);
      } else {
        console.warn("[AgentV2Channel] Sem vendedor ativo pra loja do veículo — lead marcado, sem notificação.");
      }
    } catch (e) {
      console.error("[AgentV2Channel] handoff/atribuição falhou:", e);
    }
  }
}
