import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
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
  listAiAgents, getAiAgentById, createAiAgent, updateAiAgent, deleteAiAgent, getActiveAiAgents,
  listSellers, listActiveSellers, getSellerById, createSeller, updateSeller, deleteSeller,
  getNextSellerInQueue, createSellerAssignment, listSellerAssignments, updateSellerAssignment,
  getStoreLocationByVehicleId, getDistinctStoreLocations,
} from "./db";
import { processAIMessage, DEFAULT_SYSTEM_PROMPT, DEFAULT_PERSONALITY_PROMPT, CORE_PROMPT, COMMERCIAL_PROMPT, getPersonalityPrompt, getCorePrompt, getCommercialPrompt } from "./ai";
import { emitNewMessage, emitConversationUpdate, emitTypingIndicator } from "./socket";
import { transcribeAudio } from "./_core/voiceTranscription";
import { sendTextMessage, sendImageMessage, sendAudioMessage, sendReplyButtons, sendListMessage, isConfigured as isWhatsAppConfigured } from "./whatsapp";
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
      if (!conversation || !conversation.aiActive) {
        console.log(`[Debounce] Conversa ${conversationId}: IA desativada ou conversa n\u00e3o encontrada, ignorando`);
        return;
      }

      // === GLOBAL TOGGLE CHECK ===
      const globalAiSetting = await getSetting("ai_global_enabled");
      const globalFlowsSetting = await getSetting("flows_global_enabled");
      const globalAiEnabled = globalAiSetting !== "false";
      const globalFlowsEnabled = globalFlowsSetting !== "false";

      if (!globalAiEnabled && !globalFlowsEnabled) {
        console.log(`[Debounce] Conversa ${conversationId}: IA e Fluxos DESATIVADOS globalmente, ignorando`);
        return;
      }
      // === END GLOBAL TOGGLE CHECK ===

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

      // Check if AI is globally enabled before processing
      if (!globalAiEnabled) {
        console.log(`[Debounce] Conversa ${conversationId}: IA DESATIVADA globalmente, ignorando processamento IA`);
        emitTypingIndicator(conversationId, false, "Auto Inova - Matriz IA");
        return;
      }

      const recentMessages = await listMessages(conversationId, 30);

      // Check if there's an active flow session with a custom prompt or agent
      // Priority: node agentId > flow agentId > channel agent > global prompts
      let flowAiOptions: { flowPrompt?: string; flowInstruction?: string; agentId?: number | null } | undefined;
      try {
        const activeFlowSession = await getActiveFlowSession(conversationId);
        console.log(`[Debounce] Conversa ${conversationId}: activeFlowSession=${activeFlowSession ? `id=${activeFlowSession.id}, currentNodeId=${activeFlowSession.currentNodeId}, context=${JSON.stringify(activeFlowSession.context)}` : 'null'}`);
        if (activeFlowSession) {
          const flow = await getChatFlowById(activeFlowSession.flowId);
          if (flow) {
            const sessionCtx = (activeFlowSession.context as any) || {};
            console.log(`[Debounce] Conversa ${conversationId}: fluxo "${flow.name}", sessionCtx.nodeAgentId=${sessionCtx.nodeAgentId}, flow.agentId=${flow.agentId}, flow.aiPrompt=${flow.aiPrompt ? 'yes' : 'no'}`);
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
            // Priority 3: legacy prompt from the flow
            else if (flow.aiPrompt) {
              flowAiOptions = {
                flowPrompt: flow.aiPrompt,
                flowInstruction: sessionCtx.aiInstruction || undefined,
              };
              console.log(`[Debounce] Conversa ${conversationId}: usando prompt legado do fluxo "${flow.name}"`);
            }
          }
        }
      } catch (flowPromptErr) {
        console.error(`[Debounce] Erro ao carregar prompt do fluxo:`, flowPromptErr);
      }

      // If no flow agent, try channel agent
      if (!flowAiOptions?.agentId && !flowAiOptions?.flowPrompt) {
        try {
          const { getAiAgentForChannel } = await import("./db");
          const channelAgent = await getAiAgentForChannel(conversation.channel || "whatsapp");
          if (channelAgent) {
            flowAiOptions = { ...flowAiOptions, agentId: channelAgent.id };
            console.log(`[Debounce] Conversa ${conversationId}: usando agente de canal "${channelAgent.name}" (ID: ${channelAgent.id}) para ${conversation.channel}`);
          }
        } catch (channelAgentErr) {
          console.error(`[Debounce] Erro ao carregar agente de canal:`, channelAgentErr);
        }
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

      // Send message to the correct platform
      let deliveryStatus: "sent" | "failed" | null = null;
      let deliveryError: string | null = null;
      let windowExpired = false;

      const conv = await getConversationById(input.conversationId);
      if (conv) {
        try {
          let sendResult: { success: boolean; messageId?: string; error?: string } = { success: false, error: "No platform" };

          if (conv.channel === "whatsapp" && isWhatsAppConfigured() && conv.phone) {
            sendResult = await sendTextMessage(conv.phone, input.content);
          } else if (conv.channel === "instagram" && isInstagramConfigured() && conv.platformUserId) {
            sendResult = await sendPlatformMessage("instagram", conv.platformUserId, input.content);
          } else if (conv.channel === "facebook" && isFacebookConfigured() && conv.platformUserId) {
            sendResult = await sendPlatformMessage("facebook", conv.platformUserId, input.content);
          }

          if (sendResult.success && sendResult.messageId) {
            await updateMessageExternalId(message.id, sendResult.messageId);
            deliveryStatus = "sent";
          } else if (sendResult.error) {
            deliveryError = sendResult.error;
            deliveryStatus = "failed";

            // Detect 24h window expiry (WhatsApp only)
            if (conv.channel === "whatsapp") {
              const isWindowError = sendResult.error.includes('131047') || 
                sendResult.error.includes('Re-engagement') ||
                sendResult.error.includes('outside the allowed window');
              
              if (isWindowError) {
                windowExpired = true;
                await setWindowExpired(input.conversationId, true);
                console.log(`[WhatsApp] 24h window expired for conversation ${input.conversationId}. Template required.`);
              }
            }

            // System message about delivery failure
            await createMessage({
              conversationId: input.conversationId,
              content: `\u26a0\ufe0f Mensagem não entregue: ${deliveryError}`,
              senderType: "bot",
              senderName: "Sistema",
              messageType: "system",
            }).then(sysMsg => {
              if (sysMsg) emitNewMessage(input.conversationId, sysMsg);
            }).catch(() => {});
          }
        } catch (err: any) {
          console.error(`[${conv.channel}] Failed to send agent message:`, err);
          deliveryError = err.message || "Erro desconhecido";
          deliveryStatus = "failed";
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

  /** List leads with conversation data, vehicle, agent, and latest summary preview */
  listWithDetails: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { leads: leadsTable, conversations: convsTable, leadSummaries: summariesTable, vehicles: vehiclesTable, teamMembers: membersTable, sellerAssignments: assignmentsTable, sellers: sellersTable, rescueAttempts: rescueTable } = await import("../drizzle/schema");
      const { eq, desc, inArray } = await import("drizzle-orm");

      // Get all leads
      let allLeads;
      if (input?.status && input.status !== "all") {
        allLeads = await db.select().from(leadsTable).where(eq(leadsTable.status, input.status as any)).orderBy(desc(leadsTable.updatedAt));
      } else {
        allLeads = await db.select().from(leadsTable).orderBy(desc(leadsTable.updatedAt));
      }
      if (allLeads.length === 0) return [];

      // Batch fetch conversations, summaries, vehicles, team members
      const convIds = Array.from(new Set(allLeads.map(l => l.conversationId)));
      const convs = await db.select().from(convsTable).where(inArray(convsTable.id, convIds));
      const convMap = new Map(convs.map(c => [c.id, c]));

      const leadIds = allLeads.map(l => l.id);
      const summaries = await db.select().from(summariesTable).where(inArray(summariesTable.leadId, leadIds)).orderBy(desc(summariesTable.summaryDate));
      const summaryMap = new Map<number, typeof summaries>();
      summaries.forEach(s => {
        if (!summaryMap.has(s.leadId)) summaryMap.set(s.leadId, []);
        summaryMap.get(s.leadId)!.push(s);
      });

      const vehicleIds = allLeads.filter(l => l.vehicleId).map(l => l.vehicleId!) as number[];
      let vehicleMap = new Map<number, any>();
      if (vehicleIds.length > 0) {
        const vehs = await db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds));
        vehicleMap = new Map(vehs.map(v => [v.id, v]));
      }

      const agentIds = Array.from(new Set(convs.filter(c => c.assignedTo).map(c => c.assignedTo!)));
      let agentMap = new Map<number, any>();
      if (agentIds.length > 0) {
        const agents = await db.select().from(membersTable).where(inArray(membersTable.id, agentIds));
        agentMap = new Map(agents.map(a => [a.id, a]));
      }

      // Batch fetch seller assignments (latest per conversation)
      const allAssignments = convIds.length > 0
        ? await db.select().from(assignmentsTable).where(inArray(assignmentsTable.conversationId, convIds)).orderBy(desc(assignmentsTable.assignedAt))
        : [];
      const assignmentMap = new Map<number, typeof allAssignments[0]>();
      allAssignments.forEach(a => {
        if (!assignmentMap.has(a.conversationId)) assignmentMap.set(a.conversationId, a);
      });

      // Batch fetch sellers for assignments
      const sellerIds = Array.from(new Set(allAssignments.filter(a => a.sellerId).map(a => a.sellerId)));
      let sellerMap = new Map<number, any>();
      if (sellerIds.length > 0) {
        const sllrs = await db.select().from(sellersTable).where(inArray(sellersTable.id, sellerIds));
        sellerMap = new Map(sllrs.map(s => [s.id, s]));
      }

      // Batch fetch rescue attempts
      const allRescues = leadIds.length > 0
        ? await db.select().from(rescueTable).where(inArray(rescueTable.leadId, leadIds)).orderBy(desc(rescueTable.sentAt))
        : [];
      const rescueMap = new Map<number, typeof allRescues>();
      allRescues.forEach(r => {
        if (!rescueMap.has(r.leadId)) rescueMap.set(r.leadId, []);
        rescueMap.get(r.leadId)!.push(r);
      });

      return allLeads.map(lead => {
        const conv = convMap.get(lead.conversationId);
        const sums = summaryMap.get(lead.id) || [];
        const vehicle = lead.vehicleId ? vehicleMap.get(lead.vehicleId) : null;
        const agent = conv?.assignedTo ? agentMap.get(conv.assignedTo) : null;
        // Build preview: combine all summaries into one (latest first), max 3 lines
        const fullSummary = sums.map(s => s.summary).join("\n").trim();
        const summaryPreview = fullSummary.split("\n").slice(0, 3).join("\n") || "";

        // Seller assignment info
        const assignment = assignmentMap.get(lead.conversationId);
        const seller = assignment ? sellerMap.get(assignment.sellerId) : null;

        // Rescue attempts info
        const rescues = rescueMap.get(lead.id) || [];

        return {
          ...lead,
          conversation: conv ? {
            id: conv.id,
            contactName: conv.contactName,
            contactPhoto: conv.contactPhoto,
            channel: conv.channel,
            status: conv.status,
            aiActive: conv.aiActive,
            lastMessageAt: conv.lastMessageAt,
          } : null,
          summaryPreview,
          fullSummary,
          summaries: sums.map(s => ({ id: s.id, date: s.summaryDate, summary: s.summary, messageCount: s.messageCount })),
          linkedVehicle: vehicle ? {
            id: vehicle.id,
            brand: vehicle.brand,
            model: vehicle.model,
            year: vehicle.year,
            price: vehicle.price,
            color: vehicle.color,
            imageUrl: vehicle.imageUrl,
            url: vehicle.url,
          } : null,
          assignedAgent: agent ? { id: agent.id, name: agent.name, cargo: agent.cargo } : null,
          sellerAssignment: assignment && seller ? {
            sellerName: seller.name,
            sellerPhone: seller.phone,
            storeLocation: assignment.storeLocation,
            status: assignment.status,
            assignedAt: assignment.assignedAt?.getTime() || null,
            contactedAt: assignment.contactedAt?.getTime() || null,
          } : null,
          rescueInfo: rescues.length > 0 ? {
            totalAttempts: rescues.length,
            lastAttemptAt: rescues[0].sentAt?.getTime() || null,
            responded: rescues.some(r => r.status === "responded"),
            attempts: rescues.map(r => ({
              attemptNumber: r.attemptNumber,
              status: r.status,
              sentAt: r.sentAt?.getTime() || null,
              respondedAt: r.respondedAt?.getTime() || null,
            })),
          } : null,
        };
      });
    }),

  getByConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      return getLeadByConversationId(input.conversationId);
    }),

  /** Get summaries for a specific lead */
  getSummaries: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      return getLeadSummaries(input.leadId);
    }),

  /** Generate/update summary for today based on conversation messages */
  generateSummary: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      const lead = await getLeadByConversationId(input.conversationId);
      if (!lead) throw new Error("Lead not found");

      // Get today's messages
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { messages: msgsTable } = await import("../drizzle/schema");
      const { eq, and: andOp, gte } = await import("drizzle-orm");

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split("T")[0];

      const todayMsgs = await db.select().from(msgsTable)
        .where(andOp(eq(msgsTable.conversationId, input.conversationId), gte(msgsTable.createdAt, today)))
        .orderBy(msgsTable.createdAt);

      if (todayMsgs.length === 0) return null;

      // Build conversation text for summary
      const convText = todayMsgs.map(m => {
        const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Atendente";
        return `${role}: ${m.content}`;
      }).join("\n");

      // Use LLM to generate summary
      const { invokeLLM } = await import("./_core/llm");
      let summaryText: string;
      try {
        const resp = await invokeLLM({
          messages: [
            { role: "system", content: "Você é um assistente que gera resumos concisos de conversas de atendimento de uma loja de veículos. Gere um resumo em 3-5 linhas do que aconteceu na conversa. Inclua: interesse do cliente, veículos mencionados, decisões tomadas, próximos passos. Seja objetivo e direto. NÃO use markdown." },
            { role: "user", content: `Resuma esta conversa do dia ${todayStr}:\n\n${convText}` },
          ],
        });
        const rawContent = resp.choices?.[0]?.message?.content;
        summaryText = (typeof rawContent === "string" ? rawContent : "") || "Resumo indisponível";
      } catch {
        summaryText = `${todayMsgs.length} mensagens trocadas.`;
      }

      await upsertLeadSummary({
        leadId: lead.id,
        conversationId: input.conversationId,
        summaryDate: todayStr,
        summary: summaryText,
        messageCount: todayMsgs.length,
      });

      return { date: todayStr, summary: summaryText, messageCount: todayMsgs.length };
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
      city: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["new", "qualifying", "qualified", "contacted", "converted", "lost"]).optional(),
      funnelStatus: z.enum(["novo", "interesse_definido", "pagamento_definido", "dados_pessoais", "dados_troca", "encaminhado_vendedor", "negociando", "fechado", "perdido"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { conversationId, funnelStatus, ...data } = input;
      const conv = await getConversationById(conversationId);
      const updateData: any = { ...data };
      if (funnelStatus) {
        updateData.funnelStatus = funnelStatus;
        // Auto-calculate temperature from funnel status
        const tempMap: Record<string, string> = {
          novo: "frio", perdido: "frio",
          interesse_definido: "morno",
          pagamento_definido: "quente", dados_pessoais: "quente", dados_troca: "quente",
          encaminhado_vendedor: "muito_quente", negociando: "muito_quente", fechado: "muito_quente",
        };
        updateData.temperature = tempMap[funnelStatus] || "frio";
      }
      return upsertLead({
        conversationId,
        phone: conv?.phone || "",
        ...updateData,
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

      // Normalize phone for consistent matching
      const { normalizePhone: normPhone } = await import("./phoneNormalize");
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

      // Check if AI should respond — usa debounce para agrupar mensagens rápidas
      if (conversation.aiActive) {
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

  getDebounceDelay: protectedProcedure.query(async () => {
    const saved = await getSetting("debounce_delay_ms");
    return { delayMs: saved ? parseInt(saved, 10) : 8000 };
  }),

  saveDebounceDelay: adminProcedure
    .input(z.object({ delayMs: z.number().min(1000).max(30000) }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("debounce_delay_ms", String(input.delayMs), ctx.user.id);
      setDebounceDelay(input.delayMs);
      return { success: true, delayMs: input.delayMs };
    }),

  // ─── Global AI & Flows Toggle ─────────────────────────────────
  getGlobalStatus: protectedProcedure.query(async () => {
    const aiEnabled = await getSetting("ai_global_enabled");
    const flowsEnabled = await getSetting("flows_global_enabled");
    return {
      aiEnabled: aiEnabled !== "false", // default true
      flowsEnabled: flowsEnabled !== "false", // default true
    };
  }),

  setGlobalAI: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ai_global_enabled", String(input.enabled), ctx.user.id);
      console.log(`[Settings] IA global ${input.enabled ? "ATIVADA" : "DESATIVADA"} por user ${ctx.user.id}`);
      return { success: true, enabled: input.enabled };
    }),

  setGlobalFlows: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("flows_global_enabled", String(input.enabled), ctx.user.id);
      console.log(`[Settings] Fluxos globais ${input.enabled ? "ATIVADOS" : "DESATIVADOS"} por user ${ctx.user.id}`);
      // If disabling, pause all active flow sessions
      if (!input.enabled) {
        const db = await getDb();
        if (db) {
          await db.update(chatFlowSessions)
            .set({ status: "completed" })
            .where(eq(chatFlowSessions.status, "active"));
          console.log(`[Settings] Todas as sess\u00f5es de fluxo ativas foram pausadas`);
        }
      }
      return { success: true, enabled: input.enabled };
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

// ── Rescue Router ────────────────────────────────────────────────────────────

const rescueRouter = router({
  // Get current config
  getConfig: adminProcedure.query(async () => {
    return getRescueConfig();
  }),

  // Save config
  saveConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      inactivityMinutes: z.number().min(5).max(10080).optional(),
      maxAttempts: z.number().min(1).max(10).optional(),
      intervalMinutes: z.number().min(5).max(10080).optional(),
      rescueFlowId: z.number().nullable().optional(),
      maxPerRun: z.number().min(1).max(100).optional(),
      checkIntervalMinutes: z.number().min(1).max(60).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const config = await saveRescueConfig(input, ctx.user.id);
      restartRescueJob();
      return config;
    }),

  // Get history
  history: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return getRescueHistory(input?.limit ?? 50, input?.offset ?? 0);
    }),

  // Get stats
  stats: adminProcedure.query(async () => {
    return getRescueStats();
  }),

  // Run job manually
  runNow: adminProcedure.mutation(async () => {
    const result = await runRescueJob();
    return result;
  }),

  // List rescue flows (trigger = 'rescue')
  listRescueFlows: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { chatFlows } = await import("../drizzle/schema");
    const flows = await db.select({
      id: chatFlows.id,
      name: chatFlows.name,
      description: chatFlows.description,
      active: chatFlows.active,
    }).from(chatFlows).where(eq(chatFlows.trigger, "rescue"));
    return flows;
  }),
});

// ── Campaign (Envio em Massa) Router ────────────────────────────────────────

const campaignRouter = router({
  // List all campaigns
  list: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return listCampaignsDb(input || {});
    }),

  // Get campaign by ID
  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.id);
      if (!campaign) throw new Error("Campanha não encontrada");
      return campaign;
    }),

  // Create new campaign
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      templateName: z.string().min(1),
      templateLanguage: z.string().default("pt_BR"),
      bodyParams: z.array(z.string()).optional(),
      contactIds: z.array(z.number()).optional(),
      filterTags: z.array(z.string()).optional(),
      scheduleType: z.enum(["once", "recurring"]).default("once"),
      scheduledAt: z.number().optional(),
      intervalDays: z.number().min(1).max(365).optional(),
      responseFlowId: z.number().optional(),
      conversationTag: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const nextRunAt = input.scheduledAt || undefined;
      const campaign = await createCampaignDb({
        ...input,
        bodyParams: input.bodyParams || null,
        contactIds: input.contactIds || null,
        filterTags: input.filterTags || null,
        nextRunAt,
        status: input.scheduledAt ? "scheduled" : "draft",
        totalContacts: input.contactIds?.length || 0,
        createdBy: ctx.user.id,
      });
      return campaign;
    }),

  // Update campaign
  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      templateName: z.string().optional(),
      templateLanguage: z.string().optional(),
      bodyParams: z.array(z.string()).optional(),
      contactIds: z.array(z.number()).optional(),
      filterTags: z.array(z.string()).optional(),
      scheduleType: z.enum(["once", "recurring"]).optional(),
      scheduledAt: z.number().optional(),
      intervalDays: z.number().min(1).max(365).optional(),
      responseFlowId: z.number().nullable().optional(),
      conversationTag: z.string().nullable().optional(),
      status: z.enum(["draft", "scheduled", "paused"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.contactIds) updateData.totalContacts = data.contactIds.length;
      if (data.scheduledAt) updateData.nextRunAt = data.scheduledAt;
      return updateCampaignDb(id, updateData);
    }),

  // Delete campaign
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteCampaignDb(input.id);
      return { success: true };
    }),

  // Execute campaign immediately
  execute: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return executeCampaign(input.id);
    }),

  // Schedule campaign (set status to scheduled)
  schedule: adminProcedure
    .input(z.object({
      id: z.number(),
      scheduledAt: z.number(),
      intervalDays: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      return updateCampaignDb(input.id, {
        status: "scheduled",
        scheduledAt: input.scheduledAt,
        nextRunAt: input.scheduledAt,
        intervalDays: input.intervalDays,
        scheduleType: input.intervalDays ? "recurring" : "once",
      });
    }),

  // Pause campaign
  pause: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return updateCampaignDb(input.id, { status: "paused" });
    }),

  // Get dispatch history for a campaign
  dispatches: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      runNumber: z.number().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return getCampaignDispatchesByCampaign(input.campaignId, input);
    }),

  // Get stats for a campaign
  stats: adminProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return getCampaignDispatchStats(input.campaignId);
    }),

  // List available flows for response trigger
  availableFlows: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { chatFlows } = await import("../drizzle/schema");
    return db.select({
      id: chatFlows.id,
      name: chatFlows.name,
      trigger: chatFlows.trigger,
      active: chatFlows.active,
    }).from(chatFlows);
  }),

  // Add contact to campaign
  addContact: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      contactId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada");
      
      const currentIds = campaign.contactIds || [];
      if (!currentIds.includes(input.contactId)) {
        currentIds.push(input.contactId);
      }
      
      return updateCampaignDb(input.campaignId, {
        contactIds: currentIds,
        totalContacts: currentIds.length,
      });
    }),

  // Remove contact from campaign
  removeContact: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      contactId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada");
      
      const currentIds = (campaign.contactIds || []).filter(id => id !== input.contactId);
      
      return updateCampaignDb(input.campaignId, {
        contactIds: currentIds,
        totalContacts: currentIds.length,
      });
    }),

  // Add multiple contacts to campaign
  addContacts: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      contactIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada");
      
      const currentIds = campaign.contactIds || [];
      const newIds = new Set([...currentIds, ...input.contactIds]);
      const mergedIds = Array.from(newIds);
      
      return updateCampaignDb(input.campaignId, {
        contactIds: mergedIds,
        totalContacts: mergedIds.length,
      });
    }),

  // Remove multiple contacts from campaign
  removeContacts: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      contactIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada");
      
      const removeSet = new Set(input.contactIds);
      const currentIds = (campaign.contactIds || []).filter(id => !removeSet.has(id));
      
      return updateCampaignDb(input.campaignId, {
        contactIds: currentIds,
        totalContacts: currentIds.length,
      });
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

      const finalCampaignId = input.campaignId ?? (await createOrGetCampaign(config));
      const budgetCents = Math.round(input.dailyBudgetBRL * 100);
      const adSetId = await createAdSet(config, finalCampaignId, v, budgetCents);
      const imageHash = await uploadAdImage(config, v.imageUrl);

      // Build welcome message for Click to WhatsApp
      function buildWelcomeMsg(): string {
        const makeObj = (content: string, text: string) => ({
          type: "VISUAL_EDITOR", version: 2,
          landing_screen_type: "welcome_message", media_type: "text",
          text_format: { customer_action_type: "autofill_message",
            message: { autofill_message: { content }, text } }
        });
        const attempts = [
          { content: `Olá! Vi o anúncio do ${v.brand} ${v.model} ${v.year} e tenho interesse!`, text: `Olá! Bem-vindo à Auto Inova - Matriz! 👋` },
          { content: `Interesse no ${v.brand} ${v.model} ${v.year}`, text: `Olá!` },
          { content: "Olá, tenho interesse!", text: "" },
        ];
        for (const a of attempts) {
          const json = JSON.stringify(makeObj(a.content, a.text));
          if (json.length <= 300) return json;
        }
        return JSON.stringify(makeObj("Olá!", ""));
      }

      // Create creative with Click to WhatsApp (instead of LEARN_MORE)
      const adCreativeId = await (async () => {
        const result = await metaPost(
          `act_${config.adAccountId}/adcreatives`,
          {
            name: `Criativo IA — ${v.brand} ${v.model} #${v.id}`,
            object_story_spec: {
              page_id: config.pageId,
              ...(config.instagramActorId ? { instagram_user_id: config.instagramActorId } : {}),
              link_data: {
                image_hash: imageHash,
                link: "https://api.whatsapp.com/send",
                message: input.primaryText,
                name: input.headline,
                description: input.description,
                call_to_action: {
                  type: "WHATSAPP_MESSAGE",
                  value: { app_destination: "WHATSAPP" },
                },
                page_welcome_message: buildWelcomeMsg(),
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

// ─── Vendor API (Chrome Extension) ───────────────────────────────────────
async function getVendorByApiKey(apiKey: string) {
  const db = await getDb();
  if (!db) return null;
  const { vendorApiKeys } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  const result = await db
    .select()
    .from(vendorApiKeys)
    .where(and(eq(vendorApiKeys.apiKey, apiKey), eq(vendorApiKeys.active, true)))
    .limit(1);

  if (!result[0]) return null;

  db.update(vendorApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(vendorApiKeys.id, result[0].id))
    .catch(() => {});

  const { teamMembers } = await import("../drizzle/schema");
  const member = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.id, result[0].teamMemberId))
    .limit(1);

  return member[0] ?? null;
}

const vendorKeyProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const apiKey = (ctx.req as any)?.headers?.["x-vendor-key"] as string | undefined;
  if (!apiKey) throw new Error("X-Vendor-Key header missing");
  const vendor = await getVendorByApiKey(apiKey);
  if (!vendor) throw new Error("Invalid or inactive API key");
  return next({ ctx: { ...ctx, vendor } });
});

const vendorRouter = router({

  me: vendorKeyProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.vendor.id,
      name: ctx.vendor.name,
      email: ctx.vendor.email,
      cargo: ctx.vendor.cargo,
    };
  }),

  myLeads: vendorKeyProcedure
    .input(z.object({
      status: z.enum(["all", "new", "qualifying", "qualified", "contacted", "converted", "lost"]).default("all"),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversations, leads } = await import("../drizzle/schema");
      const { eq, desc, inArray } = await import("drizzle-orm");

      const convs = await db
        .select()
        .from(conversations)
        .where(eq(conversations.assignedTo, ctx.vendor.id))
        .orderBy(desc(conversations.lastMessageAt));

      if (convs.length === 0) return [];

      const convIds = convs.map((c) => c.id);
      const allLeads = await db.select().from(leads).where(inArray(leads.conversationId, convIds));
      const leadsByConv = new Map(allLeads.map((l) => [l.conversationId, l]));

      const statusFilter = input?.status ?? "all";

      return convs
        .map((conv) => {
          const lead = leadsByConv.get(conv.id);
          return {
            conversationId: conv.id,
            phone: conv.phone,
            contactName: conv.contactName,
            status: conv.status,
            lastMessageAt: conv.lastMessageAt,
            lastMessagePreview: conv.lastMessagePreview,
            aiActive: conv.aiActive,
            lead: lead ? {
              id: lead.id,
              name: lead.name,
              vehicleInterest: lead.vehicleInterest,
              paymentMethod: lead.paymentMethod,
              downPayment: lead.downPayment,
              hasTrade: lead.hasTrade,
              tradeVehicle: lead.tradeVehicle,
              status: lead.status,
              notes: lead.notes,
              score: lead.score,
              vehicleId: lead.vehicleId,
            } : null,
          };
        })
        .filter((item) => statusFilter === "all" || item.lead?.status === statusFilter);
    }),

  updateLeadStatus: vendorKeyProcedure
    .input(z.object({
      conversationId: z.number(),
      status: z.enum(["new", "qualifying", "qualified", "contacted", "converted", "lost"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations, leads } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const conv = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv[0] || conv[0].assignedTo !== ctx.vendor.id) throw new Error("Conversa não encontrada ou não atribuída a você");

      await db.update(leads).set({ status: input.status as any, updatedAt: new Date() }).where(eq(leads.conversationId, input.conversationId));
      await createActivityLog({ userId: ctx.vendor.id, action: "vendor_update_lead_status", conversationId: input.conversationId, details: { status: input.status, via: "chrome_extension" } });
      emitConversationUpdate(input.conversationId, { leadStatus: input.status });
      return { success: true };
    }),

  addNote: vendorKeyProcedure
    .input(z.object({
      conversationId: z.number(),
      note: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations, leads } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const conv = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv[0] || conv[0].assignedTo !== ctx.vendor.id) throw new Error("Conversa não encontrada ou não atribuída a você");

      const existing = await db.select({ notes: leads.notes }).from(leads).where(eq(leads.conversationId, input.conversationId)).limit(1);
      const timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const newEntry = `[${timestamp} - ${ctx.vendor.name}]\n${input.note}`;
      const updatedNotes = existing[0]?.notes ? `${existing[0].notes}\n\n${newEntry}` : newEntry;

      await db.update(leads).set({ notes: updatedNotes, updatedAt: new Date() }).where(eq(leads.conversationId, input.conversationId));
      await createActivityLog({ userId: ctx.vendor.id, action: "vendor_add_note", conversationId: input.conversationId, details: { via: "chrome_extension" } });
      return { success: true, notes: updatedNotes };
    }),

  updateLeadData: vendorKeyProcedure
    .input(z.object({
      conversationId: z.number(),
      vehicleInterest: z.string().optional(),
      paymentMethod: z.string().optional(),
      downPayment: z.string().optional(),
      hasTrade: z.boolean().optional(),
      tradeVehicle: z.string().optional(),
      name: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations, leads } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const conv = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv[0] || conv[0].assignedTo !== ctx.vendor.id) throw new Error("Conversa não encontrada ou não atribuída a você");

      const { conversationId: _, ...updateFields } = input;
      const cleanUpdate: Record<string, unknown> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(updateFields)) {
        if (value !== undefined) cleanUpdate[key] = value;
      }

      await db.update(leads).set(cleanUpdate).where(eq(leads.conversationId, input.conversationId));
      await createActivityLog({ userId: ctx.vendor.id, action: "vendor_update_lead_data", conversationId: input.conversationId, details: { fields: Object.keys(cleanUpdate), via: "chrome_extension" } });
      emitConversationUpdate(input.conversationId, { leadUpdated: true });
      return { success: true };
    }),

  getWhatsappLink: vendorKeyProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations, leads } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const conv = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv[0] || conv[0].assignedTo !== ctx.vendor.id) throw new Error("Conversa não encontrada ou não atribuída a você");

      const lead = await db.select().from(leads).where(eq(leads.conversationId, input.conversationId)).limit(1);
      const l = lead[0];
      const c = conv[0];
      const nome = l?.name || c.contactName || "cliente";

      let texto = `Olá ${nome}! 👋\n\nSou ${ctx.vendor.name} da AutoInova.`;
      if (l?.vehicleInterest) texto += `\n\nVi que você se interessou por: *${l.vehicleInterest}*.`;
      if (l?.paymentMethod) texto += `\nForma de pagamento: ${l.paymentMethod}.`;
      if (l?.downPayment) texto += `\nEntrada disponível: ${l.downPayment}.`;
      if (l?.hasTrade && l?.tradeVehicle) texto += `\nTroca: ${l.tradeVehicle}.`;
      texto += `\n\nPosso te ajudar com mais detalhes? 🚗`;

      const phone = c.phone.replace(/\D/g, "");
      const link = `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`;
      return { link, phone, text: texto };
    }),

  createApiKey: protectedProcedure
    .input(z.object({
      teamMemberId: z.number(),
      name: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { vendorApiKeys } = await import("../drizzle/schema");

      const apiKey = crypto.randomBytes(32).toString("hex");
      await db.insert(vendorApiKeys).values({ teamMemberId: input.teamMemberId, apiKey, name: input.name ?? "Extensão Chrome", active: true });
      await createActivityLog({ userId: ctx.user.id, action: "create_vendor_api_key", details: { teamMemberId: input.teamMemberId } });
      return { apiKey };
    }),

  listApiKeys: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { vendorApiKeys } = await import("../drizzle/schema");
    const keys = await db.select().from(vendorApiKeys);
    return keys.map((k) => ({
      id: k.id,
      teamMemberId: k.teamMemberId,
      name: k.name,
      keyPreview: k.apiKey.slice(0, 8) + "••••••••••••••••••••••••••••••••••••••••",
      active: k.active,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
  }),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { vendorApiKeys } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(vendorApiKeys).set({ active: false }).where(eq(vendorApiKeys.id, input.id));
      await createActivityLog({ userId: ctx.user.id, action: "revoke_vendor_api_key", details: { keyId: input.id } });
      return { success: true };
    }),
});

// ─── Chat Flow Router ─────────────────────────────────────────
const flowRouter = router({
  list: protectedProcedure.query(async () => {
    const flows = await listChatFlows();
    // Count nodes per flow
    const result = [];
    for (const flow of flows) {
      const nodes = await listChatFlowNodes(flow.id);
      const sessions = await getFlowSessionsByFlow(flow.id);
      result.push({
        ...flow,
        nodeCount: nodes.length,
        sessionCount: sessions.length,
        activeSessionCount: sessions.filter(s => s.status === "active").length,
      });
    }
    return result;
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const flow = await getChatFlowById(input.id);
      if (!flow) throw new Error("Flow not found");
      const nodes = await listChatFlowNodes(input.id);
      const edges = await listChatFlowEdges(input.id);
      return { flow, nodes, edges };
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      trigger: z.enum(["first_contact", "keyword", "button_click", "ad_click", "manual", "reactivation", "category_interest", "rescue"]),
      triggerValue: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await createChatFlow({
        name: input.name,
        description: input.description || null,
        trigger: input.trigger,
        triggerValue: input.triggerValue || null,
        active: false,
        priority: 0,
        createdBy: ctx.user.id,
      });
      // Create default start node
      await createChatFlowNode({
        flowId: id,
        nodeType: "start",
        label: "Início",
        data: {},
        positionX: 250,
        positionY: 50,
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      trigger: z.enum(["first_contact", "keyword", "button_click", "ad_click", "manual", "reactivation", "category_interest", "rescue"]).optional(),
      triggerValue: z.string().optional(),
      active: z.boolean().optional(),
      priority: z.number().optional(),
      aiPrompt: z.string().nullable().optional(),
      agentId: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateChatFlow(id, data as any);
      // Se estiver inativando o fluxo, pausar todas as sessões ativas
      if (input.active === false) {
        const paused = await pauseAllActiveSessionsByFlow(id);
        console.log(`[Flow] Fluxo ${id} inativado, ${paused} sessões pausadas`);
      }
      return { success: true };
    }),

  // Pausar fluxo ativo de uma conversa manualmente
  pauseSession: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      const paused = await pauseFlowSessionByConversation(input.conversationId);
      return { success: paused };
    }),

  // Verificar se há sessão de fluxo ativa para uma conversa
  getActiveSession: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const session = await getActiveFlowSession(input.conversationId);
      return session || null;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteChatFlow(input.id);
      return { success: true };
    }),

  // Save entire flow (nodes + edges) in one operation
  saveFlow: adminProcedure
    .input(z.object({
      flowId: z.number(),
      nodes: z.array(z.object({
        id: z.number().optional(),
        nodeType: z.enum(["start", "send_message", "send_buttons", "send_list", "send_image", "condition", "ai_response", "update_lead", "assign_agent", "delay", "wait_input", "end", "goto_flow", "assign_seller", "send_vehicle_photos", "vehicle_presentation", "update_lead_status"]),
        label: z.string().optional(),
        data: z.any(),
        positionX: z.number(),
        positionY: z.number(),
      })),
      edges: z.array(z.object({
        sourceNodeId: z.number(),
        targetNodeId: z.number(),
        sourceHandle: z.string().optional(),
        label: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      // Delete old nodes that are not in the new list
      const existingNodes = await listChatFlowNodes(input.flowId);
      const newNodeIds = input.nodes.filter(n => n.id).map(n => n.id!);
      for (const existing of existingNodes) {
        if (!newNodeIds.includes(existing.id)) {
          await deleteChatFlowNode(existing.id);
        }
      }
      // Upsert nodes
      const nodeIds = await bulkUpsertNodes(input.flowId, input.nodes.map(n => ({
        id: n.id,
        flowId: input.flowId,
        nodeType: n.nodeType,
        label: n.label || null,
        data: n.data || {},
        positionX: n.positionX,
        positionY: n.positionY,
      })));
      // Build ID mapping (old temp IDs -> new real IDs)
      const idMap = new Map<number, number>();
      input.nodes.forEach((n, i) => {
        const oldId = n.id || -(i + 1); // temp negative IDs for new nodes
        idMap.set(oldId, nodeIds[i]);
      });
      // Replace edges with mapped IDs
      const mappedEdges = input.edges.map(e => ({
        flowId: input.flowId,
        sourceNodeId: idMap.get(e.sourceNodeId) || e.sourceNodeId,
        targetNodeId: idMap.get(e.targetNodeId) || e.targetNodeId,
        sourceHandle: e.sourceHandle || "default",
        label: e.label || null,
      }));
      await replaceFlowEdges(input.flowId, mappedEdges);
      return { success: true, nodeIds };
    }),

  // Duplicate a flow
  duplicate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const flow = await getChatFlowById(input.id);
      if (!flow) throw new Error("Flow not found");
      const nodes = await listChatFlowNodes(input.id);
      const edges = await listChatFlowEdges(input.id);
      // Create new flow
      const newFlowId = await createChatFlow({
        name: `${flow.name} (cópia)`,
        description: flow.description,
        trigger: flow.trigger,
        triggerValue: flow.triggerValue,
        active: false,
        priority: flow.priority,
        createdBy: ctx.user.id,
      });
      // Copy nodes with ID mapping
      const nodeIdMap = new Map<number, number>();
      for (const node of nodes) {
        const newNodeId = await createChatFlowNode({
          flowId: newFlowId,
          nodeType: node.nodeType,
          label: node.label,
          data: node.data,
          positionX: node.positionX,
          positionY: node.positionY,
        });
        nodeIdMap.set(node.id, newNodeId);
      }
      // Copy edges with mapped IDs
      for (const edge of edges) {
        const newSource = nodeIdMap.get(edge.sourceNodeId);
        const newTarget = nodeIdMap.get(edge.targetNodeId);
        if (newSource && newTarget) {
          await createChatFlowEdge({
            flowId: newFlowId,
            sourceNodeId: newSource,
            targetNodeId: newTarget,
            sourceHandle: edge.sourceHandle,
            label: edge.label,
          });
        }
      }
      return { id: newFlowId };
    }),
});

// ─── AI Agents Router ──────────────────────────────────────────────
const AVAILABLE_TOOLS = [
  { id: "buscar_veiculos", name: "Buscar Veículos", description: "Busca veículos no estoque por filtros" },
  { id: "resumo_estoque", name: "Resumo do Estoque", description: "Obtém resumo geral do estoque" },
  { id: "atualizar_lead", name: "Atualizar Lead", description: "Atualiza dados do lead no CRM" },
  { id: "buscar_veiculo_por_id", name: "Buscar por ID", description: "Busca veículo específico pelo ID" },
  { id: "apresentar_veiculo", name: "Apresentar Veículo (Foto)", description: "Envia foto do veículo com informações formatadas" },
  { id: "enviar_botoes", name: "Enviar Botões", description: "Envia botões interativos (máx 3)" },
  { id: "enviar_lista", name: "Enviar Lista", description: "Envia menu de lista interativo (máx 10 itens)" },
];

const agentRouter = router({
  list: protectedProcedure.query(async () => {
    return listAiAgents();
  }),

  listActive: protectedProcedure.query(async () => {
    return getActiveAiAgents();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const agent = await getAiAgentById(input.id);
      if (!agent) throw new Error("Agent not found");
      return agent;
    }),

  availableTools: protectedProcedure.query(() => {
    return AVAILABLE_TOOLS;
  }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      systemPrompt: z.string().min(1),
      includeCoreLayers: z.boolean().default(true),
      model: z.string().default("gpt-4o-mini"),
      temperature: z.string().default("0.7"),
      maxTokens: z.number().default(1024),
      enabledTools: z.array(z.string()).optional(),
      active: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await createAiAgent({
        name: input.name,
        description: input.description || null,
        systemPrompt: input.systemPrompt,
        includeCoreLayers: input.includeCoreLayers,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        enabledTools: input.enabledTools || [],
        active: input.active,
        createdBy: ctx.user.id,
      });
      return result;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      systemPrompt: z.string().min(1).optional(),
      includeCoreLayers: z.boolean().optional(),
      model: z.string().optional(),
      temperature: z.string().optional(),
      maxTokens: z.number().optional(),
      enabledTools: z.array(z.string()).optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateAiAgent(id, data as any);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteAiAgent(input.id);
      return { success: true };
    }),

  // Get/set channel agent assignments
  getChannelAgents: protectedProcedure.query(async () => {
    const whatsappId = await getSetting("channel_whatsapp_agent_id");
    const instagramId = await getSetting("channel_instagram_agent_id");
    return {
      whatsapp: whatsappId ? parseInt(whatsappId, 10) : null,
      instagram: instagramId ? parseInt(instagramId, 10) : null,
    };
  }),

  setChannelAgent: adminProcedure
    .input(z.object({
      channel: z.enum(["whatsapp", "instagram"]),
      agentId: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      const key = `channel_${input.channel}_agent_id`;
      await upsertSetting(key, input.agentId ? String(input.agentId) : "");
      return { success: true };
    }),
});

// ─── Seller Router ──────────────────────────────────────────
const sellerRouter = router({
  list: protectedProcedure
    .input(z.object({ storeLocation: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return listSellers(input?.storeLocation);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const seller = await getSellerById(input.id);
      if (!seller) throw new Error("Seller not found");
      return seller;
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      photoUrl: z.string().optional(),
      storeLocation: z.string().min(1),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const id = await createSeller({
        name: input.name,
        phone: input.phone,
        photoUrl: input.photoUrl || null,
        storeLocation: input.storeLocation,
        sortOrder: input.sortOrder,
        isActive: true,
        totalAssignments: 0,
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      phone: z.string().min(1).optional(),
      photoUrl: z.string().nullable().optional(),
      storeLocation: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateSeller(id, data as any);
      return { success: true };
    }),

  // Upload seller photo to S3
  uploadPhoto: adminProcedure
    .input(z.object({
      sellerId: z.number(),
      photoBase64: z.string(), // base64 encoded image
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ input }) => {
      const { storagePut } = await import("./storage");
      const buffer = Buffer.from(input.photoBase64, "base64");
      const ext = input.mimeType.includes("png") ? "png" : "jpg";
      const randomSuffix = Math.random().toString(36).substring(2, 10);
      const fileKey = `sellers/${input.sellerId}-photo-${randomSuffix}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      await updateSeller(input.sellerId, { photoUrl: url });
      return { url };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteSeller(input.id);
      return { success: true };
    }),

  // Get distinct store locations from vehicles
  storeLocations: protectedProcedure.query(async () => {
    return getDistinctStoreLocations();
  }),

  // Assign next seller from queue for a store
  assignNext: protectedProcedure
    .input(z.object({
      storeLocation: z.string().min(1),
      conversationId: z.number(),
      vehicleId: z.number().optional(),
      customerPhone: z.string().optional(),
      customerName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const seller = await getNextSellerInQueue(input.storeLocation);
      if (!seller) {
        throw new Error(`Nenhum vendedor ativo na loja: ${input.storeLocation}`);
      }

      // Create assignment record
      const assignmentId = await createSellerAssignment({
        sellerId: seller.id,
        conversationId: input.conversationId,
        storeLocation: input.storeLocation,
        vehicleId: input.vehicleId || null,
        customerPhone: input.customerPhone || null,
        customerName: input.customerName || null,
        status: "pending",
      });

      return { seller, assignmentId };
    }),

  // Get store location by vehicle ID
  getStoreByVehicle: protectedProcedure
    .input(z.object({ vehicleId: z.number() }))
    .query(async ({ input }) => {
      const store = await getStoreLocationByVehicleId(input.vehicleId);
      return { storeLocation: store };
    }),

  // List assignments (history)
  assignments: protectedProcedure
    .input(z.object({
      storeLocation: z.string().optional(),
      sellerId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listSellerAssignments(input?.storeLocation, input?.sellerId);
    }),

  // Update assignment status
  updateAssignment: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "contacted", "completed", "expired"]),
    }))
    .mutation(async ({ input }) => {
      const data: any = { status: input.status };
      if (input.status === "contacted") data.contactedAt = new Date();
      if (input.status === "completed") data.completedAt = new Date();
      await updateSellerAssignment(input.id, data);
      return { success: true };
    }),
});

// ── Contacts Router ─────────────────────────────────────────────────────────

const contactsRouter = router({
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      tag: z.string().optional(),
      source: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      campaignParticipant: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listContacts(input || {});
    }),

  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getContactById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
      source: z.enum(["manual", "excel", "whatsapp", "lead"]).default("manual"),
    }))
    .mutation(async ({ input }) => {
      const existing = await getContactByPhone(input.phone);
      if (existing) throw new Error("Contato com este telefone já existe");
      return createContact(input);
    }),

  // Accessible by all authenticated users (vendors can save contacts from inbox)
  createFromInbox: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const cleanPhone = input.phone.replace(/\D/g, "");
      const existing = await getContactByPhone(cleanPhone);
      if (existing) {
        // Update name if it's better
        if (input.name && input.name !== existing.name) {
          await updateContact(existing.id, { name: input.name });
        }
        return { ...existing, updated: true };
      }
      const contact = await createContact({
        name: input.name,
        phone: cleanPhone,
        email: input.email,
        notes: input.notes,
        source: "whatsapp" as const,
      });
      return { ...contact, updated: false };
    }),

  // Accessible by all authenticated users (vendors can list contacts for lookup)
  listForInbox: protectedProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return listContacts({ search: input?.search, limit: 50 });
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateContact(id, data);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteContact(input.id);
      return { success: true };
    }),

  bulkImport: adminProcedure
    .input(z.object({
      contacts: z.array(z.object({
        name: z.string().min(1),
        phone: z.string().min(1),
        email: z.string().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const rows = input.contacts.map(c => ({ ...c, source: "excel" as const }));
      return bulkCreateContacts(rows);
    }),

  tags: adminProcedure.query(async () => {
    return getAllContactTags();
  }),

  // Send template to a single contact
  sendTemplate: adminProcedure
    .input(z.object({
      contactId: z.number(),
      phone: z.string(),
      templateName: z.string(),
      bodyParams: z.array(z.string()).default([]),
      language: z.string().default("pt_BR"),
    }))
    .mutation(async ({ input }) => {
      const result = await sendWhatsAppTemplate(
        input.phone,
        input.templateName,
        input.bodyParams,
        input.language
      );
      const sendId = await createTemplateSend({
        contactId: input.contactId,
        templateName: input.templateName,
        phone: input.phone,
        status: result.success ? "sent" : "failed",
        errorMessage: result.error || undefined,
      });
      if (!result.success) throw new Error(result.error ?? "Falha ao enviar template");
      return { success: true, sendId };
    }),

  // Send template to multiple contacts (bulk)
  sendTemplateBulk: adminProcedure
    .input(z.object({
      contactIds: z.array(z.number()),
      templateName: z.string(),
      bodyParams: z.array(z.string()).default([]),
      language: z.string().default("pt_BR"),
    }))
    .mutation(async ({ input }) => {
      let sent = 0;
      let failed = 0;
      for (const contactId of input.contactIds) {
        const contact = await getContactById(contactId);
        if (!contact) { failed++; continue; }
        try {
          const result = await sendWhatsAppTemplate(
            contact.phone,
            input.templateName,
            input.bodyParams,
            input.language
          );
          await createTemplateSend({
            contactId,
            templateName: input.templateName,
            phone: contact.phone,
            status: result.success ? "sent" : "failed",
            errorMessage: result.error || undefined,
          });
          if (result.success) sent++; else failed++;
          // Small delay between sends to avoid rate limiting
          await new Promise(r => setTimeout(r, 500));
        } catch {
          failed++;
        }
      }
      return { sent, failed, total: input.contactIds.length };
    }),

  // List template send history
  sendHistory: adminProcedure
    .input(z.object({
      contactId: z.number().optional(),
      templateName: z.string().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listTemplateSends(input || {});
    }),

  // Detect duplicate contacts by normalized phone
  findDuplicates: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      const { normalizePhone } = await import("./phoneNormalize");
      const { contacts: contactsTable } = await import("../drizzle/schema");
      const allContacts = await db.select().from(contactsTable).where(eq(contactsTable.isActive, true));

      // Group by normalized phone
      const groups = new Map<string, typeof allContacts>();
      for (const c of allContacts) {
        const norm = normalizePhone(c.phone);
        if (!norm) continue;
        const existing = groups.get(norm) || [];
        existing.push(c);
        groups.set(norm, existing);
      }

      // Return only groups with duplicates
      const duplicates: Array<{ normalizedPhone: string; contacts: typeof allContacts }> = [];
      for (const [norm, group] of Array.from(groups.entries())) {
        if (group.length > 1) {
          duplicates.push({ normalizedPhone: norm, contacts: group });
        }
      }
      return duplicates;
    }),

  // Merge two contacts: keep primary, merge data from secondary, deactivate secondary
  merge: adminProcedure
    .input(z.object({
      primaryId: z.number(),
      secondaryId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const primary = await getContactById(input.primaryId);
      const secondary = await getContactById(input.secondaryId);
      if (!primary || !secondary) throw new Error("Contato não encontrado");

      const { normalizePhone } = await import("./phoneNormalize");
      const updates: Record<string, any> = {};

      // Merge name: prefer non-generic
      if ((!primary.name || primary.name === "Cliente") && secondary.name && secondary.name !== "Cliente") {
        updates.name = secondary.name;
      }
      // Merge email
      if (!primary.email && secondary.email) updates.email = secondary.email;
      // Merge notes
      if (secondary.notes) {
        updates.notes = primary.notes ? `${primary.notes}\n---\n${secondary.notes}` : secondary.notes;
      }
      // Merge tags
      const primaryTags = primary.tags || [];
      const secondaryTags = secondary.tags || [];
      const mergedTags = Array.from(new Set([...primaryTags, ...secondaryTags]));
      if (mergedTags.length > primaryTags.length) updates.tags = mergedTags;
      // Merge conversationId
      if (!primary.conversationId && secondary.conversationId) updates.conversationId = secondary.conversationId;
      // Merge leadId
      if (!primary.leadId && secondary.leadId) updates.leadId = secondary.leadId;
      // Normalize phone
      const normPhone = normalizePhone(primary.phone);
      if (normPhone && normPhone !== primary.phone) updates.phone = normPhone;

      if (Object.keys(updates).length > 0) {
        await updateContact(primary.id, updates);
      }

      // Deactivate secondary
      await deleteContact(secondary.id);

      return { success: true, primaryId: primary.id };
    }),

  // Auto-merge all detected duplicates
  autoMerge: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { normalizePhone } = await import("./phoneNormalize");
      const { contacts: contactsTable } = await import("../drizzle/schema");
      const allContacts = await db.select().from(contactsTable).where(eq(contactsTable.isActive, true));

      const groups = new Map<string, typeof allContacts>();
      for (const c of allContacts) {
        const norm = normalizePhone(c.phone);
        if (!norm) continue;
        const existing = groups.get(norm) || [];
        existing.push(c);
        groups.set(norm, existing);
      }

      let merged = 0;
      for (const [norm, group] of Array.from(groups.entries())) {
        if (group.length <= 1) continue;

        // Pick the best primary: prefer one with conversationId, then most data
        const sorted = [...group].sort((a, b) => {
          if (a.conversationId && !b.conversationId) return -1;
          if (!a.conversationId && b.conversationId) return 1;
          if (a.leadId && !b.leadId) return -1;
          if (!a.leadId && b.leadId) return 1;
          const aScore = (a.name && a.name !== "Cliente" ? 1 : 0) + (a.email ? 1 : 0) + (a.notes ? 1 : 0);
          const bScore = (b.name && b.name !== "Cliente" ? 1 : 0) + (b.email ? 1 : 0) + (b.notes ? 1 : 0);
          return bScore - aScore;
        });

        const primary = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          const secondary = sorted[i];
          const updates: Record<string, any> = {};
          if ((!primary.name || primary.name === "Cliente") && secondary.name && secondary.name !== "Cliente") {
            updates.name = secondary.name;
          }
          if (!primary.email && secondary.email) updates.email = secondary.email;
          if (secondary.notes) {
            updates.notes = primary.notes ? `${primary.notes}\n---\n${secondary.notes}` : secondary.notes;
          }
          const pTags = primary.tags || [];
          const sTags = secondary.tags || [];
          const mTags = Array.from(new Set([...pTags, ...sTags]));
          if (mTags.length > pTags.length) updates.tags = mTags;
          if (!primary.conversationId && secondary.conversationId) updates.conversationId = secondary.conversationId;
          if (!primary.leadId && secondary.leadId) updates.leadId = secondary.leadId;
          updates.phone = norm; // Normalize

          if (Object.keys(updates).length > 0) {
            await updateContact(primary.id, updates);
            // Update primary in memory for next iteration
            Object.assign(primary, updates);
          }
          await deleteContact(secondary.id);
          merged++;
        }
      }

      return { merged };
    }),

  // Sync contacts from existing conversations/leads
  syncFromConversations: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { conversations, leads } = await import("../drizzle/schema");

      // Get all conversations with phone numbers
      const allConversations = await db.select({
        id: conversations.id,
        phone: conversations.phone,
        contactName: conversations.contactName,
        contactPhoto: conversations.contactPhoto,
        channel: conversations.channel,
      }).from(conversations);

      let created = 0;
      let skipped = 0;
      let updated = 0;

      for (const conv of allConversations) {
        if (!conv.phone) { skipped++; continue; }
        
        try {
          const existing = await getContactByPhone(conv.phone);
          if (existing) {
            // Atualizar dados se necessário
            const updates: Record<string, any> = {};
            if (!existing.conversationId && conv.id) updates.conversationId = conv.id;
            if (conv.contactName && existing.name === "Cliente") updates.name = conv.contactName;
            if (Object.keys(updates).length > 0) {
              await updateContact(existing.id, updates);
              updated++;
            } else {
              skipped++;
            }
          } else {
            // Buscar lead vinculado para enriquecer dados
            const lead = await db.select({
              id: leads.id,
              name: leads.name,
              email: leads.email,
              notes: leads.notes,
            }).from(leads).where(eq(leads.conversationId, conv.id as any)).limit(1);

            const leadData = lead[0];

            await createContact({
              name: conv.contactName || leadData?.name || "Cliente",
              phone: conv.phone,
              email: leadData?.email || undefined,
              notes: leadData?.notes || undefined,
              conversationId: conv.id,
              leadId: leadData?.id || undefined,
              source: (conv.channel || "whatsapp") as any,
              isActive: true,
            });
            created++;
          }
        } catch (err) {
          console.error(`[ContactSync] Erro ao sincronizar ${conv.phone}:`, err);
          skipped++;
        }
      }

      return { created, updated, skipped, total: allConversations.length };
    }),
});

// ─── Evolution Router ─────────────────────────────────────────────────────────
const evolutionRouter = router({
  // List all instances stored in DB
  listInstances: protectedProcedure.query(async () => {
    return listEvolutionInstances();
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
      try {
        result = await evolutionSendText(input.instanceName, sendTo, input.text);
      } catch (err: any) {
        // If sending to @lid fails, return a graceful error instead of crashing
        if (sendTo.endsWith("@lid")) {
          console.warn(`[Evolution] Send to @lid failed (expected): ${err.message}`);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Aguardando atualiza\u00e7\u00e3o do n\u00famero real. Quando o contato enviar uma nova mensagem, o n\u00famero ser\u00e1 atualizado automaticamente.",
          });
        }
        throw err;
      }
      const inst = await getEvolutionInstanceByName(input.instanceName);
      if (inst && input.conversationId) {
        await createEvolutionMessage({
          instanceId: inst.id,
          instanceName: input.instanceName,
          conversationId: input.conversationId,
          remoteJid: sendTo,
          messageId: (result as any)?.key?.id as string || undefined,
          content: input.text,
          messageType: "text",
          direction: "outbound",
          senderName: ctx.user?.name || "Vendedor",
          status: "sent",
          timestamp: Date.now(),
          rawPayload: result as Record<string, unknown>,
        });
        await updateEvolutionConversation(input.conversationId, {
          lastMessageAt: Date.now(),
          lastMessagePreview: input.text.slice(0, 100),
        });
      }
      return { success: true, result };
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
          const db = await import("../drizzle/schema").then(s => s);
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
        const { parseWebhookMessage } = await import("./evolutionService");
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
      const db = await (await import("./db")).getDb();
      if (!db) return null;
      const { contacts } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(contacts).where(eq(contacts.id, conv.contactId)).limit(1);
      return rows[0] || null;
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
      const { autoLinkOrCreateContact } = await import("./db");
      const contactId = await autoLinkOrCreateContact(input.phone, input.name);
      if (!contactId) throw new Error("Failed to create/link contact");
      // Update contact notes if provided
      if (input.notes) {
        const db = await (await import("./db")).getDb();
        if (db) {
          const { contacts } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          await db.update(contacts).set({ notes: input.notes }).where(eq(contacts.id, contactId));
        }
      }
      // Link to conversation
      await updateEvolutionConversation(input.conversationId, { contactId } as any);
      return { contactId, success: true };
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
  campaign: campaignRouter,
  whatsappTemplate: whatsappTemplateRouter,
  tokenHealth: tokenHealthRouter,
  vendor: vendorRouter,
  flow: flowRouter,
  agent: agentRouter,
  seller: sellerRouter,
  rescue: rescueRouter,
  contact: contactsRouter,
  evolution: evolutionRouter,
});

export type AppRouter = typeof appRouter;
