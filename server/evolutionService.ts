/**
 * Evolution API Service
 * Handles communication with the Evolution API for multi-number WhatsApp management
 */

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || "";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";

const headers = () => ({
  "Content-Type": "application/json",
  apikey: EVOLUTION_API_KEY,
});

async function evolutionRequest(path: string, method = "GET", body?: unknown) {
  const url = `${EVOLUTION_API_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Evolution API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Instance Management ────────────────────────────────────────────────────

export async function evolutionFetchInstances() {
  return evolutionRequest("/instance/fetchInstances");
}

export async function evolutionCreateInstance(instanceName: string, webhookUrl: string) {
  return evolutionRequest("/instance/create", "POST", {
    instanceName,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
    webhook: {
      url: webhookUrl,
      byEvents: false,
      base64: false,
      headers: { apikey: EVOLUTION_API_KEY },
      events: [
        "MESSAGES_UPSERT",
        "MESSAGES_UPDATE",
        "CONNECTION_UPDATE",
        "QRCODE_UPDATED",
        "CONTACTS_UPSERT",
      ],
    },
  });
}

export async function evolutionGetQrCode(instanceName: string) {
  return evolutionRequest(`/instance/connect/${instanceName}`);
}

export async function evolutionGetInstanceStatus(instanceName: string) {
  return evolutionRequest(`/instance/connectionState/${instanceName}`);
}

export async function evolutionDeleteInstance(instanceName: string) {
  return evolutionRequest(`/instance/delete/${instanceName}`, "DELETE");
}

export async function evolutionLogoutInstance(instanceName: string) {
  return evolutionRequest(`/instance/logout/${instanceName}`, "DELETE");
}

export async function evolutionRestartInstance(instanceName: string) {
  return evolutionRequest(`/instance/restart/${instanceName}`, "PUT");
}

export async function evolutionSetWebhook(instanceName: string, webhookUrl: string) {
  return evolutionRequest(`/webhook/set/${instanceName}`, "POST", {
    url: webhookUrl,
    byEvents: false,
    base64: false,
    headers: { apikey: EVOLUTION_API_KEY },
    events: [
      "MESSAGES_UPSERT",
      "MESSAGES_UPDATE",
      "CONNECTION_UPDATE",
      "QRCODE_UPDATED",
      "CONTACTS_UPSERT",
    ],
  });
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export async function evolutionSendText(instanceName: string, to: string, text: string) {
  // @lid JIDs must be sent as-is — Baileys routes them internally via linked-device table
  // Normal JIDs (@s.whatsapp.net / @c.us): strip suffix, send only digits
  const number = to.endsWith("@lid") ? to : (to.includes("@") ? to.split("@")[0] : to);
  return evolutionRequest(`/message/sendText/${instanceName}`, "POST", {
    number,
    text,
  });
}

/** Envia áudio como mensagem de VOZ (ptt) — endpoint dedicado da Evolution v2 */
export async function evolutionSendAudio(instanceName: string, to: string, audioUrl: string) {
  const number = to.endsWith("@lid") ? to : (to.includes("@") ? to.split("@")[0] : to);
  return evolutionRequest(`/message/sendWhatsAppAudio/${instanceName}`, "POST", {
    number,
    audio: audioUrl,
    // encoding: a Evolution transcodifica para o ptt nativo do WhatsApp —
    // evita o "áudio não está mais disponível" na sincronização do
    // aparelho remetente (quirk conhecido do Baileys com áudio por URL)
    encoding: true,
  });
}

export async function evolutionSendMedia(
  instanceName: string,
  to: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" | "document",
  caption?: string,
  fileName?: string
) {
  // @lid JIDs must be sent as-is — Baileys routes them internally via linked-device table
  const number = to.endsWith("@lid") ? to : (to.includes("@") ? to.split("@")[0] : to);
  return evolutionRequest(`/message/sendMedia/${instanceName}`, "POST", {
    number,
    mediatype: mediaType,
    media: mediaUrl,
    caption,
    fileName,
  });
}

// ─── Contacts & Chats ─────────────────────────────────────────────────────────

export async function evolutionFetchChats(instanceName: string) {
  return evolutionRequest(`/chat/findChats/${instanceName}`, "POST", {});
}

export async function evolutionFetchMessages(instanceName: string, remoteJid: string, count = 50) {
  return evolutionRequest(`/chat/findMessages/${instanceName}`, "POST", {
    where: { key: { remoteJid } },
    limit: count,
  });
}

export async function evolutionFetchContacts(instanceName: string) {
  return evolutionRequest(`/contact/findContacts/${instanceName}`, "POST", {});
}

export async function evolutionGetProfilePic(instanceName: string, number: string) {
  try {
    // Evolution API v2: POST /chat/fetchProfilePictureUrl/{instance} { number }
    return await evolutionRequest(`/chat/fetchProfilePictureUrl/${instanceName}`, "POST", { number });
  } catch {
    return null;
  }
}

/**
 * Check if a phone number is valid on WhatsApp via Evolution API.
 * Returns { exists: boolean, jid: string, number: string } or null on error.
 */
export async function evolutionCheckWhatsAppNumber(instanceName: string, numbers: string[]) {
  try {
    const result = await evolutionRequest(`/chat/whatsappNumbers/${instanceName}`, "POST", { numbers });
    return result as Array<{ exists: boolean; jid: string; number: string }>;
  } catch (err) {
    console.warn(`[Evolution] checkWhatsAppNumber failed:`, err);
    return null;
  }
}

/**
 * Fetch all contacts from the Evolution instance.
 * Returns array of { id, pushName, profilePictureUrl, ... }
 */
export async function evolutionFetchAllContacts(instanceName: string) {
  try {
    const result = await evolutionRequest(`/contact/findContacts/${instanceName}`, "POST", {});
    return result as Array<{ id: string; pushName?: string; name?: string; profilePictureUrl?: string; phone?: string }>;
  } catch (err) {
    console.warn(`[Evolution] fetchAllContacts failed:`, err);
    return [];
  }
}

// ─── Media Download ──────────────────────────────────────────────────────────

/**
 * Fetch media from Evolution API using getBase64FromMediaMessage endpoint.
 * Returns a data URL (base64) that can be used directly in img/audio/video tags.
 */
export async function evolutionGetMediaBase64(
  instanceName: string,
  key: { id: string; remoteJid?: string; fromMe?: boolean },
  convertToMp4 = false,
) {
  try {
    // Evolution v2.3.x exige a key completa (id + remoteJid + fromMe) para localizar a mensagem
    const result = await evolutionRequest(`/chat/getBase64FromMediaMessage/${instanceName}`, "POST", {
      message: { key },
      convertToMp4,
    });
    // Returns { base64: "..." } (com ou sem prefixo data:) ou { mediaUrl } ou { media }
    const raw = result?.base64 || result?.media || result?.mediaUrl || null;
    if (!raw) {
      console.warn(`[Evolution] getBase64 sem mídia para ${key.id}. Resposta:`, JSON.stringify(result).substring(0, 300));
      return null;
    }
    if (typeof raw !== "string") return null;
    // Normaliza: se vier base64 puro, adiciona o prefixo data: com o mimetype da resposta
    if (raw.startsWith("data:") || raw.startsWith("http")) return raw;
    const mime = (result?.mimetype as string) || "application/octet-stream";
    return `data:${mime};base64,${raw}`;
  } catch (err) {
    console.warn(`[Evolution] getBase64FromMediaMessage failed for ${key.id}:`, err);
    return null;
  }
}

// ─── Webhook Payload Parser ───────────────────────────────────────────────────

export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: Record<string, unknown>;
}

export function parseWebhookMessage(payload: EvolutionWebhookPayload) {
  const { event, instance, data } = payload;

  if (event === "messages.upsert") {
    const msg = data as {
      key: { remoteJid: string; fromMe: boolean; id: string; participant?: string; remoteJidAlt?: string };
      message: Record<string, unknown>;
      messageType: string;
      messageTimestamp: number;
      pushName?: string;
      notifyName?: string;
      status?: string;
      // Evolution API v2 may include these
      participant?: string;
      phoneNumber?: string;
      remoteJidAlt?: string;
    };

    const remoteJid = msg.key?.remoteJid || "";
    const fromMe = msg.key?.fromMe || false;
    const messageId = msg.key?.id || "";
    const timestamp = (msg.messageTimestamp || Date.now() / 1000) * 1000;
    const pushName = msg.pushName || msg.notifyName || "";

    // Extract text content and media URL
    let content = "";
    let messageType: "text" | "audio" | "image" | "document" | "video" | "sticker" | "reaction" | "system" = "text";
    let mediaUrl = "";

    const msgData = msg.message || {};
    // Evolution API may include mediaUrl or base64 at the top level of the data payload
    const topLevelMediaUrl = (data as any).mediaUrl || (data as any).media_url || "";

    if (msgData.conversation) {
      content = msgData.conversation as string;
    } else if ((msgData.extendedTextMessage as Record<string, unknown>)?.text) {
      content = ((msgData.extendedTextMessage as Record<string, unknown>).text) as string;
    } else if (msgData.imageMessage) {
      messageType = "image";
      const imgMsg = msgData.imageMessage as Record<string, unknown>;
      content = (imgMsg.caption as string) || "";
      mediaUrl = (imgMsg.url as string) || (imgMsg.directPath as string) || topLevelMediaUrl || "";
    } else if (msgData.videoMessage) {
      messageType = "video";
      const vidMsg = msgData.videoMessage as Record<string, unknown>;
      content = (vidMsg.caption as string) || "";
      mediaUrl = (vidMsg.url as string) || (vidMsg.directPath as string) || topLevelMediaUrl || "";
    } else if (msgData.audioMessage || msgData.pttMessage) {
      messageType = "audio";
      const audioMsg = (msgData.audioMessage || msgData.pttMessage) as Record<string, unknown>;
      content = "";
      mediaUrl = (audioMsg.url as string) || (audioMsg.directPath as string) || topLevelMediaUrl || "";
    } else if (msgData.documentMessage) {
      messageType = "document";
      const docMsg = msgData.documentMessage as Record<string, unknown>;
      content = (docMsg.fileName as string) || "Documento";
      mediaUrl = (docMsg.url as string) || (docMsg.directPath as string) || topLevelMediaUrl || "";
    } else if (msgData.stickerMessage) {
      messageType = "sticker";
      const stickerMsg = msgData.stickerMessage as Record<string, unknown>;
      content = "";
      mediaUrl = (stickerMsg.url as string) || (stickerMsg.directPath as string) || topLevelMediaUrl || "";
    } else if (msgData.reactionMessage) {
      messageType = "reaction";
      content = ((msgData.reactionMessage as Record<string, unknown>).text as string) || "";
    } else {
      content = "";
    }

    // If no mediaUrl found yet but we have a messageId, we can fetch it later via getBase64FromMediaMessage
    // For now, log when media is detected but URL is missing
    if (messageType !== "text" && messageType !== "reaction" && !mediaUrl) {
      console.log(`[Evolution] Media message (${messageType}) without URL - messageId: ${messageId}, instance: ${instance}`);
    }

    // Skip group messages
    if (remoteJid.includes("@g.us")) return null;
    // Skip status messages
    if (remoteJid === "status@broadcast") return null;

    // ── Resolve real phone number ──────────────────────────────────────────
    // Evolution API in linked-device mode returns @lid JIDs (internal WhatsApp IDs)
    // instead of real phone numbers. We need to extract the real phone from:
    // 1. remoteJid if it's @s.whatsapp.net or @c.us (already a real number)
    // 2. key.participant if present (used in some group/linked-device scenarios)
    // 3. msg.phoneNumber if Evolution provides it
    // 4. Extract numeric part from @lid and use as fallback
    let phone = "";
    let resolvedJid = remoteJid; // The JID to use for sending messages back

    if (remoteJid.endsWith("@s.whatsapp.net") || remoteJid.endsWith("@c.us")) {
      // Normal case: real phone number in JID
      phone = remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
      resolvedJid = remoteJid;
    } else if (remoteJid.endsWith("@lid")) {
      // Linked-device mode: @lid JID — try to find real number from other fields
      // Priority: remoteJidAlt > senderPn (Baileys/Evolution novos) > participant > phoneNumber > fallback
      const remoteJidAlt = msg.remoteJidAlt || msg.key?.remoteJidAlt || "";
      const participant = msg.key?.participant || msg.participant || "";
      // Baileys 6.7.19+/Evolution v2.2+: senderPn/participantPn trazem o número REAL do contato @lid
      const senderPn = (msg.key as any)?.senderPn || (msg as any).senderPn
        || (msg.key as any)?.participantPn || (msg as any).participantPn || "";
      const phoneNumberField = msg.phoneNumber || senderPn || "";

      if (remoteJidAlt && (remoteJidAlt.endsWith("@s.whatsapp.net") || remoteJidAlt.endsWith("@c.us"))) {
        // Best case: Evolution provides the real JID as remoteJidAlt
        phone = remoteJidAlt.replace("@s.whatsapp.net", "").replace("@c.us", "");
        resolvedJid = remoteJidAlt;
        console.log(`[Evolution] Resolved @lid via remoteJidAlt: ${remoteJid} -> ${resolvedJid}`);
      } else if (participant && (participant.endsWith("@s.whatsapp.net") || participant.endsWith("@c.us"))) {
        phone = participant.replace("@s.whatsapp.net", "").replace("@c.us", "");
        resolvedJid = participant;
        console.log(`[Evolution] Resolved @lid via participant: ${remoteJid} -> ${resolvedJid}`);
      } else if (phoneNumberField) {
        phone = phoneNumberField.replace(/\D/g, "");
        resolvedJid = `${phone}@s.whatsapp.net`;
        console.log(`[Evolution] Resolved @lid via phoneNumber: ${remoteJid} -> ${resolvedJid}`);
      } else {
        // Last resort: keep @lid as-is for sending (Baileys may route internally)
        // Store the numeric part as phone for display purposes only
        phone = remoteJid.replace("@lid", "");
        resolvedJid = remoteJid; // keep @lid — Baileys should route it
        console.warn(`[Evolution] @lid JID without real phone: ${remoteJid}, pushName: ${pushName}`);
      }
    } else {
      // Unknown format — extract numeric part
      phone = remoteJid.split("@")[0];
      resolvedJid = remoteJid;
    }

    // Campos para correção do bug de direção da Evolution 2.3.x (LID):
    // senderPn identifica quem REALMENTE enviou, independente do fromMe
    const senderPnRaw = (msg.key as any)?.senderPn || (msg as any).senderPn
      || (msg.key as any)?.participantPn || (msg as any).participantPn || "";
    const senderPnDigits = String(senderPnRaw).replace(/\D/g, "");
    const addressingMode = ((msg.key as any)?.addressingMode as string) || "";

    return {
      type: "message" as const,
      instanceName: instance,
      remoteJid,         // original JID from Evolution (may be @lid)
      resolvedJid,       // JID to use for sending (should be @s.whatsapp.net)
      phone,             // clean phone number without @suffix
      fromMe,
      messageId,
      timestamp,
      content,
      messageType,
      mediaUrl,
      pushName,
      senderPnDigits,
      addressingMode,
      senderName: fromMe ? "Vendedor" : (pushName || phone),
      direction: fromMe ? ("outbound" as const) : ("inbound" as const),
      rawPayload: payload,
    };
  }

  if (event === "connection.update") {
    const conn = data as { state: string; statusReason?: number };
    return {
      type: "connection" as const,
      instanceName: instance,
      state: conn.state,
      statusReason: conn.statusReason,
    };
  }

  if (event === "qrcode.updated") {
    const qr = data as { qrcode: { base64?: string; code?: string } };
    return {
      type: "qrcode" as const,
      instanceName: instance,
      qrCode: qr.qrcode?.base64 || qr.qrcode?.code || "",
    };
  }

  return null;
}

// ── Webhook Handler ──────────────────────────────────────────────────────────

import {
  getEvolutionInstanceByName,
  updateEvolutionInstance,
  upsertEvolutionConversation,
  createEvolutionMessage,
  listEvolutionMessages,
} from "./db";
import type { Server as SocketIOServer } from "socket.io";

interface HandleEvolutionWebhookParams {
  event: string;
  instanceName: string;
  data: Record<string, unknown>;
  io?: SocketIOServer;
}

// ── Foto de perfil do contato (inbox unificado) ──────────────────────────────
// Busca a foto via Evolution e salva na conversa espelhada. Rate-limit de 6h
// por conversa para não martelar a API a cada mensagem.
const profilePicLastAttempt = new Map<number, number>();

async function fetchProfilePicIfMissing(instanceName: string, conversationId: number, phoneOrJid: string): Promise<void> {
  const last = profilePicLastAttempt.get(conversationId) || 0;
  if (Date.now() - last < 6 * 60 * 60 * 1000) return;
  profilePicLastAttempt.set(conversationId, Date.now());

  const { getConversationById, updateConversation } = await import("./db");
  const conv = await getConversationById(conversationId);
  if (!conv || conv.contactPhoto) return;

  try {
    const result = await evolutionGetProfilePic(instanceName, phoneOrJid);
    const url = (result as any)?.profilePictureUrl || (result as any)?.picture || "";
    if (url && typeof url === "string" && url.startsWith("http")) {
      await updateConversation(conversationId, { contactPhoto: url });
      const { emitConversationUpdate } = await import("./socket");
      emitConversationUpdate(conversationId, { contactPhoto: url });
      console.log(`[Evolution] Foto de perfil salva (conversa ${conversationId})`);
    }
  } catch { /* contato pode ter foto privada — ok */ }
}

export async function handleEvolutionWebhook({ event, instanceName, data, io }: HandleEvolutionWebhookParams) {
  // ── Status de entrega (✓ → ✓✓ → azul) para as mensagens do inbox unificado ──
  if (event === "messages.update") {
    const d = data as { keyId?: string; key?: { id?: string }; status?: string };
    const keyId = d?.keyId || d?.key?.id;
    const statusMap: Record<string, "sent" | "delivered" | "read" | "failed"> = {
      SERVER_ACK: "sent",
      DELIVERY_ACK: "delivered",
      READ: "read",
      PLAYED: "read",
      ERROR: "failed", // ex.: 463 (endereçamento LID) — mostra "não entregue" no chat
    };
    const mapped = d?.status ? statusMap[d.status] : undefined;
    if (keyId && mapped) {
      try {
        const { updateMessageDeliveryStatus, getConversationById, updateConversation } = await import("./db");
        const updated = await updateMessageDeliveryStatus(`evo_${keyId}`, mapped);

        // Captura o JID @lid do contato: na v2.3.7 ele só aparece nos eventos
        // de status (o messages.upsert vem com o número já resolvido).
        // Necessário para enviar a contatos que exigem endereçamento LID (erro 463).
        const updRemoteJid = (d as any)?.remoteJid as string | undefined;
        if (updated?.conversationId && updRemoteJid?.endsWith("@lid")) {
          const conv = await getConversationById(updated.conversationId);
          const meta = (conv?.metadata as Record<string, unknown>) || {};
          if (conv && meta.evolutionLidJid !== updRemoteJid) {
            await updateConversation(conv.id, { metadata: { ...meta, evolutionLidJid: updRemoteJid } } as any);
            console.log(`[Evolution] LID capturado via status: ${updRemoteJid} (conversa ${conv.id})`);
          }
        }
      } catch (err) {
        console.warn("[Evolution] status update falhou:", err);
      }
    }
    return;
  }

  const parsed = parseWebhookMessage({ event, instance: instanceName, data });
  if (!parsed) return;

  // ── Connection update ────────────────────────────────────────────────────
  if (parsed.type === "connection") {
    const instance = await getEvolutionInstanceByName(instanceName);
    if (instance) {
      const status = parsed.state === "open" ? "connected"
        : parsed.state === "close" ? "disconnected"
        : "connecting";
      // Captura o número dono da instância (wuid) — usado para corrigir
      // o bug de direção invertida da Evolution 2.3.x em contatos LID
      const wuid = (data as any)?.wuid as string | undefined;
      const ownerPhone = wuid ? wuid.split("@")[0].split(":")[0] : undefined;
      await updateEvolutionInstance(instance.id, { status, ...(ownerPhone ? { phone: ownerPhone } : {}) });
      console.log(`[Evolution] Instance ${instanceName} status: ${status}`);
      if (io) {
        io.emit("evolution_instance_update", { instanceName, status });
      }
    }
    return;
  }

  // ── QR code update ───────────────────────────────────────────────────────
  if (parsed.type === "qrcode") {
    if (io) {
      io.emit("evolution_qrcode", { instanceName, qrCode: parsed.qrCode });
    }
    return;
  }

  // ── Message ──────────────────────────────────────────────────────────────
  if (parsed.type === "message") {
    const instance = await getEvolutionInstanceByName(instanceName);
    if (!instance) {
      console.warn(`[Evolution] Instance not found in DB: ${instanceName}`);
      return;
    }

    // ── Correção do bug de direção da Evolution 2.3.x (contatos LID) ──
    // A Evolution pode marcar mensagens RECEBIDAS como fromMe=true.
    // Regra: se fromMe=true mas o remetente real (senderPn) NÃO é o dono da
    // instância, a mensagem é inbound.
    const ownerDigits = (instance.phone || "").replace(/\D/g, "");
    let direction: "inbound" | "outbound" = parsed.direction;
    if (parsed.fromMe && parsed.senderPnDigits && ownerDigits && parsed.senderPnDigits !== ownerDigits) {
      direction = "inbound";
      console.warn(`[Evolution] Direção corrigida (fromMe invertido/LID): sender=${parsed.senderPnDigits}, owner=${ownerDigits}`);
    }
    const isInbound = direction === "inbound";
    const effectiveSenderName = isInbound ? (parsed.pushName || parsed.phone) : "Vendedor";
    console.log(`[Evolution] upsert dbg: jid=${parsed.remoteJid} fromMe=${parsed.fromMe} senderPn=${parsed.senderPnDigits || "-"} mode=${parsed.addressingMode || "-"} push=${parsed.pushName || "-"} dir=${direction} type=${parsed.messageType} media=${(parsed.mediaUrl || "-").substring(0, 60)} msgId=${parsed.messageId || "-"} | ${parsed.content.substring(0, 30)}`);

    // Use resolvedJid for the conversation key (prefer @s.whatsapp.net over @lid)
    const jidForConversation = parsed.resolvedJid || parsed.remoteJid;

    // Upsert conversation — use resolvedJid so sending works correctly
    const conversation = await upsertEvolutionConversation({
      instanceId: instance.id,
      instanceName,
      remoteJid: jidForConversation,
      phone: parsed.phone,
      // Only update contactName if we have a real name from pushName (not just a number)
      contactName: (isInbound && parsed.pushName && parsed.pushName !== parsed.phone)
        ? parsed.pushName
        : undefined,
      lastMessageAt: parsed.timestamp,
      lastMessagePreview: (parsed.content || (parsed.messageType === "image" ? "📷 Imagem" : parsed.messageType === "audio" ? "🎤 \u00c1udio" : parsed.messageType === "video" ? "🎬 V\u00eddeo" : parsed.messageType === "document" ? "📄 Documento" : parsed.messageType === "sticker" ? "🫨 Sticker" : "")).substring(0, 500),
      unreadCount: isInbound ? 1 : 0,
    });

    // Resolve conversationId (upsert returns id number)
    const conversationId = typeof conversation === "number" ? conversation : (conversation as any).id;

    // ── Resolve media URL ──
    // IMPORTANTE: a URL que a Evolution manda (mmg.whatsapp.net/*.enc) é CRIPTOGRAFADA
    // e não renderiza no navegador. Sempre que a URL não for utilizável, baixa via
    // getBase64 e sobe para o S3.
    let finalMediaUrl = parsed.mediaUrl || "";
    const urlNotUsable = !finalMediaUrl
      || finalMediaUrl.includes(".enc")
      || finalMediaUrl.includes("mmg.whatsapp.net")
      || !finalMediaUrl.startsWith("http");
    if (parsed.messageType !== "text" && parsed.messageType !== "reaction" && urlNotUsable && parsed.messageId) {
      finalMediaUrl = ""; // força o fetch abaixo
    }
    if (parsed.messageType !== "text" && parsed.messageType !== "reaction" && !finalMediaUrl && parsed.messageId) {
      try {
        const mediaData = await evolutionGetMediaBase64(instanceName, {
          id: parsed.messageId,
          remoteJid: parsed.remoteJid,
          fromMe: parsed.fromMe,
        }, parsed.messageType === "video");
        if (mediaData) {
          if (mediaData.startsWith("data:") || mediaData.startsWith("http")) {
            // If it's a data URL (base64), upload to S3
            if (mediaData.startsWith("data:")) {
              const { storagePut } = await import("./storage");
              // Parsing robusto: mimetype de áudio vem como "audio/ogg; codecs=opus"
              // e quebrava a regex simples — split na primeira vírgula é infalível
              const commaIdx = mediaData.indexOf(",");
              if (commaIdx > 5) {
                const header = mediaData.slice(5, commaIdx); // após "data:"
                const mime = (header.split(";")[0] || "application/octet-stream").trim();
                const buffer = Buffer.from(mediaData.slice(commaIdx + 1), "base64");
                const ext = mime.split("/")[1]?.trim() || "bin";
                const key = `evolution-media/${instanceName}/${Date.now()}-${parsed.messageId.slice(-8)}.${ext}`;
                const { url } = await storagePut(key, buffer, mime);
                finalMediaUrl = url;
              }
            } else {
              finalMediaUrl = mediaData;
            }
          }
        }
      } catch (err) {
        console.warn(`[Evolution] Failed to fetch/upload media for ${parsed.messageId}:`, err);
      }
    }

    if (parsed.messageType !== "text" && parsed.messageType !== "reaction") {
      console.log(`[Evolution] media final: type=${parsed.messageType} url=${(finalMediaUrl || "VAZIA").substring(0, 80)}`);
    }

    // Transcreve áudios (inbound e outbound) para a IA e a inteligência "lerem"
    let audioTranscript = "";
    if (parsed.messageType === "audio" && finalMediaUrl) {
      try {
        const { transcribeAudio } = await import("./_core/voiceTranscription");
        const t = await transcribeAudio({ audioUrl: finalMediaUrl, language: "pt", prompt: "Conversa de venda de veículos" });
        if ("text" in t && t.text) {
          audioTranscript = t.text;
          console.log(`[Evolution] Áudio transcrito: "${audioTranscript.substring(0, 60)}"`);
        }
      } catch (err) {
        console.warn("[Evolution] Falha ao transcrever áudio:", err);
      }
    }

    // Save message
    const savedMsg = await createEvolutionMessage({
      instanceId: instance.id,
      instanceName,
      conversationId,
      remoteJid: jidForConversation,
      messageId: parsed.messageId,
      content: parsed.content || (parsed.messageType === "image" ? "" : parsed.messageType === "audio" ? "" : parsed.messageType === "video" ? "" : parsed.messageType === "sticker" ? "" : ""),
      messageType: parsed.messageType,
      direction,
      senderName: effectiveSenderName,
      timestamp: parsed.timestamp,
      mediaUrl: finalMediaUrl || undefined,
      status: "delivered",
    });

    console.log(`[Evolution] Message saved: ${parsed.direction} | ${parsed.phone} | jid=${jidForConversation} | ${parsed.content.substring(0, 50)}`);

    // ── Espelha no inbox unificado (mesma UI da matriz) ──
    if (parsed.messageType !== "reaction") {
      try {
        const { mirrorEvolutionMessage } = await import("./db");
        const mirrored = await mirrorEvolutionMessage({
          instanceName,
          phone: parsed.phone,
          remoteJid: jidForConversation,
          altJid: parsed.remoteJid !== jidForConversation ? parsed.remoteJid : undefined,
          contactName: (isInbound && parsed.pushName && parsed.pushName !== parsed.phone) ? parsed.pushName : undefined,
          // Áudio transcrito entra como conteúdo pesquisável/legível pela IA
          content: audioTranscript || parsed.content,
          transcript: audioTranscript || undefined,
          messageType: parsed.messageType,
          direction,
          senderName: effectiveSenderName,
          mediaUrl: finalMediaUrl || undefined,
          externalId: parsed.messageId ? `evo_${parsed.messageId}` : undefined,
          timestamp: parsed.timestamp,
        });
        if (mirrored) {
          console.log(`[Evolution] ✅ Espelhada no inbox unificado: conv=${mirrored.conversationId} (${instanceName})`);
          const { emitNewMessage, emitConversationUpdate } = await import("./socket");
          emitNewMessage(mirrored.conversationId, mirrored.message);
          emitConversationUpdate(mirrored.conversationId, {});
          // Foto de perfil do contato (best-effort, em background)
          fetchProfilePicIfMissing(instanceName, mirrored.conversationId, parsed.phone)
            .catch(err => console.warn("[Evolution] profile pic:", err));
        } else {
          console.log(`[Evolution] Espelhamento pulado (duplicada?) instancia=${instanceName} msgId=${parsed.messageId}`);
        }
      } catch (err) {
        console.error("[Evolution] Erro ao espelhar no inbox unificado:", err);
      }
    }

    // Emit real-time event
    if (io) {
      io.emit("evolution_new_message", {
        instanceName,
        conversationId,
        message: savedMsg,
        conversation,
      });
    }
  }
}
