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
  getActiveTeamMembers, getTeamMemberById,
  createActivityLog, listActivityLogs,
  createTeamNotification, listTeamNotifications, markNotificationsAsRead, getUnreadNotificationCount,
} from "./db";
import { processAIMessage, DEFAULT_SYSTEM_PROMPT, DEFAULT_PERSONALITY_PROMPT, CORE_PROMPT, COMMERCIAL_PROMPT, getPersonalityPrompt, getCorePrompt, getCommercialPrompt } from "./ai";
import { emitNewMessage, emitConversationUpdate, emitTypingIndicator } from "./socket";
import { transcribeAudio } from "./_core/voiceTranscription";
import { sendTextMessage, sendImageMessage, sendAudioMessage, isConfigured as isWhatsAppConfigured } from "./whatsapp";
import { storagePut } from "./storage";
import { convertWebmToOgg, needsConversionForWhatsApp, isWebmAudio } from "./audioConverter";
import { syncStock } from "./stockSync";
import crypto from "crypto";
import { getDb } from "./db";
import { createTeamMember, updateTeamMember, deactivateTeamMember, hashPassword, authenticateTeamMember } from "./teamAuth";
import { listTeamMembers as listTeamMembersAuth } from "./teamAuth";
import { sdk } from "./_core/sdk";
import { ONE_YEAR_MS } from "@shared/const";

/**
 * Extract vehicle IDs from AI response and send their images
 */
async function sendVehicleImages(conversationPhone: string, aiResponse: string) {
  // Extract all [ID:X] patterns from the response
  const idMatches = aiResponse.match(/\[ID:(\d+)\]/g);
  if (!idMatches || idMatches.length === 0) return;

  const vehicleIds = Array.from(new Set(idMatches.map(m => parseInt(m.match(/\d+/)![0])))); // Remove duplicates
  const db = await getDb();
  if (!db) return;

  // Get vehicle images
  const vehiclesTable = (await import("../drizzle/schema")).vehicles;
  const { eq, inArray } = await import("drizzle-orm");
  
  try {
    const vehicleRecords = await db
      .select()
      .from(vehiclesTable)
      .where(inArray(vehiclesTable.id, vehicleIds))
      .limit(5); // Send max 5 images

    // Send each image with a small delay to avoid rate limiting
    for (const vehicle of vehicleRecords) {
      if (!vehicle.imageUrl) continue;
      
      const caption = `${vehicle.title || `${vehicle.brand} ${vehicle.model}`} (${vehicle.year})`;
      await sendImageMessage(conversationPhone, vehicle.imageUrl, caption);
      
      // Small delay between images
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error("[Webhook] Failed to send vehicle images:", err);
  }
}

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

  sendMedia: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      mediaType: z.enum(["image", "audio"]),
      base64Data: z.string(), // base64 encoded file data
      mimeType: z.string(),
      fileName: z.string().optional(),
      caption: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // When agent sends media, automatically pause AI
      await updateConversation(input.conversationId, {
        aiActive: false,
        assignedTo: ctx.user.id,
      });
      emitConversationUpdate(input.conversationId, { aiActive: false, assignedTo: ctx.user.id });

      // Upload original to S3 (for chat display)
      const buffer = Buffer.from(input.base64Data, "base64");
      const uploadMimeType = input.mimeType;
      const uploadExt = input.mimeType.split("/")[1]?.split(";")[0] || "bin";

      console.log(`[SendMedia] Received ${input.mediaType}: mimeType=${input.mimeType}, size=${buffer.length} bytes`);

      // === AUDIO CONVERSION FOR WHATSAPP ===
      // RULE: NEVER send webm to WhatsApp. Always convert to ogg first.
      // If conversion fails, audio is NOT sent to WhatsApp (but still saved in chat).
      // Strategy: Upload OGG directly to WhatsApp Media API (recommended by Meta)
      // instead of using hosted URL links (which can be inaccessible).
      let whatsappAudioUrl: string | null = null;
      let whatsappAudioBuffer: Buffer | null = null;
      let audioConversionFailed = false;

      if (input.mediaType === "audio" && needsConversionForWhatsApp(input.mimeType)) {
        console.log(`[SendMedia] ⚠️ Audio needs conversion: ${input.mimeType} is NOT accepted by WhatsApp`);
        console.log(`[SendMedia] Original format: ${input.mimeType}`);
        console.log(`[SendMedia] Target format: audio/ogg (opus codec)`);

        try {
          const oggBuffer = await convertWebmToOgg(buffer);
          whatsappAudioBuffer = oggBuffer;
          
          // Also upload to S3 for backup/reference
          const oggRandomSuffix = crypto.randomBytes(8).toString("hex");
          const oggFileKey = `chat-media/${ctx.user.id}/${Date.now()}-${oggRandomSuffix}.ogg`;
          const { url: oggUrl } = await storagePut(oggFileKey, oggBuffer, "audio/ogg");
          whatsappAudioUrl = oggUrl;

          console.log(`[SendMedia] ✅ Audio converted successfully`);
          console.log(`[SendMedia]   Original: ${input.mimeType} (${buffer.length} bytes)`);
          console.log(`[SendMedia]   Converted: audio/ogg (${oggBuffer.length} bytes)`);
          console.log(`[SendMedia]   S3 backup URL: ${oggUrl}`);
          console.log(`[SendMedia]   Will upload directly to WhatsApp Media API`);
        } catch (err: any) {
          audioConversionFailed = true;
          console.error(`[SendMedia] ❌ Audio conversion FAILED: ${err.message}`);
          console.error(`[SendMedia] ❌ Audio will NOT be sent to WhatsApp (webm is not accepted)`);
        }
      } else if (input.mediaType === "audio") {
        // Audio is already in a WhatsApp-compatible format, keep the buffer for direct upload
        whatsappAudioBuffer = buffer;
        console.log(`[SendMedia] Audio already in compatible format: ${input.mimeType}`);
      }

      // Upload original file to S3 (for chat display in the CRM)
      const randomSuffix = crypto.randomBytes(8).toString("hex");
      const fileKey = `chat-media/${ctx.user.id}/${Date.now()}-${randomSuffix}.${uploadExt}`;
      const { url: mediaUrl } = await storagePut(fileKey, buffer, uploadMimeType);
      console.log(`[SendMedia] Original file uploaded to S3: ${mediaUrl}`);

      // Save message to database
      const content = input.mediaType === "image"
        ? (input.caption || "[Imagem enviada]")
        : "[Mensagem de voz]";

      const message = await createMessage({
        conversationId: input.conversationId,
        content,
        senderType: "agent",
        senderName: ctx.user.name || "Atendente",
        messageType: input.mediaType,
        metadata: { mediaUrl, mimeType: input.mimeType, fileName: input.fileName },
      });

      emitNewMessage(input.conversationId, message);

      // === SEND TO WHATSAPP ===
      if (isWhatsAppConfigured()) {
        const conv = await getConversationById(input.conversationId);
        console.log(`[SendMedia] WhatsApp configured. Conv: ${conv?.id}, channel: ${conv?.channel}, phone: ${conv?.phone}`);

        if (conv && conv.channel === "whatsapp" && conv.phone) {
          if (input.mediaType === "image") {
            console.log(`[SendMedia] Sending image to WhatsApp: phone=${conv.phone}, URL=${mediaUrl}`);
            sendImageMessage(conv.phone, mediaUrl, input.caption).then((result) => {
              console.log(`[SendMedia] WhatsApp image result:`, JSON.stringify(result));
            }).catch((err) => {
              console.error("[WhatsApp] Failed to send agent image:", err);
            });

          } else if (input.mediaType === "audio") {
            // STRICT RULE: Never send webm to WhatsApp
            if (audioConversionFailed) {
              console.error(`[SendMedia] ❌ BLOCKED: Audio NOT sent to WhatsApp because conversion failed`);
              console.error(`[SendMedia] ❌ Original format ${input.mimeType} is not accepted by WhatsApp`);
            } else if (isWebmAudio(input.mimeType) && !whatsappAudioUrl) {
              console.error(`[SendMedia] ❌ BLOCKED: webm audio cannot be sent to WhatsApp without conversion`);
            } else {
              // Use converted ogg URL, or original if it's already in a WhatsApp-compatible format
              const audioUrlForWhatsApp = whatsappAudioUrl || mediaUrl;
              const finalMime = whatsappAudioUrl ? "audio/ogg" : input.mimeType;
              console.log(`[SendMedia] Sending audio to WhatsApp:`);
              console.log(`[SendMedia]   Phone: ${conv.phone}`);
              console.log(`[SendMedia]   URL: ${audioUrlForWhatsApp}`);
              console.log(`[SendMedia]   MIME: ${finalMime}`);
              console.log(`[SendMedia]   Was converted: ${!!whatsappAudioUrl}`);

              // Pass the buffer for direct upload to WhatsApp Media API (recommended)
              sendAudioMessage(conv.phone, audioUrlForWhatsApp, whatsappAudioBuffer || undefined).then((result) => {
                console.log(`[SendMedia] ✅ WhatsApp audio result:`, JSON.stringify(result));
              }).catch((err) => {
                console.error(`[WhatsApp] ❌ Failed to send agent audio:`, err);
              });
            }
          }
        }
      } else {
        console.log(`[SendMedia] WhatsApp not configured, skipping delivery`);
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

      // === REATIVAÇÃO AUTOMÁTICA ===
      // Se a conversa estava resolved/closed e o cliente mandou nova mensagem,
      // reabrir automaticamente com IA ativa
      if (conversation.status === "resolved" || conversation.status === "closed") {
        console.log(`[Webhook] REATIVAÇÃO: Conversa ${conversation.id} (${conversation.phone}) estava ${conversation.status}. Reabrindo com IA ativa.`);
        conversation = await updateConversation(conversation.id, {
          status: "open",
          aiActive: true,
          assignedTo: null, // Remove atribuição anterior para IA atender primeiro
          lastMessageAt: Date.now(),
        }) || conversation;
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

          // Send vehicle images asynchronously (don't wait for completion)
          sendVehicleImages(conversation.phone, aiResult.response).catch(err => 
            console.error("[Webhook] Error sending vehicle images:", err)
          );

          return { conversationId: conversation.id, aiResponse: aiResult.response, leadData: aiResult.leadData };
        }
      }

      return { conversationId: conversation.id, aiResponse: null, leadData: null };
    }),
});

const settingsRouter = router({
  getPrompt: protectedProcedure.query(async () => {
    // Return all layers (current values from DB or defaults)
    const corePrompt = await getCorePrompt();
    const commercialPrompt = await getCommercialPrompt();
    const personalityPrompt = await getPersonalityPrompt();

    // Check which layers are customized
    const customCore = await getSetting("ai_core_prompt");
    const customCommercial = await getSetting("ai_commercial_prompt");
    const customPersonality = await getSetting("ai_personality_prompt");
    const legacyPrompt = await getSetting("ai_prompt");

    return {
      corePrompt,
      commercialPrompt,
      personalityPrompt,
      coreIsCustom: !!(customCore && customCore.trim()),
      commercialIsCustom: !!(customCommercial && customCommercial.trim()),
      personalityIsCustom: !!(customPersonality && customPersonality.trim()) || !!(legacyPrompt && legacyPrompt.trim()),
      defaultCorePrompt: CORE_PROMPT,
      defaultCommercialPrompt: COMMERCIAL_PROMPT,
      defaultPersonalityPrompt: DEFAULT_PERSONALITY_PROMPT,
    };
  }),

  savePrompt: adminProcedure
    .input(z.object({
      layer: z.enum(["core", "commercial", "personality"]),
      prompt: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const keyMap: Record<string, string> = {
        core: "ai_core_prompt",
        commercial: "ai_commercial_prompt",
        personality: "ai_personality_prompt",
      };
      await upsertSetting(keyMap[input.layer], input.prompt, ctx.user.id);
      // Clear legacy prompt if saving personality (migration)
      if (input.layer === "personality") {
        const legacyPrompt = await getSetting("ai_prompt");
        if (legacyPrompt) {
          await upsertSetting("ai_prompt", "", ctx.user.id);
        }
      }
      return { success: true };
    }),

  resetPrompt: adminProcedure
    .input(z.object({
      layer: z.enum(["core", "commercial", "personality"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const keyMap: Record<string, string> = {
        core: "ai_core_prompt",
        commercial: "ai_commercial_prompt",
        personality: "ai_personality_prompt",
      };
      const defaultMap: Record<string, string> = {
        core: CORE_PROMPT,
        commercial: COMMERCIAL_PROMPT,
        personality: DEFAULT_PERSONALITY_PROMPT,
      };
      await upsertSetting(keyMap[input.layer], "", ctx.user.id);
      if (input.layer === "personality") {
        await upsertSetting("ai_prompt", "", ctx.user.id);
      }
      return { success: true, defaultPrompt: defaultMap[input.layer] };
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

// ─── Team Members Router ──────────────────────────────────────
const teamRouter = router({
  list: protectedProcedure.query(async () => {
    return getActiveTeamMembers();
  }),

  listAll: adminProcedure.query(async () => {
    return listTeamMembersAuth();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getTeamMemberById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
      cargo: z.enum(["admin", "gerente", "vendedor", "suporte"]).default("vendedor"),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await createTeamMember(input.name, input.email, input.password, input.cargo);
      await createActivityLog({
        userId: ctx.user.id,
        action: "create_team_member",
        details: { name: input.name, email: input.email, cargo: input.cargo },
      });
      return { success: true };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      cargo: z.enum(["admin", "gerente", "vendedor", "suporte"]).optional(),
      status: z.enum(["ativo", "inativo"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      await updateTeamMember(id, updates);
      await createActivityLog({
        userId: ctx.user.id,
        action: "update_team_member",
        details: { memberId: id, ...updates },
      });
      return { success: true };
    }),

  resetPassword: adminProcedure
    .input(z.object({
      id: z.number(),
      newPassword: z.string().min(6),
    }))
    .mutation(async ({ input, ctx }) => {
      const newHash = hashPassword(input.newPassword);
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { teamMembers: tm } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(tm).set({ passwordHash: newHash }).where(eq(tm.id, input.id));
      await createActivityLog({
        userId: ctx.user.id,
        action: "reset_password",
        details: { memberId: input.id },
      });
      return { success: true };
    }),

  deactivate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await deactivateTeamMember(input.id);
      await createActivityLog({
        userId: ctx.user.id,
        action: "deactivate_team_member",
        details: { memberId: input.id },
      });
      return { success: true };
    }),
});

// ─── Team Auth Router ──────────────────────────────────────
const TEAM_COOKIE = "team_session";

const teamAuthRouter = router({
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const member = await authenticateTeamMember(input.email, input.password);
      if (!member) {
        throw new Error("Email ou senha inválidos");
      }
      // Create a virtual openId for this team member
      const virtualOpenId = `team_member_${member.id}`;
      // Ensure a user record exists for this team member
      const existingUser = await getUserByOpenId(virtualOpenId);
      if (!existingUser) {
        await upsertUser({
          openId: virtualOpenId,
          name: member.name,
          email: member.email,
          role: member.cargo === "admin" ? "admin" : "user",
          lastSignedIn: new Date(),
        });
      } else {
        await upsertUser({
          openId: virtualOpenId,
          name: member.name,
          lastSignedIn: new Date(),
        });
      }
      // Create session token and set cookie
      const token = await sdk.createSessionToken(virtualOpenId, { name: member.name });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      return {
        success: true,
        member: { id: member.id, name: member.name, email: member.email, cargo: member.cargo },
      };
    }),

  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    // Check if this is a team member
    if (ctx.user.openId.startsWith("team_member_")) {
      const memberId = parseInt(ctx.user.openId.replace("team_member_", ""));
      const member = await getTeamMemberById(memberId);
      if (member) {
        return {
          ...ctx.user,
          teamMember: { id: member.id, name: member.name, email: member.email, cargo: member.cargo, status: member.status },
          isTeamMember: true,
        };
      }
    }
    return { ...ctx.user, teamMember: null, isTeamMember: false };
  }),
});

import { getUserByOpenId, upsertUser } from "./db";

// ─── Notification Router ──────────────────────────────────────
const notificationRouter = router({
  list: protectedProcedure
    .input(z.object({ unreadOnly: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return listTeamNotifications(ctx.user.id, input?.unreadOnly);
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return getUnreadNotificationCount(ctx.user.id);
  }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markNotificationsAsRead(ctx.user.id);
    return { success: true };
  }),
});

// ─── Activity Log Router ──────────────────────────────────────
const activityRouter = router({
  list: protectedProcedure
    .input(z.object({
      conversationId: z.number().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listActivityLogs(input?.conversationId, input?.limit);
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
  team: teamRouter,
  teamAuth: teamAuthRouter,
  notification: notificationRouter,
  activity: activityRouter,
});

export type AppRouter = typeof appRouter;
