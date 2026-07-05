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
    return evolutionRequest(`/contact/getProfilePicture/${instanceName}?number=${number}`);
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
export async function evolutionGetMediaBase64(instanceName: string, messageId: string, convertToMp4 = false) {
  try {
    const result = await evolutionRequest(`/chat/getBase64FromMediaMessage/${instanceName}`, "POST", {
      message: { key: { id: messageId } },
      convertToMp4,
    });
    // Returns { base64: "data:mime;base64,..." } or { mediaUrl: "..." }
    if (result?.base64) return result.base64 as string;
    if (result?.mediaUrl) return result.mediaUrl as string;
    return null;
  } catch (err) {
    console.warn(`[Evolution] getBase64FromMediaMessage failed for ${messageId}:`, err);
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
      // Priority: remoteJidAlt > key.remoteJidAlt > participant > phoneNumber > fallback
      const remoteJidAlt = msg.remoteJidAlt || msg.key?.remoteJidAlt || "";
      const participant = msg.key?.participant || msg.participant || "";
      const phoneNumberField = msg.phoneNumber || "";

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

export async function handleEvolutionWebhook({ event, instanceName, data, io }: HandleEvolutionWebhookParams) {
  const parsed = parseWebhookMessage({ event, instance: instanceName, data });
  if (!parsed) return;

  // ── Connection update ────────────────────────────────────────────────────
  if (parsed.type === "connection") {
    const instance = await getEvolutionInstanceByName(instanceName);
    if (instance) {
      const status = parsed.state === "open" ? "connected"
        : parsed.state === "close" ? "disconnected"
        : "connecting";
      await updateEvolutionInstance(instance.id, { status });
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

    // Use resolvedJid for the conversation key (prefer @s.whatsapp.net over @lid)
    const jidForConversation = parsed.resolvedJid || parsed.remoteJid;

    // Upsert conversation — use resolvedJid so sending works correctly
    const conversation = await upsertEvolutionConversation({
      instanceId: instance.id,
      instanceName,
      remoteJid: jidForConversation,
      phone: parsed.phone,
      // Only update contactName if we have a real name from pushName (not just a number)
      contactName: (parsed.senderName && parsed.senderName !== parsed.phone && !parsed.fromMe)
        ? parsed.senderName
        : undefined,
      lastMessageAt: parsed.timestamp,
      lastMessagePreview: (parsed.content || (parsed.messageType === "image" ? "📷 Imagem" : parsed.messageType === "audio" ? "🎤 \u00c1udio" : parsed.messageType === "video" ? "🎬 V\u00eddeo" : parsed.messageType === "document" ? "📄 Documento" : parsed.messageType === "sticker" ? "🫨 Sticker" : "")).substring(0, 500),
      unreadCount: parsed.direction === "inbound" ? 1 : 0,
    });

    // Resolve conversationId (upsert returns id number)
    const conversationId = typeof conversation === "number" ? conversation : (conversation as any).id;

    // ── Resolve media URL: if media message has no URL, fetch via getBase64 and upload to S3 ──
    let finalMediaUrl = parsed.mediaUrl || "";
    if (parsed.messageType !== "text" && parsed.messageType !== "reaction" && !finalMediaUrl && parsed.messageId) {
      try {
        const mediaData = await evolutionGetMediaBase64(instanceName, parsed.messageId);
        if (mediaData) {
          if (mediaData.startsWith("data:") || mediaData.startsWith("http")) {
            // If it's a data URL (base64), upload to S3
            if (mediaData.startsWith("data:")) {
              const { storagePut } = await import("./storage");
              const mimeMatch = mediaData.match(/^data:([^;]+);base64,(.+)$/);
              if (mimeMatch) {
                const mime = mimeMatch[1];
                const buffer = Buffer.from(mimeMatch[2], "base64");
                const ext = mime.split("/")[1]?.replace("webm", "webm").replace("ogg", "ogg") || "bin";
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

    // Save message
    const savedMsg = await createEvolutionMessage({
      instanceId: instance.id,
      instanceName,
      conversationId,
      remoteJid: jidForConversation,
      messageId: parsed.messageId,
      content: parsed.content || (parsed.messageType === "image" ? "" : parsed.messageType === "audio" ? "" : parsed.messageType === "video" ? "" : parsed.messageType === "sticker" ? "" : ""),
      messageType: parsed.messageType,
      direction: parsed.direction,
      senderName: parsed.senderName || (parsed.fromMe ? "Vendedor" : parsed.phone),
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
          contactName: (parsed.senderName && parsed.senderName !== parsed.phone && !parsed.fromMe) ? parsed.senderName : undefined,
          content: parsed.content,
          messageType: parsed.messageType,
          direction: parsed.direction,
          senderName: parsed.senderName || (parsed.fromMe ? "Vendedor" : parsed.phone),
          mediaUrl: finalMediaUrl || undefined,
          externalId: parsed.messageId ? `evo_${parsed.messageId}` : undefined,
          timestamp: parsed.timestamp,
        });
        if (mirrored) {
          const { emitNewMessage, emitConversationUpdate } = await import("./socket");
          emitNewMessage(mirrored.conversationId, mirrored.message);
          emitConversationUpdate(mirrored.conversationId, {});
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
