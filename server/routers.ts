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
  listAiDecisions, getAiDecisionsByConversation, getAiDecisionStats,
  updateMessageExternalId, setWindowExpired,
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

// ── Meta Ads imports ──────────────────────────────────────────────────────────
import { metaAds as metaAdsTable } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import {
  createAdForVehicle,
  createOrGetCampaign,
  createAdSet,
  uploadAdImage,
  createAd,
  metaPost,
  metaGet,
  setAdStatus,
  getAdInsights,
  buildMetaConfig,
  importAdsFromMeta,
  listCampaigns,
  listAdSets,
  createAdInExistingAdSet,
} from "./metaAds";

// ── Follow-Up imports ────────────────────────────────────────────────────────
import {
  getFollowUpConfig,
  saveFollowUpConfig,
  getFollowUpHistory,
  getFollowUpStats,
  runFollowUpJob,
  restartFollowUpJob,
} from "./followUp";
import { listTemplates, sendWhatsAppTemplate, isTemplateApproved, isTemplatesConfigured } from "./whatsappTemplates";
import { invokeLLM } from "./_core/llm";
import { runTokenHealthCheck, getLastCheckResults } from "./tokenMonitor";

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
      let deliveryStatus: "sent" | "failed" | null = null;
      let deliveryError: string | null = null;
      let windowExpired = false;

      if (isWhatsAppConfigured()) {
        const conv = await getConversationById(input.conversationId);
        if (conv && conv.channel === "whatsapp" && conv.phone) {
          try {
            const sendResult = await sendTextMessage(conv.phone, input.content);
            
            if (sendResult.success && sendResult.messageId) {
              // Save the wamid for delivery tracking
              await updateMessageExternalId(message.id, sendResult.messageId);
              deliveryStatus = "sent";
            } else if (sendResult.error) {
              deliveryError = sendResult.error;
              deliveryStatus = "failed";
              
              // Detect 24h window expiry (error 131047)
              const isWindowError = sendResult.error.includes('131047') || 
                sendResult.error.includes('Re-engagement') ||
                sendResult.error.includes('outside the allowed window');
              
              if (isWindowError) {
                windowExpired = true;
                await setWindowExpired(input.conversationId, true);
                console.log(`[WhatsApp] 24h window expired for conversation ${input.conversationId}. Template required.`);
              }
              
              // Update message status to failed
              await createMessage({
                conversationId: input.conversationId,
                content: `⚠️ Mensagem não entregue: ${isWindowError ? 'Janela de 24h expirada. Use um template aprovado para reabrir a conversa.' : sendResult.error}`,
                senderType: "bot",
                senderName: "Sistema",
                messageType: "system",
              }).then(sysMsg => {
                if (sysMsg) emitNewMessage(input.conversationId, sysMsg);
              }).catch(() => {});
            }
          } catch (err: any) {
            console.error("[WhatsApp] Failed to send agent message:", err);
            deliveryError = err.message || "Erro desconhecido";
            deliveryStatus = "failed";
          }
        }
      }

      return { ...message, deliveryStatus, deliveryError, windowExpired };
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

          return { conversationId: conversation.id, aiResponse: aiResult.response, leadData: aiResult.leadData, aiMessageId: botMsg?.id || null };
        }
      }

      return { conversationId: conversation.id, aiResponse: null, leadData: null, aiMessageId: null };
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

// ─── AI Decision Router ──────────────────────────────────────
const aiDecisionRouter = router({
  list: adminProcedure
    .input(z.object({
      conversationId: z.number().optional(),
      toolName: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listAiDecisions({
        conversationId: input?.conversationId,
        toolName: input?.toolName,
        limit: input?.limit || 50,
        offset: input?.offset || 0,
      });
    }),

  byConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      return getAiDecisionsByConversation(input.conversationId);
    }),

  stats: adminProcedure
    .query(async () => {
      return getAiDecisionStats();
    }),
});

// ── Follow-Up Router ─────────────────────────────────────────────────────────

const followUpRouter = router({
  // Get current config
  getConfig: adminProcedure.query(async () => {
    return getFollowUpConfig();
  }),

  // Save config
  saveConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      maxAttempts: z.number().min(1).max(10).optional(),
      inactiveHours: z.number().min(1).max(168).optional(),
      intervalHours: z.number().min(1).max(72).optional(),
      maxPerRun: z.number().min(1).max(100).optional(),
      useTemplateAfter24h: z.boolean().optional(),
      templateName: z.string().optional(),
      messages: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const config = await saveFollowUpConfig(input, ctx.user.id);
      restartFollowUpJob();
      return config;
    }),

  // Get history
  history: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return getFollowUpHistory(input?.limit ?? 50, input?.offset ?? 0);
    }),

  // Get stats
  stats: adminProcedure.query(async () => {
    return getFollowUpStats();
  }),

  // Run job manually
  runNow: adminProcedure.mutation(async () => {
    const result = await runFollowUpJob();
    return result;
  }),
});

// ── WhatsApp Templates Router ─────────────────────────────────────────────────

const whatsappTemplateRouter = router({
  // Check if templates are configured
  isConfigured: adminProcedure.query(() => {
    return isTemplatesConfigured();
  }),

  // List available templates
  list: adminProcedure.query(async () => {
    return listTemplates();
  }),

  // Check if a template is approved
  checkApproval: adminProcedure
    .input(z.object({ templateName: z.string() }))
    .query(async ({ input }) => {
      const approved = await isTemplateApproved(input.templateName);
      return { approved };
    }),

  // Send a template message manually and save it in the conversation
  send: adminProcedure
    .input(z.object({
      phone: z.string(),
      templateName: z.string(),
      bodyParams: z.array(z.string()).default([]),
      language: z.string().default("pt_BR"),
      conversationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await sendWhatsAppTemplate(
        input.phone,
        input.templateName,
        input.bodyParams,
        input.language
      );
      if (!result.success) throw new Error(result.error ?? "Falha ao enviar template");

      // Find the conversation by phone if conversationId not provided
      let conversationId = input.conversationId;
      if (!conversationId) {
        const conv = await getConversationByPhone(input.phone);
        conversationId = conv?.id;
      }

      // Save the template message in the conversation
      if (conversationId) {
        // Build a human-readable content for the template message
        let templateContent = `[Template: ${input.templateName}]`;
        if (input.bodyParams.length > 0) {
          templateContent += `\nPar\u00e2metros: ${input.bodyParams.join(", ")}`;
        }

        const msg = await createMessage({
          conversationId,
          content: templateContent,
          senderType: "bot",
          senderName: "Sistema",
          messageType: "text",
          metadata: {
            isTemplate: true,
            templateName: input.templateName,
            templateParams: input.bodyParams,
            templateLanguage: input.language,
          },
        });

        // Save the wamid for delivery tracking
        if (result.messageId && msg) {
          await updateMessageExternalId(msg.id, result.messageId);
        }

        // Reset window expired flag since template reopens the window
        await setWindowExpired(conversationId, false);

        // Emit the new message via socket
        emitNewMessage(conversationId, msg);
      }

      return result;
    }),
});

// ── Token Health Router ────────────────────────────────────────────────────────

const tokenHealthRouter = router({
  // Get last check results (cached)
  status: adminProcedure.query(() => {
    return getLastCheckResults();
  }),

  // Force a manual health check
  check: adminProcedure.mutation(async () => {
    const results = await runTokenHealthCheck();
    return results;
  }),
});

// ── Meta Ads Router ──────────────────────────────────────────────────────────

const metaAdsRouter = router({
  // Verificar se Meta Ads está configurado
  isConfigured: protectedProcedure.query(() => {
    const missingVars = [
      !process.env.META_ADS_ACCESS_TOKEN && "META_ADS_ACCESS_TOKEN",
      !process.env.META_ADS_ACCOUNT_ID   && "META_ADS_ACCOUNT_ID",
      !process.env.META_ADS_PAGE_ID      && "META_ADS_PAGE_ID",
    ].filter(Boolean) as string[];
    return { configured: missingVars.length === 0, missingVars };
  }),

  // Listar anúncios com dados do veículo
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { vehicles: vehiclesTable } = await import("../drizzle/schema");
    const ads = await db
      .select({ ad: metaAdsTable, vehicle: vehiclesTable })
      .from(metaAdsTable)
      .leftJoin(vehiclesTable, eq(metaAdsTable.vehicleId, vehiclesTable.id))
      .orderBy(desc(metaAdsTable.createdAt))
      .limit(100);
    return ads;
  }),

  // Listar campanhas existentes da conta Meta
  listCampaigns: protectedProcedure.query(async () => {
    const config = buildMetaConfig();
    if (!config.accessToken || !config.adAccountId) {
      throw new Error("Meta Ads não configurado.");
    }
    return listCampaigns(config.accessToken, config.adAccountId);
  }),

  // Listar adsets de uma campanha
  listAdSets: protectedProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      const config = buildMetaConfig();
      if (!config.accessToken) throw new Error("Meta Ads não configurado.");
      return listAdSets(config.accessToken, input.campaignId);
    }),

  // Criar anúncio em adset existente (fluxo simplificado)
  createAdInAdSet: protectedProcedure
    .input(z.object({
      vehicleId:    z.number(),
      campaignId:   z.string(),
      adSetId:      z.string(),
      headline:     z.string(),
      description:  z.string(),
      primaryText:  z.string(),
      selectedImageUrl: z.string().optional(),
      campaignObjective: z.string().optional(),
      carouselImageUrls: z.array(z.string()).optional(),
      carouselCaptions: z.array(z.string()).optional(),
      pixelId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const config = buildMetaConfig();
      if (!config.accessToken || !config.adAccountId || !config.pageId) {
        throw new Error("Meta Ads não configurado.");
      }
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const { vehicles: vehiclesTable } = await import("../drizzle/schema");
      const vehicleRows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).limit(1);
      if (!vehicleRows.length) throw new Error("Veículo não encontrado");
      const v = vehicleRows[0];
      if (!v.imageUrl) throw new Error("Veículo sem imagem");

      const result = await createAdInExistingAdSet(
        config,
        input.adSetId,
        input.campaignId,
        {
          brand: v.brand, model: v.model, year: v.year,
          price: v.price, mileage: v.mileage ?? 0,
          transmission: v.transmission ?? "manual",
          fuel: v.fuel ?? "flex",
          color: v.color ?? "",
          id: v.id, imageUrl: v.imageUrl,
        },
        {
          headline: input.headline,
          description: input.description,
          primaryText: input.primaryText,
        },
        input.selectedImageUrl,
        input.campaignObjective,
        input.carouselImageUrls,
        input.carouselCaptions,
        input.pixelId
      );

      // Salvar no banco
      await db.insert(metaAdsTable).values({
        vehicleId: input.vehicleId,
        campaignId: input.campaignId,
        adSetId: input.adSetId,
        adCreativeId: result.adCreativeId,
        adId: result.adId,
        imageHash: result.imageHash,
        status: "paused",
        dailyBudgetCents: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return { success: true, adId: result.adId, campaignId: input.campaignId, adSetId: input.adSetId };
    }),

  // Ativar anúncio
  activate: protectedProcedure
    .input(z.object({ adId: z.string() }))
    .mutation(async ({ input }) => {
      const config = buildMetaConfig();
      const ok = await setAdStatus(input.adId, "ACTIVE", config.accessToken);
      if (!ok) throw new Error("Falha ao ativar anúncio");
      const db = await getDb();
      if (db) {
        await db.update(metaAdsTable)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(metaAdsTable.adId, input.adId));
      }
      return { success: true };
    }),

  // Pausar anúncio
  pause: protectedProcedure
    .input(z.object({ adId: z.string() }))
    .mutation(async ({ input }) => {
      const config = buildMetaConfig();
      const ok = await setAdStatus(input.adId, "PAUSED", config.accessToken);
      if (!ok) throw new Error("Falha ao pausar anúncio");
      const db = await getDb();
      if (db) {
        await db.update(metaAdsTable)
          .set({ status: "paused", updatedAt: new Date() })
          .where(eq(metaAdsTable.adId, input.adId));
      }
      return { success: true };
    }),

  // Sincronizar métricas de um anúncio
  syncInsights: protectedProcedure
    .input(z.object({ adId: z.string() }))
    .mutation(async ({ input }) => {
      const config = buildMetaConfig();
      const insights = await getAdInsights(input.adId, config.accessToken);
      if (!insights) throw new Error("Não foi possível obter métricas");
      const db = await getDb();
      if (db) {
        await db.update(metaAdsTable)
          .set({
            impressions:     insights.impressions,
            clicks:          insights.clicks,
            leads:           insights.leads,
            spendCents:      Math.round(insights.spend * 100),
            lastInsightSync: new Date(),
            updatedAt:       new Date(),
          })
          .where(eq(metaAdsTable.adId, input.adId));
      }
      return insights;
    }),

  // Sincronizar métricas de todos os anúncios ativos
  syncAllInsights: protectedProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database indisponível");
    const config = buildMetaConfig();
    const activeAds = await db
      .select({ adId: metaAdsTable.adId })
      .from(metaAdsTable)
      .where(eq(metaAdsTable.status, "active"));
    let synced = 0;
    for (const { adId } of activeAds) {
      const insights = await getAdInsights(adId, config.accessToken);
      if (insights) {
        await db.update(metaAdsTable)
          .set({
            impressions:     insights.impressions,
            clicks:          insights.clicks,
            leads:           insights.leads,
            spendCents:      Math.round(insights.spend * 100),
            lastInsightSync: new Date(),
            updatedAt:       new Date(),
          })
          .where(eq(metaAdsTable.adId, adId));
        synced++;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return { synced };
  }),

  // Importar anúncios existentes da conta Meta
  importFromMeta: protectedProcedure.mutation(async () => {
    const config = buildMetaConfig();
    if (!config.accessToken || !config.adAccountId) {
      throw new Error("Meta Ads não configurado. Adicione ACCESS_TOKEN e ACCOUNT_ID.");
    }
    const result = await importAdsFromMeta(config.accessToken, config.adAccountId);
    return result;
  }),

  // Sincronizar tudo: importar + atualizar métricas
  syncAll: protectedProcedure.mutation(async () => {
    const config = buildMetaConfig();
    if (!config.accessToken || !config.adAccountId) {
      throw new Error("Meta Ads não configurado.");
    }
    // 1. Importar/atualizar anúncios da conta
    const importResult = await importAdsFromMeta(config.accessToken, config.adAccountId);
    return {
      imported: importResult.imported,
      updated: importResult.updated,
      errors: importResult.errors,
    };
  }),

  // Gerar texto do anúncio com IA
  generateAdText: protectedProcedure
    .input(z.object({
      vehicleId: z.number(),
      style: z.enum(["persuasivo", "informativo", "urgente", "premium", "jovem"]).optional().default("persuasivo"),
      targetAudience: z.string().optional(),
      highlights: z.string().optional(),
      extraInstructions: z.string().optional(),
      numCarouselImages: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const { vehicles: vehiclesTable } = await import("../drizzle/schema");
      const vehicleRows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).limit(1);
      if (!vehicleRows.length) throw new Error("Veículo não encontrado");
      const v = vehicleRows[0];

      const fmtPrice = v.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
      const fmtKm = (v.mileage ?? 0).toLocaleString("pt-BR");

      const styleGuides: Record<string, string> = {
        persuasivo: "Tom persuasivo e envolvente, foque nos benefícios e no desejo de compra. Use gatilhos emocionais.",
        informativo: "Tom informativo e direto, destaque especificações técnicas e dados concretos do veículo.",
        urgente: "Tom de urgência e escassez, use frases como 'Última unidade', 'Oportunidade única', 'Não perca'.",
        premium: "Tom sofisticado e elegante, foque na exclusividade, conforto e status do veículo.",
        jovem: "Tom descontraído e moderno, use linguagem jovem e dinâmica, emojis com moderação.",
      };

      const styleInstruction = styleGuides[input.style] || styleGuides.persuasivo;
      const audienceInstruction = input.targetAudience ? `\nPúblico-alvo: ${input.targetAudience}` : "";
      const highlightsInstruction = input.highlights ? `\nDestaques a enfatizar: ${input.highlights}` : "";
      const extraInstruction = input.extraInstructions ? `\nInstruções adicionais: ${input.extraInstructions}` : "";

      // Get features if available
      const featuresStr = v.features && Array.isArray(v.features) ? (v.features as string[]).slice(0, 10).join(", ") : "";

      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Você é um copywriter especializado em anúncios de veículos para Facebook e Instagram.
${styleInstruction}
Crie textos otimizados para conversão.
Sempre retorne JSON válido.`
          },
          {
            role: "user",
            content: `Crie um anúncio para este veículo:

Marca: ${v.brand}
Modelo: ${v.model}
Versão: ${v.version || "N/I"}
Ano: ${v.year}
Preço: ${fmtPrice}
Quilometragem: ${fmtKm} km
Câmbio: ${v.transmission || "N/I"}
Combustível: ${v.fuel || "N/I"}
Cor: ${v.color || "N/I"}
Categoria: ${v.category || "N/I"}
${featuresStr ? `Opcionais: ${featuresStr}` : ""}
${v.description ? `Descrição: ${v.description.slice(0, 200)}` : ""}${audienceInstruction}${highlightsInstruction}${extraInstruction}

Retorne um JSON com:
{
  "headline": "Título curto e impactante (máx 40 caracteres)",
  "description": "Descrição curta para o card (máx 90 caracteres)",
  "primaryText": "Texto principal do anúncio (3-5 linhas, use emojis com moderação)",
  "callToAction": "Frase de chamada para ação (1 linha)"${input.numCarouselImages && input.numCarouselImages >= 2 ? `,
  "carouselCaptions": ["Legenda curta para foto 1 (máx 40 chars)", "Legenda curta para foto 2", ... até ${input.numCarouselImages} legendas]` : ""}
}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ad_text",
            strict: true,
            schema: {
              type: "object",
              properties: {
                headline: { type: "string", description: "Título curto" },
                description: { type: "string", description: "Descrição curta" },
                primaryText: { type: "string", description: "Texto principal" },
                callToAction: { type: "string", description: "Call to action" },
                carouselCaptions: { type: "array", items: { type: "string" }, description: "Legendas para cada foto do carrossel" },
              },
              required: ["headline", "description", "primaryText", "callToAction", "carouselCaptions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = result.choices[0]?.message?.content;
      if (!content) throw new Error("IA não retornou conteúdo");
      const contentStr = typeof content === "string" ? content : JSON.stringify(content);

      try {
        const parsed = JSON.parse(contentStr);
        return {
          ...parsed,
          vehicle: {
            id: v.id,
            brand: v.brand,
            model: v.model,
            year: v.year,
            price: v.price,
            imageUrl: v.imageUrl,
          },
        };
      } catch {
        throw new Error("IA retornou formato inválido");
      }
    }),

  // Criar anúncio com texto personalizado (gerado pela IA)
  createAdWithText: protectedProcedure
    .input(z.object({
      vehicleId: z.number(),
      headline: z.string(),
      description: z.string(),
      primaryText: z.string(),
      dailyBudgetBRL: z.number().min(5).max(1000).default(30),
      campaignId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const config = buildMetaConfig();
      if (!config.accessToken || !config.adAccountId || !config.pageId) {
        throw new Error("Meta Ads não configurado.");
      }

      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const { vehicles: vehiclesTable } = await import("../drizzle/schema");
      const vehicleRows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).limit(1);
      if (!vehicleRows.length) throw new Error("Veículo não encontrado");
      const v = vehicleRows[0];
      if (!v.imageUrl) throw new Error("Veículo sem imagem");

      const phone = process.env.WHATSAPP_PHONE_NUMBER || "5551994782062";
      const waMsg = encodeURIComponent(
        `Olá! Vi o anúncio do ${v.brand} ${v.model} ${v.year} e tenho interesse!`
      );
      const whatsappLink = `https://wa.me/${phone}?text=${waMsg}`;

      const finalCampaignId = input.campaignId ?? (await createOrGetCampaign(config));
      const budgetCents = Math.round(input.dailyBudgetBRL * 100);
      const adSetId = await createAdSet(config, finalCampaignId, v, budgetCents);
      const imageHash = await uploadAdImage(config, v.imageUrl);

      // Create creative with custom AI text
      const adCreativeId = await (async () => {
        const result = await metaPost(
          `act_${config.adAccountId}/adcreatives`,
          {
            name: `Criativo IA — ${v.brand} ${v.model} #${v.id}`,
            object_story_spec: {
              page_id: config.pageId,
              ...(config.instagramActorId ? { instagram_actor_id: config.instagramActorId } : {}),
              link_data: {
                image_hash: imageHash,
                link: whatsappLink,
                message: input.primaryText,
                name: input.headline,
                description: input.description,
                call_to_action: {
                  type: "LEARN_MORE",
                  value: { link: whatsappLink },
                },
              },
            },
          },
          config.accessToken
        );
        return result.id as string;
      })();

      const adId = await createAd(config, adSetId, adCreativeId, v);

      await db.insert(metaAdsTable).values({
        vehicleId: input.vehicleId,
        campaignId: finalCampaignId,
        adSetId,
        adCreativeId,
        adId,
        imageHash,
        status: "paused",
        dailyBudgetCents: budgetCents,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return { success: true, adId, campaignId: finalCampaignId };
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
  aiDecision: aiDecisionRouter,
  metaAds: metaAdsRouter,
  followUp: followUpRouter,
  whatsappTemplate: whatsappTemplateRouter,
  tokenHealth: tokenHealthRouter,
});

export type AppRouter = typeof appRouter;
