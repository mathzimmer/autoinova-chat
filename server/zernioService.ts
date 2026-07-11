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
async function zernioFetch(path: string, init?: RequestInit): Promise<any> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error("ZERNIO_API_KEY não configurado");
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

/** Lista as contas conectadas (para descobrir o accountId do WhatsApp). */
export async function zernioListAccounts(): Promise<any[]> {
  const data = await zernioFetch("/accounts");
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
    if (!acc) return { success: false, error: "ZERNIO_ACCOUNT_ID não configurado" };
    const data = await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ accountId: acc, message }),
    });
    const msgId = data?.message?._id || data?.message?.id || data?._id || data?.id;
    return { success: true, messageId: msgId ? String(msgId) : undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Falha no envio Zernio" };
  }
}

// ─── Normalização defensiva do payload de mensagem ────────────────────────────
export interface ZernioParsedMessage {
  eventId?: string;
  conversationId?: string;
  accountId?: string;
  platform?: string;
  phone: string;
  name?: string;
  content: string;
  messageType: "text" | "audio" | "image" | "document" | "video";
  mediaUrl?: string;
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
  const contact = conv?.contact || conv?.participant || conv?.sender || msg?.from || {};

  // telefone: WhatsApp normalmente traz em contact.phone / .platformUserId / .id
  const phoneRaw = firstDefined<string>(
    contact?.phone, contact?.phoneNumber, contact?.platformUserId, contact?.waId,
    contact?.id, conv?.phone, conv?.recipientPhone, msg?.fromPhone,
  );
  const phone = String(phoneRaw || "").replace(/[^\d]/g, "");

  const name = firstDefined<string>(
    contact?.name, contact?.displayName, contact?.username, contact?.profileName,
    conv?.name, conv?.title,
  );

  // mídia: attachments[0].url + type
  const attachments: any[] = msg?.attachments || msg?.media || [];
  const att = Array.isArray(attachments) ? attachments[0] : attachments;
  const mediaUrl = firstDefined<string>(att?.url, att?.link, att?.mediaUrl, msg?.mediaUrl);
  const rawType = firstDefined<string>(att?.type, msg?.type, msg?.messageType);
  const messageType: ZernioParsedMessage["messageType"] = mediaUrl ? mapMediaType(rawType) : "text";

  const text = firstDefined<string>(msg?.text, msg?.body, msg?.content, msg?.caption) || "";
  const content = text || (mediaUrl
    ? (messageType === "audio" ? "[Áudio]" : messageType === "image" ? "[Imagem]" : messageType === "video" ? "[Vídeo]" : "[Documento]")
    : "");

  const directionRaw = String(firstDefined(msg?.direction, payload?.event?.includes?.("sent") ? "outbound" : undefined) || "").toLowerCase();
  const direction: "inbound" | "outbound" =
    payload?.event === "message.sent" ? "outbound"
    : directionRaw === "outbound" || directionRaw === "out" ? "outbound"
    : "inbound";

  return {
    eventId: payload?.id,
    conversationId: firstDefined<string>(conv?._id, conv?.id, conv?.conversationId),
    accountId: firstDefined<string>(account?._id, account?.id, msg?.accountId),
    platform: firstDefined<string>(account?.platform, conv?.platform, msg?.platform),
    phone,
    name,
    content,
    messageType,
    mediaUrl,
    externalId: firstDefined<string>(msg?._id, msg?.id, msg?.platformMessageId, msg?.messageId),
    direction,
    timestamp: toEpochMs(firstDefined(msg?.createdAt, msg?.timestamp, payload?.timestamp)),
  };
}
