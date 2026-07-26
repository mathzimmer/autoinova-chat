/**
 * WhatsApp Multi-Number Service
 *
 * Manages multiple WhatsApp Cloud API numbers from the same WABA.
 * Each number has its own phone_number_id and optional access token.
 * Falls back to the global WHATSAPP_SYSTEM_USER_TOKEN if no per-number token is set.
 */
import axios from "axios";
import { getDb } from "./db";
import {
  whatsappNumbers,
  whatsappNumberConversations,
  whatsappNumberMessages,
} from "../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

// ─── Config helpers ────────────────────────────────────────────────────────────

function getGlobalToken(): string {
  const token =
    process.env.WHATSAPP_SYSTEM_USER_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("No global WhatsApp token configured");
  return token;
}

function getTokenForNumber(numberRecord: { accessToken: string | null }): string {
  return numberRecord.accessToken || getGlobalToken();
}

// ─── Number management ─────────────────────────────────────────────────────────

export async function listWhatsappNumbers() {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  return db.select().from(whatsappNumbers).orderBy(whatsappNumbers.displayName);
}

export async function getWhatsappNumberById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  const rows = await db
    .select()
    .from(whatsappNumbers)
    .where(eq(whatsappNumbers.id, id));
  return rows[0] || null;
}

export async function getWhatsappNumberByPhoneNumberId(phoneNumberId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(whatsappNumbers)
    .where(eq(whatsappNumbers.phoneNumberId, phoneNumberId));
  return rows[0] || null;
}

export async function createWhatsappNumber(data: {
  phoneNumberId: string;
  displayName: string;
  phoneDisplay?: string;
  accessToken?: string;
  wabaId?: string;
  sellerId?: number;
  assignedUserId?: number;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  // Upsert por phoneNumberId (reconectar o mesmo número não duplica)
  const existing = await getWhatsappNumberByPhoneNumberId(data.phoneNumberId);
  if (existing) {
    await db.update(whatsappNumbers).set({
      displayName: data.displayName,
      phoneDisplay: data.phoneDisplay ?? existing.phoneDisplay,
      accessToken: data.accessToken ?? existing.accessToken,
      wabaId: data.wabaId ?? (existing as any).wabaId,
      isActive: true, updatedAt: new Date(),
    } as any).where(eq(whatsappNumbers.id, existing.id));
    return getWhatsappNumberById(existing.id);
  }
  await db.insert(whatsappNumbers).values({
    phoneNumberId: data.phoneNumberId,
    displayName: data.displayName,
    phoneDisplay: data.phoneDisplay,
    accessToken: data.accessToken || null,
    wabaId: data.wabaId || null,
    sellerId: data.sellerId || null,
    assignedUserId: data.assignedUserId || null,
    notes: data.notes || null,
    isActive: true,
  } as any);
  const rows = await db
    .select()
    .from(whatsappNumbers)
    .where(eq(whatsappNumbers.phoneNumberId, data.phoneNumberId));
  return rows[0];
}

/**
 * Assina o app do provedor à WABA para que os webhooks (mensagens) cheguem.
 * Usa o token do provedor (System User). Idempotente do lado da Meta.
 */
export async function subscribeWabaToApp(wabaId: string, token?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const t = token || getGlobalToken();
    await axios.post(`${WHATSAPP_API_URL}/${wabaId}/subscribed_apps`, {}, {
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    });
    console.log(`[WA-Multi] WABA ${wabaId} assinada ao app do provedor`);
    return { success: true };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WA-Multi] Falha ao assinar WABA ${wabaId}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Conexão completa via Embedded Signup: assina a WABA no app + salva o número.
 * O token de envio é o do provedor (System User) por padrão — não precisa token
 * por número. Retorna o registro salvo.
 */
export async function connectNumberFromSignup(data: {
  wabaId: string; phoneNumberId: string; displayName?: string; phoneDisplay?: string;
}) {
  // 1) Garante que as mensagens vão chegar (assina a WABA no app)
  const sub = await subscribeWabaToApp(data.wabaId);
  // 2) Salva/atualiza o número (token do provedor por padrão)
  const record = await createWhatsappNumber({
    phoneNumberId: data.phoneNumberId,
    wabaId: data.wabaId,
    displayName: data.displayName || data.phoneDisplay || `WhatsApp ${data.phoneNumberId.slice(-4)}`,
    phoneDisplay: data.phoneDisplay,
  });
  return { record, subscribed: sub.success, subscribeError: sub.error };
}

export async function updateWhatsappNumber(
  id: number,
  data: {
    displayName?: string;
    phoneDisplay?: string;
    accessToken?: string | null;
    sellerId?: number | null;
    assignedUserId?: number | null;
    isActive?: boolean;
    notes?: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  await db
    .update(whatsappNumbers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(whatsappNumbers.id, id));
  return getWhatsappNumberById(id);
}

export async function deleteWhatsappNumber(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  await db.delete(whatsappNumbers).where(eq(whatsappNumbers.id, id));
}

// ─── Sending messages ──────────────────────────────────────────────────────────

export async function sendTextFromNumber(
  phoneNumberId: string,
  to: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const numRecord = await getWhatsappNumberByPhoneNumberId(phoneNumberId);
  const token = numRecord ? getTokenForNumber(numRecord) : getGlobalToken();

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const messageId = response.data?.messages?.[0]?.id;
    console.log(`[WA-Multi] Text sent from ${phoneNumberId} to ${to}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg =
      error?.response?.data?.error?.message || error.message;
    console.error(
      `[WA-Multi] Failed to send text from ${phoneNumberId} to ${to}:`,
      errMsg
    );
    return { success: false, error: errMsg };
  }
}

export async function sendMediaFromNumber(
  phoneNumberId: string,
  to: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" | "document",
  caption?: string,
  filename?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const numRecord = await getWhatsappNumberByPhoneNumberId(phoneNumberId);
  const token = numRecord ? getTokenForNumber(numRecord) : getGlobalToken();

  const mediaPayload: Record<string, any> = { link: mediaUrl };
  if (caption) mediaPayload.caption = caption;
  if (filename && mediaType === "document") mediaPayload.filename = filename;

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: mediaType,
        [mediaType]: mediaPayload,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const messageId = response.data?.messages?.[0]?.id;
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg =
      error?.response?.data?.error?.message || error.message;
    console.error(
      `[WA-Multi] Failed to send media from ${phoneNumberId} to ${to}:`,
      errMsg
    );
    return { success: false, error: errMsg };
  }
}

export async function markAsReadFromNumber(
  phoneNumberId: string,
  messageId: string
): Promise<void> {
  const numRecord = await getWhatsappNumberByPhoneNumberId(phoneNumberId);
  const token = numRecord ? getTokenForNumber(numRecord) : getGlobalToken();

  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      { messaging_product: "whatsapp", status: "read", message_id: messageId },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch {
    // Non-critical — ignore read receipt errors
  }
}

/** Envia um objeto interactive (Meta Cloud API) pelo token de um número. */
async function sendInteractiveFromNumber(
  phoneNumberId: string,
  to: string,
  interactive: any
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const numRecord = await getWhatsappNumberByPhoneNumberId(phoneNumberId);
  const token = numRecord ? getTokenForNumber(numRecord) : getGlobalToken();
  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      { messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive", interactive },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
    return { success: true, messageId: response.data?.messages?.[0]?.id };
  } catch (error: any) {
    return { success: false, error: error?.response?.data?.error?.message || error.message };
  }
}

export async function sendButtonsFromNumber(
  phoneNumberId: string, to: string, body: string,
  buttons: Array<{ id: string; title: string }>
) {
  return sendInteractiveFromNumber(phoneNumberId, to, {
    type: "button",
    body: { text: body },
    action: { buttons: buttons.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
  });
}

export async function sendListFromNumber(
  phoneNumberId: string, to: string, body: string, buttonText: string,
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
) {
  return sendInteractiveFromNumber(phoneNumberId, to, {
    type: "list",
    body: { text: body },
    action: { button: buttonText.slice(0, 20), sections },
  });
}

// ─── Conversation management ───────────────────────────────────────────────────

export async function upsertWNConversation(data: {
  whatsappNumberId: number;
  phoneNumberId: string;
  customerPhone: string;
  contactName?: string;
  lastMessagePreview?: string;
  direction: "inbound" | "outbound";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");

  const existing = await db
    .select()
    .from(whatsappNumberConversations)
    .where(
      and(
        eq(whatsappNumberConversations.whatsappNumberId, data.whatsappNumberId),
        eq(whatsappNumberConversations.customerPhone, data.customerPhone)
      )
    )
    .limit(1);

  const now = Date.now();

  if (existing.length > 0) {
    const conv = existing[0];
    await db
      .update(whatsappNumberConversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview:
          data.lastMessagePreview || conv.lastMessagePreview,
        contactName: data.contactName || conv.contactName,
        unreadCount:
          data.direction === "inbound"
            ? sql`${whatsappNumberConversations.unreadCount} + 1`
            : conv.unreadCount,
        updatedAt: new Date(),
      })
      .where(eq(whatsappNumberConversations.id, conv.id));
    return conv.id;
  } else {
    await db.insert(whatsappNumberConversations).values({
      whatsappNumberId: data.whatsappNumberId,
      phoneNumberId: data.phoneNumberId,
      customerPhone: data.customerPhone,
      contactName: data.contactName || null,
      lastMessageAt: now,
      lastMessagePreview: data.lastMessagePreview || null,
      unreadCount: data.direction === "inbound" ? 1 : 0,
      status: "open",
      windowExpired: false,
    });
    const created = await db
      .select()
      .from(whatsappNumberConversations)
      .where(
        and(
          eq(whatsappNumberConversations.whatsappNumberId, data.whatsappNumberId),
          eq(whatsappNumberConversations.customerPhone, data.customerPhone)
        )
      )
      .limit(1);
    return created[0]?.id;
  }
}

export async function saveWNMessage(data: {
  whatsappNumberId: number;
  conversationId: number;
  externalMessageId?: string;
  content?: string;
  messageType:
    | "text"
    | "audio"
    | "image"
    | "document"
    | "video"
    | "sticker"
    | "reaction"
    | "system";
  mediaUrl?: string;
  direction: "inbound" | "outbound";
  senderName?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  timestamp: number;
  rawPayload?: any;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");

  // Deduplicate by externalMessageId
  if (data.externalMessageId) {
    const existing = await db
      .select({ id: whatsappNumberMessages.id })
      .from(whatsappNumberMessages)
      .where(
        eq(whatsappNumberMessages.externalMessageId, data.externalMessageId)
      )
      .limit(1);
    if (existing.length > 0) return existing[0].id;
  }

  await db.insert(whatsappNumberMessages).values({
    whatsappNumberId: data.whatsappNumberId,
    conversationId: data.conversationId,
    externalMessageId: data.externalMessageId || null,
    content: data.content || null,
    messageType: data.messageType,
    mediaUrl: data.mediaUrl || null,
    direction: data.direction,
    senderName: data.senderName || null,
    status: data.status || "sent",
    timestamp: data.timestamp,
    rawPayload: data.rawPayload || null,
  });

  const rows = await db
    .select({ id: whatsappNumberMessages.id })
    .from(whatsappNumberMessages)
    .where(eq(whatsappNumberMessages.conversationId, data.conversationId))
    .orderBy(desc(whatsappNumberMessages.id))
    .limit(1);
  return rows[0]?.id;
}

export async function listWNConversations(
  whatsappNumberId: number,
  limit = 50
) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  return db
    .select()
    .from(whatsappNumberConversations)
    .where(
      eq(whatsappNumberConversations.whatsappNumberId, whatsappNumberId)
    )
    .orderBy(desc(whatsappNumberConversations.lastMessageAt))
    .limit(limit);
}

export async function listWNMessages(conversationId: number, limit = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  return db
    .select()
    .from(whatsappNumberMessages)
    .where(eq(whatsappNumberMessages.conversationId, conversationId))
    .orderBy(whatsappNumberMessages.timestamp)
    .limit(limit);
}

export async function updateWNConversation(
  id: number,
  data: {
    contactName?: string;
    status?: "open" | "pending" | "resolved" | "closed";
    leadStatus?: string;
    vehicleInterest?: string;
    notes?: string;
    tags?: string[];
    unreadCount?: number;
    windowExpired?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  await db
    .update(whatsappNumberConversations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(whatsappNumberConversations.id, id));
}

export async function markWNConversationRead(conversationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  await db
    .update(whatsappNumberConversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(whatsappNumberConversations.id, conversationId));
}

export async function getWNConversationById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");
  const rows = await db
    .select()
    .from(whatsappNumberConversations)
    .where(eq(whatsappNumberConversations.id, id))
    .limit(1);
  return rows[0] || null;
}

// ─── Webhook handler ───────────────────────────────────────────────────────────

export async function handleWNWebhook(payload: any): Promise<boolean> {
  try {
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    if (!changes) return false;

    const phoneNumberId: string = changes.metadata?.phone_number_id;
    if (!phoneNumberId) return false;

    // Find the registered number
    const numRecord = await getWhatsappNumberByPhoneNumberId(phoneNumberId);
    if (!numRecord) {
      // Not a multi-number registered phone — let main webhook handle it
      return false;
    }

    // Process status updates
    if (changes.statuses?.length) {
      const db = await getDb();
      if (db) {
        for (const status of changes.statuses) {
          const wamid = status.id;
          const newStatus = status.status;
          if (wamid && newStatus) {
            await db
              .update(whatsappNumberMessages)
              .set({ status: newStatus as any })
              .where(eq(whatsappNumberMessages.externalMessageId, wamid));
          }
        }
      }
    }

    // Process inbound messages
    if (!changes.messages?.length) return true;

    for (const msg of changes.messages) {
      const customerPhone = msg.from;
      const pushName = changes.contacts?.find(
        (c: any) => c.wa_id === msg.from
      )?.profile?.name;
      const timestamp = parseInt(msg.timestamp) * 1000;

      let content = "";
      let messageType:
        | "text"
        | "audio"
        | "image"
        | "document"
        | "video"
        | "sticker"
        | "reaction"
        | "system" = "text";

      if (msg.type === "text") {
        content = msg.text?.body || "";
        messageType = "text";
      } else if (msg.type === "image") {
        messageType = "image";
        content = msg.image?.caption || "";
      } else if (msg.type === "audio" || msg.type === "voice") {
        messageType = "audio";
      } else if (msg.type === "video") {
        messageType = "video";
        content = msg.video?.caption || "";
      } else if (msg.type === "document") {
        messageType = "document";
        content = msg.document?.filename || "";
      } else if (msg.type === "sticker") {
        messageType = "sticker";
      } else if (msg.type === "reaction") {
        messageType = "reaction";
        content = msg.reaction?.emoji || "";
      }

      const preview = content || `[${messageType}]`;

      const convId = await upsertWNConversation({
        whatsappNumberId: numRecord.id,
        phoneNumberId,
        customerPhone,
        contactName: pushName,
        lastMessagePreview: preview,
        direction: "inbound",
      });

      if (!convId) continue;

      await saveWNMessage({
        whatsappNumberId: numRecord.id,
        conversationId: convId,
        externalMessageId: msg.id,
        content,
        messageType,
        direction: "inbound",
        senderName: pushName || customerPhone,
        status: "delivered",
        timestamp,
        rawPayload: msg,
      });

      // ─── Escrita Dupla: Espelhar no inbox unificado (tabela conversations/messages principal) ───
      try {
        const { mirrorWNMessage } = await import("./db");
        const mirrored = await mirrorWNMessage({
          whatsappNumberId: numRecord.id,
          phoneNumberId,
          customerPhone,
          contactName: pushName,
          content,
          messageType,
          direction: "inbound",
          senderName: pushName || customerPhone,
          externalId: msg.id,
          timestamp,
          rawPayload: msg,
        });
        if (mirrored) {
          console.log(`[WA-Multi] ✅ Espelhada no inbox unificado: conv=${mirrored.conversationId} (${phoneNumberId})`);
          const { emitNewMessage, emitConversationUpdate } = await import("./socket");
          emitNewMessage(mirrored.conversationId, mirrored.message);
          emitConversationUpdate(mirrored.conversationId, {});
        }
      } catch (err) {
        console.error("[WA-Multi] Erro ao espelhar no inbox unificado:", err);
      }

      await markAsReadFromNumber(phoneNumberId, msg.id);
    }

    return true;
  } catch (err) {
    console.error("[WA-Multi] Webhook error:", err);
    return false;
  }
}
