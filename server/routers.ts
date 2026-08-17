import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { normalizePhone, phoneVariations } from "./phoneNormalize";
import { resolveAgentForConversation } from "./agentResolver";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  listConversations, getConversationById, createConversation, updateConversation, getConversationByPhone, getConversationByPlatformUserId,
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
  getLeadSummaries, getLeadSummariesByConversation, upsertLeadSummary, getFullLeadSummaryText,
  listChatFlows, getChatFlowById, createChatFlow, updateChatFlow, deleteChatFlow, getActiveChatFlows,
  listChatFlowNodes, getChatFlowNodeById, createChatFlowNode, updateChatFlowNode, deleteChatFlowNode, bulkUpsertNodes,
  listChatFlowEdges, createChatFlowEdge, deleteChatFlowEdge, replaceFlowEdges,
  getActiveFlowSession, createFlowSession, updateFlowSession, getFlowSessionsByFlow,
  pauseFlowSessionByConversation, pauseAllActiveSessionsByFlow,
  listAiAgents, getAiAgentById, createAiAgent, updateAiAgent, deleteAiAgent, getActiveAiAgents, setDefaultAiAgent,
  listSellers, listActiveSellers, getSellerById, createSeller, updateSeller, deleteSeller,
  getNextSellerInQueue, createSellerAssignment, listSellerAssignments, updateSellerAssignment,
  getStoreLocationByVehicleId, getDistinctStoreLocations,
} from "./db";
import { processAIMessage, DEFAULT_SYSTEM_PROMPT, DEFAULT_PERSONALITY_PROMPT, CORE_PROMPT, COMMERCIAL_PROMPT, getPersonalityPrompt, getCorePrompt, getCommercialPrompt } from "./ai";
import { emitNewMessage, emitConversationUpdate, emitTypingIndicator } from "./socket";
import { transcribeAudio } from "./_core/voiceTranscription";
import { sendTextMessage, sendImageMessage, sendAudioMessage, sendVideoMessage, sendReplyButtons, sendListMessage, isConfigured as isWhatsAppConfigured } from "./whatsapp";
import { sendPlatformMessage, sendPlatformImage, isInstagramConfigured, isFacebookConfigured, getPlatformUserProfile } from "./instagramFacebook";
import { storagePut } from "./storage";
import { convertWebmToOgg, needsConversionForWhatsApp, isWebmAudio } from "./audioConverter";
import { syncStock } from "./stockSync";
import { addToDebounce, setDebounceCallback, cancelDebounce, setDebounceDelay, getDebounceDelay } from "./messageDebounce";
import crypto from "crypto";
import { getDb } from "./db";
import { chatFlowSessions } from "../drizzle/schema";
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
  getMetaConfig,
  testMetaConnection,
  importAdsFromMeta,
  listCampaigns,
  listAdSets,
  createAdInExistingAdSet,
} from "./metaAds";

// ── Campaign (Envio em Massa) imports ────────────────────────────────────────
import {
  executeCampaign,
  handleCampaignResponse,
} from "./campaignService";

// ── Evolution API imports ─────────────────────────────────────────────────────
import {
  evolutionFetchInstances,
  evolutionCreateInstance,
  evolutionGetQrCode,
  evolutionGetInstanceStatus,
  evolutionDeleteInstance,
  evolutionLogoutInstance,
  evolutionRestartInstance,
  evolutionSetWebhook,
  evolutionSendText,
  evolutionSendMedia,
  evolutionGetProfilePic,
  evolutionFetchChats,
  evolutionFetchMessages,
  evolutionCheckWhatsAppNumber,
  evolutionFetchAllContacts,
} from "./evolutionService";
import {
  listEvolutionInstances,
  getEvolutionInstanceById,
  getEvolutionInstanceByName,
  createEvolutionInstance,
  updateEvolutionInstance,
  deleteEvolutionInstance as deleteEvolutionInstanceDb,
  listEvolutionConversations,
  getEvolutionConversationById,
  getEvolutionConversationByJid,
  upsertEvolutionConversation,
  updateEvolutionConversation,
  listEvolutionMessages,
  createEvolutionMessage,
} from "./db";
import {
  createCampaign as createCampaignDb,
  getCampaignById as getCampaignByIdDb,
  listCampaigns as listCampaignsDb,
  updateCampaign as updateCampaignDb,
  deleteCampaign as deleteCampaignDb,
  getCampaignDispatchesByCampaign,
  getCampaignDispatchStats,
} from "./db";
import { listTemplates, sendWhatsAppTemplate, isTemplateApproved, isTemplatesConfigured } from "./whatsappTemplates";
import { invokeLLM } from "./_core/llm";
import { runTokenHealthCheck, getLastCheckResults } from "./tokenMonitor";
import { processFlowMessage, cancelFlowSession, continueFlowAfterAI } from "./flowEngine";
import {
  listContacts, getContactById, getContactByPhone, createContact, updateContact,
  deleteContact, bulkCreateContacts, getAllContactTags,
  createTemplateSend, listTemplateSends, updateTemplateSendStatus,
} from "./db";

// ── Rescue Job imports ──────────────────────────────────────────────────────
import {
  getRescueConfig,
  saveRescueConfig,
  getRescueHistory,
  getRescueStats,
  runRescueJob,
  restartRescueJob,
} from "./rescueJob";

// ── Routers extraídos (PR #10) ───────────────────────────────────────────────
import { customersRouter } from "./routers/customers";
import { campaignRouter } from "./routers/campaign";
import { sellerRouter } from "./routers/seller";
import { tokenHealthRouter } from "./routers/tokenHealth";
import { quickReplyRouter } from "./routers/quickReply";
import { labelRouter } from "./routers/label";
import { reminderRouter } from "./routers/reminder";
import { scheduledMessageRouter } from "./routers/scheduledMessage";
import { capiRouter } from "./routers/capi";
import { teamRouter } from "./routers/team";
import { teamAuthRouter } from "./routers/teamAuth";
import { notificationRouter } from "./routers/notification";
import { activityRouter } from "./routers/activity";
import { aiDecisionRouter } from "./routers/aiDecision";
import { rescueRouter } from "./routers/rescue";
import { reengagementRouter } from "./routers/reengagement";
import { whatsappTemplateRouter } from "./routers/whatsappTemplate";
import { copilotRouter } from "./routers/copilot";
import { coachRouter } from "./routers/coach";
import { vendorRouter } from "./routers/vendor";
import { evolutionRouter } from "./routers/evolution";
import { zernioRouter } from "./routers/zernio";
import { whatsappNumberRouter } from "./routers/whatsappNumber";
import { performanceRouter } from "./routers/performance";
import { dashboardRouter } from "./routers/dashboard";
import { vehicleRouter } from "./routers/vehicle";
import { webhookRouter } from "./routers/webhook";
import { settingsRouter } from "./routers/settings";
import { metaAdsRouter } from "./routers/metaAds";
import { knowledgeBaseRouter } from "./routers/knowledgeBase";
import { automationAiRouter } from "./routers/automationAi";
import { conversationRouter } from "./routers/conversation";
import { messageRouter } from "./routers/message";
import { leadRouter } from "./routers/lead";
import { flowRouter } from "./routers/flow";
import { agentRouter } from "./routers/agent";
import { contactsRouter } from "./routers/contacts";
import { currentTeamMember } from "./routers/_helpers";

/**
 * Inicializa o debounce callback e carrega delay do banco
 */
async function initDebounce() {
  // Carrega delay do banco de dados
  try {
    const savedDelay = await getSetting("debounce_delay_ms");
    if (savedDelay) {
      setDebounceDelay(parseInt(savedDelay, 10));
    }
  } catch (err) {
    console.log("[Debounce] Usando delay padrão (8s)");
  }

  // Registra o callback que será chamado quando o debounce expirar
  setDebounceCallback(async (conversationId, groupedContent, messages) => {
    try {
      const conversation = await getConversationById(conversationId);
      if (!conversation) {
        console.log(`[Debounce] Conversa ${conversationId}: n\u00e3o encontrada, ignorando`);
        return;
      }

      // Fluxos rodam independente do aiActive (freio de emerg\u00eancia flows_global_enabled).
      // A IA "livre" \u00e9 liberada mais abaixo, s\u00f3 se a conversa estiver com aiActive.
      const globalFlowsEnabled = (await getSetting("flows_global_enabled")) !== "false";

      console.log(`[Debounce] Conversa ${conversationId}: processando ${messages.length} mensagem(ns) agrupada(s)`);
      emitTypingIndicator(conversationId, true, "Auto Inova - Matriz IA");

      // === FLOW ENGINE: Tentar processar via fluxo programado ===
      if (globalFlowsEnabled) try {
        const flowResult = await processFlowMessage({
          conversationId,
          phone: conversation.phone || "",
          customerMessage: groupedContent,
          contactName: conversation.contactName || undefined,
        });

        if (flowResult.handled) {
          console.log(`[Debounce] Conversa ${conversationId}: processado pelo Flow Engine (${flowResult.responses.length} respostas, waiting: ${flowResult.waitingForInput})`);
          emitTypingIndicator(conversationId, false, "Auto Inova - Matriz IA");

          // Save flow responses to DB and emit
          for (const response of flowResult.responses) {
            const botMsg = await createMessage({
              conversationId,
              content: response,
              senderType: "bot",
              senderName: "Auto Inova - Matriz IA",
              messageType: "text",
            });
            emitNewMessage(conversationId, botMsg);
          }
          // Save flow image messages to DB
          for (const img of flowResult.imageMessages) {
            const imgMsg = await createMessage({
              conversationId,
              content: img.caption || "[Imagem]",
              senderType: "bot",
              senderName: "Auto Inova - Matriz IA",
              messageType: "image",
              metadata: { mediaUrl: img.imageUrl, caption: img.caption },
            });
            emitNewMessage(conversationId, imgMsg);
          }
          // Save flow interactive messages to DB with metadata
          for (const im of flowResult.interactiveMessages) {
            const interactiveMetadata: any = { interactiveType: im.type, interactiveData: im.data };
            let content = im.data.body || "";
            if (im.type === "buttons" && im.data.buttons) {
              content += `\n\n[Botões: ${im.data.buttons.map((b: any) => b.title).join(" | ")}]`;
              interactiveMetadata.buttons = im.data.buttons;
            } else if (im.type === "list" && im.data.sections) {
              content += `\n\n[Lista: ${im.data.sections.flatMap((s: any) => (s.rows || []).map((r: any) => r.title)).join(" | ")}]`;
              interactiveMetadata.sections = im.data.sections;
              interactiveMetadata.buttonText = im.data.buttonText;
            }
            const flowInteractiveMsg = await createMessage({
              conversationId,
              content,
              senderType: "bot",
              senderName: "Auto Inova - Matriz IA",
              messageType: "text",
              metadata: interactiveMetadata,
            });
            emitNewMessage(conversationId, flowInteractiveMsg);
          }
          return; // Flow handled, don't pass to AI
        }
      } catch (flowErr) {
        console.error(`[Debounce] Conversa ${conversationId}: erro no Flow Engine, fallback para IA:`, flowErr);
      }
      // === END FLOW ENGINE ===

      // IA "livre" só entra se: aiActive na conversa E a conexão permitir (IA automática
      // ligada) OU a IA foi escolhida explicitamente (fluxo/atendente). Nunca "globalmente".
      const freshConv = await getConversationById(conversationId);
      const { isConnectionAiAllowed } = await import("./db");
      if (!freshConv?.aiActive || !(await isConnectionAiAllowed(freshConv))) {
        console.log(`[Debounce] Conversa ${conversationId}: IA não liberada nesta conexão/conversa, sem resposta automática`);
        emitTypingIndicator(conversationId, false, "Auto Inova - Matriz IA");
        return;
      }

      const recentMessages = await listMessages(conversationId, 30);

      // Check if there's an active flow session with a custom prompt or agent
      // Priority: node agentId > flow agentId > channel agent > global prompts
      let flowAiOptions: { flowPrompt?: string; flowInstruction?: string; agentId?: number | null; onlyTools?: string[] } | undefined;
      let collectOnlyTools: string[] | undefined;
      let discoveryPromptCtx: string | undefined;
      try {
        const activeFlowSession = await getActiveFlowSession(conversationId);
        console.log(`[Debounce] Conversa ${conversationId}: activeFlowSession=${activeFlowSession ? `id=${activeFlowSession.id}, currentNodeId=${activeFlowSession.currentNodeId}, context=${JSON.stringify(activeFlowSession.context)}` : 'null'}`);
        if (activeFlowSession) {
          const flow = await getChatFlowById(activeFlowSession.flowId);
          if (flow) {
            const sessionCtx = (activeFlowSession.context as any) || {};
            console.log(`[Debounce] Conversa ${conversationId}: fluxo "${flow.name}", sessionCtx.nodeAgentId=${sessionCtx.nodeAgentId}, flow.agentId=${flow.agentId}`);
            // Nó "Coletar com IA": restringe as ferramentas da IA (só coleta, sem buscar veículo)
            if (sessionCtx.collectMode) {
              collectOnlyTools = Array.isArray(sessionCtx.collectTools) && sessionCtx.collectTools.length > 0 ? sessionCtx.collectTools : ["atualizar_lead"];
            } else if (Array.isArray(sessionCtx.nodeOnlyTools) && sessionCtx.nodeOnlyTools.length > 0) {
              // Nó de IA livre / Apresentar com IA com ferramentas específicas
              collectOnlyTools = sessionCtx.nodeOnlyTools;
            }
            if (sessionCtx.discoveryMode && sessionCtx.discoveryPrompt) {
              discoveryPromptCtx = sessionCtx.discoveryPrompt;
            }
            // Priority 1: agentId from the current ai_response node
            if (sessionCtx.nodeAgentId) {
              flowAiOptions = {
                agentId: sessionCtx.nodeAgentId,
                flowInstruction: sessionCtx.aiInstruction || undefined,
              };
              console.log(`[Debounce] Conversa ${conversationId}: usando agente ID ${sessionCtx.nodeAgentId} do nó IA no fluxo "${flow.name}"`);
            }
            // Priority 2: agentId from the flow itself (fallback)
            else if (flow.agentId) {
              flowAiOptions = {
                agentId: flow.agentId,
                flowInstruction: sessionCtx.aiInstruction || undefined,
              };
              console.log(`[Debounce] Conversa ${conversationId}: usando agente ID ${flow.agentId} do fluxo "${flow.name}"`);
            }
          }
        }
      } catch (flowPromptErr) {
        console.error(`[Debounce] Erro ao carregar prompt do fluxo:`, flowPromptErr);
      }

      // Nó "Apresentar com IA": usa prompt PRÓPRIO (sem as 3 camadas globais que
      // mandariam apresentar em texto). Isso desliga a seleção de agente abaixo.
      if (discoveryPromptCtx) {
        flowAiOptions = { flowPrompt: discoveryPromptCtx, onlyTools: collectOnlyTools };
        console.log(`[Debounce] Conversa ${conversationId}: modo APRESENTAR COM IA (prompt próprio, tools=${JSON.stringify(collectOnlyTools)})`);
      }

      // Seleção de agente (fixado → instância → padrão) — FONTE ÚNICA
      // (mesma função usada pelo preview "quem responde esta conversa?").
      if (!flowAiOptions?.agentId && !flowAiOptions?.flowPrompt) {
        try {
          const r = await resolveAgentForConversation(conversation as any);
          if (r.agentId) {
            flowAiOptions = { ...flowAiOptions, agentId: r.agentId };
            console.log(`[Debounce] Conversa ${conversationId}: agente por ${r.source} → "${r.agent?.name}" (ID ${r.agentId})`);
          }
        } catch (agentErr) {
          console.error(`[Debounce] Erro ao resolver agente:`, agentErr);
        }
      }

      // Coleta com IA: força o conjunto mínimo de ferramentas, independente do agente escolhido
      if (collectOnlyTools) {
        flowAiOptions = { ...flowAiOptions, onlyTools: collectOnlyTools };
      }
      // Pós-handoff: já foi transferido pro vendedor → IA responde breve, sem vender
      if ((conversation as any).routingState === "handed_off") {
        flowAiOptions = {
          ...flowAiOptions,
          onlyTools: ["atualizar_lead"],
          flowInstruction: "O atendimento JÁ foi transferido para um vendedor humano. Responda de forma BREVE e cordial: não apresente veículos, não venda e não reabra negociação. Se o cliente insistir em preço/condições, diga que o vendedor vai continuar o atendimento por aqui em instantes.",
        };
        console.log(`[Debounce] Conversa ${conversationId}: modo PÓS-HANDOFF (IA breve, sem vender)`);
      }
      console.log(`[Debounce] Conversa ${conversationId}: chamando processAIMessage com flowAiOptions=${JSON.stringify(flowAiOptions)}`);
      const aiResult = await processAIMessage(conversation, recentMessages, groupedContent, flowAiOptions);
      console.log(`[Debounce] Conversa ${conversationId}: IA respondeu, interactiveMessages=${aiResult.interactiveMessages?.length || 0}`);

      emitTypingIndicator(conversationId, false, "Auto Inova - Matriz IA");

      if (aiResult.response) {
        const botMsg = await createMessage({
          conversationId,
          content: aiResult.response,
          senderType: "bot",
          senderName: "Auto Inova - Matriz IA",
          messageType: "text",
        });

        emitNewMessage(conversationId, botMsg);

        // Enviar resposta via plataforma correta
        try {
          let sendResult: { success: boolean; messageId?: string; error?: string } = { success: false, error: "No platform configured" };

          console.log(`[Debounce] Debug envio: channel="${conversation.channel}", isConfigured=${isWhatsAppConfigured()}, phone="${conversation.phone}"`);

          if (conversation.channel === "whatsapp" && isWhatsAppConfigured() && conversation.phone) {
            sendResult = await sendTextMessage(conversation.phone, aiResult.response);
          } else if (conversation.channel === "instagram" && isInstagramConfigured() && conversation.platformUserId) {
            sendResult = await sendPlatformMessage("instagram", conversation.platformUserId, aiResult.response);
          } else if (conversation.channel === "facebook" && isFacebookConfigured() && conversation.platformUserId) {
            sendResult = await sendPlatformMessage("facebook", conversation.platformUserId, aiResult.response);
          }

          if (sendResult.success && sendResult.messageId) {
            await updateMessageExternalId(botMsg.id, sendResult.messageId);
            console.log(`[Debounce] Conversa ${conversationId}: resposta enviada via ${conversation.channel} (id: ${sendResult.messageId})`);
          } else if (sendResult.error) {
            console.error(`[Debounce] Conversa ${conversationId}: falha ao enviar via ${conversation.channel}:`, sendResult.error);
          }
        } catch (platformErr) {
          console.error(`[Debounce] Conversa ${conversationId}: erro ao enviar via ${conversation.channel}:`, platformErr);
        }

        // Send vehicle images asynchronously (WhatsApp only for now, IG/FB have different image handling)
        if (conversation.channel === "whatsapp" && conversation.phone) {
          sendVehicleImages(conversation.phone, aiResult.response).catch(err =>
            console.error("[Debounce] Error sending vehicle images:", err)
          );
        } else if ((conversation.channel === "instagram" || conversation.channel === "facebook") && conversation.platformUserId) {
          sendPlatformVehicleImages(conversation.channel, conversation.platformUserId, aiResult.response).catch(err =>
            console.error("[Debounce] Error sending platform vehicle images:", err)
          );
        }

        // === SEND AI IMAGES FIRST (before flow continuation, so photo arrives before buttons) ===
        if (aiResult.interactiveMessages && aiResult.interactiveMessages.length > 0 && conversation.channel === "whatsapp" && isWhatsAppConfigured() && conversation.phone) {
          for (const im of aiResult.interactiveMessages) {
            if (im.type === "image" && im.imageUrl) {
              try {
                // Small delay to ensure AI text arrives first
                await new Promise(resolve => setTimeout(resolve, 800));
                const imageResult = await sendImageMessage(
                  conversation.phone,
                  im.imageUrl,
                  im.caption || im.body
                );
                console.log(`[Debounce] Conversa ${conversationId}: imagem de ve\u00edculo enviada - success: ${imageResult.success}`);
                if (imageResult.success) {
                  const imageMsg = await createMessage({
                    conversationId,
                    content: im.caption || im.body || "[Imagem do ve\u00edculo]",
                    senderType: "bot",
                    senderName: "Auto Inova - Matriz IA",
                    messageType: "image",
                    metadata: { imageUrl: im.imageUrl, caption: im.caption },
                  });
                  emitNewMessage(conversationId, imageMsg);
                  if (imageResult.messageId) {
                    await updateMessageExternalId(imageMsg.id, imageResult.messageId);
                  }
                }
              } catch (imgErr) {
                console.error(`[Debounce] Conversa ${conversationId}: erro ao enviar imagem:`, imgErr);
              }
            }
          }
        }
        // === END SEND AI IMAGES ===

        // === FLOW CONTINUATION: After AI responds, continue flow if pending ===
        let flowContinued = false;
        if (globalFlowsEnabled) try {
          const flowContinuation = await continueFlowAfterAI(conversationId, {
            conversationId,
            phone: conversation.phone || "",
            customerMessage: groupedContent,
            contactName: conversation.contactName || undefined,
          });

          if (flowContinuation.handled) {
            flowContinued = true;
            console.log(`[Debounce] Conversa ${conversationId}: fluxo continuado ap\u00f3s IA (${flowContinuation.responses.length} respostas, ${flowContinuation.interactiveMessages.length} interativos)`);

            // Small delay to ensure AI text arrives first
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Send flow continuation responses (save to DB + emit socket only; flowEngine already sent via WhatsApp API)
            for (const response of flowContinuation.responses) {
              const botMsg = await createMessage({
                conversationId,
                content: response,
                senderType: "bot",
                senderName: "Auto Inova - Matriz IA",
                messageType: "text",
              });
              emitNewMessage(conversationId, botMsg);
            }

            // Save flow continuation image messages to DB
            for (const img of flowContinuation.imageMessages) {
              const imgMsg = await createMessage({
                conversationId,
                content: img.caption || "[Imagem]",
                senderType: "bot",
                senderName: "Auto Inova - Matriz IA",
                messageType: "image",
                metadata: { mediaUrl: img.imageUrl, caption: img.caption },
              });
              emitNewMessage(conversationId, imgMsg);
            }

            // Send flow continuation interactive messages (save to DB + emit socket only; flowEngine already sent via WhatsApp API)
            for (const im of flowContinuation.interactiveMessages) {
              const interactiveMetadata: any = { interactiveType: im.type, interactiveData: im.data };
              let content = im.data.body || "";
              if (im.type === "buttons" && im.data.buttons) {
                content += `\n\n[Botões: ${im.data.buttons.map((b: any) => b.title).join(" | ")}]`;
                interactiveMetadata.buttons = im.data.buttons;
              } else if (im.type === "list" && im.data.sections) {
                content += `\n\n[Lista: ${im.data.sections.flatMap((s: any) => (s.rows || []).map((r: any) => r.title)).join(" | ")}]`;
                interactiveMetadata.sections = im.data.sections;
                interactiveMetadata.buttonText = im.data.buttonText;
              }
              const flowInteractiveMsg = await createMessage({
                conversationId,
                content,
                senderType: "bot",
                senderName: "Auto Inova - Matriz IA",
                messageType: "text",
                metadata: interactiveMetadata,
              });
              emitNewMessage(conversationId, flowInteractiveMsg);
            }
          }
        } catch (flowContErr) {
          console.error(`[Debounce] Conversa ${conversationId}: erro ao continuar fluxo ap\u00f3s IA:`, flowContErr);
        }
        // === END FLOW CONTINUATION ===

        // Send AI interactive messages (buttons/lists only - images already sent above)
        console.log(`[Debounce] Conversa ${conversationId}: flowContinued=${flowContinued}, interactiveMessages=${aiResult.interactiveMessages?.length || 0}`);
        if (!flowContinued && aiResult.interactiveMessages && aiResult.interactiveMessages.length > 0 && conversation.channel === "whatsapp" && isWhatsAppConfigured() && conversation.phone) {
          for (const im of aiResult.interactiveMessages) {
            // Skip images - already sent before flow continuation
            if (im.type === "image") continue;

            try {
              // Small delay to ensure previous messages arrive first
              await new Promise(resolve => setTimeout(resolve, 800));
              
              let interactiveResult: { success: boolean; messageId?: string; error?: string } = { success: false };

              if (im.type === "buttons" && im.buttons && im.buttons.length > 0) {
                interactiveResult = await sendReplyButtons(
                  conversation.phone,
                  im.body,
                  im.buttons,
                  im.header,
                  im.footer
                );
                console.log(`[Debounce] Conversa ${conversationId}: reply buttons enviados (${im.buttons.length} botões) - success: ${interactiveResult.success}`);
              } else if (im.type === "list" && im.sections && im.sections.length > 0 && im.buttonText) {
                interactiveResult = await sendListMessage(
                  conversation.phone,
                  im.body,
                  im.buttonText,
                  im.sections,
                  im.header,
                  im.footer
                );
                const totalItems = im.sections.reduce((sum, s) => sum + s.rows.length, 0);
                console.log(`[Debounce] Conversa ${conversationId}: list message enviada (${totalItems} itens) - success: ${interactiveResult.success}`);
              }

              // Save interactive message to DB for display in dashboard
              if (interactiveResult.success) {
                const interactiveContent = im.type === "buttons"
                  ? `[Botões: ${im.buttons!.map(b => b.title).join(" | ")}]`
                  : `[Lista: ${im.sections!.flatMap(s => s.rows.map(r => r.title)).join(" | ")}]`;
                const interactiveMetadata: any = { interactiveType: im.type };
                if (im.type === "buttons" && im.buttons) {
                  interactiveMetadata.buttons = im.buttons;
                  interactiveMetadata.body = im.body;
                } else if (im.type === "list" && im.sections) {
                  interactiveMetadata.sections = im.sections;
                  interactiveMetadata.buttonText = im.buttonText;
                  interactiveMetadata.body = im.body;
                }
                const interactiveMsg = await createMessage({
                  conversationId,
                  content: `${im.body}\n\n${interactiveContent}`,
                  senderType: "bot",
                  senderName: "Auto Inova - Matriz IA",
                  messageType: "text",
                  metadata: interactiveMetadata,
                });
                emitNewMessage(conversationId, interactiveMsg);
                if (interactiveResult.messageId) {
                  await updateMessageExternalId(interactiveMsg.id, interactiveResult.messageId);
                }
              }
            } catch (interactiveErr) {
              console.error(`[Debounce] Conversa ${conversationId}: erro ao enviar mensagem interativa:`, interactiveErr);
            }
          }
        }
      }
    } catch (err) {
      console.error(`[Debounce] Erro ao processar conversa ${conversationId}:`, err);
      emitTypingIndicator(conversationId, false, "Auto Inova - Matriz IA");
    }
  });

  console.log(`[Debounce] Sistema de agrupamento de mensagens inicializado (delay: ${getDebounceDelay()}ms)`);
}

// Inicializa o debounce ao carregar o módulo
initDebounce().catch(err => console.error("[Debounce] Erro na inicialização:", err));

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

/**
 * Send vehicle images via Instagram or Facebook
 */
async function sendPlatformVehicleImages(platform: "instagram" | "facebook", recipientId: string, aiResponse: string) {
  const idMatches = aiResponse.match(/\[ID:(\d+)\]/g);
  if (!idMatches || idMatches.length === 0) return;

  const vehicleIds = Array.from(new Set(idMatches.map(m => parseInt(m.match(/\d+/)![0]))));
  const db = await getDb();
  if (!db) return;

  const vehiclesTable = (await import("../drizzle/schema")).vehicles;
  const { inArray } = await import("drizzle-orm");

  try {
    const vehicleRecords = await db
      .select()
      .from(vehiclesTable)
      .where(inArray(vehiclesTable.id, vehicleIds))
      .limit(5);

    for (const vehicle of vehicleRecords) {
      if (!vehicle.imageUrl) continue;
      const caption = `${vehicle.title || `${vehicle.brand} ${vehicle.model}`} (${vehicle.year})`;
      await sendPlatformImage(platform, recipientId, vehicle.imageUrl, caption);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error(`[${platform}] Failed to send vehicle images:`, err);
  }
}










// ─── Team Members Router ──────────────────────────────────────

// ─── Team Auth Router ──────────────────────────────────────
const TEAM_COOKIE = "team_session";


import { getUserByOpenId, upsertUser } from "./db";

// ─── Notification Router ──────────────────────────────────────

// ─── Activity Log Router ──────────────────────────────────────

// ─── AI Decision Router ──────────────────────────────────────

// ── Rescue Router ────────────────────────────────────────────────────────────


// ── Reengagement Router (motor único v2 — PR #6) ─────────────────────────────


// ── Customers Router (pessoa canônica — PR #7) ───────────────────────────────



// ── WhatsApp Templates Router ─────────────────────────────────────────────────


// ── Token Health Router ────────────────────────────────────────────────────────


// ── Meta Ads Router ──────────────────────────────────────────────────────────




// ─── Seller Router ──────────────────────────────────────────
// ── Contacts Router ─────────────────────────────────────────────────────────


// ─── Evolution Router ─────────────────────────────────────────────────────────

// ─── Quick Replies Router (respostas prontas via "/") ────────────────────────


// ─── Labels Router (etiquetas de conversa) ────────────────────────────────────


// ─── Reminders Router (lembretes por conversa) ────────────────────────────────


// ─── Scheduled Messages Router (mensagens agendadas) ──────────────────────────


// ─── Meta CAPI Router (tracking avançado de anúncios) ─────────────────────────


// ─── Zernio Router ────────────────────────────────────────────────────────────

// ─── WhatsApp API Oficial (multi-número) Router ───────────────────────────────

// ── Avaliação de vendedores / coaching de vendas com IA ───────────────────────

// ─── Base de Conhecimento (FAQ para a IA — RAG leve) ──────────────────────────

// ─── IA automática por conexão (canal/instância/número) ──────────────────────

export const appRouter = router({
  system: systemRouter,
  knowledgeBase: knowledgeBaseRouter,
  automationAi: automationAiRouter,
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
  campaign: campaignRouter,
  whatsappTemplate: whatsappTemplateRouter,
  copilot: copilotRouter,
  coach: coachRouter,
  tokenHealth: tokenHealthRouter,
  vendor: vendorRouter,
  flow: flowRouter,
  agent: agentRouter,
  seller: sellerRouter,
  rescue: rescueRouter,
  reengagement: reengagementRouter,
  customers: customersRouter,
  contact: contactsRouter,
  evolution: evolutionRouter,
  zernio: zernioRouter,
  whatsappNumber: whatsappNumberRouter,
  performance: performanceRouter,
  quickReply: quickReplyRouter,
  label: labelRouter,
  reminder: reminderRouter,
  scheduledMessage: scheduledMessageRouter,
  capi: capiRouter,
});

export type AppRouter = typeof appRouter;
