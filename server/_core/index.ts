import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initSocketIO } from "../socket";
import { sendTextMessage, markAsRead, getMediaUrl, isConfigured as isWhatsAppConfigured } from "../whatsapp";
import { processWhatsAppMedia } from "../media";
import { startAutoSync } from "../stockSync";
import { getMessageByExternalId, updateMessageDeliveryStatus, updateMessageExternalId, updateLastCustomerMessageAt, setWindowExpired, getConversationByPlatformUserId, getConversationByPhone, createConversation, updateConversation, createMessage, createTeamNotification } from "../db";
import { startCampaignScheduler, handleCampaignDeliveryStatus, handleCampaignResponse } from "../campaignService";
import { handleEvolutionWebhook } from "../evolutionService";
import { handleWNWebhook } from "../whatsappMultiNumber";
import { startRescueJob } from "../rescueJob";
import { startScheduler } from "../scheduler";
import { startTokenMonitor } from "../tokenMonitor";
import { addToDebounce } from "../messageDebounce";
import { emitNewMessage, emitConversationUpdate } from "../socket";
import { getPlatformUserProfile } from "../instagramFacebook";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ─── Buscar dados completos do lead na Graph API do Meta ───────────────────────

async function fetchMetaLeadData(leadgenId: string): Promise<any> {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${token}`
    );
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function normalizePhone(phone: string | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11) return "55" + digits;
  if (digits.length === 10) return "55" + digits;
  return digits;
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Initialize Socket.IO for real-time communication
  initSocketIO(server);

  // Start automatic stock synchronization (every 30 minutes)
  startAutoSync();

  // Scheduler de campanhas de envio em massa (verifica a cada 5 min)
  startCampaignScheduler();

  // Resgate de leads inativos (a cada 2 min)
  startRescueJob();

  // Monitoramento periódico de tokens (a cada 30 min)
  startTokenMonitor();

  // Lembretes de conversa + mensagens agendadas (a cada 30s)
  startScheduler();
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Webhook endpoint for WhatsApp Cloud API (outside tRPC for compatibility)
  app.post("/api/webhook/whatsapp", async (req, res) => {
    try {
      const body = req.body;
      // Handle WhatsApp Cloud API verification
      if (req.query["hub.mode"] === "subscribe") {
        const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "autoinova_verify_token";
        if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
          return res.status(200).send(req.query["hub.challenge"]);
        }
        return res.sendStatus(403);
      }

      // ── Multi-number routing: check if this phone_number_id is a registered WA number ──
      const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      if (phoneNumberId) {
        const handled = await handleWNWebhook(body);
        if (handled) {
          return res.sendStatus(200);
        }
        // Not handled by multi-number → fall through to main handler
      }

      // Process incoming messages from WhatsApp Cloud API
      if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const msg = body.entry[0].changes[0].value.messages[0];
        const contact = body.entry[0].changes[0].value.contacts?.[0];
        const phone = msg.from;
        const name = contact?.profile?.name || "Cliente";
        const whatsappMessageId = msg.id;

        let content = "";
        let messageType: "text" | "audio" | "image" | "document" = "text";
        let mediaUrl: string | undefined;
        let mediaMimeType: string | undefined;

        if (msg.type === "text") {
          content = msg.text?.body || "";
        } else if (msg.type === "audio") {
          messageType = "audio";
          const mediaId = msg.audio?.id;
          mediaMimeType = msg.audio?.mime_type;
          if (mediaId) {
            // Download audio from WhatsApp and upload to S3
            const s3Media = await processWhatsAppMedia(mediaId, "audio", mediaMimeType);
            if (s3Media) {
              mediaUrl = s3Media.url;
              console.log(`[Webhook] Audio uploaded to S3: ${s3Media.url}`);
            } else {
              // Fallback: get direct WhatsApp URL for transcription
              const directUrl = await getMediaUrl(mediaId);
              mediaUrl = directUrl || undefined;
            }
          }
          content = "[Mensagem de áudio]";
        } else if (msg.type === "image") {
          messageType = "image";
          const mediaId = msg.image?.id;
          mediaMimeType = msg.image?.mime_type;
          const caption = msg.image?.caption || "";
          if (mediaId) {
            // Download image from WhatsApp and upload to S3
            const s3Media = await processWhatsAppMedia(mediaId, "image", mediaMimeType);
            if (s3Media) {
              mediaUrl = s3Media.url;
              console.log(`[Webhook] Image uploaded to S3: ${s3Media.url}`);
            }
          }
          content = caption || "[Imagem recebida]";
        } else if (msg.type === "document") {
          messageType = "document";
          const mediaId = msg.document?.id;
          mediaMimeType = msg.document?.mime_type;
          const filename = msg.document?.filename || "arquivo";
          if (mediaId) {
            const s3Media = await processWhatsAppMedia(mediaId, "document", mediaMimeType);
            if (s3Media) {
              mediaUrl = s3Media.url;
            }
          }
          content = `[Documento: ${filename}]`;
        } else if (msg.type === "location") {
          content = `[Localização: ${msg.location?.latitude}, ${msg.location?.longitude}]`;
        } else if (msg.type === "interactive") {
          // Handle interactive message replies (button clicks and list selections)
          const interactiveType = msg.interactive?.type;
          if (interactiveType === "button_reply") {
            const buttonId = msg.interactive?.button_reply?.id || "";
            const buttonTitle = msg.interactive?.button_reply?.title || "";
            content = buttonTitle; // Use the button title as the message content
            console.log(`[Webhook] Interactive button reply: id=${buttonId}, title=${buttonTitle}`);
          } else if (interactiveType === "list_reply") {
            const listId = msg.interactive?.list_reply?.id || "";
            const listTitle = msg.interactive?.list_reply?.title || "";
            const listDescription = msg.interactive?.list_reply?.description || "";
            content = listTitle; // Use the list item title as the message content
            if (listDescription) content += ` - ${listDescription}`;
            console.log(`[Webhook] Interactive list reply: id=${listId}, title=${listTitle}, desc=${listDescription}`);
          } else {
            content = `[Resposta interativa: ${interactiveType}]`;
          }
        } else {
          content = `[${msg.type}]`;
        }

        // Mark message as read in WhatsApp
        if (whatsappMessageId) {
          markAsRead(whatsappMessageId).catch(() => {});
        }

        // Deduplicate: skip if this WhatsApp message was already processed
        if (whatsappMessageId) {
          const existing = await getMessageByExternalId(whatsappMessageId);
          if (existing) {
            console.log(`[Webhook] Duplicate message detected (externalId: ${whatsappMessageId}), skipping`);
            return res.sendStatus(200);
          }
        }

        // Use tRPC caller to process the message
        const caller = appRouter.createCaller({ user: null, req: req as any, res: res as any });
        const result = await caller.webhook.receive({
          phone,
          name,
          content,
          messageType,
          mediaUrl,
          externalId: whatsappMessageId,
        });

        // CTWA: captura atribuição de anúncio Click-to-WhatsApp (usada pelo Meta CAPI)
        if (msg.referral?.ctwa_clid && result.conversationId) {
          try {
            const { upsertLead } = await import("../db");
            await upsertLead({
              conversationId: result.conversationId,
              phone,
              ctwaId: msg.referral.ctwa_clid,
              utmSource: "meta_ctwa",
              utmCampaign: msg.referral.headline || msg.referral.source_id || undefined,
              landingPage: msg.referral.source_url || undefined,
            } as any);
            console.log(`[Webhook] CTWA capturado: ctwa_clid=${msg.referral.ctwa_clid} (conversa ${result.conversationId})`);
          } catch (err) {
            console.error("[Webhook] Erro ao salvar atribuição CTWA:", err);
          }
        }

        // Update lastCustomerMessageAt for 24h window tracking
        if (result.conversationId) {
          await updateLastCustomerMessageAt(result.conversationId, Date.now());

          // Mark rescue attempt as responded if applicable
          try {
            const { markRescueResponded } = await import("../rescueJob");
            await markRescueResponded(result.conversationId);
          } catch (err) {
            // Non-critical, don't fail the webhook
          }

          // Check if this is a response to a campaign dispatch
          try {
            const campaignResult = await handleCampaignResponse(phone);
            if (campaignResult) {
              console.log(`[Campaign] Resposta detectada de ${phone} para campanha ${campaignResult.campaignId}`);
              // Apply conversation tag if set
              if (campaignResult.conversationTag) {
                const conv = await getConversationByPhone(phone);
                if (conv) {
                  const existingMeta = (conv.metadata as any) || {};
                  const tags = existingMeta.tags || [];
                  if (!tags.includes(campaignResult.conversationTag)) {
                    tags.push(campaignResult.conversationTag);
                  }
                  await updateConversation(conv.id, { metadata: { ...existingMeta, tags, campaignId: campaignResult.campaignId } });
                }
              }
              // Trigger response flow if configured
              if (campaignResult.responseFlowId && result.conversationId) {
                try {
                  const { processFlowMessage } = await import("../flowEngine");
                  // Start the response flow for this conversation
                  const { createFlowSession } = await import("../db");
                  await createFlowSession({
                    conversationId: result.conversationId,
                    flowId: campaignResult.responseFlowId,
                    status: "active",
                    context: { source: "campaign", campaignId: campaignResult.campaignId },
                  });
                  console.log(`[Campaign] Fluxo ${campaignResult.responseFlowId} acionado para conversa ${result.conversationId}`);
                } catch (flowErr) {
                  console.error(`[Campaign] Erro ao acionar fluxo:`, flowErr);
                }
              }
            }
          } catch (campErr) {
            // Non-critical
          }
        }

        // Send AI response back to WhatsApp and track delivery
        if (result.aiResponse && isWhatsAppConfigured()) {
          const sendResult = await sendTextMessage(phone, result.aiResponse);
          
          // Save the wamid of the sent message for delivery tracking
          if (sendResult.success && sendResult.messageId && result.aiMessageId) {
            await updateMessageExternalId(result.aiMessageId, sendResult.messageId);
          }
          
          // Handle error 131047 (24h window expired)
          if (!sendResult.success && sendResult.error) {
            const isWindowExpired = sendResult.error.includes('131047') || 
              sendResult.error.includes('Re-engagement') ||
              sendResult.error.includes('outside the allowed window');
            
            if (isWindowExpired && result.conversationId) {
              await setWindowExpired(result.conversationId, true);
              console.log(`[WhatsApp] 24h window expired for conversation ${result.conversationId}. Template required.`);
            }
            
            // Mark the AI message as failed
            if (result.aiMessageId) {
              await updateMessageDeliveryStatus(
                sendResult.messageId || `local-${result.aiMessageId}`,
                'failed',
                sendResult.error
              );
            }
          }
        }
      }

      // Handle status updates (delivered, read, failed, etc.)
      const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      if (statuses && Array.isArray(statuses)) {
        for (const statusUpdate of statuses) {
          const wamid = statusUpdate.id;
          const status = statusUpdate.status; // sent, delivered, read, failed
          const errorCode = statusUpdate.errors?.[0]?.code;
          const errorTitle = statusUpdate.errors?.[0]?.title;
          const errorMessage = statusUpdate.errors?.[0]?.message;
          
          console.log(`[WhatsApp] Status update: ${wamid} -> ${status}${errorCode ? ` (error: ${errorCode} - ${errorTitle})` : ''}`);
          
          if (wamid && status) {
            const validStatuses = ['sent', 'delivered', 'read', 'failed'] as const;
            const mappedStatus = validStatuses.includes(status as any) ? status as typeof validStatuses[number] : null;
            
            if (mappedStatus) {
              const errorDetail = errorCode ? `${errorCode}: ${errorTitle || errorMessage || 'Unknown error'}` : undefined;
              await updateMessageDeliveryStatus(wamid, mappedStatus, errorDetail);
              
              // Also track campaign dispatch delivery status
              try {
                await handleCampaignDeliveryStatus(wamid, mappedStatus);
              } catch (e) {
                // Non-critical
              }
              
              // If error 131047, mark conversation window as expired
              if (errorCode === 131047 || errorCode === '131047') {
                // Find the message to get conversationId
                const msg = await getMessageByExternalId(wamid);
                if (msg) {
                  await setWindowExpired(msg.conversationId, true);
                  console.log(`[WhatsApp] Window expired for conversation ${msg.conversationId} (error 131047)`);
                }
              }
            }
          }
        }
      }

      res.sendStatus(200);
    } catch (error) {
      console.error("[Webhook] Error:", error);
      res.sendStatus(200); // Always return 200 to WhatsApp
    }
  });

  // WhatsApp Cloud API webhook verification (GET)
  app.get("/api/webhook/whatsapp", (req, res) => {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "autoinova_verify_token";
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    res.sendStatus(403);
  });

  // ─── Webhook Meta Ads Lead Forms (GET — verificação) ────────────────────────
  app.get("/api/webhook/meta-ads", (req, res) => {
    const token = process.env.META_ADS_VERIFY_TOKEN || "autoinova_ads_token";
    if (
      req.query["hub.mode"]         === "subscribe" &&
      req.query["hub.verify_token"] === token
    ) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    res.sendStatus(403);
  });

  // ─── Webhook Meta Ads Lead Forms (POST — receber leads) ─────────────────────
  app.post("/api/webhook/meta-ads", async (req, res) => {
    // CRÍTICO: responder 200 imediatamente — Meta cancela se demorar > 5s
    res.sendStatus(200);

    try {
      const entries = req.body?.entry || [];
      for (const entry of entries) {
        for (const change of (entry.changes || [])) {
          if (change.field !== "leadgen") continue;
          const leadgenId = change.value?.leadgen_id;
          if (!leadgenId) continue;

          console.log(`[MetaAds Lead] Novo lead recebido: leadgenId=${leadgenId}`);

          // Buscar dados completos na Graph API do Meta
          const leadData = await fetchMetaLeadData(leadgenId);
          if (!leadData) {
            console.error(`[MetaAds Lead] Não foi possível buscar dados do lead ${leadgenId}`);
            continue;
          }

          const fields: Record<string, string> = {};
          for (const f of (leadData.field_data || [])) {
            fields[f.name] = f.values?.[0] || "";
          }

          console.log(`[MetaAds Lead] Campos recebidos:`, JSON.stringify(fields));

          const rawPhone     = fields["phone_number"] || fields["telefone"] || fields["phone"] || "";
          const name         = fields["full_name"]    || fields["nome"]     || fields["name"] || "Lead Ads";
          const carInterest  = fields["carro_interesse"] || fields["veiculo"] || fields["vehicle"] || "";

          const phone = normalizePhone(rawPhone);
          if (!phone) {
            console.error(`[MetaAds Lead] Lead sem telefone, ignorando.`);
            continue;
          }

          const caller = appRouter.createCaller({ user: null, req: req as any, res: res as any });
          const content = carInterest
            ? `Olá! Vim pelo anúncio, tenho interesse em ${carInterest}. Pode me dar mais informações?`
            : "Olá! Vi o anúncio da Auto Inova - Matriz. Pode me dar mais informações sobre os veículos disponíveis?";

          const result = await caller.webhook.receive({
            phone,
            name,
            content,
            messageType: "text",
            externalId: `meta_ads_${leadgenId}`,
          });

          console.log(`[MetaAds Lead] ✅ Conversa criada: id=${result.conversationId}, phone=${phone}`);

          // Salva o Meta Lead ID no lead — necessário para Conversion Leads (CAPI CRM)
          if (result.conversationId) {
            try {
              const { upsertLead } = await import("../db");
              await upsertLead({
                conversationId: result.conversationId,
                phone,
                metaLeadId: String(leadgenId),
                utmSource: "meta_lead_ads",
                vehicleInterest: carInterest || undefined,
              } as any);
              console.log(`[MetaAds Lead] metaLeadId=${leadgenId} salvo no lead (conversa ${result.conversationId})`);
            } catch (err) {
              console.error("[MetaAds Lead] Erro ao salvar metaLeadId:", err);
            }
          }

          if (result.aiResponse && isWhatsAppConfigured()) {
            await sendTextMessage(phone, result.aiResponse);
            console.log(`[MetaAds Lead] IA respondeu para ${phone}`);
          }
        }
      }
    } catch (error) {
      console.error("[MetaAds Lead] Erro ao processar webhook:", error);
    }
  });

  // ─── Instagram & Facebook Messenger Webhook (GET — verificação) ─────────────
  app.get("/api/webhook/instagram", (req, res) => {
    const incomingToken = req.query["hub.verify_token"] as string;
    // Accept any of the configured verify tokens
    const validTokens = [
      process.env.META_ADS_VERIFY_TOKEN,
      process.env.WHATSAPP_VERIFY_TOKEN,
      "autoinova_verify_token",
    ].filter(Boolean);
    
    if (req.query["hub.mode"] === "subscribe" && validTokens.includes(incomingToken)) {
      console.log(`[Instagram Webhook] Verification successful (token matched)`);
      return res.status(200).send(req.query["hub.challenge"]);
    }
    console.log(`[Instagram Webhook] Verification FAILED. Received token: ${incomingToken?.substring(0, 10)}... Valid tokens: ${validTokens.map(t => t?.substring(0, 10) + '...').join(', ')}`);
    res.sendStatus(403);
  });

  // ─── Instagram & Facebook Messenger Webhook (POST — receber mensagens) ──────
  app.post("/api/webhook/instagram", async (req, res) => {
    // Responder 200 imediatamente — Meta cancela se demorar > 5s
    res.sendStatus(200);

    try {
      const body = req.body;
      const objectType = body?.object; // "instagram" or "page"

      if (objectType !== "instagram" && objectType !== "page") {
        return; // Not a messaging webhook
      }

      const channel: "instagram" | "facebook" = objectType === "instagram" ? "instagram" : "facebook";

      for (const entry of (body.entry || [])) {
        for (const messagingEvent of (entry.messaging || [])) {
          // Skip echo messages (sent by us)
          if (messagingEvent.message?.is_echo) continue;
          // Skip deleted messages
          if (messagingEvent.message?.is_deleted) continue;

          const senderId = messagingEvent.sender?.id;
          const recipientId = messagingEvent.recipient?.id;
          const messageId = messagingEvent.message?.mid;
          const timestamp = messagingEvent.timestamp;

          if (!senderId || !messageId) continue;

          // Skip messages from our own page/account
          const pageId = process.env.META_ADS_PAGE_ID;
          const instagramId = process.env.META_ADS_INSTAGRAM_ID;
          if (senderId === pageId || senderId === instagramId) continue;

          // Deduplicate: skip if this message was already processed
          const existing = await getMessageByExternalId(messageId);
          if (existing) {
            console.log(`[${channel}] Duplicate message detected (mid: ${messageId}), skipping`);
            continue;
          }

          // Extract message content
          let content = "";
          let messageType: "text" | "image" | "audio" = "text";
          let mediaUrl: string | undefined;

          if (messagingEvent.message?.text) {
            content = messagingEvent.message.text;
          }

          // Handle attachments
          if (messagingEvent.message?.attachments) {
            for (const attachment of messagingEvent.message.attachments) {
              if (attachment.type === "image") {
                messageType = "image";
                mediaUrl = attachment.payload?.url;
                if (!content) content = "[Imagem recebida]";
              } else if (attachment.type === "audio") {
                messageType = "audio";
                mediaUrl = attachment.payload?.url;
                if (!content) content = "[Mensagem de áudio]";
              } else if (attachment.type === "video") {
                if (!content) content = "[Vídeo recebido]";
              } else if (attachment.type === "share" || attachment.type === "story_mention") {
                if (!content) content = "[Compartilhamento recebido]";
              } else if (attachment.type === "ig_reel" || attachment.type === "reel") {
                if (!content) content = "[Reel compartilhado]";
              } else {
                if (!content) content = `[${attachment.type} recebido]`;
              }
            }
          }

          // Handle postbacks (button clicks)
          if (messagingEvent.postback?.payload) {
            content = messagingEvent.postback.payload;
          }

          if (!content) continue;

          console.log(`[${channel}] Message from ${senderId}: ${content.substring(0, 100)}`);

          // Get user profile for name and photo
          let contactName = "Cliente";
          let contactPhoto: string | undefined;
          try {
            const profile = await getPlatformUserProfile(senderId, channel);
            if (profile?.name) contactName = profile.name;
            if (profile?.profilePic) contactPhoto = profile.profilePic;
            console.log(`[${channel}] Profile fetched for ${senderId}: name=${contactName}, hasPhoto=${!!contactPhoto}`);
          } catch (err) {
            console.warn(`[${channel}] Could not fetch profile for ${senderId}`);
          }

          // Find or create conversation by platformUserId
          let conversation = await getConversationByPlatformUserId(senderId, channel);
          if (!conversation) {
            conversation = await createConversation({
              phone: `${channel}_${senderId}`, // Use platform prefix + ID as phone placeholder
              contactName,
              contactPhoto,
              channel,
              platformUserId: senderId,
              status: "open",
              aiActive: true,
              lastMessageAt: Date.now(),
            });
            console.log(`[${channel}] New conversation created for ${contactName} (${senderId})`);
          } else if (contactPhoto && !conversation.contactPhoto) {
            // Update photo if we got it now but didn't have it before
            await updateConversation(conversation.id, { contactPhoto });
          }

          if (!conversation) continue;

          // Reactivate if resolved/closed
          if (conversation.status === "resolved" || conversation.status === "closed") {
            console.log(`[${channel}] REATIVAÇÃO: Conversa ${conversation.id} estava ${conversation.status}. Reabrindo.`);
            conversation = await updateConversation(conversation.id, {
              status: "open",
              aiActive: true,
              assignedTo: null,
              lastMessageAt: Date.now(),
            }) || conversation;
          }

          // Build metadata
          const metadata: Record<string, unknown> = { platform: channel, platformUserId: senderId };
          if (mediaUrl) metadata.mediaUrl = mediaUrl;

          // Save customer message
          const customerMsg = await createMessage({
            conversationId: conversation.id,
            content,
            senderType: "customer",
            senderName: contactName,
            messageType,
            externalId: messageId,
            metadata,
          });

          emitNewMessage(conversation.id, customerMsg);

          // Update conversation metadata
          await updateConversation(conversation.id, {
            lastMessageAt: Date.now(),
            contactName: contactName !== "Cliente" ? contactName : conversation.contactName,
          });

          // Notify assigned agent if AI is off
          if (conversation.assignedTo && !conversation.aiActive) {
            createTeamNotification({
              userId: conversation.assignedTo,
              type: "new_message",
              title: `Nova mensagem (${channel === "instagram" ? "Instagram" : "Facebook"})`,
              message: `${contactName}: ${content.substring(0, 100)}`,
              conversationId: conversation.id,
            }).catch(err => console.error(`[${channel}] Error creating notification:`, err));
          }

          // AI debounce if active
          if (conversation.aiActive) {
            let aiContent = content;
            if (messageType === "image" && mediaUrl) {
              aiContent = `[IMAGEM: ${mediaUrl}] ${content}`;
            }
            addToDebounce(conversation.id, aiContent, messageType, mediaUrl);
          }
        }
      }
    } catch (error) {
      console.error("[Instagram/Facebook Webhook] Error:", error);
    }
  });

  // Evolution API webhook endpoint (multi-instance WhatsApp)
  app.post("/api/webhook/evolution", async (req, res) => {
    try {
      const body = req.body;
      const event = body.event as string;
      const instanceName = body.instance as string;
      const data = body.data;

      console.log(`[Evolution Webhook] Event: ${event} | Instance: ${instanceName}`);

      if (!event || !instanceName) {
        return res.status(400).json({ error: "Missing event or instance" });
      }

      await handleEvolutionWebhook({ event, instanceName, data, io: (req as any).io });
      res.json({ success: true });
    } catch (error) {
      console.error("[Evolution Webhook] Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Generic webhook endpoint (compatible with Chatwoot/n8n)
  app.post("/api/webhook/generic", async (req, res) => {
    try {
      const body = req.body;
      const phone = body.phone || body.sender?.phone_number || "";
      const name = body.name || body.sender?.name || "Cliente";
      const content = body.content || body.message || "";
      const mediaUrl = body.mediaUrl || body.media_url || undefined;
      const messageType = body.messageType || body.message_type || "text";

      if (phone && (content || mediaUrl)) {
        const caller = appRouter.createCaller({ user: null, req: req as any, res: res as any });
        const result = await caller.webhook.receive({
          phone,
          name,
          content: content || (messageType === "image" ? "[Imagem recebida]" : "[Mídia recebida]"),
          messageType,
          mediaUrl,
        });
        return res.json(result);
      }

      res.status(400).json({ error: "Missing phone or content" });
    } catch (error) {
      console.error("[Webhook Generic] Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── WhatsApp Embedded Signup — token exchange ───────────────────────────────
  app.post("/api/whatsapp/exchange-token", async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing code" });
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return res.status(500).json({ error: "META_APP_ID / META_APP_SECRET não configurados" });
    try {
      const r = await fetch("https://graph.facebook.com/v19.0/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: appId,
          client_secret: appSecret,
          grant_type: "authorization_code",
          redirect_uri: "https://autoinovacrm.com.br/",
          code,
        }),
      });
      const data = await r.json() as any;
      if (data.access_token) {
        console.log("[EmbeddedSignup] Token trocado com sucesso");
        return res.json({ success: true, token: data.access_token });
      }
      console.error("[EmbeddedSignup] Erro na troca:", data);
      return res.status(400).json({ error: data.error?.message || "Falha na troca de token" });
    } catch (err) {
      console.error("[EmbeddedSignup] Exception:", err);
      return res.status(500).json({ error: "Erro interno" });
    }
  });

  // ─── Legal pages (required for Meta Tech Provider) ──────────────────────────

  const LEGAL_HTML_HEADER = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#222;line-height:1.7}
    .wrap{max-width:800px;margin:0 auto;padding:40px 24px}header{background:#075e54;color:#fff;padding:24px;border-radius:12px;margin-bottom:32px}
    header h1{font-size:1.5rem;margin-bottom:4px}header p{font-size:.85rem;opacity:.8}
    h2{font-size:1.1rem;color:#075e54;margin:28px 0 10px;border-bottom:2px solid #e0e0e0;padding-bottom:6px}
    p,li{font-size:.95rem;color:#444;margin-bottom:8px}ul{padding-left:20px;margin-bottom:12px}
    .badge{display:inline-block;background:#e8f5e9;color:#1b5e20;font-size:.8rem;padding:4px 10px;border-radius:20px;margin-bottom:16px}
    footer{margin-top:48px;font-size:.8rem;color:#999;text-align:center;border-top:1px solid #ddd;padding-top:16px}
    a{color:#075e54}
  </style></head><body><div class="wrap">`;

  const LEGAL_HTML_FOOTER = `<footer>AutoInova CRM &mdash; autoinovacrm.com.br</footer></div></body></html>`;

  // Privacy Policy
  app.get("/privacy", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`${LEGAL_HTML_HEADER}
      <header><h1>Política de Privacidade</h1><p>AutoInova CRM &mdash; Plataforma de Gestão de Leads</p></header>
      <span class="badge">Última atualização: ${new Date().toLocaleDateString("pt-BR",{year:"numeric",month:"long",day:"numeric"})}</span>
      <h2>1. Quem Somos</h2>
      <p>A <strong>AutoInova CRM</strong> é uma plataforma de gestão de relacionamento com clientes (CRM) voltada para concessionárias e revendedoras de veículos, acessível em <a href="https://autoinovacrm.com.br">autoinovacrm.com.br</a>.</p>
      <h2>2. Dados que Coletamos</h2>
      <ul>
        <li><strong>Dados de contato:</strong> nome, telefone, e-mail fornecidos por leads via WhatsApp, Instagram ou Facebook.</li>
        <li><strong>Mensagens:</strong> conteúdo de conversas trocadas por meio das plataformas integradas.</li>
        <li><strong>Dados de uso:</strong> informações de acesso à plataforma (IP, navegador, horários).</li>
        <li><strong>Dados de anúncios:</strong> informações de leads gerados por campanhas no Facebook/Instagram Ads.</li>
      </ul>
      <h2>3. Como Usamos os Dados</h2>
      <ul>
        <li>Gerenciar o relacionamento entre empresas parceiras e seus clientes/leads.</li>
        <li>Automatizar respostas e follow-ups via inteligência artificial.</li>
        <li>Gerar relatórios de desempenho de atendimento.</li>
        <li>Cumprir obrigações legais e regulatórias.</li>
      </ul>
      <h2>4. Compartilhamento</h2>
      <p>Não vendemos dados pessoais. Compartilhamos dados apenas com:</p>
      <ul>
        <li><strong>Meta Platforms (Facebook/WhatsApp):</strong> para envio e recebimento de mensagens.</li>
        <li><strong>Provedores de IA</strong> (ex: OpenAI) para processamento de linguagem natural &mdash; conforme suas políticas de privacidade.</li>
        <li><strong>Parceiros de infraestrutura</strong> (servidores em nuvem) para hospedagem segura dos dados.</li>
      </ul>
      <h2>5. Retenção dos Dados</h2>
      <p>Os dados são mantidos enquanto a conta da empresa parceira estiver ativa. Após o encerramento, os dados são removidos em até 90 dias, salvo obrigação legal.</p>
      <h2>6. Direitos dos Titulares (LGPD)</h2>
      <p>Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode:</p>
      <ul>
        <li>Solicitar acesso, correção ou exclusão dos seus dados.</li>
        <li>Revogar o consentimento a qualquer momento.</li>
        <li>Solicitar a portabilidade dos dados.</li>
      </ul>
      <p>Entre em contato: <a href="mailto:privacidade@autoinovacrm.com.br">privacidade@autoinovacrm.com.br</a></p>
      <h2>7. Segurança</h2>
      <p>Utilizamos criptografia TLS em todas as comunicações, autenticação segura e servidores com acesso restrito para proteger seus dados.</p>
      <h2>8. Cookies</h2>
      <p>Utilizamos cookies de sessão estritamente necessários para autenticação. Não utilizamos cookies de rastreamento de terceiros.</p>
      <h2>9. Alterações</h2>
      <p>Podemos atualizar esta política periodicamente. Usuários serão notificados por e-mail em caso de alterações relevantes.</p>
      <h2>10. Contato</h2>
      <p>Dúvidas ou solicitações: <a href="mailto:privacidade@autoinovacrm.com.br">privacidade@autoinovacrm.com.br</a></p>
    ${LEGAL_HTML_FOOTER}`);
  });

  // Terms of Service
  app.get("/terms", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`${LEGAL_HTML_HEADER}
      <header><h1>Termos de Serviço</h1><p>AutoInova CRM &mdash; Plataforma de Gestão de Leads</p></header>
      <span class="badge">Última atualização: ${new Date().toLocaleDateString("pt-BR",{year:"numeric",month:"long",day:"numeric"})}</span>
      <h2>1. Aceitação</h2>
      <p>Ao utilizar a plataforma AutoInova CRM, você concorda com estes Termos de Serviço e com nossa <a href="/privacy">Política de Privacidade</a>.</p>
      <h2>2. Descrição do Serviço</h2>
      <p>AutoInova CRM é uma plataforma SaaS (Software as a Service) que permite gerenciar leads, automatizar atendimentos via WhatsApp/Instagram/Facebook e acompanhar o desempenho de campanhas de marketing digital.</p>
      <h2>3. Elegibilidade</h2>
      <p>O serviço é destinado a empresas (pessoas jurídicas) ou profissionais autônomos que atuam no segmento automotivo ou de vendas. O uso por menores de 18 anos não é permitido.</p>
      <h2>4. Responsabilidades do Usuário</h2>
      <ul>
        <li>Manter as credenciais de acesso seguras e confidenciais.</li>
        <li>Utilizar a plataforma em conformidade com as políticas da Meta (WhatsApp/Facebook/Instagram).</li>
        <li>Não enviar mensagens de spam, conteúdo ilegal ou enganoso.</li>
        <li>Obter consentimento adequado dos leads antes de iniciar comunicações.</li>
        <li>Cumprir a LGPD e demais legislações aplicáveis.</li>
      </ul>
      <h2>5. Integração com Meta Platforms</h2>
      <p>O uso das APIs do WhatsApp Business, Instagram e Facebook está sujeito às políticas da Meta Platforms, Inc. O usuário é responsável por manter suas integrações ativas e em conformidade.</p>
      <h2>6. Limitação de Responsabilidade</h2>
      <p>A AutoInova CRM não se responsabiliza por: interrupções nas APIs de terceiros (Meta, OpenAI), perda de dados por falha do usuário ou uso indevido da plataforma, ou resultados de vendas.</p>
      <h2>7. Propriedade Intelectual</h2>
      <p>Todo o código, design e conteúdo da plataforma pertencem à AutoInova CRM. É proibida a reprodução ou distribuição sem autorização.</p>
      <h2>8. Rescisão</h2>
      <p>Podemos suspender contas que violem estes termos, sem aviso prévio em casos graves. O usuário pode cancelar sua conta a qualquer momento.</p>
      <h2>9. Lei Aplicável</h2>
      <p>Estes termos são regidos pelas leis brasileiras. Foro: comarca de São Paulo/SP.</p>
      <h2>10. Contato</h2>
      <p><a href="mailto:suporte@autoinovacrm.com.br">suporte@autoinovacrm.com.br</a></p>
    ${LEGAL_HTML_FOOTER}`);
  });

  // Data Deletion — page + Facebook callback
  app.get("/data-deletion", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`${LEGAL_HTML_HEADER}
      <header><h1>Exclusão de Dados</h1><p>AutoInova CRM &mdash; Como remover seus dados</p></header>
      <h2>Como solicitar a exclusão dos seus dados</h2>
      <p>Se você usou o login com Facebook/Instagram para acessar algum serviço integrado à AutoInova CRM e deseja que seus dados sejam removidos, siga os passos abaixo:</p>
      <ul>
        <li>Envie um e-mail para <a href="mailto:privacidade@autoinovacrm.com.br">privacidade@autoinovacrm.com.br</a> com o assunto <strong>"Exclusão de Dados"</strong>.</li>
        <li>Informe seu nome completo e o e-mail ou telefone associado à conta.</li>
        <li>Você receberá uma confirmação em até <strong>5 dias úteis</strong>.</li>
        <li>Seus dados serão excluídos definitivamente em até <strong>30 dias</strong> após a confirmação.</li>
      </ul>
      <h2>Exclusão via Facebook</h2>
      <p>Você também pode remover o acesso do app diretamente nas configurações do Facebook:</p>
      <ul>
        <li>Acesse <a href="https://www.facebook.com/settings?tab=applications" target="_blank">Configurações &gt; Apps e Sites</a> no Facebook.</li>
        <li>Localize <strong>AutoInova CRM</strong> e clique em <strong>Remover</strong>.</li>
        <li>Na seção "Removidos", clique no app e selecione "Solicitar exclusão de dados".</li>
      </ul>
      <h2>Dados que serão excluídos</h2>
      <ul>
        <li>Informações de perfil (nome, e-mail, foto)</li>
        <li>Histórico de conversas associado à sua conta</li>
        <li>Dados de campanhas e leads vinculados ao seu perfil</li>
      </ul>
      <p>Para dúvidas: <a href="mailto:privacidade@autoinovacrm.com.br">privacidade@autoinovacrm.com.br</a></p>
    ${LEGAL_HTML_FOOTER}`);
  });

  // Facebook Data Deletion Callback (POST — chamado pelo Facebook quando usuário solicita exclusão)
  app.post("/data-deletion", (req, res) => {
    try {
      // Facebook envia signed_request; respondemos com confirmation
      const confirmationCode = `autoinova_del_${Date.now()}`;
      console.log("[DataDeletion] Solicitação de exclusão recebida:", req.body?.signed_request ? "com signed_request" : "sem signed_request");
      res.json({
        url: "https://autoinovacrm.com.br/data-deletion",
        confirmation_code: confirmationCode,
      });
    } catch {
      res.status(500).json({ error: "Internal error" });
    }
  });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
