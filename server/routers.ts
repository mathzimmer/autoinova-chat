import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import {
  listConversations, getConversationById, createConversation, updateConversation, getConversationByPhone,
  listMessages, createMessage, markMessagesAsRead,
  listLeads, getLeadByConversationId, upsertLead,
  getDashboardStats, getAiStats,
  searchVehicles, listVehicles, createVehicle,
  getSetting, upsertSetting, getAllSettings,
} from "./db";
import { processAIMessage, DEFAULT_SYSTEM_PROMPT } from "./ai";
import { emitNewMessage, emitConversationUpdate, emitTypingIndicator } from "./socket";
import { transcribeAudio } from "./_core/voiceTranscription";
import { sendTextMessage, isConfigured as isWhatsAppConfigured } from "./whatsapp";
import { syncStock } from "./stockSync";

const conversationRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listConversations(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const conv = await getConversationById(input.id);
      if (!conv) throw new Error("Conversation not found");
      return conv;
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["open", "pending", "resolved", "closed"]),
    }))
    .mutation(async ({ input }) => {
      const conv = await updateConversation(input.id, { status: input.status });
      emitConversationUpdate(input.id, conv);
      return conv;
    }),

  toggleAI: protectedProcedure
    .input(z.object({
      id: z.number(),
      aiActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const conv = await updateConversation(input.id, { aiActive: input.aiActive });
      emitConversationUpdate(input.id, conv);
      return conv;
    }),

  assignAgent: protectedProcedure
    .input(z.object({
      id: z.number(),
      agentId: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      const conv = await updateConversation(input.id, {
        assignedTo: input.agentId,
        aiActive: input.agentId ? false : true,
      });
      emitConversationUpdate(input.id, conv);
      return conv;
    }),

  updateContact: protectedProcedure
    .input(z.object({
      id: z.number(),
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
      contactNotes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const conv = await updateConversation(id, data);
      emitConversationUpdate(id, conv);
      return conv;
    }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await markMessagesAsRead(input.id);
      return { success: true };
    }),
});

const messageRouter = router({
  list: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return listMessages(input.conversationId, input.limit);
    }),

  send: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      content: z.string().min(1),
      senderType: z.enum(["agent", "bot"]).default("agent"),
    }))
    .mutation(async ({ input, ctx }) => {
      // When agent sends a message, automatically pause AI
      if (input.senderType === "agent") {
        await updateConversation(input.conversationId, {
          aiActive: false,
          assignedTo: ctx.user.id,
        });
        emitConversationUpdate(input.conversationId, { aiActive: false, assignedTo: ctx.user.id });
      }

      const message = await createMessage({
        conversationId: input.conversationId,
        content: input.content,
        senderType: input.senderType,
        senderName: ctx.user.name || "Atendente",
        messageType: "text",
      });

      emitNewMessage(input.conversationId, message);

      // Send message to WhatsApp if configured and conversation is from WhatsApp
      if (isWhatsAppConfigured()) {
        const conv = await getConversationById(input.conversationId);
        if (conv && conv.channel === "whatsapp" && conv.phone) {
          sendTextMessage(conv.phone, input.content).catch((err) => {
            console.error("[WhatsApp] Failed to send agent message:", err);
          });
        }
      }

      return message;
    }),
});

const leadRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return listLeads(input);
    }),

  getByConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      return getLeadByConversationId(input.conversationId);
    }),

  update: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      name: z.string().optional(),
      intention: z.string().optional(),
      vehicleInterest: z.string().optional(),
      vehicleId: z.number().nullable().optional(),
      hasTrade: z.boolean().optional(),
      tradeVehicle: z.string().optional(),
      tradeYear: z.string().optional(),
      tradeKm: z.string().optional(),
      paymentMethod: z.string().optional(),
      downPayment: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["new", "qualifying", "qualified", "contacted", "converted", "lost"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { conversationId, ...data } = input;
      // Get conversation phone for upsert
      const conv = await getConversationById(conversationId);
      return upsertLead({
        conversationId,
        phone: conv?.phone || "",
        ...data,
      });
    }),
});

const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    const [stats, aiStats] = await Promise.all([
      getDashboardStats(),
      getAiStats(),
    ]);
    return { ...stats, ...aiStats };
  }),
});

const vehicleRouter = router({
  list: protectedProcedure.query(async () => {
    return listVehicles();
  }),

  search: protectedProcedure
    .input(z.object({
      brand: z.string().optional(),
      model: z.string().optional(),
      maxPrice: z.number().optional(),
      category: z.string().optional(),
      transmission: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return searchVehicles(input);
    }),

  create: adminProcedure
    .input(z.object({
      brand: z.string(),
      model: z.string(),
      year: z.number(),
      price: z.number(),
      mileage: z.number().optional(),
      color: z.string().optional(),
      transmission: z.enum(["manual", "automatic"]).optional(),
      fuel: z.string().optional(),
      category: z.string().optional(),
      description: z.string().optional(),
      imageUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await createVehicle({ ...input, available: true });
      return { id };
    }),

  syncStock: adminProcedure
    .mutation(async () => {
      const result = await syncStock();
      return result;
    }),
});

const webhookRouter = router({
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

      // Find or create conversation
      let conversation = await getConversationByPhone(input.phone);
      if (!conversation) {
        conversation = await createConversation({
          phone: input.phone,
          contactName: input.name || null,
          channel: "whatsapp",
          status: "open",
          aiActive: true,
          lastMessageAt: Date.now(),
        });
      }

      if (!conversation) throw new Error("Failed to create conversation");

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

      // Check if AI should respond
      if (conversation.aiActive) {
        emitTypingIndicator(conversation.id, true, "Auto Inova IA");

        const recentMessages = await listMessages(conversation.id, 30);
        
        // For image messages, pass the image URL to the AI for vision processing
        let aiMessageContent = messageContent;
        if (input.messageType === "image" && storedMediaUrl) {
          aiMessageContent = `[IMAGEM: ${storedMediaUrl}] ${messageContent}`;
        }

        const aiResult = await processAIMessage(conversation, recentMessages, aiMessageContent);

        emitTypingIndicator(conversation.id, false, "Auto Inova IA");

        if (aiResult.response) {
          const botMsg = await createMessage({
            conversationId: conversation.id,
            content: aiResult.response,
            senderType: "bot",
            senderName: "Auto Inova IA",
            messageType: "text",
          });

          emitNewMessage(conversation.id, botMsg);

          return { conversationId: conversation.id, aiResponse: aiResult.response, leadData: aiResult.leadData };
        }
      }

      return { conversationId: conversation.id, aiResponse: null, leadData: null };
    }),
});

const settingsRouter = router({
  getPrompt: protectedProcedure.query(async () => {
    const customPrompt = await getSetting("ai_prompt");
    return {
      prompt: customPrompt || DEFAULT_SYSTEM_PROMPT,
      isCustom: !!customPrompt,
      defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    };
  }),

  savePrompt: adminProcedure
    .input(z.object({ prompt: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ai_prompt", input.prompt, ctx.user.id);
      return { success: true };
    }),

  resetPrompt: adminProcedure
    .mutation(async ({ ctx }) => {
      await upsertSetting("ai_prompt", "", ctx.user.id);
      return { success: true, defaultPrompt: DEFAULT_SYSTEM_PROMPT };
    }),

  getAll: protectedProcedure.query(async () => {
    return getAllSettings();
  }),

  save: adminProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting(input.key, input.value, ctx.user.id);
      return { success: true };
    }),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  conversation: conversationRouter,
  message: messageRouter,
  lead: leadRouter,
  dashboard: dashboardRouter,
  vehicle: vehicleRouter,
  webhook: webhookRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
