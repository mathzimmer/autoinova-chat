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
  // Ensure phone is in correct format: 5511999999999@s.whatsapp.net
  const number = to.includes("@") ? to.split("@")[0] : to;
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
  const number = to.includes("@") ? to.split("@")[0] : to;
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
      key: { remoteJid: string; fromMe: boolean; id: string };
      message: Record<string, unknown>;
      messageType: string;
      messageTimestamp: number;
      pushName?: string;
      status?: string;
    };

    const remoteJid = msg.key?.remoteJid || "";
    const fromMe = msg.key?.fromMe || false;
    const messageId = msg.key?.id || "";
    const timestamp = (msg.messageTimestamp || Date.now() / 1000) * 1000;
    const pushName = msg.pushName || "";

    // Extract text content
    let content = "";
    let messageType: "text" | "audio" | "image" | "document" | "video" | "sticker" | "reaction" | "system" = "text";
    let mediaUrl = "";

    const msgData = msg.message || {};

    if (msgData.conversation) {
      content = msgData.conversation as string;
    } else if ((msgData.extendedTextMessage as Record<string, unknown>)?.text) {
      content = ((msgData.extendedTextMessage as Record<string, unknown>).text) as string;
    } else if (msgData.imageMessage) {
      messageType = "image";
      content = ((msgData.imageMessage as Record<string, unknown>).caption as string) || "[Imagem]";
    } else if (msgData.videoMessage) {
      messageType = "video";
      content = ((msgData.videoMessage as Record<string, unknown>).caption as string) || "[Vídeo]";
    } else if (msgData.audioMessage || msgData.pttMessage) {
      messageType = "audio";
      content = "[Áudio]";
    } else if (msgData.documentMessage) {
      messageType = "document";
      content = ((msgData.documentMessage as Record<string, unknown>).fileName as string) || "[Documento]";
    } else if (msgData.stickerMessage) {
      messageType = "sticker";
      content = "[Sticker]";
    } else if (msgData.reactionMessage) {
      messageType = "reaction";
      content = ((msgData.reactionMessage as Record<string, unknown>).text as string) || "[Reação]";
    } else {
      content = "[Mensagem]";
    }

    // Skip group messages
    if (remoteJid.includes("@g.us")) return null;
    // Skip status messages
    if (remoteJid === "status@broadcast") return null;

    const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");

    return {
      type: "message" as const,
      instanceName: instance,
      remoteJid,
      phone,
      fromMe,
      messageId,
      timestamp,
      content,
      messageType,
      mediaUrl,
      senderName: fromMe ? "Vendedor" : pushName,
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
