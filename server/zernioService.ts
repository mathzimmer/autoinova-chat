// ─── Conector Zernio (coexistência WhatsApp oficial) ─────────────────────────
// Integração ISOLADA: não interfere nos fluxos Meta Cloud API / Evolution.
// Zernio é um agregador — falamos com a API deles (zernio.com/api/v1) e as
// mensagens chegam pelos webhooks deles (formato próprio: conversationId/accountId).
//
// Docs: https://docs.zernio.com/webhooks/inbox  |  https://docs.zernio.com/platforms/whatsapp
//
// IMPORTANTE: os campos internos de `message`/`conversation`/`account` NÃO são
// documentados campo-a-campo, então o parser abaixo é DEFENSIVO (tenta vários
// nomes de campo) e loga o payload cru na primeira mensagem para travarmos o
// shape real. Depois de ver 1 webhook real, dá pra enxugar o parser.

import { createHmac, timingSafeEqual } from "crypto";

const ZERNIO_API_BASE = process.env.ZERNIO_API_BASE || "https://zernio.com/api/v1";

export function zernioEnabled(): boolean {
  return !!process.env.ZERNIO_API_KEY;
}

/** ID da conta WhatsApp conectada no Zernio usada para responder. */
export function zernioAccountId(): string | undefined {
  return process.env.ZERNIO_ACCOUNT_ID || undefined;
}

// ─── Assinatura de webhook (HMAC-SHA256 hex do corpo cru) ─────────────────────
// https://docs.zernio.com/webhooks#signature-verification
export function verifyZernioSignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) {
    // Sem secret configurado não dá para validar — permite mas avisa (igual ao
    // fallback do webhook Meta). Configure ZERNIO_WEBHOOK_SECRET em produção.
    console.warn("[Zernio] ZERNIO_WEBHOOK_SECRET não configurado — assinatura NÃO verificada");
    return true;
  }
  if (!signatureHeader) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  try {
    // Zernio manda o hex puro (sem prefixo "sha256=")
    return timingSafeEqual(Buffer.from(signatureHeader.trim()), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Chamada genérica à API do Zernio ─────────────────────────────────────────
async function zernioFetch(path: string, init?: RequestInit, apiKey?: string): Promise<any> {
  const key = apiKey || process.env.ZERNIO_API_KEY;
  if (!key) throw new Error("ZERNIO_API_KEY não configurado (nem chave por instância)");
  const res = await fetch(`${ZERNIO_API_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`Zernio API ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

/** Resolve a chave de API de uma conta: chave da instância cadastrada ou a global. */
async function resolveApiKey(accountId?: string): Promise<string | undefined> {
  if (accountId) {
    try {
      const { getZernioInstanceByAccount } = await import("./db");
      const inst = await getZernioInstanceByAccount(accountId);
      if (inst?.apiKey) return inst.apiKey;
    } catch { /* fallback global */ }
  }
  return process.env.ZERNIO_API_KEY;
}

/** Lista as contas conectadas no Zernio (para descobrir/validar o accountId). */
export async function zernioListAccounts(apiKey?: string): Promise<any[]> {
  const data = await zernioFetch("/accounts", undefined, apiKey);
  return data?.accounts || data?.data || (Array.isArray(data) ? data : []);
}

/**
 * Responde dentro de uma conversa existente do Zernio.
 * POST /inbox/conversations/{conversationId}/messages  body { accountId, message }
 */
export async function zernioReply(
  conversationId: string,
  message: string,
  accountId?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const acc = accountId || zernioAccountId();
    if (!acc) return { success: false, error: "accountId da conta Zernio não informado" };
    const apiKey = await resolveApiKey(acc);
    const data = await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ accountId: acc, message }),
    }, apiKey);
    const msgId = data?.message?._id || data?.message?.id || data?._id || data?.id;
    return { success: true, messageId: msgId ? String(msgId) : undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Falha no envio Zernio" };
  }
}

/**
 * Baixa uma mídia do Zernio (URL autenticada) e sobe no S3/MinIO, retornando a
 * URL pública. As URLs de mídia do Zernio exigem Bearer token, então não dá
 * para renderizá-las direto no inbox — precisam ser re-hospedadas.
 */
export async function hostZernioMedia(
  mediaUrl: string,
  mimeType: string,
  kind: "image" | "audio" | "video" | "document",
  accountId?: string,
): Promise<string | undefined> {
  try {
    const apiKey = await resolveApiKey(accountId);
    const res = await fetch(mediaUrl, {
      headers: apiKey ? { "Authorization": `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) {
      console.error(`[Zernio] download de mídia falhou ${res.status}: ${mediaUrl}`);
      return undefined;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const { uploadMediaToS3 } = await import("./media");
    const uploaded = await uploadMediaToS3(buf, kind, mimeType || "application/octet-stream");
    return uploaded?.url;
  } catch (err) {
    console.error("[Zernio] hostZernioMedia erro:", err);
    return undefined;
  }
}

/**
 * Envia mídia numa conversa Zernio via attachmentUrl (deve ser URL pública —
 * usamos a URL do S3/MinIO). Áudio de voz vai com voiceNote=true (precisa .ogg opus).
 */
export async function zernioSendMedia(
  conversationId: string,
  attachmentUrl: string,
  attachmentType: "image" | "video" | "audio" | "file",
  accountId?: string,
  caption?: string,
  voiceNote?: boolean,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const acc = accountId || zernioAccountId();
    if (!acc) return { success: false, error: "accountId da conta Zernio não informado" };
    const apiKey = await resolveApiKey(acc);
    const body: Record<string, any> = { accountId: acc, attachmentUrl, attachmentType };
    if (caption) body.message = caption;
    if (voiceNote && attachmentType === "audio") body.voiceNote = true;
    const data = await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }, apiKey);
    const msgId = data?.data?.messageId || data?.message?.id || data?.id;
    return { success: true, messageId: msgId ? String(msgId) : undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Falha no envio de mídia Zernio" };
  }
}

/**
 * Botões de resposta via Zernio. Usa o campo `quickReplies` (Meta quick_replies),
 * que é o caminho suportado para botões de resposta no WhatsApp. Se falhar, cai
 * para texto com as opções numeradas (o cliente sempre recebe algo utilizável).
 */
export async function zernioSendButtons(
  conversationId: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
  accountId?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const acc = accountId || zernioAccountId();
  if (!acc) return { success: false, error: "accountId não informado" };
  const apiKey = await resolveApiKey(acc);
  const path = `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`;
  // 1) Botões nativos (quickReplies)
  try {
    const data = await zernioFetch(path, {
      method: "POST",
      body: JSON.stringify({
        accountId: acc,
        message: body,
        quickReplies: buttons.slice(0, 13).map(b => ({ title: b.title.slice(0, 24), payload: b.id })),
      }),
    }, apiKey);
    console.log(`[Zernio] botões (quickReplies) enviados na conversa ${conversationId}`);
    return { success: true, messageId: data?.data?.messageId || data?.message?.id };
  } catch (err) {
    console.error(`[Zernio] quickReplies falhou, fallback texto:`, err instanceof Error ? err.message : err);
  }
  // 2) Fallback: texto com as opções
  const txt = body + "\n\n" + buttons.map((b, i) => `${i + 1}️⃣ ${b.title}`).join("\n");
  return zernioReply(conversationId, txt, acc);
}

/** Lista interativa (WhatsApp interactive.type=list) via Zernio. */
export async function zernioSendList(
  conversationId: string,
  body: string,
  buttonText: string,
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>,
  accountId?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const acc = accountId || zernioAccountId();
  if (!acc) return { success: false, error: "accountId não informado" };
  const apiKey = await resolveApiKey(acc);
  const path = `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`;
  try {
    const interactive = {
      type: "list",
      body: { text: body },
      action: { button: buttonText.slice(0, 20), sections },
    };
    const data = await zernioFetch(path, {
      method: "POST", body: JSON.stringify({ accountId: acc, interactive }),
    }, apiKey);
    console.log(`[Zernio] lista enviada na conversa ${conversationId}`);
    return { success: true, messageId: data?.data?.messageId || data?.message?.id };
  } catch (err) {
    console.error(`[Zernio] lista falhou, fallback texto:`, err instanceof Error ? err.message : err);
  }
  const rows = sections.flatMap(s => s.rows);
  const txt = body + "\n\n" + rows.map((r, i) => `${i + 1}️⃣ ${r.title}${r.description ? ` — ${r.description}` : ""}`).join("\n");
  return zernioReply(conversationId, txt, acc);
}

// ─── Normalização defensiva do payload de mensagem ────────────────────────────
export interface ZernioParsedMessage {
  eventId?: string;
  conversationId?: string;
  accountId?: string;
  platform?: string;
  phone: string;
  name?: string;
  senderName?: string;      // nome de quem enviou (negócio no outbound, cliente no inbound)
  content: string;
  messageType: "text" | "audio" | "image" | "document" | "video";
  mediaUrl?: string;
  mimeType?: string;
  externalId?: string;      // id da mensagem no Zernio / plataforma
  direction: "inbound" | "outbound";
  timestamp: number;        // epoch ms
}

function firstDefined<T>(...vals: (T | undefined | null)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v as T;
  return undefined;
}

function toEpochMs(v: any): number {
  if (!v) return Date.now();
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? Date.now() : t;
}

function mapMediaType(raw: any): ZernioParsedMessage["messageType"] {
  const t = String(raw || "").toLowerCase();
  if (t.includes("audio") || t.includes("voice") || t.includes("ptt")) return "audio";
  if (t.includes("image") || t.includes("photo") || t.includes("sticker")) return "image";
  if (t.includes("video")) return "video";
  if (t.includes("document") || t.includes("file") || t.includes("pdf")) return "document";
  return "text";
}

/**
 * Extrai os campos que o CRM precisa de um payload de inbox do Zernio.
 * É tolerante a variações de nome de campo (o schema exato não é documentado).
 */
export function parseZernioMessage(payload: any): ZernioParsedMessage {
  const msg = payload?.message || {};
  const conv = payload?.conversation || msg?.conversation || {};
  const account = payload?.account || {};

  // O PARTICIPANTE da conversa é SEMPRE o cliente (nos dois sentidos). Em uma
  // mensagem "outgoing" o message.sender é o negócio (CRM), então NÃO dá para
  // usar sender.phoneNumber como telefone do cliente — usa-se conversation.*
  const phoneRaw = firstDefined<string>(
    conv?.participantId, conv?.platformConversationId, conv?.participantUsername,
    conv?.phone, conv?.recipientPhone,
    // fallbacks antigos (caso o shape mude)
    conv?.contact?.phone, conv?.contact?.phoneNumber,
  );
  const phone = String(phoneRaw || "").replace(/[^\d]/g, "");

  const name = firstDefined<string>(
    conv?.participantName, conv?.name, conv?.title,
    conv?.contact?.name,
  );

  // Nome de quem enviou (para outbound = o negócio; inbound = o cliente)
  const senderName = firstDefined<string>(msg?.sender?.name, msg?.sender?.username);

  // mídia: attachments[0].url + type
  const attachments: any[] = msg?.attachments || msg?.media || [];
  const att = Array.isArray(attachments) ? attachments[0] : attachments;
  const mediaUrl = firstDefined<string>(att?.url, att?.link, att?.mediaUrl, msg?.mediaUrl);
  const mimeType = firstDefined<string>(att?.payload?.mimeType, att?.mimeType, msg?.mimeType);
  const rawType = firstDefined<string>(att?.type, att?.payload?.mimeType, msg?.type, msg?.messageType);
  const messageType: ZernioParsedMessage["messageType"] = mediaUrl ? mapMediaType(rawType) : "text";

  const text = firstDefined<string>(msg?.text, msg?.body, msg?.content, msg?.caption) || "";
  const content = text || (mediaUrl
    ? (messageType === "audio" ? "[Áudio]" : messageType === "image" ? "[Imagem]" : messageType === "video" ? "[Vídeo]" : "[Documento]")
    : "");

  // Zernio usa "outgoing"/"incoming"; o evento também indica o sentido
  const directionRaw = String(msg?.direction || "").toLowerCase();
  const direction: "inbound" | "outbound" =
    payload?.event === "message.sent" ? "outbound"
    : payload?.event === "message.received" ? "inbound"
    : (directionRaw === "outgoing" || directionRaw === "outbound" || directionRaw === "out") ? "outbound"
    : "inbound";

  return {
    eventId: payload?.id,
    conversationId: firstDefined<string>(conv?.id, conv?._id, conv?.conversationId, msg?.conversationId),
    accountId: firstDefined<string>(account?.id, account?._id, account?.accountId, msg?.accountId),
    platform: firstDefined<string>(account?.platform, conv?.platform, msg?.platform),
    phone,
    name,
    senderName,
    content,
    messageType,
    mediaUrl,
    mimeType,
    externalId: firstDefined<string>(msg?.id, msg?._id, msg?.platformMessageId, msg?.messageId),
    direction,
    timestamp: toEpochMs(firstDefined(msg?.sentAt, msg?.receivedAt, msg?.createdAt, msg?.timestamp, payload?.timestamp)),
  };
}
