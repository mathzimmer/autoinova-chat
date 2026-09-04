import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createHmac, timingSafeEqual } from "crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { normalizePhone } from "../phoneNormalize";
import { initSocketIO } from "../socket";
import { sendTextMessage, markAsRead, getMediaUrl, isConfigured as isWhatsAppConfigured } from "../whatsapp";
import { processWhatsAppMedia } from "../media";
import { startAutoSync } from "../stockSync";
import { getMessageByExternalId, updateMessageDeliveryStatus, updateMessageExternalId, updateLastCustomerMessageAt, setWindowExpired, getConversationByPlatformUserId, getConversationByPhone, createConversation, updateConversation, createMessage, createTeamNotification, getConnectionAiAuto } from "../db";
import { startCampaignScheduler, handleCampaignDeliveryStatus, handleCampaignResponse } from "../campaignService";
import { handleEvolutionWebhook } from "../evolutionService";
import { handleWNWebhook } from "../whatsappMultiNumber";
import { startRescueJob } from "../rescueJob";
import { startReengagementJob } from "../reengagement";
import { startScheduler } from "../scheduler";
import { startTokenMonitor } from "../tokenMonitor";
import { addToDebounce } from "../messageDebounce";
import { emitNewMessage, emitConversationUpdate } from "../socket";
import { getPlatformUserProfile } from "../instagramFacebook";
import { verifyZernioSignature, parseZernioMessage, zernioEnabled } from "../zernioService";
import { mirrorZernioMessage } from "../db";
import { transcribeAudio } from "./voiceTranscription";

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

// Transcrição segura para o conector Zernio (retorna o texto ou undefined)
async function transcribeAudioSafe(audioUrl: string): Promise<string | undefined> {
  try {
    const r = await transcribeAudio({
      audioUrl,
      language: "pt",
      prompt: "Transcrever mensagem de voz do cliente sobre veículos e automóveis",
    });
    if (r && "text" in r && r.text) return r.text;
  } catch (e) {
    console.error("[Zernio] transcribeAudioSafe erro:", e);
  }
  return undefined;
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads.
  // verify: guarda o corpo bruto para validar a assinatura HMAC dos webhooks da Meta.
  app.use(express.json({
    limit: "50mb",
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
  }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ─── Verificação de assinatura dos webhooks Meta (X-Hub-Signature-256) ──────
  // A Meta assina todo webhook com HMAC-SHA256 do corpo usando o App Secret.
  // Sem essa checagem, qualquer pessoa que descubra a URL pode injetar
  // mensagens/leads falsos e acionar a IA.
  function verifyMetaSignature(req: express.Request): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
      console.warn("[Webhook Security] META_APP_SECRET não configurado — assinatura NÃO verificada");
      return true; // não bloqueia se não há secret para comparar
    }
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!signature || !rawBody) return false;
    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  function requireMetaSignature(req: express.Request, res: express.Response): boolean {
    if (verifyMetaSignature(req)) return true;
    console.warn(`[Webhook Security] Assinatura inválida rejeitada: ${req.path} (ip: ${req.ip})`);
    res.sendStatus(401);
    return false;
  }

  // Initialize Socket.IO for real-time communication
  initSocketIO(server);

  // Start automatic stock synchronization (every 30 minutes)
  startAutoSync();

  // Scheduler de campanhas de envio em massa (verifica a cada 5 min)
  startCampaignScheduler();

  // Resgate de leads inativos (a cada 2 min)
  startRescueJob();

  // Motor único de reengajamento v2 (PR #6 — ativo só quando reengagement_config.enabled=true)
  startReengagementJob();

  // Monitoramento periódico de tokens (a cada 30 min)
  startTokenMonitor();

  // Lembretes de conversa + mensagens agendadas (a cada 30s)
  startScheduler();

  // Lembrete de "sem resposta" nos fluxos (a cada 60s)
  setInterval(() => {
    import("../flowEngine").then(m => m.runFlowNoReplyCheck().catch(e => console.error("[FlowNoReply] erro:", e)));
  }, 60000);

  // Auto-qualificação de leads por IA (a cada 2 min, se ligado nas configs)
  setInterval(() => {
    import("../autoQualify").then(m => m.runAutoQualify().catch(e => console.error("[AutoQualify] erro:", e)));
  }, 120000);

  // Encerra leads parados (sem resposta há X dias → "perdido"), 1x por hora
  setInterval(() => {
    import("../staleLeads").then(m => m.runStaleLeadCheck().catch(e => console.error("[StaleLeads] erro:", e)));
  }, 60 * 60 * 1000);

  // Sincronizador Zernio: recupera mensagens que chegaram enquanto o CRM estava
  // fora do ar (ex.: durante o deploy). Roda ~30s após o boot e a cada 15 min.
  setTimeout(() => {
    import("../zernioSync").then(m => m.runZernioSyncLocked()).catch(e => console.error("[ZernioSync] boot:", e));
  }, 30 * 1000);
  setInterval(() => {
    import("../zernioSync").then(m => m.runZernioSyncLocked()).catch(e => console.error("[ZernioSync] erro:", e));
  }, 15 * 60 * 1000);
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
    if (!requireMetaSignature(req, res)) return;
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

      // ── Multi-número: se o phone_number_id for de um número oficial registrado,
      // espelha no inbox unificado (channel whatsapp + instanceName) e roda a IA.
      const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      if (phoneNumberId) {
        try {
          const { getWhatsappNumberByPhoneNumberId } = await import("../whatsappMultiNumber");
          const registered = await getWhatsappNumberByPhoneNumberId(phoneNumberId);
          // Qualquer número oficial REGISTRADO e ativo é roteado para sua própria
          // aba (inbox por número). Não depende mais de ser diferente do .env — assim
          // um número em coexistência nunca "cai na Matriz" só por ser o padrão do .env.
          if (registered && registered.isActive) {
            // Número gerido pelo Meta Business Agent: o CRM só observa + trata handoff.
            if ((registered as any).mode === "meta_agent") {
              const { handleMetaAgentWebhook } = await import("../metaAgent");
              await handleMetaAgentWebhook(body, phoneNumberId);
              return res.sendStatus(200);
            }
            const { handleOfficialMessage } = await import("../officialInstance");
            // status updates ainda seguem o fluxo padrão abaixo; mensagens vão para o handler oficial
            if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
              await handleOfficialMessage(body, phoneNumberId);
              return res.sendStatus(200);
            }
          }
        } catch (e) {
          console.error("[Official] roteamento falhou:", e);
        }
      }

      // Process incoming messages from WhatsApp Cloud API
      if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        // ── Matriz desativada? Se chegou aqui, o número NÃO é uma instância
        // registrada (os registrados já foram roteados/retornados acima). Então
        // ignora a mensagem em vez de criar uma conversa fantasma na Matriz.
        const { isMatrizActive } = await import("../matrizConfig");
        if (!(await isMatrizActive())) {
          console.warn(`[Webhook] Matriz desativada; número ${phoneNumberId || "?"} não é instância registrada — mensagem ignorada (não roteada).`);
          return res.sendStatus(200);
        }

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
            const { markReengagementResponded } = await import("../reengagement");
            await markReengagementResponded(result.conversationId);
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

  // ── Estoque para o Meta Business Agent (conector) ──
  // Busca ESTRUTURADA do estoque atual (com fotos), pro agente da Meta consumir
  // ao vivo via conector. Estoque é publico (site), mas aceita chave opcional
  // (env AGENT_API_KEY) via ?key= ou header x-api-key.
  app.get("/api/agent/vehicles", async (req, res) => {
    try {
      const requiredKey = process.env.AGENT_API_KEY;
      if (requiredKey && req.query.key !== requiredKey && req.headers["x-api-key"] !== requiredKey) {
        return res.status(401).json({ error: "unauthorized" });
      }
      const num = (x: any) => (x != null && x !== "" && !isNaN(Number(x)) ? Number(x) : undefined);
      const q = typeof req.query.q === "string" ? req.query.q : (typeof req.query.query === "string" ? req.query.query : "");
      const { searchVehiclesStructured } = await import("../stockSync");
      const vehiclesOut = await searchVehiclesStructured({
        q,
        maxPrice: num(req.query.max_price ?? req.query.maxPrice),
        minPrice: num(req.query.min_price ?? req.query.minPrice),
        yearMin: num(req.query.year_min ?? req.query.yearMin),
        fuel: typeof req.query.fuel === "string" ? req.query.fuel : undefined,
        limit: num(req.query.limit) || 10,
      });
      res.json({ total: vehiclesOut.length, vehicles: vehiclesOut });
    } catch (err) {
      console.error("[AgentVehicles] erro:", err);
      res.status(500).json({ error: "erro ao buscar estoque" });
    }
  });

  // ── Feed de catálogo VEHICLES pro Facebook/Meta Commerce ──
  // CSV completo (várias fotos + ano/km/câmbio/combustível) gerado do estoque
  // real do CRM. Cole esta URL no Commerce Manager como fonte de dados agendada;
  // o Facebook re-processa sozinho no horário definido.
  app.get(["/api/catalog/facebook.csv", "/api/catalog/vehicles.csv"], async (req, res) => {
    try {
      const { buildFacebookVehiclesCsv } = await import("../catalogFeed");
      const csv = await buildFacebookVehiclesCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "inline; filename=autoinova_vehicles.csv");
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.send("﻿" + csv); // BOM p/ acentos
    } catch (err) {
      console.error("[CatalogFeed] erro:", err);
      res.status(500).send("erro ao gerar feed");
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

  // ─── Webhook Zernio (coexistência WhatsApp oficial) ─────────────────────────
  // Isolado dos webhooks Meta/Evolution. Zernio envia eventos no formato próprio
  // (message.received / message.sent / message.delivered|read|failed).
  // Docs: https://docs.zernio.com/webhooks
  const zernioSeenEvents = new Set<string>(); // dedupe simples em memória por payload.id
  // Proxy autenticado de mídia do Zernio: baixa com o Bearer token e devolve os
  // bytes, para o inbox renderizar imagem/áudio/vídeo (as URLs do Zernio exigem
  // token e não podem ir direto no <img>/<audio>). Reconstrói a URL a partir do
  // mid + accountId (sem parâmetro de URL livre → sem risco de SSRF).
  app.get("/api/zernio/media", async (req, res) => {
    try {
      const mid = String(req.query.mid || "");
      const accountId = String(req.query.accountId || "");
      if (!/^[A-Za-z0-9_-]+$/.test(mid) || !/^[A-Za-z0-9_-]+$/.test(accountId)) return res.sendStatus(400);
      const { resolveApiKey } = await import("../zernioService");
      const key = await resolveApiKey(accountId);
      if (!key) return res.sendStatus(404);
      const url = `https://zernio.com/api/v1/whatsapp/media/${mid}?accountId=${encodeURIComponent(accountId)}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) {
        console.error(`[Zernio] proxy de mídia falhou ${r.status}: ${mid}`);
        return res.sendStatus(r.status);
      }
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=86400");
      return res.send(buf);
    } catch (err) {
      console.error("[Zernio] proxy de mídia erro:", err);
      return res.sendStatus(502);
    }
  });

  app.post("/api/webhook/zernio", async (req, res) => {
    // Assinatura HMAC-SHA256 hex do corpo cru
    const signature = (req.headers["x-zernio-signature"] || req.headers["x-late-signature"]) as string | undefined;
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!(await verifyZernioSignature(rawBody ?? JSON.stringify(req.body), signature))) {
      console.warn(`[Zernio] Assinatura inválida rejeitada (ip: ${req.ip})`);
      return res.sendStatus(401);
    }

    // Zernio exige 2xx em até 5s → responde já e processa depois
    res.sendStatus(200);

    try {
      const payload = req.body || {};
      const event: string = payload.event || "unknown";
      const eventId: string | undefined = payload.id;

      // Dedupe at-least-once
      if (eventId) {
        if (zernioSeenEvents.has(eventId)) return;
        zernioSeenEvents.add(eventId);
        if (zernioSeenEvents.size > 5000) zernioSeenEvents.clear(); // evita vazamento
      }

      // LOG do payload cru (as primeiras entregas nos dão o shape real para
      // enxugar o parser depois — ver comentários em zernioService.ts)
      console.log(`[Zernio] Evento "${event}" recebido:`, JSON.stringify(payload).substring(0, 1500));

      // DETECÇÃO DE CTWA (anúncio): se o payload tiver qualquer sinal de referral/
      // anúncio, loga o payload INTEIRO (sem truncar) para acharmos onde está o
      // ctwa_clid e ligar a atribuição. Grep: "[Zernio][CTWA-RAW]".
      const raw = JSON.stringify(payload);
      if (/ctwa|referral|source_id|source_url|ad_id|"ads?"|welcome/i.test(raw)) {
        console.log(`[Zernio][CTWA-RAW] possível anúncio →`, raw);
      }

      if (event === "webhook.test") {
        console.log("[Zernio] webhook.test OK — endpoint validado.");
        return;
      }

      // ── Mensagem recebida do cliente ──
      if (event === "message.received") {
        const m = parseZernioMessage(payload);
        // DIAGNÓSTICO de roteamento: mostra qual instância (accountId) foi lida.
        console.log(`[Zernio][ROTA] recebida → accountId=${m.accountId || "?"} | phone=${m.phone || "?"} | zernioConvId=${m.conversationId || "?"} | texto="${(m.content || "").slice(0, 30)}"`);
        if (!m.phone && !m.conversationId) {
          console.warn("[Zernio] message.received sem telefone/conversa — payload logado acima.");
          return;
        }

        // Ignora contas NÃO cadastradas ou INATIVAS no CRM. Sem isto, um número
        // "excluído" do CRM (exclusão é só local) continuava espelhando mensagens
        // enquanto o Zernio seguisse entregando webhooks dele.
        const { isZernioAccountAllowed } = await import("../db");
        if (!(await isZernioAccountAllowed(m.accountId))) {
          console.log(`[Zernio] message.received ignorado: conta ${m.accountId || "?"} não cadastrada ou inativa no CRM`);
          return;
        }

        // Número de DESTINO migrado p/ outro canal (ex.: Evolution) mas ainda
        // registrado no Zernio → chega com o accountId de terceiro; ignora.
        const { isZernioBusinessPhoneBlocked } = await import("../db");
        if (await isZernioBusinessPhoneBlocked(m.businessPhone)) {
          console.log(`[Zernio] message.received ignorado: destino ${m.businessPhone} é atendido por outro canal`);
          return;
        }

        // Mídia do Zernio exige Bearer token → re-hospeda no S3/MinIO para o
        // inbox renderizar (imagem/áudio/vídeo) e a transcrição conseguir baixar.
        let hostedMediaUrl: string | undefined = m.mediaUrl;
        if (m.mediaUrl && m.messageType !== "text") {
          const { hostZernioMedia } = await import("../zernioService");
          const kind = m.messageType === "audio" ? "audio"
            : m.messageType === "image" ? "image"
            : m.messageType === "video" ? "video" : "document";
          const hosted = await hostZernioMedia(m.mediaUrl, m.mimeType || "", kind, m.accountId);
          if (hosted) hostedMediaUrl = hosted;
        }

        // Transcreve áudio (mesmo pipeline Groq/Whisper do restante), já da URL pública
        let transcript: string | undefined;
        let content = m.content;
        if (m.messageType === "audio" && hostedMediaUrl) {
          try {
            const t = await transcribeAudioSafe(hostedMediaUrl);
            if (t) { transcript = t; content = t; }
          } catch (e) {
            console.error("[Zernio] transcrição falhou:", e);
          }
        }

        const result = await mirrorZernioMessage({
          zernioConversationId: m.conversationId,
          accountId: m.accountId,
          phone: m.phone,
          contactName: m.name || m.senderName, // pushName do WhatsApp = quem enviou (cliente)
          content,
          transcript,
          messageType: m.messageType,
          direction: "inbound",
          senderName: m.name || m.senderName || m.phone || "Cliente",
          mediaUrl: hostedMediaUrl,
          externalId: m.externalId,
          timestamp: m.timestamp,
          ctwaId: m.ctwaId, // grava a atribuição JÁ na criação do lead (sem corrida)
        });

        if (result) {
          emitNewMessage(result.conversationId, result.message);
          emitConversationUpdate(result.conversationId, {});
          await updateLastCustomerMessageAt(result.conversationId, m.timestamp).catch(() => {});

          // CTWA: se a conversa veio de anúncio Click-to-WhatsApp, captura a
          // atribuição (ctwa_clid) → lead marcado como "anúncio" + Meta CAPI.
          console.log(`[Zernio][CTWA] referral? ctwa_clid=${m.ctwaId || "não"} | ad=${m.adHeadline || "-"} | adId=${m.adId || "-"}`);
          if (m.ctwaId || m.adId) {
            try {
              const { upsertLead } = await import("../db");
              await upsertLead({
                conversationId: result.conversationId,
                phone: m.phone,
                ctwaId: m.ctwaId || undefined,
                utmSource: "meta_ctwa",
                utmMedium: m.adId || undefined,        // ID do anúncio (casar com campanha no Meta)
                utmCampaign: m.adHeadline || undefined, // nome legível (veículo)
                landingPage: m.adSourceUrl || undefined,
              } as any);
              console.log(`[Zernio] CTWA capturado: ad="${m.adHeadline || "?"}" adId=${m.adId || "-"} (conversa ${result.conversationId})`);
            } catch (err) {
              console.error("[Zernio] Erro ao salvar atribuição CTWA:", err);
            }
          }

          // Detecta a origem do lead pela 1ª mensagem (portal/anúncio) e etiqueta
          try { const { applyLeadOrigin } = await import("../db"); applyLeadOrigin(result.conversationId, content).catch(() => {}); } catch { /* noop */ }

          // Dispara IA + fluxos (assíncrono, para responder rápido ao webhook)
          const { runZernioAI } = await import("../zernioAI");
          try { runZernioAI(result.conversationId, content); } catch (e) {
            console.error("[Zernio] runZernioAI falhou:", e);
          }
        }
        return;
      }

      // ── Mensagem enviada (pela Bianca no app / dashboard Zernio) → espelha ──
      if (event === "message.sent") {
        const m = parseZernioMessage(payload);
        // Mesmo guard do message.received: conta não cadastrada/inativa → ignora
        const { isZernioAccountAllowed } = await import("../db");
        if (!(await isZernioAccountAllowed(m.accountId))) {
          console.log(`[Zernio] message.sent ignorado: conta ${m.accountId || "?"} não cadastrada ou inativa no CRM`);
          return;
        }
        const { isZernioBusinessPhoneBlocked } = await import("../db");
        if (await isZernioBusinessPhoneBlocked(m.businessPhone)) {
          console.log(`[Zernio] message.sent ignorado: destino ${m.businessPhone} é atendido por outro canal`);
          return;
        }
        let hostedMediaUrl: string | undefined = m.mediaUrl;
        if (m.mediaUrl && m.messageType !== "text") {
          const { hostZernioMedia } = await import("../zernioService");
          const kind = m.messageType === "audio" ? "audio"
            : m.messageType === "image" ? "image"
            : m.messageType === "video" ? "video" : "document";
          const hosted = await hostZernioMedia(m.mediaUrl, m.mimeType || "", kind, m.accountId);
          if (hosted) hostedMediaUrl = hosted;
        }
        const result = await mirrorZernioMessage({
          zernioConversationId: m.conversationId,
          accountId: m.accountId,
          phone: m.phone,
          contactName: m.name,
          content: m.content,
          messageType: m.messageType,
          direction: "outbound",
          senderName: m.senderName || "Atendente",
          mediaUrl: hostedMediaUrl,
          externalId: m.externalId,
          timestamp: m.timestamp,
        });
        // Só emite se for mensagem nova (não o eco de algo que já enviamos pelo CRM)
        if (result && !result.isDuplicate) emitNewMessage(result.conversationId, result.message);
        return;
      }

      // ── Status de entrega ──
      if (event === "message.delivered" || event === "message.read" || event === "message.failed") {
        const msg = payload.message || {};
        const externalId = msg.id || msg._id || msg.platformMessageId || msg.messageId;
        const status = event === "message.delivered" ? "delivered" : event === "message.read" ? "read" : "failed";
        const errDetail = payload.error ? `${payload.error.code || ""}: ${payload.error.title || payload.error.message || ""}` : undefined;
        if (externalId) {
          await updateMessageDeliveryStatus(String(externalId), status as any, errDetail).catch(() => {});
        }
        return;
      }

      // outros eventos (conversation.started, reaction.received, etc.) — só loga por ora
    } catch (err) {
      console.error("[Zernio] Erro ao processar webhook:", err);
    }
  });

  // Verificação GET do endpoint Zernio (retorna 200 simples; Zernio valida via
  // dashboard + webhook.test, não usa o challenge da Meta)
  app.get("/api/webhook/zernio", (_req, res) => {
    res.status(200).send(zernioEnabled() ? "zernio-ok" : "zernio-disabled");
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
    if (!requireMetaSignature(req, res)) return;
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
    if (!requireMetaSignature(req, res)) return;
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
              aiActive: await getConnectionAiAuto(`meta:${channel}`), // IA automática só se o canal estiver marcado
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
              aiActive: await getConnectionAiAuto(`meta:${channel}`), // respeita o padrão da conexão ao reabrir
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

          // Sempre agrupa (fluxo pode disparar mesmo com IA desligada; IA livre é gated no callback)
          {
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
    // Segurança: exige API key ativa (tabela vendorApiKeys) no header X-Api-Key
    try {
      const apiKey = (req.headers["x-api-key"] as string || "").trim();
      if (!apiKey) return res.status(401).json({ error: "Missing X-Api-Key header" });
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });
      const { vendorApiKeys } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const keyRow = await db.select().from(vendorApiKeys)
        .where(and(eq(vendorApiKeys.apiKey, apiKey), eq(vendorApiKeys.active, true)))
        .limit(1);
      if (keyRow.length === 0) {
        console.warn(`[Webhook Generic] API key inválida rejeitada (ip: ${req.ip})`);
        return res.status(401).json({ error: "Invalid API key" });
      }
      try { await db.update(vendorApiKeys).set({ lastUsedAt: new Date() }).where(eq(vendorApiKeys.id, keyRow[0].id)); } catch {}
    } catch (err) {
      console.error("[Webhook Generic] Erro na validação de API key:", err);
      return res.status(500).json({ error: "Auth check failed" });
    }

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
    // Segurança: só admin autenticado pode trocar codes (usa o App Secret do sistema)
    try {
      const { sdk } = await import("./sdk");
      const user = await sdk.authenticateRequest(req);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Apenas administradores" });
      }
    } catch {
      return res.status(401).json({ error: "Não autenticado" });
    }

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

  // ── Conversões do SITE (Meta CAPI sem Stape) ────────────────────────────────
  // O site autoinovars.com.br chama este endpoint no clique do WhatsApp e no
  // envio de formulário; o servidor repassa à CAPI com PII hasheada.
  const SITE_ALLOWED_ORIGINS = [
    "https://www.autoinovars.com.br",
    "https://autoinovars.com.br",
  ];
  function applySiteCors(req: any, res: any) {
    const origin = req.headers.origin as string | undefined;
    if (origin && SITE_ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  app.options("/api/site/track", (req, res) => { applySiteCors(req, res); res.sendStatus(204); });
  app.post("/api/site/track", async (req, res) => {
    applySiteCors(req, res);
    try {
      const b = req.body || {};
      const allowed = ["Contact", "Lead", "SubmitApplication", "ViewContent", "Schedule"];
      const eventName = allowed.includes(b.event) ? b.event : "Lead";
      const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
      const clientIp = xff || req.socket?.remoteAddress || undefined;
      const clientUserAgent = (req.headers["user-agent"] as string | undefined) || undefined;
      const { sendWebsiteConversion } = await import("../metaConversions");
      const r = await sendWebsiteConversion({
        eventName,
        eventId: typeof b.eventId === "string" ? b.eventId : undefined,
        eventSourceUrl: typeof b.eventSourceUrl === "string" ? b.eventSourceUrl : undefined,
        fbp: typeof b.fbp === "string" ? b.fbp : undefined,
        fbc: typeof b.fbc === "string" ? b.fbc : undefined,
        email: typeof b.email === "string" ? b.email : undefined,
        phone: typeof b.phone === "string" ? b.phone : undefined,
        firstName: typeof b.firstName === "string" ? b.firstName : undefined,
        lastName: typeof b.lastName === "string" ? b.lastName : undefined,
        value: typeof b.value === "number" ? b.value : undefined,
        currency: typeof b.currency === "string" ? b.currency : undefined,
        clientIp, clientUserAgent,
      });
      // Nunca vaza erro de tracking pro visitante; sempre 200 pro navegador
      res.status(200).json({ ok: r.success });
    } catch (err) {
      console.error("[CAPI-Site] erro no endpoint:", err);
      res.status(200).json({ ok: false });
    }
  });

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
