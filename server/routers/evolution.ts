// ── Evolution Router (extraído de routers.ts no PR #10 — só move) ───────────
import { z } from "zod";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { currentTeamMember } from "./_helpers";
import {
  evolutionFetchInstances, evolutionCreateInstance, evolutionGetQrCode,
  evolutionGetInstanceStatus, evolutionDeleteInstance, evolutionLogoutInstance,
  evolutionRestartInstance, evolutionSendText, evolutionSendMedia,
  evolutionGetProfilePic, evolutionFetchAllContacts, evolutionGetMediaBase64,
} from "../evolutionService";
import {
  listEvolutionInstances, getEvolutionInstanceByName, createEvolutionInstance,
  updateEvolutionInstance, deleteEvolutionInstance as deleteEvolutionInstanceDb,
  listEvolutionConversations, getEvolutionConversationById,
  updateEvolutionConversation, listEvolutionMessages, createEvolutionMessage,
  upsertEvolutionConversation,
} from "../db";

export const evolutionRouter = router({
  // List all instances stored in DB (vendedor vê só as dele)
  listInstances: protectedProcedure.query(async ({ ctx }) => {
    const rows = await listEvolutionInstances();
    const member = await currentTeamMember(ctx);
    if (member && member.cargo === "vendedor") {
      return (rows as any[]).filter((r) => r.assignedUserId === member.id);
    }
    return rows;
  }),

  /** Vincula um vendedor (usuário da equipe) a uma instância (número dele) */
  assignUser: adminProcedure
    .input(z.object({ id: z.number(), userId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      await updateEvolutionInstance(input.id, { assignedUserId: input.userId ?? null } as any);
      return { success: true };
    }),

  // Sync instances from Evolution API into DB
  syncInstances: protectedProcedure.mutation(async () => {
    const apiInstances = await evolutionFetchInstances() as Array<{ instance: { instanceName: string; owner?: string; profilePictureUrl?: string; connectionStatus?: string } }>;
    const dbInstances = await listEvolutionInstances();
    const dbMap = new Map(dbInstances.map(i => [i.instanceName, i]));

    for (const item of apiInstances) {
      const name = item.instance?.instanceName;
      if (!name) continue;
      const status = item.instance?.connectionStatus === "open" ? "connected" : "disconnected";
      const existing = dbMap.get(name);
      if (existing) {
        await updateEvolutionInstance(existing.id, { status: status as "connected" | "disconnected", phone: item.instance?.owner });
      } else {
        await createEvolutionInstance({
          instanceName: name,
          displayName: name,
          phone: item.instance?.owner,
          status: status as "connected" | "disconnected",
          profilePicUrl: item.instance?.profilePictureUrl,
          webhookConfigured: false,
        });
      }
    }
    return listEvolutionInstances();
  }),

  // Create a new instance
  createInstance: protectedProcedure
    .input(z.object({ instanceName: z.string().min(2), displayName: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const webhookUrl = `${process.env.VITE_OAUTH_PORTAL_URL?.replace("portal", "api") || ""}/webhook/evolution`;
      const appUrl = (ctx.req as { headers: Record<string, string> }).headers?.origin || "";
      const wh = `${appUrl}/api/webhook/evolution`;

      // Create in Evolution API
      const result = await evolutionCreateInstance(input.instanceName, wh) as any;
      const qrCode = (result?.qrcode?.base64 as string) || "";

      // Save to DB
      const id = await createEvolutionInstance({
        instanceName: input.instanceName,
        displayName: input.displayName || input.instanceName,
        status: "connecting",
        qrCode,
        webhookConfigured: true,
      });
      return { id, qrCode, instanceName: input.instanceName };
    }),

  // Get QR code for an instance
  getQrCode: protectedProcedure
    .input(z.object({ instanceName: z.string() }))
    .query(async ({ input }) => {
      const result = await evolutionGetQrCode(input.instanceName);
      const qrCode = (result as Record<string, unknown>)?.base64 as string || (result as Record<string, unknown>)?.code as string || "";
      // Update DB
      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (inst) await updateEvolutionInstance(inst.id, { qrCode, status: "qr_code" });
      return { qrCode };
    }),

  // Get connection status
  getStatus: protectedProcedure
    .input(z.object({ instanceName: z.string() }))
    .query(async ({ input }) => {
      const result = await evolutionGetInstanceStatus(input.instanceName) as Record<string, unknown>;
      const state = (result?.instance as Record<string, unknown>)?.state as string || "close";
      const status = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (inst) await updateEvolutionInstance(inst.id, { status: status as "connected" | "disconnected" | "connecting" });
      return { status, state };
    }),

  // Logout (disconnect) instance
  logoutInstance: protectedProcedure
    .input(z.object({ instanceName: z.string() }))
    .mutation(async ({ input }) => {
      await evolutionLogoutInstance(input.instanceName);
      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (inst) await updateEvolutionInstance(inst.id, { status: "disconnected", qrCode: null });
      return { success: true };
    }),

  // Restart instance
  restartInstance: protectedProcedure
    .input(z.object({ instanceName: z.string() }))
    .mutation(async ({ input }) => {
      await evolutionRestartInstance(input.instanceName);
      return { success: true };
    }),

  // Delete instance
  deleteInstance: protectedProcedure
    .input(z.object({ id: z.number(), instanceName: z.string() }))
    .mutation(async ({ input }) => {
      try { await evolutionDeleteInstance(input.instanceName); } catch { /* ignore if not in API */ }
      await deleteEvolutionInstanceDb(input.id);
      return { success: true };
    }),

  // Update instance metadata (displayName, sellerId, assignedUserId)
  updateInstance: protectedProcedure
    .input(z.object({
      id: z.number(),
      displayName: z.string().optional(),
      sellerId: z.number().nullable().optional(),
      assignedUserId: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateEvolutionInstance(id, data);
      return { success: true };
    }),

  // List conversations for an instance
  listConversations: protectedProcedure
    .input(z.object({ instanceId: z.number().optional() }))
    .query(async ({ input }) => {
      return listEvolutionConversations(input.instanceId);
    }),

  // List messages for a conversation
  listMessages: protectedProcedure
    .input(z.object({ conversationId: z.number(), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      return listEvolutionMessages(input.conversationId, input.limit);
    }),

  // Send a text message
  sendMessage: protectedProcedure
    .input(z.object({
      instanceName: z.string(),
      remoteJid: z.string(),
      text: z.string(),
      conversationId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // For @lid JIDs, send as-is — Baileys routes them internally via linked-device table
      // Do NOT try to convert @lid to @s.whatsapp.net as the phone stored is the internal ID, not a real number
      const sendTo = input.remoteJid;
      let result: unknown;
      let sendFailed = false;
      try {
        result = await evolutionSendText(input.instanceName, sendTo, input.text);
      } catch (err: any) {
        // If sending to @lid fails, don't crash — save message locally as pending
        if (sendTo.endsWith("@lid")) {
          console.warn(`[Evolution] Send to @lid failed (non-blocking): ${err.message}`);
          sendFailed = true;
        } else {
          throw err;
        }
      }
      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (inst && input.conversationId) {
        await createEvolutionMessage({
          instanceId: inst.id,
          instanceName: input.instanceName,
          conversationId: input.conversationId,
          remoteJid: sendTo,
          messageId: sendFailed ? `local_${Date.now()}` : ((result as any)?.key?.id as string || undefined),
          content: input.text,
          messageType: "text",
          direction: "outbound",
          senderName: ctx.user?.name || "Vendedor",
          status: sendFailed ? "failed" : "sent",
          timestamp: Date.now(),
          rawPayload: sendFailed ? undefined : (result as Record<string, unknown>),
        });
        await updateEvolutionConversation(input.conversationId, {
          lastMessageAt: Date.now(),
          lastMessagePreview: input.text.slice(0, 100),
        });
      }
      return {
        success: !sendFailed,
        result,
        pendingDelivery: sendFailed,
        message: sendFailed ? "Mensagem salva. Ser\u00e1 entregue quando o n\u00famero real for identificado." : undefined,
      };
    }),

  // Send media (image/video/document/audio) from URL
  sendMedia: protectedProcedure
    .input(z.object({
      instanceName: z.string(),
      remoteJid: z.string(),
      mediaUrl: z.string(),
      mediaType: z.enum(["image", "video", "audio", "document"]),
      caption: z.string().optional(),
      fileName: z.string().optional(),
      conversationId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await evolutionSendMedia(
        input.instanceName,
        input.remoteJid,
        input.mediaUrl,
        input.mediaType,
        input.caption,
        input.fileName
      );
      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (inst && input.conversationId) {
        await createEvolutionMessage({
          instanceId: inst.id,
          instanceName: input.instanceName,
          conversationId: input.conversationId,
          remoteJid: input.remoteJid,
          messageId: (result as any)?.key?.id as string || undefined,
          content: input.caption || `[${input.mediaType}]`,
          messageType: input.mediaType,
          mediaUrl: input.mediaUrl,
          direction: "outbound",
          senderName: ctx.user?.name || "Vendedor",
          status: "sent",
          timestamp: Date.now(),
        });
        await updateEvolutionConversation(input.conversationId, {
          lastMessageAt: Date.now(),
          lastMessagePreview: input.caption || `[${input.mediaType}]`,
        });
      }
      return { success: true, result };
    }),

  // Upload media file and send
  uploadAndSendMedia: protectedProcedure
    .input(z.object({
      instanceName: z.string(),
      remoteJid: z.string(),
      fileBase64: z.string(),
      mimeType: z.string(),
      fileName: z.string(),
      caption: z.string().optional(),
      conversationId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Upload to S3
      const buf = Buffer.from(input.fileBase64, "base64");
      const ext = input.fileName.split(".").pop() || "bin";
      const key = `evolution-media/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { url } = await storagePut(key, buf, input.mimeType);

      // Determine media type
      const mime = input.mimeType.toLowerCase();
      const mediaType: "image" | "video" | "audio" | "document" =
        mime.startsWith("image/") ? "image" :
        mime.startsWith("video/") ? "video" :
        mime.startsWith("audio/") ? "audio" : "document";

      const result = await evolutionSendMedia(
        input.instanceName,
        input.remoteJid,
        url,
        mediaType,
        input.caption,
        input.fileName
      );

      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (inst && input.conversationId) {
        await createEvolutionMessage({
          instanceId: inst.id,
          instanceName: input.instanceName,
          conversationId: input.conversationId,
          remoteJid: input.remoteJid,
          messageId: (result as any)?.key?.id as string || undefined,
          content: input.caption || input.fileName,
          messageType: mediaType,
          mediaUrl: url,
          direction: "outbound",
          senderName: ctx.user?.name || "Vendedor",
          status: "sent",
          timestamp: Date.now(),
        });
        await updateEvolutionConversation(input.conversationId, {
          lastMessageAt: Date.now(),
          lastMessagePreview: input.caption || `[${mediaType}]`,
        });
      }
      return { success: true, url, mediaType };
    }),

  // Start a new conversation (send first message)
  startConversation: protectedProcedure
    .input(z.object({
      instanceName: z.string(),
      phone: z.string(),
      text: z.string(),
      contactName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (!inst) throw new Error("Instância não encontrada");

      // Normalize phone
      const phone = input.phone.replace(/\D/g, "");
      const remoteJid = `${phone}@s.whatsapp.net`;

      // Send message
      const result = await evolutionSendText(input.instanceName, phone, input.text);

      // Upsert conversation
      const convId = await upsertEvolutionConversation({
        instanceId: inst.id,
        instanceName: input.instanceName,
        remoteJid,
        phone,
        contactName: input.contactName || phone,
        lastMessageAt: Date.now(),
        lastMessagePreview: input.text.slice(0, 100),
        unreadCount: 0,
        status: "open",
      });

      // Save message
      await createEvolutionMessage({
        instanceId: inst.id,
        instanceName: input.instanceName,
        conversationId: convId,
        remoteJid,
        messageId: (result as any)?.key?.id as string || undefined,
        content: input.text,
        messageType: "text",
        direction: "outbound",
        senderName: ctx.user?.name || "Vendedor",
        status: "sent",
        timestamp: Date.now(),
      });

      return { success: true, conversationId: convId, remoteJid };
    }),

  // Get profile picture of a contact
  getProfilePic: protectedProcedure
    .input(z.object({ instanceName: z.string(), phone: z.string() }))
    .query(async ({ input }) => {
      try {
        const result = await evolutionGetProfilePic(input.instanceName, input.phone) as any;
        return { url: result?.profilePictureUrl || result?.url || null };
      } catch {
        return { url: null };
      }
    }),

  // Update conversation (status, contactName, phone, notes)
  updateConversation: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
      contactName: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
      leadStatus: z.string().optional(),
      vehicleInterest: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      // If phone is being updated, also update remoteJid to @s.whatsapp.net
      if (data.phone) {
        const cleanPhone = data.phone.replace(/\D/g, "");
        (data as any).phone = cleanPhone;
        (data as any).remoteJid = `${cleanPhone}@s.whatsapp.net`;
      }
      await updateEvolutionConversation(id, data);
      return { success: true };
    }),

  // Resolve real WhatsApp number for a @lid conversation via Evolution API
  resolveContactPhone: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      instanceName: z.string(),
    }))
    .mutation(async ({ input }) => {
      const conv = await getEvolutionConversationById(input.conversationId);
      if (!conv) throw new Error("Conversa não encontrada");

      // Only try to resolve if it's a @lid conversation
      if (!conv.remoteJid?.endsWith("@lid")) {
        return { success: true, resolved: false, message: "Já possui número real" };
      }

      // The @lid numeric part is NOT a real phone — we need to check via Evolution API
      // Try the contacts endpoint first to find a matching contact
      const contacts = await evolutionFetchAllContacts(input.instanceName);
      const lidId = conv.remoteJid.replace("@lid", "");

      // Look for a contact whose id matches the @lid
      const match = contacts.find((c: any) => {
        const contactId = (c.id || "").replace("@lid", "").replace("@s.whatsapp.net", "").replace("@c.us", "");
        return contactId === lidId;
      });

      if (match) {
        // Extract real phone from the contact's id or phone field
        let realPhone = "";
        let realJid = "";

        if (match.id && (match.id.endsWith("@s.whatsapp.net") || match.id.endsWith("@c.us"))) {
          realPhone = match.id.replace("@s.whatsapp.net", "").replace("@c.us", "");
          realJid = `${realPhone}@s.whatsapp.net`;
        } else if (match.phone) {
          realPhone = match.phone.replace(/\D/g, "");
          realJid = `${realPhone}@s.whatsapp.net`;
        }

        if (realPhone) {
          const contactName = match.pushName || match.name || conv.contactName || realPhone;
          await updateEvolutionConversation(input.conversationId, {
            phone: realPhone,
            remoteJid: realJid,
            contactName: (contactName !== "Vendedor" && contactName !== conv.phone) ? contactName : conv.contactName || realPhone,
          });
          // Also update all messages in this conversation
          const db = await import("../../drizzle/schema").then(s => s);
          console.log(`[Evolution] Resolved @lid ${conv.remoteJid} -> ${realJid} (${contactName})`);
          return { success: true, resolved: true, phone: realPhone, jid: realJid, name: contactName };
        }
      }

      return { success: true, resolved: false, message: "Não foi possível resolver o número via API. Use a edição manual." };
    }),

  // Sync all contacts from Evolution instance — resolves @lid conversations
  syncContacts: protectedProcedure
    .input(z.object({ instanceName: z.string() }))
    .mutation(async ({ input }) => {
      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (!inst) throw new Error("Instância não encontrada");

      // Fetch all contacts from Evolution
      const contacts = await evolutionFetchAllContacts(input.instanceName);
      if (!contacts || contacts.length === 0) {
        return { success: true, updated: 0, message: "Nenhum contato encontrado na instância" };
      }

      // Build a map: lid_id -> { phone, name }
      const lidMap = new Map<string, { phone: string; jid: string; name: string }>();
      const phoneMap = new Map<string, { name: string }>();

      for (const c of contacts) {
        const id = c.id || "";
        const name = c.pushName || c.name || "";

        if (id.endsWith("@lid")) {
          const lidId = id.replace("@lid", "");
          // @lid contacts don't have real phone in id — skip for now
          // but store the name if we find a matching @s.whatsapp.net contact later
          lidMap.set(lidId, { phone: "", jid: id, name });
        } else if (id.endsWith("@s.whatsapp.net") || id.endsWith("@c.us")) {
          const phone = id.replace("@s.whatsapp.net", "").replace("@c.us", "");
          phoneMap.set(phone, { name });
          // Check if there's a corresponding @lid in the map
          // (Evolution sometimes returns both @lid and @s.whatsapp.net for the same contact)
        }
      }

      // Get all @lid conversations for this instance
      const allConvs = await listEvolutionConversations(inst.id);
      const lidConvs = allConvs.filter((c: any) => c.remoteJid?.endsWith("@lid"));

      let updated = 0;
      let nameUpdated = 0;

      for (const conv of lidConvs) {
        const lidId = conv.remoteJid.replace("@lid", "");
        const contactInfo = lidMap.get(lidId);

        if (contactInfo?.phone) {
          // We have a real phone for this @lid
          const updateData: any = {
            phone: contactInfo.phone,
            remoteJid: contactInfo.jid,
          };
          if (contactInfo.name && contactInfo.name !== "Vendedor") {
            updateData.contactName = contactInfo.name;
          }
          await updateEvolutionConversation(conv.id, updateData);
          updated++;
        } else if (contactInfo?.name && contactInfo.name !== "Vendedor" && contactInfo.name !== conv.contactName) {
          // At least update the name
          await updateEvolutionConversation(conv.id, { contactName: contactInfo.name });
          nameUpdated++;
        }
      }

      // Also update names for @s.whatsapp.net conversations that have no name
      const normalConvs = allConvs.filter((c: any) =>
        !c.remoteJid?.endsWith("@lid") &&
        (!c.contactName || c.contactName === c.phone || c.contactName === c.remoteJid)
      );
      for (const conv of normalConvs) {
        const info = phoneMap.get(conv.phone || "");
        if (info?.name && info.name !== "Vendedor") {
          await updateEvolutionConversation(conv.id, { contactName: info.name });
          nameUpdated++;
        }
      }

      return {
        success: true,
        updated,
        nameUpdated,
        totalContacts: contacts.length,
        message: `${updated} números resolvidos, ${nameUpdated} nomes atualizados de ${contacts.length} contatos`,
      };
    }),

  // Mark conversation as read
  markAsRead: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      await updateEvolutionConversation(input.conversationId, { unreadCount: 0 });
      return { success: true };
    }),

  // Webhook endpoint for Evolution API events
  webhook: publicProcedure
    .input(z.any())
    .mutation(async ({ input }) => {
      try {
        const payload = input as { event: string; instance: string; data: Record<string, unknown> };
        const { parseWebhookMessage } = await import("../evolutionService");
        const parsed = parseWebhookMessage(payload);
        if (!parsed) return { ok: true };

        if (parsed.type === "qrcode") {
          const inst = await getEvolutionInstanceByName(parsed.instanceName);
          if (inst) await updateEvolutionInstance(inst.id, { qrCode: parsed.qrCode, status: "qr_code" });
        }

        if (parsed.type === "connection") {
          const inst = await getEvolutionInstanceByName(parsed.instanceName);
          if (inst) {
            const status = parsed.state === "open" ? "connected" : "disconnected";
            await updateEvolutionInstance(inst.id, {
              status: status as "connected" | "disconnected",
              qrCode: parsed.state === "open" ? null : inst.qrCode,
              lastConnectedAt: parsed.state === "open" ? Date.now() : inst.lastConnectedAt,
            });
          }
        }

        if (parsed.type === "message") {
          const inst = await getEvolutionInstanceByName(parsed.instanceName);
          if (!inst) return { ok: true };

          // Upsert conversation
          const convId = await upsertEvolutionConversation({
            instanceId: inst.id,
            instanceName: parsed.instanceName,
            remoteJid: parsed.remoteJid,
            phone: parsed.phone,
            contactName: parsed.senderName || parsed.phone,
            lastMessageAt: parsed.timestamp,
            lastMessagePreview: parsed.content?.slice(0, 100),
            unreadCount: parsed.direction === "inbound" ? 1 : 0,
            status: "open",
          });

          // Save message
          await createEvolutionMessage({
            instanceId: inst.id,
            instanceName: parsed.instanceName,
            conversationId: convId,
            remoteJid: parsed.remoteJid,
            messageId: parsed.messageId,
            content: parsed.content,
            messageType: parsed.messageType,
            direction: parsed.direction,
            senderName: parsed.senderName,
            status: "delivered",
            timestamp: parsed.timestamp,
            rawPayload: parsed.rawPayload as any,
          });
        }
      } catch (err) {
        console.error("[Evolution Webhook] Error:", err);
      }
      return { ok: true };
    }),

  // Link a contact to a conversation
  linkContact: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      contactId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await updateEvolutionConversation(input.conversationId, { contactId: input.contactId } as any);
      return { success: true };
    }),

  // Get linked contact for a conversation
  getLinkedContact: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const conv = await getEvolutionConversationById(input.conversationId);
      if (!conv || !conv.contactId) return null;
      const db = await (await import("../db")).getDb();
      if (!db) return null;
      const { contacts } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(contacts).where(eq(contacts.id, conv.contactId)).limit(1);
      return rows[0] || null;
    }),

  // Fetch media URL on demand (for messages that were saved without mediaUrl)
  getMediaUrl: protectedProcedure
    .input(z.object({
      instanceName: z.string(),
      messageId: z.string(),
      remoteJid: z.string().optional(),
      fromMe: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { evolutionGetMediaBase64 } = await import("../evolutionService");
      const { storagePut } = await import("../storage");
      const mediaData = await evolutionGetMediaBase64(input.instanceName, {
        id: input.messageId,
        remoteJid: input.remoteJid,
        fromMe: input.fromMe,
      });
      if (!mediaData) return { url: null };
      if (mediaData.startsWith("http")) return { url: mediaData };
      if (mediaData.startsWith("data:")) {
        // Parsing robusto (mimetype pode vir como "audio/ogg; codecs=opus")
        const commaIdx = mediaData.indexOf(",");
        if (commaIdx > 5) {
          const header = mediaData.slice(5, commaIdx);
          const mime = (header.split(";")[0] || "application/octet-stream").trim();
          const buffer = Buffer.from(mediaData.slice(commaIdx + 1), "base64");
          const ext = mime.split("/")[1]?.trim() || "bin";
          const key = `evolution-media/${input.instanceName}/${Date.now()}-${input.messageId.slice(-8)}.${ext}`;
          const { url } = await storagePut(key, buffer, mime);
          return { url };
        }
      }
      return { url: null };
    }),

  // Save contact from inbox (creates or merges) and links to conversation
  saveAndLinkContact: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      name: z.string().min(1),
      phone: z.string().min(8),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { autoLinkOrCreateContact } = await import("../db");
      const contactId = await autoLinkOrCreateContact(input.phone, input.name);
      if (!contactId) throw new Error("Failed to create/link contact");
      // Update contact notes if provided
      if (input.notes) {
        const db = await (await import("../db")).getDb();
        if (db) {
          const { contacts } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          await db.update(contacts).set({ notes: input.notes }).where(eq(contacts.id, contactId));
        }
      }
      // Link to conversation AND update contactName so it shows in the list
      await updateEvolutionConversation(input.conversationId, { contactId, contactName: input.name } as any);
      return { contactId, success: true };
    }),
});
