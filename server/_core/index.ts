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
import { getMessageByExternalId, updateMessageDeliveryStatus, updateMessageExternalId, updateLastCustomerMessageAt, setWindowExpired } from "../db";
import { startFollowUpJob } from "../followUp";
import { startTokenMonitor } from "../tokenMonitor";

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

  // Follow-up automático de leads frios (a cada 6h)
  startFollowUpJob();

  // Monitoramento periódico de tokens (a cada 30 min)
  startTokenMonitor();
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

        // Update lastCustomerMessageAt for 24h window tracking
        if (result.conversationId) {
          await updateLastCustomerMessageAt(result.conversationId, Date.now());
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
            : "Olá! Vi o anúncio da Auto Inova. Pode me dar mais informações sobre os veículos disponíveis?";

          const result = await caller.webhook.receive({
            phone,
            name,
            content,
            messageType: "text",
            externalId: `meta_ads_${leadgenId}`,
          });

          console.log(`[MetaAds Lead] ✅ Conversa criada: id=${result.conversationId}, phone=${phone}`);

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
