/**
 * Integração Meta Business Agent × CRM.
 *
 * Num número marcado como `mode = "meta_agent"`, quem RESPONDE o cliente é o
 * agente da Meta. O CRM apenas:
 *   1) OBSERVA (standby): espelha as mensagens no inbox, marcadas "agente Meta",
 *      SEM acionar a IA/fluxos do CRM;
 *   2) no HANDOFF (o agente passa o controle da thread pro app): cria/garante o
 *      lead, extrai o interesse do histórico (conversationIntelligence), atribui
 *      um vendedor (round-robin) e dispara a automação.
 *
 * ⚠️ PARSER A CONFIRMAR: o formato exato do payload de standby/handoff da Meta
 * ainda não está cravado na doc. Este handler LOGA o payload cru (pra captura no
 * VPS) e faz parse best-effort do que é conhecido. O ponto do handoff está em
 * `detectHandoff()` marcado com TODO_HANDOFF — fecha com um webhook real.
 */
import {
  getConversationByPhone, mirrorOfficialMessage, getOrCreateLeadByPhone,
  updateConversation, assignSellerRoundRobin,
} from "./db";
import { emitNewMessage, emitConversationUpdate } from "./socket";

function extractText(m: any): string {
  if (!m) return "";
  if (m.type === "text") return m.text?.body || "";
  if (m.type === "interactive") {
    return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "[resposta interativa]";
  }
  if (m.type === "image") return m.image?.caption || "[imagem]";
  if (m.type === "audio") return "[áudio]";
  if (m.type === "document") return `[documento: ${m.document?.filename || "arquivo"}]`;
  return m.text?.body || `[${m.type || "mensagem"}]`;
}

/**
 * TODO_HANDOFF — detectar quando o controle da thread passa para o app.
 * Campos prováveis (a confirmar com webhook real): value.messaging_handovers,
 * value.handover, value.control_passed. Retorna o telefone do cliente ou null.
 */
function detectHandoff(value: any): { phone?: string } | null {
  const h = value?.messaging_handovers || value?.handover || value?.control_passed || value?.thread_control;
  if (!h) return null;
  const phone = value?.contacts?.[0]?.wa_id
    || value?.messages?.[0]?.from
    || (Array.isArray(h) ? h[0]?.from : h?.from);
  return { phone };
}

/** Webhook de um número que roda o Meta Business Agent. */
export async function handleMetaAgentWebhook(body: any, phoneNumberId: string): Promise<boolean> {
  try {
    console.log(`[MetaAgent] RAW webhook (${phoneNumberId}) — capturar p/ fechar parser:`, JSON.stringify(body).slice(0, 4000));
  } catch { /* noop */ }

  const value = body?.entry?.[0]?.changes?.[0]?.value;
  if (!value) return false;

  // FORMATO REAL (Meta Business Agent): `value.standby` é um OBJETO
  //   { contacts:[...], messages:[...], message_echoes:[...], statuses:[...] }
  // — as mensagens NÃO vêm em value.messages, e sim em value.standby.messages.
  // Se não houver standby-objeto, cai pro próprio value (formato oficial normal).
  const standbyObj = (value.standby && typeof value.standby === "object" && !Array.isArray(value.standby)) ? value.standby : null;
  const src: any = standbyObj || value;
  const contact = src.contacts?.[0] || value.contacts?.[0];

  // Espelha o que houver, sem acionar IA. messages = entrada (cliente);
  // message_echoes = saída (respostas do próprio agente da Meta).
  const buckets: Array<{ m: any; direction: "inbound" | "outbound" }> = [];
  if (Array.isArray(src.messages)) src.messages.forEach((m: any) => buckets.push({ m, direction: "inbound" }));
  if (Array.isArray(src.message_echoes)) src.message_echoes.forEach((m: any) => buckets.push({ m, direction: "outbound" }));
  // Compat: caso algum dia o standby venha como ARRAY de mensagens.
  if (Array.isArray(value.standby)) value.standby.forEach((m: any) => buckets.push({ m, direction: "inbound" }));

  for (const { m, direction } of buckets) {
    // Nos ECHOES (resposta do agente), os dados ficam ANINHADOS em `m.message`
    // e o telefone do cliente é `message.to` (não há `from`). Nas mensagens do
    // cliente (standby.messages) os campos são planos e o telefone é `from`.
    const inner = (m.message && typeof m.message === "object") ? m.message : m;
    const phone = direction === "outbound"
      ? (inner.to || m.to || contact?.wa_id || "")
      : (m.from || inner.from || contact?.wa_id || "");
    if (!phone) continue;
    const type = inner.type;
    try {
      const res = await mirrorOfficialMessage({
        phoneNumberId,
        phone,
        contactName: contact?.profile?.name || undefined,
        content: extractText(inner),
        messageType: (type === "image" || type === "audio" || type === "document" ? type : "text"),
        direction,
        senderName: direction === "outbound" ? "Agente Meta" : (contact?.profile?.name || phone),
        externalId: m.id || inner.id,
        timestamp: Date.now(),
      });
      // IMPORTANTE: NÃO chamar IA/fluxo aqui — quem responde é o agente da Meta.
      if (res) emitNewMessage(res.conversationId, res.message);
    } catch (e) {
      console.error("[MetaAgent] falha ao espelhar mensagem:", e);
    }
  }

  const handoff = detectHandoff(value);
  if (handoff?.phone) {
    await onMetaAgentHandoff(handoff.phone).catch((e) => console.error("[MetaAgent] handoff falhou:", e));
  }

  return true;
}

/**
 * Processa o handoff: garante o lead, extrai o interesse do histórico, atribui
 * vendedor e desliga a IA do CRM (o vendedor humano assume). Dispara update.
 */
export async function onMetaAgentHandoff(phone: string): Promise<void> {
  const conv = await getConversationByPhone(phone);
  if (!conv) { console.warn(`[MetaAgent] handoff sem conversa para ${phone}`); return; }

  const meta = ((conv as any).metadata as Record<string, unknown>) || {};
  await updateConversation(conv.id, {
    status: "open",
    aiActive: false, // vendedor humano assume; IA do CRM não responde
    metadata: { ...meta, metaAgentHandoff: true, metaAgentHandoffAt: Date.now() } as any,
  });

  try { await getOrCreateLeadByPhone({ phone, conversationId: conv.id, name: (conv as any).contactName || undefined }); }
  catch (e) { console.error("[MetaAgent] getOrCreateLead:", e); }

  // Extrai carro de interesse / pagamento / troca / score do histórico recebido.
  try { const { analyzeConversation } = await import("./conversationIntelligence"); await analyzeConversation(conv.id); }
  catch (e) { console.error("[MetaAgent] analyzeConversation:", e); }

  // Atribui um vendedor (round-robin por loja).
  try { await assignSellerRoundRobin(conv.id, { phone, contactName: (conv as any).contactName || undefined }); }
  catch (e) { console.error("[MetaAgent] assignSeller:", e); }

  emitConversationUpdate(conv.id, {});
  console.log(`[MetaAgent] Handoff OK: conversa ${conv.id} (${phone}) → lead + vendedor + automação.`);
}
