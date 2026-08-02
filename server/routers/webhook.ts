// ── Webhook Router (extraído de routers.ts no PR #10 — só move) ─────────────
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  createConversation, updateConversation, createMessage, createTeamNotification,
  getConversationByPhone, getSetting,
  getContactByPhone, createContact, updateContact,
} from "../db";
import { normalizePhone } from "../phoneNormalize";
import { emitNewMessage } from "../socket";
import { transcribeAudio } from "../_core/voiceTranscription";
import { addToDebounce } from "../messageDebounce";

export const webhookRouter = router({
  // WhatsApp Cloud API webhook verification
  verify: publicProcedure
    .input(z.object({
      mode: z.string().optional(),
      token: z.string().optional(),
      challenge: z.string().optional(),
    }))
    .query(({ input }) => {
      const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "autoinova_verify_token";
      if (input.mode === "subscribe" && input.token === VERIFY_TOKEN) {
        return input.challenge || "OK";
      }
      return "Forbidden";
    }),

  // Process incoming WhatsApp message
  receive: publicProcedure
    .input(z.object({
      phone: z.string(),
      name: z.string().optional(),
      content: z.string(),
      messageType: z.enum(["text", "audio", "image", "document"]).default("text"),
      audioUrl: z.string().optional(),
      mediaUrl: z.string().optional(),
      externalId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      let messageContent = input.content;
      let storedMediaUrl = input.mediaUrl || undefined;
      let transcribedText: string | undefined;

      // Handle audio: transcribe + keep audio URL for playback
      if (input.messageType === "audio") {
        const audioSource = input.mediaUrl || input.audioUrl;
        console.log(`[Webhook] Audio message received. Source URL: ${audioSource || 'none'}`);
        if (audioSource) {
          storedMediaUrl = audioSource;
          // Transcribe the audio
          try {
            console.log(`[Webhook] Starting audio transcription from: ${audioSource}`);
            const transcription = await transcribeAudio({
              audioUrl: audioSource,
              language: "pt",
              prompt: "Transcrever mensagem de voz do cliente sobre veículos e automóveis",
            });
            console.log(`[Webhook] Transcription result:`, JSON.stringify(transcription).substring(0, 500));
            if ("text" in transcription && transcription.text) {
              transcribedText = transcription.text;
              messageContent = transcription.text;
              console.log(`[Webhook] Audio transcribed successfully: "${transcription.text}"`);
            } else if ("error" in transcription) {
              console.error(`[Webhook] Transcription error: ${transcription.error} (${transcription.code}) - ${transcription.details || ''}`);
              // Keep audio URL for playback, tell AI it's an untranscribed audio
              messageContent = "[Cliente enviou uma mensagem de áudio que não pôde ser transcrita. Peça gentilmente para o cliente digitar a mensagem.]";
            } else {
              console.error(`[Webhook] Transcription returned unexpected format`);
              messageContent = "[Cliente enviou uma mensagem de áudio que não pôde ser transcrita. Peça gentilmente para o cliente digitar a mensagem.]";
            }
          } catch (err) {
            console.error("[Webhook] Audio transcription exception:", err);
            messageContent = "[Cliente enviou uma mensagem de áudio que não pôde ser transcrita. Peça gentilmente para o cliente digitar a mensagem.]";
          }
        } else {
          console.warn(`[Webhook] Audio message received but no URL available`);
        }
      }

      // Handle image: store URL for display and AI vision
      if (input.messageType === "image" && input.mediaUrl) {
        storedMediaUrl = input.mediaUrl;
        // If no caption, set a descriptive content
        if (!messageContent || messageContent === "[Imagem recebida]") {
          messageContent = "[Imagem enviada pelo cliente]";
        }
      }

      // Normalize phone for consistent matching
      const normPhone = normalizePhone;
      const normalizedPhone = normPhone(input.phone);

      // Find or create conversation (tries phone variations automatically)
      let conversation = await getConversationByPhone(input.phone);
      if (!conversation) {
        conversation = await createConversation({
          phone: normalizedPhone || input.phone,
          contactName: input.name || null,
          channel: "whatsapp",
          status: "open",
          aiActive: true,
          lastMessageAt: Date.now(),
        });
      } else if (conversation.phone !== normalizedPhone && normalizedPhone.length >= 12) {
        // Update conversation phone to normalized form for future exact matches
        console.log(`[Webhook] Normalizing conversation phone: ${conversation.phone} → ${normalizedPhone}`);
        await updateConversation(conversation.id, { phone: normalizedPhone });
      }

      if (!conversation) throw new Error("Failed to create conversation");

      // === LEAD ÚNICO POR PESSOA (cria no 1º contato; reativa se finalizado) ===
      try {
        const { getOrCreateLeadByPhone } = await import("../db");
        await getOrCreateLeadByPhone({ phone: input.phone, conversationId: conversation.id, name: input.name });
      } catch (err) {
        console.error("[Lead] ensure (whatsapp):", err);
      }

      // === AUTO-SYNC CONTATO NA AGENDA ===
      try {
        const existingContact = await getContactByPhone(input.phone);
        if (!existingContact) {
          await createContact({
            name: input.name || conversation.contactName || "Cliente",
            phone: normalizedPhone || input.phone,
            conversationId: conversation.id,
            source: "whatsapp",
            isActive: true,
          });
          console.log(`[Webhook] Auto-sync: contato criado na agenda para ${normalizedPhone}`);
        } else {
          // Atualizar conversationId se não tinha
          if (!existingContact.conversationId && conversation.id) {
            await updateContact(existingContact.id, { conversationId: conversation.id });
          }
          // Atualizar nome se mudou
          if (input.name && input.name !== existingContact.name && existingContact.name === "Cliente") {
            await updateContact(existingContact.id, { name: input.name });
          }
          // Normalize phone on existing contact if different
          if (existingContact.phone !== normalizedPhone && normalizedPhone.length >= 12) {
            console.log(`[Webhook] Normalizing contact phone: ${existingContact.phone} → ${normalizedPhone}`);
            await updateContact(existingContact.id, { phone: normalizedPhone });
          }
        }
      } catch (err) {
        // Non-critical, don't fail the webhook
        console.error(`[Webhook] Auto-sync contato falhou:`, err);
      }

      // === CSAT: resposta pode ser uma nota pendente (1-5) ===
      let csatHandled = false;
      if (conversation.status === "resolved" || conversation.status === "closed") {
        try {
          const { captureCsatReply } = await import("../csat");
          csatHandled = await captureCsatReply(conversation.id, messageContent);
        } catch (err) {
          console.error("[Webhook] CSAT capture erro:", err);
        }
      }

      // === REATIVAÇÃO AUTOMÁTICA (com carência) ===
      // Carência: se o cliente responde logo após o fechamento (ex.: "obrigado"),
      // a conversa volta para o MESMO atendente, sem reiniciar IA/fluxo.
      // Fora da carência: reabre com IA ativa (comportamento padrão).
      if (!csatHandled && (conversation.status === "resolved" || conversation.status === "closed")) {
        const graceMinutes = Number(await getSetting("reopen_grace_minutes")) || 30;
        const closedAgoMs = Date.now() - new Date(conversation.updatedAt).getTime();
        const withinGrace = closedAgoMs < graceMinutes * 60 * 1000 && !!conversation.assignedTo;

        if (withinGrace) {
          console.log(`[Webhook] CARÊNCIA: Conversa ${conversation.id} fechada há ${Math.round(closedAgoMs / 60000)}min. Devolvendo ao atendente ${conversation.assignedTo} sem IA.`);
          conversation = await updateConversation(conversation.id, {
            status: "open",
            aiActive: false, // mantém com o atendente que fechou
            lastMessageAt: Date.now(),
          }) || conversation;
        } else {
          console.log(`[Webhook] REATIVAÇÃO: Conversa ${conversation.id} (${conversation.phone}) estava ${conversation.status}. Reabrindo com IA ativa.`);
          conversation = await updateConversation(conversation.id, {
            status: "open",
            aiActive: true,
            assignedTo: null, // Remove atribuição anterior para IA atender primeiro
            lastMessageAt: Date.now(),
          }) || conversation;
        }
      }

      // Build metadata with media info
      const metadata: Record<string, unknown> = {};
      if (storedMediaUrl) metadata.mediaUrl = storedMediaUrl;
      if (transcribedText) metadata.transcribedText = transcribedText;
      if (input.audioUrl) metadata.originalAudioUrl = input.audioUrl;

      // Save customer message
      const customerMsg = await createMessage({
        conversationId: conversation.id,
        content: messageContent,
        senderType: "customer",
        senderName: input.name || conversation.contactName || "Cliente",
        messageType: input.messageType,
        externalId: input.externalId,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      });

      emitNewMessage(conversation.id, customerMsg);

      // Detecta origem do lead (portal/anúncio na 1ª mensagem) e etiqueta
      try { const { applyLeadOrigin } = await import("../db"); applyLeadOrigin(conversation.id, messageContent).catch(() => {}); } catch { /* noop */ }

      // Notify assigned agent if conversation is assigned and AI is off
      if (conversation.assignedTo && !conversation.aiActive) {
        createTeamNotification({
          userId: conversation.assignedTo,
          type: "new_message",
          title: "Nova mensagem",
          message: `${conversation.contactName || conversation.phone}: ${messageContent.substring(0, 100)}`,
          conversationId: conversation.id,
        }).catch(err => console.error("[Webhook] Error creating notification:", err));
      }

      // Sempre agrupa no debounce (o fluxo pode disparar mesmo com IA desligada;
      // a IA "livre" é liberada só se aiActive dentro do callback).
      // (nota de CSAT consumida não aciona nada)
      if (!csatHandled) {
        // Prepara o conteúdo para o debounce
        let aiMessageContent = messageContent;
        if (input.messageType === "image" && storedMediaUrl) {
          aiMessageContent = `[IMAGEM: ${storedMediaUrl}] ${messageContent}`;
        }

        // Adiciona ao buffer de debounce (IA será chamada quando o timer expirar)
        addToDebounce(conversation.id, aiMessageContent, input.messageType, storedMediaUrl);
      }

      return { conversationId: conversation.id, aiResponse: null, leadData: null, aiMessageId: null };
    }),
});
