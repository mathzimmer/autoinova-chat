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

// Identifica o membro da equipe logado (via openId "team_member_<id>").
// Retorna { id, cargo } ou null (usuário base/admin do sistema).
async function currentTeamMember(ctx: any): Promise<{ id: number; cargo: string } | null> {
  const openId = ctx?.user?.openId as string | undefined;
  if (!openId || !openId.startsWith("team_member_")) return null;
  const id = parseInt(openId.replace("team_member_", ""));
  if (!id) return null;
  try {
    const m = await getTeamMemberById(id);
    return m ? { id: m.id, cargo: m.cargo as string } : null;
  } catch { return null; }
}

// Deriva o valor da "fonte" (aba do inbox) de uma conversa
function conversationSourceValue(conv: { channel?: string | null; instanceName?: string | null }): string {
  if (conv.channel === "evolution" && conv.instanceName) return conv.instanceName;
  if (conv.channel === "zernio" && conv.instanceName) return `zernio:${conv.instanceName}`;
  if (conv.channel === "whatsapp" && conv.instanceName) return `official:${conv.instanceName}`;
  return "matriz";
}

const conversationRouter = router({
  /** Resolve a "fonte"/aba do inbox de uma conversa (corrige o "Ir para conversa") */
  sourceOf: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) return { source: "matriz" };
      return { source: conversationSourceValue(conv as any) };
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      search: z.string().optional(),
      searchContent: z.boolean().optional(), // procurar também no texto das mensagens
      instance: z.string().optional(), // "matriz" (padrão) ou nome da instância Evolution
      archived: z.boolean().optional(),
      limit: z.number().min(1).max(300).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      // Vendedor só vê as conversas das instâncias atribuídas a ele.
      const member = await currentTeamMember(ctx);
      if (member && member.cargo === "vendedor") {
        const { allowedInboxSourcesForMember } = await import("./db");
        const allowed = await allowedInboxSourcesForMember(member.id);
        if (allowed.length === 0) return [];
        const requested = input?.instance;
        if (requested && requested !== "matriz") {
          // Pediu uma aba específica: só devolve se for dele
          return allowed.includes(requested) ? listConversations(input) : [];
        }
        // Sem aba específica (ou "matriz"): junta as conversas das instâncias dele
        const merged: any[] = [];
        for (const src of allowed) merged.push(...await listConversations({ ...(input || {}), instance: src }));
        merged.sort((a, b) => (Number(b.lastMessageAt) || 0) - (Number(a.lastMessageAt) || 0));
        return merged.slice(0, input?.limit ?? 100);
      }
      return listConversations(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const conv = await getConversationById(input.id);
      if (!conv) throw new Error("Conversation not found");
      // Vendedor não pode abrir conversa de instância que não é dele
      const member = await currentTeamMember(ctx);
      if (member && member.cargo === "vendedor") {
        const { allowedInboxSourcesForMember } = await import("./db");
        const allowed = await allowedInboxSourcesForMember(member.id);
        const src = conversationSourceValue(conv as any);
        if (!allowed.includes(src)) throw new Error("Sem permissão para esta conversa");
      }
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
      // CSAT: pesquisa de satisfação ao resolver (fire-and-forget, se habilitada)
      if (input.status === "resolved") {
        import("./csat").then(({ requestCsat }) => requestCsat(input.id))
          .catch(err => console.error("[CSAT] hook updateStatus:", err));
      }
      return conv;
    }),

  toggleAI: protectedProcedure
    .input(z.object({
      id: z.number(),
      aiActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const conv = await updateConversation(input.id, {
        aiActive: input.aiActive,
        routingState: input.aiActive ? "ai_agent" : "human",
      });
      emitConversationUpdate(input.id, conv);
      return conv;
    }),

  // Roteamento unificado da conversa: um só condutor por vez (fluxo / IA / humano).
  // Trocar de modo é exclusivo — sair para IA ou humano pausa qualquer fluxo ativo.
  // (O modo "flow" é iniciado por flow.startForConversation, que também ajusta o routingState.)
  setRouting: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      mode: z.enum(["ai_agent", "human"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getConversationById(input.conversationId);
      if (!before) throw new Error("Conversa não encontrada");
      // Sempre pausa fluxo ao entregar para IA ou humano
      await pauseFlowSessionByConversation(input.conversationId).catch(() => {});
      if (input.mode === "ai_agent") {
        const conv = await updateConversation(input.conversationId, {
          aiActive: true,
          routingState: "ai_agent",
        });
        emitConversationUpdate(input.conversationId, conv);
        return conv;
      }
      // human
      const conv = await updateConversation(input.conversationId, {
        aiActive: false,
        assignedTo: ctx.user.id,
        routingState: "human",
      });
      emitConversationUpdate(input.conversationId, conv);
      if (before.assignedTo !== ctx.user.id) {
        const { logTimeline } = await import("./db");
        logTimeline({
          conversationId: input.conversationId,
          userId: ctx.user.id,
          action: "atribuido_atendente",
          details: { para: ctx.user.name || null },
        }).catch(() => {});
      }
      return conv;
    }),

  assignAgent: protectedProcedure
    .input(z.object({
      id: z.number(),
      agentId: z.number().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getConversationById(input.id);
      const conv = await updateConversation(input.id, {
        assignedTo: input.agentId,
        aiActive: input.agentId ? false : true,
      });
      emitConversationUpdate(input.id, conv);
      // Linha do tempo: transferência/atribuição de atendente
      if (before?.assignedTo !== input.agentId) {
        const { logTimeline } = await import("./db");
        let fromName: string | null = null, toName: string | null = null;
        try {
          const members = await listTeamMembersAuth();
          fromName = (members as any[]).find((m: any) => m.id === before?.assignedTo)?.name || null;
          toName = (members as any[]).find((m: any) => m.id === input.agentId)?.name || null;
        } catch {}
        logTimeline({
          conversationId: input.id,
          userId: ctx.user.id,
          action: input.agentId ? "atribuido_atendente" : "liberado_atendente",
          details: { de: fromName, para: toName },
        }).catch(() => {});
      }
      return conv;
    }),

  updateContact: protectedProcedure
    .input(z.object({
      id: z.number(),
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
      contactNotes: z.string().optional(),
      // Corrigir telefone manualmente (ex.: contato @lid sem número real)
      phone: z.string().min(10).max(20).regex(/^\d+$/, "Apenas dígitos, com DDI (ex: 5551999998888)").optional(),
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

  /**
   * Transfere o atendimento da matriz (API oficial) para a instância de um vendedor:
   * 1. Envia a primeira mensagem ao cliente PELA INSTÂNCIA do vendedor
   * 2. Registra nota interna na conversa oficial informando a transferência
   * 3. Finaliza a conversa oficial (status resolved)
   * O lead/funil continua o mesmo — o histórico fica preservado nos dois lados.
   */
  transferToInstance: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      instanceName: z.string().min(1),
      message: z.string().min(1).max(4000),
    }))
    .mutation(async ({ input, ctx }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new Error("Conversa não encontrada");
      if (conv.channel === "evolution") throw new Error("Esta conversa já está numa instância de vendedor");
      if (!conv.phone) throw new Error("Conversa sem telefone");

      // 1. Envia pela instância do vendedor
      const { evolutionSendText } = await import("./evolutionService");
      const result = await evolutionSendText(input.instanceName, conv.phone, input.message);
      const evoMsgId = (result as any)?.key?.id;

      // 2. Espelha no inbox unificado (cria a conversa da instância já com o histórico iniciado)
      const { mirrorEvolutionMessage } = await import("./db");
      const mirrored = await mirrorEvolutionMessage({
        instanceName: input.instanceName,
        phone: conv.phone,
        remoteJid: `${conv.phone}@s.whatsapp.net`,
        contactName: conv.contactName || undefined,
        content: input.message,
        messageType: "text",
        direction: "outbound",
        senderName: ctx.user.name || "Vendedor",
        externalId: evoMsgId ? `evo_${evoMsgId}` : undefined,
        timestamp: Date.now(),
      });
      if (mirrored) emitNewMessage(mirrored.conversationId, mirrored.message);

      // 3. Nota interna + finaliza a conversa oficial
      const note = await createMessage({
        conversationId: input.conversationId,
        content: `📤 Atendimento transferido para a instância "${input.instanceName}" por ${ctx.user.name || "atendente"}. O vendedor continua a conversa pelo número da instância.`,
        senderType: "internal",
        senderName: ctx.user.name || "Sistema",
        messageType: "text",
      });
      emitNewMessage(input.conversationId, note);
      await updateConversation(input.conversationId, { status: "resolved", aiActive: false });
      emitConversationUpdate(input.conversationId, { status: "resolved" });

      // 4. Transferência = marco de funil: sobe o lead CANÔNICO para "encaminhado
      //    ao vendedor" (dispara InitiateCheckout na Meta, atribuído ao anúncio).
      try {
        const { updateLeadFunnelStatus: updFunnel, getCanonicalLead: getCanon, upsertLead: upLead, logTimeline: logTl } = await import("./db");
        const canonForLog = conv.phone ? await getCanon(conv.phone) : undefined;
        await logTl({ conversationId: input.conversationId, leadId: canonForLog?.id, userId: ctx.user.id, action: "lead_transferido", details: { para: input.instanceName, por: ctx.user.name || "atendente" } });
        // Dono do lead = usuário/vendedor associado à instância de destino (base do acesso do vendedor)
        try {
          const db2 = await getDb();
          if (db2 && canonForLog?.id) {
            const { evolutionInstances, leads: leadsT } = await import("../drizzle/schema");
            const inst = (await db2.select().from(evolutionInstances).where(eq(evolutionInstances.instanceName, input.instanceName)).limit(1))[0];
            const ownerId = (inst as any)?.assignedUserId || (inst as any)?.sellerId || null;
            if (ownerId) {
              await db2.update(leadsT).set({ ownerId }).where(eq(leadsT.id, canonForLog.id));
              // Atribui a conversa do vendedor a ele → aparece no portal "Meus leads"
              if (mirrored?.conversationId) {
                const { conversations: convT2 } = await import("../drizzle/schema");
                await db2.update(convT2).set({ assignedTo: ownerId }).where(eq(convT2.id, mirrored.conversationId));
              }
            }
          }
        } catch (e) { console.error("[Transfer] set owner:", e); }
        await updFunnel(input.conversationId, "encaminhado_vendedor");
        // 5. Propaga a atribuição do anúncio (ctwaId) + interesse para o lead do
        //    número do vendedor, para a venda lá continuar atribuída ao anúncio.
        if (mirrored?.conversationId && conv.phone) {
          const canon = await getCanon(conv.phone);
          if (canon && (canon.ctwaId || canon.metaLeadId || (canon as any).vehicleInterest)) {
            await upLead({
              conversationId: mirrored.conversationId,
              phone: conv.phone,
              ctwaId: canon.ctwaId || undefined,
              metaLeadId: canon.metaLeadId || undefined,
              vehicleInterest: (canon as any).vehicleInterest || undefined,
            } as any);
          }
        }
      } catch (e) {
        console.error("[Transfer] funil/atribuição:", e);
      }

      return { success: true, sellerConversationId: mirrored?.conversationId ?? null };
    }),

  /** Verifica se já existe conversa com este número na fonte escolhida */
  findByPhone: protectedProcedure
    .input(z.object({ phone: z.string().min(8), instance: z.string().default("matriz") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const { conversations: convTable } = await import("../drizzle/schema");
      const { eq, and: andOp, ne: neOp, or: orOp } = await import("drizzle-orm");
      const digits = input.phone.replace(/\D/g, "");
      const variations = Array.from(new Set([digits, ...phoneVariations(digits)]));
      const isMatriz = input.instance === "matriz";
      const phoneCond = orOp(...variations.map(v => eq(convTable.phone, v)))!;
      const row = (await db.select({
        id: convTable.id, contactName: convTable.contactName, phone: convTable.phone,
      }).from(convTable).where(
        isMatriz
          ? andOp(phoneCond, neOp(convTable.channel, "evolution" as any))
          : andOp(phoneCond, eq(convTable.channel, "evolution" as any), eq(convTable.instanceName, input.instance))
      ).limit(1))[0];
      return row || null;
    }),

  /** Fixa (ou solta) o agente de IA de uma conversa */
  setAgent: protectedProcedure
    .input(z.object({ conversationId: z.number(), agentId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const conv = await updateConversation(input.conversationId, { agentId: input.agentId } as any);
      emitConversationUpdate(input.conversationId, { agentId: input.agentId });
      return conv;
    }),

  /** Arquiva/desarquiva uma ou várias conversas */
  setArchived: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations: convTable } = await import("../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      await db.update(convTable).set({ archived: input.archived, updatedAt: new Date() }).where(inArray(convTable.id, input.ids));
      input.ids.forEach(id => emitConversationUpdate(id, { archived: input.archived }));
      return { success: true, count: input.ids.length };
    }),

  /** Exclui permanentemente uma ou várias conversas (mensagens, labels, lembretes, agendadas) */
  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations: convTable, messages: msgTable, conversationLabels: clTable, conversationReminders: crTable, scheduledMessages: smTable } = await import("../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      await db.delete(msgTable).where(inArray(msgTable.conversationId, input.ids));
      await db.delete(clTable).where(inArray(clTable.conversationId, input.ids));
      await db.delete(crTable).where(inArray(crTable.conversationId, input.ids));
      await db.delete(smTable).where(inArray(smTable.conversationId, input.ids));
      await db.delete(convTable).where(inArray(convTable.id, input.ids));
      return { success: true, count: input.ids.length };
    }),

  /** Inicia uma nova conversa (matriz ou instância Evolution) com contato novo ou existente */
  startNew: protectedProcedure
    .input(z.object({
      name: z.string().max(255).optional(),
      phone: z.string().min(10).max(20),
      instance: z.string().default("matriz"), // "matriz" ou nome da instância Evolution
      firstMessage: z.string().max(4000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const normPhone = normalizePhone;
      const phone = normPhone(input.phone.replace(/\D/g, ""));
      if (!phone || phone.length < 10) throw new Error("Telefone inválido — use DDI+DDD+número");

      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations: convTable } = await import("../drizzle/schema");
      const { eq, and: andOp, ne: neOp } = await import("drizzle-orm");

      const isMatriz = input.instance === "matriz";
      const isZernio = input.instance.startsWith("zernio:");
      const zAccountId = isZernio ? input.instance.slice("zernio:".length) : null;
      // API oficial adicional (coexistência ou número oficial): prefixo "official:"
      const isOfficial = input.instance.startsWith("official:");
      const officialPhoneId = isOfficial ? input.instance.slice("official:".length) : null;

      // Localiza conversa existente na fonte escolhida
      let conv = (await db.select().from(convTable).where(
        isMatriz
          ? andOp(eq(convTable.phone, phone), neOp(convTable.channel, "evolution" as any), neOp(convTable.channel, "zernio" as any))
          : isZernio
            ? andOp(eq(convTable.phone, phone), eq(convTable.channel, "zernio" as any), eq(convTable.instanceName, zAccountId!))
            : isOfficial
              ? andOp(eq(convTable.phone, phone), eq(convTable.channel, "whatsapp" as any), eq(convTable.instanceName, officialPhoneId!))
              : andOp(eq(convTable.phone, phone), eq(convTable.channel, "evolution" as any), eq(convTable.instanceName, input.instance))
      ).limit(1))[0];

      if (!conv) {
        const inserted = await db.insert(convTable).values({
          phone,
          contactName: input.name || null,
          channel: isMatriz ? "whatsapp" : isZernio ? ("zernio" as any) : isOfficial ? ("whatsapp" as any) : ("evolution" as any),
          instanceName: isMatriz ? null : isZernio ? zAccountId : isOfficial ? officialPhoneId : input.instance,
          status: "open",
          aiActive: false, // conversa iniciada pelo atendente: sem IA
          assignedTo: ctx.user.id,
          lastMessageAt: Date.now(),
          lastMessagePreview: input.firstMessage?.substring(0, 500) || null,
        }).returning();
        conv = inserted[0];
      }

      // Cadastra o contato na agenda se não existir (com a instância que criou)
      try {
        const existingContact = await getContactByPhone(phone);
        if (!existingContact) {
          await createContact({
            name: input.name || "Cliente",
            phone,
            conversationId: conv.id,
            source: "manual",
            createdByInstance: isMatriz ? null : isOfficial ? officialPhoneId : input.instance,
            isActive: true,
          } as any);
        }
      } catch { /* não-crítico */ }

      // Envia a primeira mensagem, se houver
      let sendError: string | null = null;
      let windowExpired = false;
      if (input.firstMessage?.trim()) {
        try {
          if (isMatriz) {
            if (isWhatsAppConfigured()) {
              const r = await sendTextMessage(phone, input.firstMessage.trim());
              if (!r.success) {
                sendError = r.error || "Falha no envio";
                windowExpired = !!(r.error && (r.error.includes("131047") || r.error.includes("Re-engagement")));
              } else {
                const msg = await createMessage({
                  conversationId: conv.id, content: input.firstMessage.trim(),
                  senderType: "agent", senderName: ctx.user.name || "Atendente",
                  messageType: "text", externalId: r.messageId,
                });
                emitNewMessage(conv.id, msg);
              }
            } else sendError = "WhatsApp oficial não configurado";
          } else if (isZernio) {
            // No Zernio só dá para responder DENTRO de uma conversa existente
            // (a API precisa do zernioConversationId). Iniciar do zero exige que
            // o cliente já tenha falado — ou envio de template (fora do escopo).
            const zConvId = (conv.metadata as any)?.zernioConversationId as string | undefined;
            if (!zConvId) {
              sendError = "No Zernio, só é possível responder a uma conversa iniciada pelo cliente. Este número ainda não tem conversa ativa (fora da janela, seria preciso um template).";
            } else {
              const { zernioReply } = await import("./zernioService");
              const r = await zernioReply(zConvId, input.firstMessage.trim(), zAccountId || undefined);
              if (!r.success) {
                sendError = r.error || "Falha no envio Zernio";
              } else {
                const msg = await createMessage({
                  conversationId: conv.id, content: input.firstMessage.trim(),
                  senderType: "agent", senderName: ctx.user.name || "Atendente",
                  messageType: "text", externalId: r.messageId,
                });
                emitNewMessage(conv.id, msg);
              }
            }
          } else if (isOfficial) {
            // API oficial adicional (coexistência/número oficial) → NÃO usa Evolution
            const { sendTextFromNumber } = await import("./whatsappMultiNumber");
            const r = await sendTextFromNumber(officialPhoneId!, phone, input.firstMessage.trim());
            if (!r.success) {
              sendError = r.error || "Falha no envio (API oficial)";
            } else {
              const msg = await createMessage({
                conversationId: conv.id, content: input.firstMessage.trim(),
                senderType: "agent", senderName: ctx.user.name || "Atendente",
                messageType: "text", externalId: r.messageId,
              });
              emitNewMessage(conv.id, msg);
            }
          } else {
            const { evolutionSendText } = await import("./evolutionService");
            const r = await evolutionSendText(input.instance, phone, input.firstMessage.trim());
            const msg = await createMessage({
              conversationId: conv.id, content: input.firstMessage.trim(),
              senderType: "agent", senderName: ctx.user.name || "Atendente",
              messageType: "text", externalId: (r as any)?.key?.id ? `evo_${(r as any).key.id}` : undefined,
            });
            emitNewMessage(conv.id, msg);
          }
        } catch (err) {
          sendError = err instanceof Error ? err.message : "Falha no envio";
        }
      }

      emitConversationUpdate(conv.id, {});
      return { conversationId: conv.id, sendError, windowExpired };
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

  /** Envia fotos de um veículo do estoque (URLs do JSON sincronizado) */
  sendVehiclePhotos: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      vehicleId: z.number(),
      imageUrls: z.array(z.string().url()).min(1).max(10),
      caption: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv?.phone) throw new Error("Conversa sem telefone");

      // Atendente assume a conversa ao enviar fotos
      await updateConversation(input.conversationId, { aiActive: false, assignedTo: ctx.user.id });

      // Roteia por canal da conversa (bug: antes ia sempre pela Matriz oficial)
      const zConvId = conv.channel === "zernio" ? ((conv.metadata as any)?.zernioConversationId as string | undefined) : undefined;
      const zAccId = conv.channel === "zernio" ? (((conv.metadata as any)?.zernioAccountId as string | undefined) || (conv as any).instanceName || undefined) : undefined;
      const evoInstance = conv.channel === "evolution" ? (conv as any).instanceName as string | undefined : undefined;
      const evoJid = conv.channel === "evolution" ? (((conv.metadata as any)?.evolutionLidJid as string) || ((conv.metadata as any)?.evolutionRemoteJid as string) || conv.phone) : conv.phone;

      let sent = 0;
      const errors: string[] = [];
      for (let i = 0; i < input.imageUrls.length; i++) {
        const url = input.imageUrls[i];
        const caption = i === 0 ? (input.caption || "") : "";
        let result: { success: boolean; messageId?: string; error?: string };
        if (conv.channel === "zernio") {
          if (!zConvId) { result = { success: false, error: "Zernio: conversa sem sessão ativa (cliente precisa ter mandado a 1ª mensagem)" }; }
          else {
            const { zernioSendMedia } = await import("./zernioService");
            result = await zernioSendMedia(zConvId, url, "image", zAccId, caption);
          }
        } else if (conv.channel === "evolution" && evoInstance) {
          const { evolutionSendMedia } = await import("./evolutionService");
          try {
            const r = await evolutionSendMedia(evoInstance, evoJid!, url, "image", caption);
            result = { success: true, messageId: (r as any)?.key?.id ? `evo_${(r as any).key.id}` : undefined };
          } catch (e) { result = { success: false, error: e instanceof Error ? e.message : "erro" }; }
        } else if (conv.channel === "whatsapp" && (conv as any).instanceName) {
          const { sendMediaFromNumber } = await import("./whatsappMultiNumber");
          result = await sendMediaFromNumber((conv as any).instanceName, conv.phone, url, "image", caption);
        } else {
          result = await sendImageMessage(conv.phone, url, caption);
        }
        if (result.success) {
          const msg = await createMessage({
            conversationId: input.conversationId,
            content: caption || "[Foto do veículo]",
            senderType: "agent",
            senderName: ctx.user.name || "Atendente",
            messageType: "image",
            metadata: { mediaUrl: url, caption, vehicleId: input.vehicleId },
            externalId: result.messageId,
          });
          emitNewMessage(input.conversationId, msg);
          sent++;
        } else {
          errors.push(result.error || "erro");
        }
        // Delay entre fotos para manter a ordem no WhatsApp
        if (i < input.imageUrls.length - 1) await new Promise(r => setTimeout(r, 900));
      }
      if (sent === 0) throw new Error("Nenhuma foto enviada: " + (errors[0] || "erro desconhecido"));
      return { sent, failed: errors.length };
    }),

  /** IA sugere a próxima resposta do atendente com base no histórico */
  suggestReply: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      historyCount: z.number().min(2).max(50).default(10),
    }))
    .mutation(async ({ input }) => {
      const msgs = await listMessages(input.conversationId, input.historyCount);
      if (!msgs || msgs.length === 0) throw new Error("Sem histórico nesta conversa");

      const lead = await getLeadByConversationId(input.conversationId);
      const ordered = [...msgs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const transcript = ordered
        .filter(m => m.senderType !== "internal")
        .map(m => {
          const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Atendente";
          return `${role}: ${m.content}`;
        }).join("\n");

      const leadContext = lead
        ? `\nContexto do lead: interesse em ${lead.vehicleInterest || "não definido"}; etapa do funil: ${lead.funnelStatus}; pagamento: ${lead.paymentMethod || "não informado"}; troca: ${lead.hasTrade ? lead.tradeVehicle || "sim" : "não"}.`
        : "";

      const { invokeLLM } = await import("./_core/llm");
      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Você é um vendedor experiente de uma concessionária de veículos (Auto Inova). Com base no histórico da conversa, sugira a PRÓXIMA mensagem que o atendente deve enviar ao cliente. Regras: responda APENAS com o texto da mensagem sugerida (sem aspas, sem explicações, sem markdown); tom cordial e direto, português do Brasil; objetivo: avançar a venda (qualificar, agendar test-drive, fechar); no máximo 3 frases.${leadContext}`,
          },
          { role: "user", content: `Histórico (últimas ${ordered.length} mensagens):\n\n${transcript}\n\nSugira a próxima resposta do atendente:` },
        ],
      });
      const raw = resp.choices?.[0]?.message?.content;
      const suggestion = (typeof raw === "string" ? raw : "").trim();
      if (!suggestion) throw new Error("A IA não retornou sugestão");
      return { suggestion };
    }),

  send: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      content: z.string().min(1),
      senderType: z.enum(["agent", "bot", "internal"]).default("agent"),
    }))
    .mutation(async ({ input, ctx }) => {
      // Nota interna: visível só para o time, NUNCA vai para o cliente
      if (input.senderType === "internal") {
        const note = await createMessage({
          conversationId: input.conversationId,
          content: input.content,
          senderType: "internal",
          senderName: ctx.user.name || "Atendente",
          messageType: "text",
        });
        emitNewMessage(input.conversationId, note);
        return note;
      }

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

          if (conv.channel === "evolution" && (conv as any).instanceName && conv.phone) {
            // Conversa de instância Evolution: envia pela API da instância.
            // Usa o remoteJid original (essencial para contatos @lid, onde o
            // "telefone" é um ID interno do WhatsApp e não roteia sozinho).
            const { evolutionSendText } = await import("./evolutionService");
            let toJid = ((conv.metadata as any)?.evolutionRemoteJid as string) || "";
            if (!toJid) {
              // Conversa espelhada antes do fix do metadata: busca o JID na tabela Evolution
              try {
                const db = await getDb();
                if (db) {
                  const { evolutionConversations } = await import("../drizzle/schema");
                  const { eq, and: andOp, or: orOp, like: likeOp } = await import("drizzle-orm");
                  const evoConv = (await db.select().from(evolutionConversations)
                    .where(andOp(
                      eq(evolutionConversations.instanceName, (conv as any).instanceName),
                      orOp(eq(evolutionConversations.phone, conv.phone), likeOp(evolutionConversations.remoteJid, `${conv.phone}@%`)),
                    )).limit(1))[0];
                  if (evoConv?.remoteJid) {
                    toJid = evoConv.remoteJid;
                    // Salva no metadata para os próximos envios
                    await updateConversation(input.conversationId, {
                      metadata: { ...((conv.metadata as any) || {}), evolutionRemoteJid: toJid },
                    } as any);
                  }
                }
              } catch { /* fallback abaixo */ }
            }
            if (!toJid) toJid = conv.phone;
            // Endereçamento LID: contatos migrados só aceitam envio pelo @lid
            // (enviar pelo número gera erro 463 assíncrono no WhatsApp).
            // Tenta o @lid primeiro quando conhecido; se a Evolution recusar
            // sincronamente, cai para o JID/número tradicional.
            const lidJid = (conv.metadata as any)?.evolutionLidJid as string | undefined;
            const candidates = Array.from(new Set([lidJid, toJid].filter(Boolean))) as string[];
            sendResult = { success: false, error: "Sem destino" };
            for (const candidate of candidates) {
              console.log(`[EvolutionSend] Tentando enviar: instancia=${(conv as any).instanceName}, toJid=${candidate}, conv=${conv.id}`);
              try {
                const evoResult = await evolutionSendText((conv as any).instanceName, candidate, input.content);
                const evoMsgId = (evoResult as any)?.key?.id;
                console.log(`[EvolutionSend] ✅ Aceito pela Evolution: msgId=${evoMsgId || "?"} (via ${candidate})`);
                sendResult = { success: true, messageId: evoMsgId ? `evo_${evoMsgId}` : undefined };
                break;
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : "Falha no envio Evolution";
                console.error(`[EvolutionSend] ❌ Recusado (${candidate}): ${errMsg}`);
                sendResult = { success: false, error: errMsg };
              }
            }
          } else if (conv.channel === "zernio") {
            // Conversa Zernio: responde via API do Zernio dentro da conversa dele.
            const zConvId = (conv.metadata as any)?.zernioConversationId as string | undefined;
            const zAccId = ((conv.metadata as any)?.zernioAccountId as string | undefined) || (conv as any).instanceName || undefined;
            if (!zConvId) {
              sendResult = { success: false, error: "Conversa sem zernioConversationId (só é possível responder após a 1ª mensagem do cliente)" };
            } else {
              const { zernioReply } = await import("./zernioService");
              sendResult = await zernioReply(zConvId, input.content, zAccId);
            }
          } else if (conv.channel === "whatsapp" && (conv as any).instanceName && conv.phone) {
            // Número oficial ADICIONAL: envia pelo token daquele número
            const { sendTextFromNumber } = await import("./whatsappMultiNumber");
            sendResult = await sendTextFromNumber((conv as any).instanceName, conv.phone, input.content);
          } else if (conv.channel === "whatsapp" && isWhatsAppConfigured() && conv.phone) {
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
      mediaType: z.enum(["image", "audio", "video"]),
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
        : input.mediaType === "video"
        ? (input.caption || "[Vídeo enviado]")
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

      // Transcreve o ÁUDIO que o atendente envia (assíncrono) → a IA usa no contexto
      if (input.mediaType === "audio") {
        const audioForTranscript = whatsappAudioUrl || mediaUrl;
        (async () => {
          try {
            const t = await transcribeAudio({ audioUrl: audioForTranscript, language: "pt", prompt: "Transcrever mensagem de voz do vendedor sobre veículos e automóveis" });
            if ("text" in t && t.text) {
              const { updateMessageMetadata } = await import("./db");
              await updateMessageMetadata(message.id, { transcribedText: t.text });
              try { emitConversationUpdate(input.conversationId, {}); } catch { /* opcional */ }
              console.log(`[SendMedia] áudio do atendente transcrito: "${t.text.slice(0, 60)}"`);
            }
          } catch (e) { console.error("[SendMedia] transcrição outbound falhou:", e); }
        })();
      }

      // === ENVIO PARA INSTÂNCIA EVOLUTION ===
      const convForSend = await getConversationById(input.conversationId);
      if (convForSend?.channel === "evolution" && (convForSend as any).instanceName && convForSend.phone) {
        const { evolutionSendMedia, evolutionSendAudio } = await import("./evolutionService");
        const meta = (convForSend.metadata as any) || {};
        const toJid = (meta.evolutionLidJid as string) || (meta.evolutionRemoteJid as string) || convForSend.phone;
        const instName = (convForSend as any).instanceName as string;

        const sendPromise = input.mediaType === "audio"
          // Áudio: endpoint dedicado de VOZ (ptt) com o ogg convertido
          ? evolutionSendAudio(instName, toJid, whatsappAudioUrl || mediaUrl)
          : evolutionSendMedia(instName, toJid, mediaUrl, input.mediaType, input.caption, input.fileName);

        sendPromise.then((r) => {
          console.log(`[SendMedia] ✅ Evolution ${input.mediaType} enviado:`, JSON.stringify(r).substring(0, 200));
        }).catch((err) => {
          console.error(`[SendMedia] ❌ Evolution ${input.mediaType} falhou:`, err);
        });
        return message;
      }

      // === ENVIO PARA INSTÂNCIA ZERNIO (coexistência oficial) ===
      if (convForSend?.channel === "zernio") {
        const zConvId = (convForSend.metadata as any)?.zernioConversationId as string | undefined;
        const zAccId = ((convForSend.metadata as any)?.zernioAccountId as string | undefined) || (convForSend as any).instanceName || undefined;
        if (!zConvId) {
          console.error("[SendMedia] Zernio sem zernioConversationId — não é possível enviar mídia");
        } else {
          const { zernioSendMedia } = await import("./zernioService");
          const attType = input.mediaType === "image" ? "image" : input.mediaType === "video" ? "video" : "audio";
          // Áudio de voz precisa ser .ogg opus → usa a versão convertida (whatsappAudioUrl)
          const urlToSend = input.mediaType === "audio" ? (whatsappAudioUrl || mediaUrl) : mediaUrl;
          zernioSendMedia(zConvId, urlToSend, attType as any, zAccId, input.caption, input.mediaType === "audio")
            .then((r) => console.log(`[SendMedia] ${r.success ? "✅" : "❌"} Zernio ${input.mediaType}:`, r.error || r.messageId))
            .catch((err) => console.error(`[SendMedia] ❌ Zernio ${input.mediaType} falhou:`, err));
        }
        return message;
      }

      // === ENVIO POR NÚMERO OFICIAL ADICIONAL (multi-número) ===
      if (convForSend?.channel === "whatsapp" && (convForSend as any).instanceName && convForSend.phone) {
        const { sendMediaFromNumber } = await import("./whatsappMultiNumber");
        const urlToSend = input.mediaType === "audio" ? (whatsappAudioUrl || mediaUrl) : mediaUrl;
        sendMediaFromNumber((convForSend as any).instanceName, convForSend.phone, urlToSend, input.mediaType, input.caption)
          .then((r) => console.log(`[SendMedia] ${r.success ? "✅" : "❌"} Oficial ${input.mediaType}:`, r.error || r.messageId))
          .catch((err) => console.error(`[SendMedia] ❌ Oficial ${input.mediaType} falhou:`, err));
        return message;
      }

      // === SEND TO WHATSAPP (oficial) ===
      if (isWhatsAppConfigured()) {
        const conv = convForSend;
        console.log(`[SendMedia] WhatsApp configured. Conv: ${conv?.id}, channel: ${conv?.channel}, phone: ${conv?.phone}`);

        if (conv && conv.channel === "whatsapp" && conv.phone) {
          if (input.mediaType === "image") {
            console.log(`[SendMedia] Sending image to WhatsApp: phone=${conv.phone}, URL=${mediaUrl}`);
            sendImageMessage(conv.phone, mediaUrl, input.caption).then((result) => {
              console.log(`[SendMedia] WhatsApp image result:`, JSON.stringify(result));
            }).catch((err) => {
              console.error("[WhatsApp] Failed to send agent image:", err);
            });

          } else if (input.mediaType === "video") {
            console.log(`[SendMedia] Sending video to WhatsApp: phone=${conv.phone}, URL=${mediaUrl}`);
            sendVideoMessage(conv.phone, mediaUrl, input.caption).then((result) => {
              console.log(`[SendMedia] WhatsApp video result:`, JSON.stringify(result));
            }).catch((err) => {
              console.error("[WhatsApp] Failed to send agent video:", err);
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

  /** Conversas do lead (todos os números) — para o "Ir para conversa" com escolha de instância */
  conversations: protectedProcedure
    .input(z.object({ leadId: z.number(), phone: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversations: convTable } = await import("../drizzle/schema");
      const { eq, or: orOp, desc: descOp } = await import("drizzle-orm");
      let where = eq(convTable.leadId, input.leadId);
      // fallback por telefone (leads/conversas antigas sem leadId vinculado)
      const rows = await db.select().from(convTable)
        .where(input.phone ? orOp(where, eq(convTable.phone, input.phone))! : where)
        .orderBy(descOp(convTable.lastMessageAt))
        .limit(20);
      // Nome cadastrado das instâncias Zernio (accountId → Deivid, etc.)
      let zernioNameByAccount = new Map<string, string>();
      try {
        const { zernioInstances } = await import("../drizzle/schema");
        const zi = await db.select().from(zernioInstances);
        zernioNameByAccount = new Map(zi.map(z => [z.accountId, z.displayName || z.phone || z.accountId]));
      } catch { /* tabela pode não existir */ }
      return rows.map((c: any) => ({
        conversationId: c.id,
        source: conversationSourceValue(c),
        channel: c.channel,
        instanceName: c.instanceName,
        label: c.channel === "zernio" ? `Zernio: ${zernioNameByAccount.get(c.instanceName || "") || "Recepção"}`
          : c.channel === "evolution" ? `Vendedor: ${c.instanceName || ""}`
          : c.channel === "whatsapp" && c.instanceName ? `Oficial ${c.instanceName}`
          : "Matriz (oficial)",
        lastMessageAt: c.lastMessageAt,
      }));
    }),

  /** Marca que o contato NÃO é lead (fornecedor, colega, etc.) — tira do funil */
  setNotLead: protectedProcedure
    .input(z.object({ leadId: z.number(), reason: z.string().min(2).max(40) }))
    .mutation(async ({ input }) => {
      const { setLeadNotLead } = await import("./db");
      await setLeadNotLead(input.leadId, input.reason);
      return { success: true };
    }),

  /** Reverte: volta a ser lead */
  setIsLead: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .mutation(async ({ input }) => {
      const { setLeadIsLead } = await import("./db");
      await setLeadIsLead(input.leadId);
      return { success: true };
    }),

  /** Situação de crédito (com/sem crédito, valor, condições, banco) — ou "limpar" */
  setCredit: protectedProcedure
    .input(z.object({
      leadId: z.number(),
      approved: z.enum(["sim", "nao", "limpar"]),
      amount: z.string().max(50).optional(),
      conditions: z.string().max(255).optional(),
      bank: z.string().max(40).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const { leads: leadsT } = await import("../drizzle/schema");
      const lead = (await db.select().from(leadsT).where(eq(leadsT.id, input.leadId)).limit(1))[0];
      if (!lead) throw new Error("Lead não encontrado");
      const clear = input.approved === "limpar";
      await db.update(leadsT).set({
        creditApproved: clear ? null : input.approved,
        creditAmount: input.approved === "sim" ? (input.amount ?? null) : null,
        creditConditions: input.approved === "sim" ? (input.conditions ?? null) : null,
        creditBank: input.approved === "sim" ? (input.bank ?? null) : null,
        updatedAt: new Date(),
      } as any).where(eq(leadsT.id, input.leadId));
      const { logTimeline } = await import("./db");
      await logTimeline({
        conversationId: lead.conversationId, leadId: input.leadId, userId: ctx.user.id,
        action: clear ? "credito_removido" : "credito",
        details: clear ? {} : { aprovado: input.approved, valor: input.amount, condicoes: input.conditions, banco: input.bank },
      });

      // CRÉDITO APROVADO = sinal FORTE para a Meta ("SubmitApplication").
      // É esse evento que ensina o algoritmo a buscar gente que CONSEGUE crédito.
      if (input.approved === "sim") {
        try {
          const { trackLeadProgress } = await import("./metaConversions");
          void trackLeadProgress(input.leadId, { funnelStatus: "pagamento_definido" });
        } catch (e) { console.error("[CAPI] evento de crédito aprovado:", e); }
      }
      return { success: true };
    }),

  /**
   * Qualidade do lead — o vendedor diz "quero mais clientes assim" (bom) ou
   * "cliente ruim". É o sinal de MAIOR prioridade: manda mais que crédito e IA.
   * "bom" dispara o evento forte na Meta; "ruim" bloqueia os eventos profundos.
   */
  setQuality: protectedProcedure
    .input(z.object({
      leadId: z.number(),
      quality: z.enum(["alta", "baixa", "limpar"]),
      reason: z.string().max(200).optional(),
      visitedStore: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const { leads: leadsT } = await import("../drizzle/schema");
      const lead = (await db.select().from(leadsT).where(eq(leadsT.id, input.leadId)).limit(1))[0];
      if (!lead) throw new Error("Lead não encontrado");
      const clear = input.quality === "limpar";

      await db.update(leadsT).set({
        quality: clear ? null : input.quality,
        qualitySource: clear ? null : "vendedor",
        qualityReason: clear ? null : (input.reason || null),
        ...(input.visitedStore != null ? { visitedStore: input.visitedStore } : {}),
        updatedAt: new Date(),
      } as any).where(eq(leadsT.id, input.leadId));

      const { logTimeline } = await import("./db");
      await logTimeline({
        conversationId: lead.conversationId, leadId: input.leadId, userId: ctx.user.id,
        action: clear ? "qualidade_removida" : "qualidade",
        details: clear ? {} : { qualidade: input.quality, motivo: input.reason, visitou: input.visitedStore },
      });

      // Qualidade ALTA = sinal forte pra Meta ("quero mais assim"), mesmo sem crédito
      if (input.quality === "alta") {
        try {
          const { trackLeadProgress } = await import("./metaConversions");
          void trackLeadProgress(input.leadId, { funnelStatus: "pagamento_definido" });
        } catch (e) { console.error("[CAPI] evento de lead bom:", e); }
      }
      return { success: true };
    }),

  /** Vincula (ou desvincula) um veículo do estoque ao lead */
  linkVehicle: protectedProcedure
    .input(z.object({ leadId: z.number(), vehicleId: z.number().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const { leads: leadsT, vehicles: vehT } = await import("../drizzle/schema");
      const lead = (await db.select().from(leadsT).where(eq(leadsT.id, input.leadId)).limit(1))[0];
      if (!lead) throw new Error("Lead não encontrado");
      await db.update(leadsT).set({ vehicleId: input.vehicleId, updatedAt: new Date() } as any).where(eq(leadsT.id, input.leadId));
      if (input.vehicleId) {
        const v = (await db.select().from(vehT).where(eq(vehT.id, input.vehicleId)).limit(1))[0];
        const { logTimeline } = await import("./db");
        await logTimeline({ conversationId: lead.conversationId, leadId: input.leadId, userId: ctx.user.id, action: "veiculo_vinculado", details: { veiculo: v ? `${v.brand} ${v.model} ${v.year}` : String(input.vehicleId) } });
      }
      return { success: true };
    }),

  /** IA analisa UMA conversa: temperatura, objeções, crédito, próxima ação */
  analyze: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      const { analyzeConversation } = await import("./conversationIntelligence");
      const result = await analyzeConversation(input.conversationId);
      if (!result) throw new Error("Sem mensagens suficientes para analisar");
      return result;
    }),

  /** IA analisa em lote as conversas de uma fonte/período (painel do gestor) */
  analyzeBulk: protectedProcedure
    .input(z.object({
      source: z.string().optional(), // "matriz" ou nome da instância
      sinceDays: z.number().min(1).max(90).default(7),
      limit: z.number().min(1).max(80).default(40),
    }))
    .mutation(async ({ input }) => {
      const { analyzeBulk } = await import("./conversationIntelligence");
      return analyzeBulk(input);
    }),

  /** Painel de inteligência: leads com insight, ranqueados por score */
  intelligence: protectedProcedure
    .input(z.object({
      source: z.string().optional(),
      sinceDays: z.number().min(1).max(90).default(7),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversationInsights, conversations: convTable } = await import("../drizzle/schema");
      const { eq, and: andOp, ne: neOp, gte: gteOp, desc: descOp } = await import("drizzle-orm");
      const sinceDays = input?.sinceDays ?? 7;
      const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

      const conds = [gteOp(convTable.lastMessageAt, since), eq(convTable.archived, false)];
      const src = input?.source;
      if (!src || src === "matriz") conds.push(neOp(convTable.channel, "evolution" as any));
      else if (src !== "todas") { conds.push(eq(convTable.channel, "evolution" as any)); conds.push(eq(convTable.instanceName, src)); }

      const rows = await db.select({
        conversationId: convTable.id,
        contactName: convTable.contactName,
        phone: convTable.phone,
        instanceName: convTable.instanceName,
        channel: convTable.channel,
        lastMessageAt: convTable.lastMessageAt,
        assignedTo: convTable.assignedTo,
        temperature: conversationInsights.temperature,
        score: conversationInsights.score,
        summary: conversationInsights.summary,
        buyingSignals: conversationInsights.buyingSignals,
        objections: conversationInsights.objections,
        creditStatus: conversationInsights.creditStatus,
        nextAction: conversationInsights.nextAction,
        vehicleInterest: conversationInsights.vehicleInterest,
        analyzedAt: conversationInsights.analyzedAt,
        messageCount: conversationInsights.messageCount,
      }).from(convTable)
        .innerJoin(conversationInsights, eq(conversationInsights.conversationId, convTable.id))
        .where(andOp(...conds))
        .orderBy(descOp(conversationInsights.score))
        .limit(200);
      return rows;
    }),

  /** List leads with conversation data, vehicle, agent, and latest summary preview */
  listWithDetails: protectedProcedure
    .input(z.object({ status: z.string().optional(), discarded: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const { leads: leadsTable, conversations: convsTable, leadSummaries: summariesTable, vehicles: vehiclesTable, teamMembers: membersTable, sellerAssignments: assignmentsTable, sellers: sellersTable, rescueAttempts: rescueTable } = await import("../drizzle/schema");
      const { eq, desc, inArray, and: andOp } = await import("drizzle-orm");

      // discarded=true → aba "Não é lead" (isLead=false); senão só os leads reais
      const leadScope = eq(leadsTable.isLead, input?.discarded ? false : true);
      let allLeads;
      if (input?.status && input.status !== "all" && !input?.discarded) {
        allLeads = await db.select().from(leadsTable).where(andOp(eq(leadsTable.status, input.status as any), leadScope)).orderBy(desc(leadsTable.updatedAt));
      } else {
        allLeads = await db.select().from(leadsTable).where(leadScope).orderBy(desc(leadsTable.updatedAt));
      }
      if (allLeads.length === 0) return [];

      // Batch fetch conversations, summaries, vehicles, team members
      const convIds = Array.from(new Set(allLeads.map(l => l.conversationId)));
      const convs = await db.select().from(convsTable).where(inArray(convsTable.id, convIds));
      const convMap = new Map(convs.map(c => [c.id, c]));

      // Conversa MAIS RECENTE de cada lead — a pessoa pode ter falado em vários
      // números/instâncias; a lista deve mostrar a última conversa, não a original.
      const leadIdsForConv = allLeads.map(l => l.id);
      const leadConvs = leadIdsForConv.length
        ? await db.select().from(convsTable).where(inArray(convsTable.leadId, leadIdsForConv))
        : [];
      const recentConvByLead = new Map<number, any>();
      for (const c of leadConvs) {
        if (c.leadId == null) continue;
        const cur = recentConvByLead.get(c.leadId);
        if (!cur || (Number(c.lastMessageAt) || 0) > (Number(cur.lastMessageAt) || 0)) recentConvByLead.set(c.leadId, c);
      }

      // ESCOPO POR VENDEDOR: só vê leads que falaram na instância dele OU que ele é dono.
      const memberL = await currentTeamMember(ctx);
      if (memberL && memberL.cargo === "vendedor") {
        const { allowedInboxSourcesForMember } = await import("./db");
        const allowedSet = new Set(await allowedInboxSourcesForMember(memberL.id));
        const leadSources = new Map<number, Set<string>>();
        for (const c of leadConvs) {
          if (c.leadId == null) continue;
          const s = conversationSourceValue(c as any);
          (leadSources.get(c.leadId) || leadSources.set(c.leadId, new Set<string>()).get(c.leadId)!).add(s);
        }
        allLeads = allLeads.filter((l: any) =>
          (l.ownerId != null && l.ownerId === memberL.id) ||
          Array.from(leadSources.get(l.id) || []).some((s) => allowedSet.has(s))
        );
        if (allLeads.length === 0) return [];
      }
      // ── Não respondidos + tempo de resposta ──────────────────────────────────
      // Decidido pela ORDEM REAL das mensagens (não por colunas de timestamp, que
      // podem vir de fusos/fontes diferentes): se a última mensagem da conversa é
      // do CLIENTE e não houve resposta depois → está aguardando.
      const waitingByLead = new Map<number, number>();   // leadId → desde quando aguarda (epoch ms)
      const avgRespByLead = new Map<number, number>();
      try {
        const { messages: msgsT } = await import("../drizzle/schema");
        const { gte: gteM } = await import("drizzle-orm");
        // Só conversas com atividade recente (limita o peso da consulta)
        const since30ms = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const activeConvs = leadConvs.filter(c => Number(c.lastMessageAt || 0) >= since30ms).slice(0, 800);
        const convIdsForResp = activeConvs.map(c => c.id);
        if (convIdsForResp.length) {
          const since30 = new Date(since30ms);
          const rows = await db.select({
            conversationId: msgsT.conversationId, senderType: msgsT.senderType, createdAt: msgsT.createdAt,
          }).from(msgsT)
            .where(andOp(inArray(msgsT.conversationId, convIdsForResp), gteM(msgsT.createdAt, since30)))
            .orderBy(msgsT.createdAt);

          const convToLead = new Map<number, number>();
          for (const c of activeConvs) if (c.leadId != null) convToLead.set(c.id, c.leadId);

          // Última do cliente x última resposta (atendente OU IA) por conversa
          const lastCustAt = new Map<number, number>();
          const lastReplyAt = new Map<number, number>();
          // Tempo de resposta: pares (cliente → próxima resposta humana)
          const acc = new Map<number, { sum: number; n: number }>();
          const pendingByConv = new Map<number, number>();

          for (const m of rows) {
            const leadId = convToLead.get(m.conversationId);
            if (leadId == null) continue;
            const t = new Date(m.createdAt as any).getTime();
            if (m.senderType === "customer") {
              lastCustAt.set(m.conversationId, t);
              if (!pendingByConv.has(m.conversationId)) pendingByConv.set(m.conversationId, t);
            } else if (m.senderType === "agent" || m.senderType === "bot") {
              lastReplyAt.set(m.conversationId, t);
              if (m.senderType === "agent") {
                const started = pendingByConv.get(m.conversationId);
                if (started != null) {
                  const a = acc.get(leadId) || { sum: 0, n: 0 };
                  a.sum += (t - started) / 1000; a.n += 1;
                  acc.set(leadId, a);
                }
              }
              pendingByConv.delete(m.conversationId);
            }
          }
          for (const [leadId, a] of Array.from(acc)) if (a.n > 0) avgRespByLead.set(leadId, Math.round(a.sum / a.n));

          // Marca quem está aguardando. waitingSince usa lastCustomerMessageAt
          // (epoch absoluto) para a conta de "há quanto tempo" ficar correta.
          for (const c of activeConvs) {
            if (c.leadId == null) continue;
            const lc = lastCustAt.get(c.id);
            if (!lc) continue;
            const lr = lastReplyAt.get(c.id) || 0;
            if (lc > lr) {
              const since = Number((c as any).lastCustomerMessageAt || 0) || Number(c.lastMessageAt || 0);
              if (!since) continue;
              const cur = waitingByLead.get(c.leadId) || 0;
              if (!cur || since < cur) waitingByLead.set(c.leadId, since); // espera mais antiga
            }
          }
        }
      } catch (e) { console.error("[Leads] tempo de resposta:", e); }

      // JÁ É CLIENTE? Quantas compras a pessoa já fez (oportunidades ganhas).
      // Serve para o vendedor ver de cara que aquele contato já comprou antes.
      const comprasPorLead = new Map<number, number>();
      try {
        const { leadOpportunities } = await import("../drizzle/schema");
        const won = await db.select({ leadId: leadOpportunities.leadId })
          .from(leadOpportunities)
          .where(andOp(inArray(leadOpportunities.leadId, allLeads.map(l => l.id)), eq(leadOpportunities.status, "won")));
        for (const w of won) comprasPorLead.set(w.leadId, (comprasPorLead.get(w.leadId) || 0) + 1);
      } catch { /* opcional */ }

      // Mapa accountId (instanceName cru do Zernio) → nome cadastrado (Deivid, etc.)
      let zernioNameByAccount = new Map<string, string>();
      try {
        const { zernioInstances } = await import("../drizzle/schema");
        const zi = await db.select().from(zernioInstances);
        zernioNameByAccount = new Map(zi.map(z => [z.accountId, z.displayName || z.phone || z.accountId]));
      } catch { /* tabela pode não existir */ }

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
        // Prefere a conversa MAIS RECENTE do lead; cai pra original se não houver.
        const conv = recentConvByLead.get(lead.id) || convMap.get(lead.conversationId);
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

        // Aguardando resposta? (não conta lead fechado/perdido)
        const finalizado = lead.funnelStatus === "fechado" || lead.funnelStatus === "perdido";
        const waitingSince = finalizado ? null : (waitingByLead.get(lead.id) ?? null);

        // ── PONTUAÇÃO DO LEAD (0–100) ──────────────────────────────────────────
        // Soma de sinais objetivos. Serve para priorizar atendimento e, no futuro,
        // para alimentar público/otimização. Tudo transparente e auditável.
        const L: any = lead;
        let pts = 0;
        if (L.creditApproved === "sim") pts += 30;           // crédito aprovado
        if (L.creditApproved === "nao") pts -= 25;           // sem crédito
        if (L.visitedStore) pts += 25;                        // visitou a loja
        if (L.hasTrade) pts += 12;                            // tem troca
        if (L.vehicleId) pts += 10;                           // veículo definido do estoque
        else if (L.vehicleInterest && L.vehicleInterest !== "não definido") pts += 5;
        // Etapa do funil
        const etapaPts: Record<string, number> = {
          negociando: 15, encaminhado_vendedor: 12, dados_troca: 10,
          dados_pessoais: 10, pagamento_definido: 10, interesse_definido: 5, novo: 0,
        };
        pts += etapaPts[String(L.funnelStatus)] ?? 0;
        // Temperatura da IA (leitura da conversa)
        const tempPts: Record<string, number> = { muito_quente: 10, quente: 7, morno: 3, frio: 0 };
        pts += tempPts[String(L.temperature)] ?? 0;
        // Penaliza quem está largado sem resposta
        if (waitingSince) {
          const diasEsperando = (Date.now() - Number(waitingSince)) / 86400000;
          if (diasEsperando > 3) pts -= 10;
          else if (diasEsperando > 1) pts -= 5;
        }
        // Qualidade marcada pelo VENDEDOR pesa forte (é quem viu o cliente)
        if (L.quality === "alta") pts += 20;
        if (L.quality === "baixa") pts -= 20;
        const qualityScore = Math.max(0, Math.min(100, pts));

        return {
          ...lead,
          unanswered: waitingSince != null,
          waitingSince,                                   // epoch ms desde a msg do cliente
          avgResponseSec: avgRespByLead.get(lead.id) ?? null,
          qualityScore,                                   // pontuação 0–100 do lead
          // Já comprou antes? (oportunidades ganhas, ou está fechado agora)
          purchases: (comprasPorLead.get(lead.id) || 0) + (lead.funnelStatus === "fechado" ? 1 : 0),
          isCustomer: (comprasPorLead.get(lead.id) || 0) > 0 || lead.funnelStatus === "fechado",
          conversation: conv ? {
            id: conv.id,
            contactName: conv.contactName,
            contactPhoto: conv.contactPhoto,
            channel: conv.channel,
            instanceName: conv.instanceName,
            // Rótulo amigável da instância (Zernio: accountId → nome cadastrado)
            instanceLabel: conv.channel === "zernio"
              ? (zernioNameByAccount.get(conv.instanceName || "") || "Recepção")
              : (conv.instanceName || null),
            source: conversationSourceValue(conv as any),
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
      const lead: any = await getLeadByConversationId(input.conversationId);
      if (!lead) return lead;
      // "Já é cliente": nº de compras (oportunidades ganhas) — o vendedor precisa
      // ver isso de cara ao abrir a conversa.
      let purchases = lead.funnelStatus === "fechado" ? 1 : 0;
      try {
        const db = await getDb();
        if (db) {
          const { leadOpportunities } = await import("../drizzle/schema");
          const { and: andO } = await import("drizzle-orm");
          const won = await db.select({ id: leadOpportunities.id }).from(leadOpportunities)
            .where(andO(eq(leadOpportunities.leadId, lead.id), eq(leadOpportunities.status, "won")));
          purchases += won.length;
        }
      } catch { /* opcional */ }
      return { ...lead, purchases, isCustomer: purchases > 0 };
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
      let stageChanged = false;
      if (funnelStatus) {
        const prevLead = await getLeadByConversationId(conversationId).catch(() => null);
        stageChanged = (prevLead?.funnelStatus || null) !== funnelStatus;
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
      const saved = await upsertLead({
        conversationId,
        phone: conv?.phone || "",
        ...updateData,
      });
      // Gatilho de CRM: entrou em etapa do funil (só quando muda de fato)
      if (stageChanged && funnelStatus) {
        (async () => {
          try {
            const { triggerEventFlow } = await import("./flowEngine");
            await triggerEventFlow({ conversationId, triggerType: "funnel_stage_entered", matchValue: funnelStatus });
          } catch (e) { console.error("[CRM trigger] etapa:", e); }
        })();
      }
      return saved;
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

  /** Métricas operacionais avançadas (últimos 30 dias) */
  advancedStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;
    const { sql: sqlOp } = await import("drizzle-orm");

    // Tempo médio até a 1ª resposta (atendente ou IA) — em segundos
    const firstResponse = await db.execute(sqlOp`
      SELECT COALESCE(AVG(diff), 0)::float AS avg_seconds, COUNT(*)::int AS sample
      FROM (
        SELECT c.id,
          EXTRACT(EPOCH FROM (MIN(m2."createdAt") - MIN(m1."createdAt"))) AS diff
        FROM conversations c
        JOIN messages m1 ON m1."conversationId" = c.id AND m1."senderType" = 'customer'
        JOIN messages m2 ON m2."conversationId" = c.id AND m2."senderType" IN ('agent','bot')
        WHERE c."createdAt" > now() - interval '30 days'
        GROUP BY c.id
        HAVING MIN(m2."createdAt") > MIN(m1."createdAt")
      ) t
    `);

    // TMA — tempo médio até resolver (conversas resolvidas/fechadas nos últimos 30d)
    const tma = await db.execute(sqlOp`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))), 0)::float AS avg_seconds,
             COUNT(*)::int AS resolved_count
      FROM conversations
      WHERE "status" IN ('resolved','closed')
        AND "updatedAt" > now() - interval '30 days'
    `);

    // Funil: contagem de leads por etapa (últimos 30d por atualização)
    const funnel = await db.execute(sqlOp`
      SELECT "funnelStatus" AS stage, COUNT(*)::int AS count
      FROM leads
      WHERE "updatedAt" > now() - interval '30 days'
      GROUP BY "funnelStatus"
    `);

    // Vendas reportadas à Meta (CAPI Purchase, 30d)
    const capiSales = await db.execute(sqlOp`
      SELECT COUNT(*)::int AS purchases, COALESCE(SUM(value), 0)::float AS total_value
      FROM "capiEvents"
      WHERE "eventName" = 'Purchase' AND "capiEventStatus" = 'sent'
        AND "createdAt" > now() - interval '30 days'
    `);

    // Origem dos leads (30d)
    const origins = await db.execute(sqlOp`
      SELECT
        COUNT(*) FILTER (WHERE "ctwaId" IS NOT NULL)::int AS ctwa,
        COUNT(*) FILTER (WHERE "metaLeadId" IS NOT NULL)::int AS lead_ads,
        COUNT(*) FILTER (WHERE "ctwaId" IS NULL AND "metaLeadId" IS NULL AND ("gclid" IS NOT NULL OR "utmSource" IS NOT NULL))::int AS outros_pagos,
        COUNT(*) FILTER (WHERE "ctwaId" IS NULL AND "metaLeadId" IS NULL AND "gclid" IS NULL AND "utmSource" IS NULL)::int AS organico
      FROM leads
      WHERE "createdAt" > now() - interval '30 days'
    `);

    // CSAT médio (30d)
    const csat = await db.execute(sqlOp`
      SELECT COALESCE(AVG(rating), 0)::float AS avg_rating, COUNT(*)::int AS rated
      FROM "csatRatings"
      WHERE "csatStatus" = 'rated' AND "ratedAt" > now() - interval '30 days'
    `);

    const fr = (firstResponse as any)[0] || (firstResponse as any).rows?.[0] || {};
    const tm = (tma as any)[0] || (tma as any).rows?.[0] || {};
    const cs = (capiSales as any)[0] || (capiSales as any).rows?.[0] || {};
    const og = (origins as any)[0] || (origins as any).rows?.[0] || {};
    const ct = (csat as any)[0] || (csat as any).rows?.[0] || {};
    const funnelRows = ((funnel as any).rows ?? (funnel as any)) || [];

    return {
      csatAvg: Number(ct.avg_rating) || 0,
      csatCount: Number(ct.rated) || 0,
      firstResponseAvgSeconds: Number(fr.avg_seconds) || 0,
      firstResponseSample: Number(fr.sample) || 0,
      tmaAvgSeconds: Number(tm.avg_seconds) || 0,
      resolvedCount: Number(tm.resolved_count) || 0,
      funnel: (funnelRows as any[]).map(r => ({ stage: r.stage, count: Number(r.count) })),
      capiPurchases: Number(cs.purchases) || 0,
      capiTotalValue: Number(cs.total_value) || 0,
      origins: {
        ctwa: Number(og.ctwa) || 0,
        leadAds: Number(og.lead_ads) || 0,
        outrosPagos: Number(og.outros_pagos) || 0,
        organico: Number(og.organico) || 0,
      },
    };
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

  /** Config "Estoque para IA": quais campos a IA vê + curadoria (limpa lixo). */
  getAiConfig: protectedProcedure.query(async () => {
    const { getStockAiConfig, STOCK_AI_FIELDS } = await import("./stockSync");
    return { config: await getStockAiConfig(), campos: STOCK_AI_FIELDS };
  }),

  setAiConfig: adminProcedure
    .input(z.object({
      fields: z.array(z.string()).min(1),
      labels: z.record(z.string(), z.string()).default({}),
      onlyKnownVehicles: z.boolean(),
      hideNoPrice: z.boolean(),
      hideNoPhoto: z.boolean(),
      hideCategories: z.array(z.string()).default([]),
    }))
    .mutation(async ({ input }) => {
      await upsertSetting("ai_stock_config", JSON.stringify(input));
      return { success: true };
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
        const { getOrCreateLeadByPhone } = await import("./db");
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
          const { captureCsatReply } = await import("./csat");
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
      try { const { applyLeadOrigin } = await import("./db"); applyLeadOrigin(conversation.id, messageContent).catch(() => {}); } catch { /* noop */ }

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

const settingsRouter = router({
  /** Parametrização Completa da IA do CRM (Temperaturas, Auto-Tags, Linha do Tempo e Estoque) */
  getAiCrmConfig: protectedProcedure.query(async () => {
    const raw = await getSetting("ai_crm_config");
    const defaultConfig = {
      temperatureMap: {
        novo: "frio",
        interesse_definido: "morno",
        pagamento_definido: "quente",
        dados_pessoais: "quente",
        dados_troca: "quente",
        encaminhado_vendedor: "muito_quente",
        negociando: "muito_quente",
        fechado: "muito_quente",
        perdido: "frio",
      },
      autoTags: [
        { keyword: "financiamento", tag: "Simulação" },
        { keyword: "troca", tag: "Com Troca" },
        { keyword: "consórcio", tag: "Consórcio" },
        { keyword: "visita", tag: "Agendamento" },
      ],
      timelineLogging: {
        logStageChange: true,
        logDataCollected: true,
        logOnSellerTransfer: true,
        noteStyle: "objetivo",
      },
      stockRules: {
        preferSameStore: true,
        requirePhoto: false,
        autoSearchOnVehicleInterest: true,
      },
      funnelStageInstructions: {
        interesse_definido: "Pergunte sobre preferências de modelo, ano e uso quando o cliente demonstrar interesse.",
        pagamento_definido: "Identifique se prefere financiamento, à vista, consórcio ou troca.",
        dados_pessoais: "Colete o nome do cliente e a cidade onde reside.",
        dados_troca: "Pergunte modelo, ano e km do carro de troca se aplicável.",
      },
    };
    try {
      if (!raw) return defaultConfig;
      const parsed = JSON.parse(raw);
      return {
        ...defaultConfig,
        ...parsed,
        temperatureMap: { ...defaultConfig.temperatureMap, ...(parsed.temperatureMap || {}) },
        timelineLogging: { ...defaultConfig.timelineLogging, ...(parsed.timelineLogging || {}) },
        stockRules: { ...defaultConfig.stockRules, ...(parsed.stockRules || {}) },
      };
    } catch {
      return defaultConfig;
    }
  }),

  saveAiCrmConfig: adminProcedure
    .input(z.object({
      temperatureMap: z.record(z.string(), z.enum(["frio", "morno", "quente", "muito_quente"])),
      autoTags: z.array(z.object({
        keyword: z.string().min(1),
        tag: z.string().min(1),
      })),
      timelineLogging: z.object({
        logStageChange: z.boolean(),
        logDataCollected: z.boolean(),
        logOnSellerTransfer: z.boolean(),
        noteStyle: z.enum(["objetivo", "detalhado"]),
      }),
      stockRules: z.object({
        preferSameStore: z.boolean(),
        requirePhoto: z.boolean(),
        autoSearchOnVehicleInterest: z.boolean(),
      }),
      funnelStageInstructions: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ai_crm_config", JSON.stringify(input), ctx.user.id);
      return { success: true };
    }),

  /** Auto-qualificação de leads por IA (liga/desliga + teto de estágio) */
  getAutoQualify: protectedProcedure.query(async () => {
    return {
      enabled: (await getSetting("auto_qualify_enabled")) === "true",
      maxStage: (await getSetting("auto_qualify_max_stage")) || "negociando",
    };
  }),
  saveAutoQualify: adminProcedure
    .input(z.object({
      enabled: z.boolean(),
      maxStage: z.enum(["interesse_definido", "pagamento_definido", "dados_pessoais", "dados_troca", "encaminhado_vendedor", "negociando"]).default("negociando"),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("auto_qualify_enabled", input.enabled ? "true" : "false", ctx.user.id);
      await upsertSetting("auto_qualify_max_stage", input.maxStage, ctx.user.id);
      return { success: true };
    }),

  /** Estilo dos comentários da IA nos leads (curto/objetivo x detalhado) */
  getIaCommentStyle: protectedProcedure.query(async () => {
    return { style: (await getSetting("ia_comment_style")) || "objetivo" };
  }),
  saveIaCommentStyle: adminProcedure
    .input(z.object({ style: z.enum(["objetivo", "equilibrado", "detalhado"]) }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ia_comment_style", input.style, ctx.user.id);
      return { success: true };
    }),

  /** Nomes customizados das etapas do funil (ex.: renomear "Dados pessoais" → "Documentação") */
  getFunnelLabels: protectedProcedure.query(async () => {
    const raw = await getSetting("funnel_stage_labels");
    try { return raw ? (JSON.parse(raw) as Record<string, string>) : {}; } catch { return {}; }
  }),

  saveFunnelLabels: adminProcedure
    .input(z.record(z.string(), z.string().max(40)))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("funnel_stage_labels", JSON.stringify(input), ctx.user.id);
      return { success: true };
    }),

  /** Permissões de menu por cargo (admin sempre vê tudo) */
  getNavPermissions: protectedProcedure.query(async () => {
    const raw = await getSetting("nav_permissions");
    try { return raw ? (JSON.parse(raw) as Record<string, string[]>) : null; } catch { return null; }
  }),

  saveNavPermissions: adminProcedure
    .input(z.record(z.string(), z.array(z.string())))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("nav_permissions", JSON.stringify(input), ctx.user.id);
      return { success: true };
    }),

  /** Config de atendimento: CSAT + carência de reabertura */
  getAttendanceConfig: adminProcedure.query(async () => {
    const [csatEnabled, graceMinutes, csatWindow] = await Promise.all([
      getSetting("csat_enabled"),
      getSetting("reopen_grace_minutes"),
      getSetting("csat_window_minutes"),
    ]);
    return {
      csatEnabled: csatEnabled === "true",
      graceMinutes: Number(graceMinutes) || 30,
      csatWindowMinutes: Number(csatWindow) || 15,
    };
  }),

  saveAttendanceConfig: adminProcedure
    .input(z.object({
      csatEnabled: z.boolean(),
      graceMinutes: z.number().min(0).max(1440),
      csatWindowMinutes: z.number().min(1).max(120),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("csat_enabled", input.csatEnabled ? "true" : "false", ctx.user.id);
      await upsertSetting("reopen_grace_minutes", String(input.graceMinutes), ctx.user.id);
      await upsertSetting("csat_window_minutes", String(input.csatWindowMinutes), ctx.user.id);
      return { success: true };
    }),

  /** Ferramentas/config do Agente Geral (modo livre) */
  getFreeAgentConfig: protectedProcedure.query(async () => {
    const raw = await getSetting("ai_free_tools");
    let tools: string[] = [];
    try { tools = raw ? JSON.parse(raw) : []; } catch { tools = []; }
    return { enabledTools: tools };
  }),

  saveFreeAgentConfig: adminProcedure
    .input(z.object({ enabledTools: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ai_free_tools", JSON.stringify(input.enabledTools), ctx.user.id);
      return { success: true };
    }),

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

  /** Linha do tempo do lead: eventos + notas, com nome do usuário resolvido */
  timeline: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const logs = await listActivityLogs(input.conversationId, 200);
      let members: any[] = [];
      try { members = (await listTeamMembersAuth()) as any[]; } catch {}
      const nameOf = (uid: number) => uid === 0 ? "Sistema" : (members.find(m => m.id === uid)?.name || "Usuário");
      return (logs as any[]).map(l => ({
        id: l.id,
        action: l.action,
        userId: l.userId,
        userName: nameOf(l.userId),
        details: l.details,
        createdAt: l.createdAt,
      }));
    }),

  /** Linha do tempo UNIFICADA por lead (todos os números/conversas da pessoa) */
  timelineByLead: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      const { listActivityLogsByLead } = await import("./db");
      const logs = await listActivityLogsByLead(input.leadId, 120);
      let members: any[] = [];
      try { members = (await listTeamMembersAuth()) as any[]; } catch {}
      const nameOf = (uid: number) => uid === 0 ? "Sistema" : (members.find(m => m.id === uid)?.name || "Usuário");
      return (logs as any[]).map(l => ({
        id: l.id, action: l.action, userId: l.userId, userName: nameOf(l.userId),
        details: l.details, createdAt: l.createdAt,
      }));
    }),

  /** Adiciona uma nota manual à linha do tempo (registra quem, quando) */
  addNote: protectedProcedure
    .input(z.object({ conversationId: z.number(), note: z.string().min(1).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const { logTimeline } = await import("./db");
      await logTimeline({
        conversationId: input.conversationId,
        userId: ctx.user.id,
        action: "nota",
        details: { note: input.note.trim(), authorName: ctx.user.name || "Atendente" },
      });
      return { success: true };
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

// ── Reengagement Router (motor único v2 — PR #6) ─────────────────────────────

const reengagementRouter = router({
  getConfig: adminProcedure.query(async () => {
    const { getReengagementConfig } = await import("./reengagement");
    return getReengagementConfig();
  }),

  saveConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      maxAttempts: z.number().min(1).max(10).optional(),
      maxPerRun: z.number().min(1).max(100).optional(),
      checkIntervalMinutes: z.number().min(1).max(60).optional(),
      steps: z.array(z.object({
        afterMinutes: z.number().min(5).max(43200),
        strategy: z.enum(["flow", "ai_message", "template"]),
        flowId: z.number().nullable().optional(),
        templateName: z.string().nullable().optional(),
      })).min(1).max(10).optional(),
      aiMessages: z.array(z.string()).max(10).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { saveReengagementConfig, restartReengagementJob } = await import("./reengagement");
      const config = await saveReengagementConfig(input, ctx.user.id);
      restartReengagementJob();
      return config;
    }),

  history: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const { getReengagementHistory } = await import("./reengagement");
      return getReengagementHistory(input?.limit ?? 50, input?.offset ?? 0);
    }),

  stats: adminProcedure.query(async () => {
    const { getReengagementStats } = await import("./reengagement");
    return getReengagementStats();
  }),

  runNow: adminProcedure.mutation(async () => {
    const { runReengagementJob } = await import("./reengagement");
    return runReengagementJob();
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
      filterKind: z.enum(["lead", "cliente"]).optional(), // público: só leads ou só clientes
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
        filterKind: input.filterKind || null,
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

  // Ler a config de anúncios (env + ajustes salvos) para a tela de configurações
  getAdsConfig: protectedProcedure.query(async () => {
    const raw = await getSetting("meta_ads_config");
    const saved = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    const cfg = await getMetaConfig();
    return {
      saved,
      effective: {
        pageId: cfg.pageId,
        instagramActorId: cfg.instagramActorId || "",
        whatsappNumber: cfg.whatsappNumber || "",
        dailyBudgetCents: cfg.defaultBudgetCents,
        welcomeMessageTemplate: cfg.welcomeMessageTemplate || "Olá, tenho interesse no veículo: {{marca}} {{modelo}} {{ano}} {{id}}",
        targetCityKey: cfg.defaultTargeting.geo_locations.cities?.[0]?.key || "",
        targetRadiusKm: cfg.defaultTargeting.geo_locations.cities?.[0]?.radius || 80,
        ageMin: cfg.defaultTargeting.age_min,
        ageMax: cfg.defaultTargeting.age_max,
        interests: cfg.defaultTargeting.flexible_spec?.[0]?.interests || [],
      },
      envReady: !!(cfg.accessToken && cfg.adAccountId),
    };
  }),

  // Salvar ajustes da config de anúncios
  saveAdsConfig: protectedProcedure
    .input(z.object({
      pageId: z.string().optional(),
      instagramActorId: z.string().optional(),
      whatsappNumber: z.string().optional(),
      dailyBudgetCents: z.number().min(100).optional(),
      welcomeMessageTemplate: z.string().optional(),
      targetCityKey: z.string().optional(),
      targetRadiusKm: z.number().min(1).max(500).optional(),
      ageMin: z.number().min(13).max(65).optional(),
      ageMax: z.number().min(13).max(65).optional(),
      interests: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    }))
    .mutation(async ({ input }) => {
      const raw = await getSetting("meta_ads_config");
      const cur = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
      const merged = { ...cur, ...input };
      await upsertSetting("meta_ads_config", JSON.stringify(merged));
      return { success: true };
    }),

  // Testar a conexão com a Meta (valida token/conta/página)
  testConnection: protectedProcedure.mutation(async () => {
    const cfg = await getMetaConfig();
    return testMetaConnection(cfg);
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
    const config = await getMetaConfig();
    if (!config.accessToken || !config.adAccountId) {
      throw new Error("Meta Ads não configurado.");
    }
    return listCampaigns(config.accessToken, config.adAccountId);
  }),

  // Listar adsets de uma campanha
  listAdSets: protectedProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      const config = await getMetaConfig();
      if (!config.accessToken) throw new Error("Meta Ads não configurado.");
      return listAdSets(config.accessToken, input.campaignId);
    }),

  // Criar anúncio em adset existente (fluxo simplificado)
  /** Upload de uma imagem própria (ex: arte de stories) para usar no anúncio */
  uploadCreativeImage: protectedProcedure
    .input(z.object({ base64Data: z.string(), mimeType: z.string() }))
    .mutation(async ({ input }) => {
      const { storagePut } = await import("./storage");
      const buffer = Buffer.from(input.base64Data, "base64");
      const ext = input.mimeType.split("/")[1]?.split(";")[0] || "jpg";
      const key = `meta-ads/creative-${crypto.randomBytes(8).toString("hex")}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url };
    }),

  // Gera os 3 criativos (1:1, 4:5, 9:16) do veículo com os selos posicionados e
  // devolve as URLs (S3) para o preview "ver antes de aplicar".
  generateCreativesPreview: protectedProcedure
    .input(z.object({
      vehicleId: z.number(),
      selos: z.array(z.object({ text: z.string(), x: z.number(), y: z.number() })).default([]),
      style: z.object({
        bandColor: z.string().optional(),
        accentColor: z.string().optional(),
        checkColor: z.string().optional(),
      }).optional(),
      priceOverride: z.string().optional(),
      specsOverride: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const { vehicles: vehiclesTable } = await import("../drizzle/schema");
      const v = (await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).limit(1))[0];
      if (!v) throw new Error("Veículo não encontrado");

      // Fotos na ordem do estoque (foto 1 = externa). Aceita images como array de
      // strings ou de objetos {url}. Cai para imageUrl se não houver array.
      const rawImgs = (v as any).images;
      let photoUrls: string[] = [];
      if (Array.isArray(rawImgs)) {
        photoUrls = rawImgs.map((it: any) => (typeof it === "string" ? it : it?.url)).filter(Boolean);
      }
      if (photoUrls.length === 0 && v.imageUrl) photoUrls = [v.imageUrl];
      if (photoUrls.length === 0) throw new Error("Veículo sem fotos");

      const price = input.priceOverride
        || `R$ ${Number(v.price || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
      const versionTxt = (v as any).version ? ` ${(v as any).version}` : "";
      const kmTxt = v.mileage ? ` · ${Number(v.mileage).toLocaleString("pt-BR")} km` : "";
      const specs = input.specsOverride || `${v.brand} ${v.model}${versionTxt} · ${v.year}${kmTxt}`;

      const { generateAllCreatives } = await import("./creativeGenerator");
      const { uploadMediaToS3 } = await import("./media");
      const gen = await generateAllCreatives({ photoUrls, price, specs, selos: input.selos, style: input.style });

      const out: Record<string, string> = {};
      for (const { aspect, buffer } of gen) {
        const up = await uploadMediaToS3(buffer, "image", "image/jpeg");
        if (up) out[aspect] = up.url;
      }
      return { creatives: out, photoCount: photoUrls.length };
    }),

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
      // Criativos por posicionamento (asset_feed_spec): 4:5 no feed, 9:16 no story
      placementCreatives: z.object({ feedUrl: z.string(), storyUrl: z.string() }).optional(),
    }))
    .mutation(async ({ input }) => {
      const config = await getMetaConfig();
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

      // Caminho NOVO: imagem por posicionamento (asset_feed_spec)
      if (input.placementCreatives?.feedUrl && input.placementCreatives?.storyUrl) {
        const { createAdWithPlacementCreatives } = await import("./metaAds");
        const r = await createAdWithPlacementCreatives(
          config, input.adSetId,
          { brand: v.brand, model: v.model, year: v.year, id: v.id },
          { headline: input.headline, description: input.description, primaryText: input.primaryText },
          input.placementCreatives,
          input.pixelId,
        );
        await db.insert(metaAdsTable).values({
          vehicleId: input.vehicleId, campaignId: input.campaignId, adSetId: input.adSetId,
          adCreativeId: r.adCreativeId, adId: r.adId, imageHash: "",
          status: "paused", dailyBudgetCents: 0, createdAt: new Date(), updatedAt: new Date(),
        });
        return { success: true, adId: r.adId, campaignId: input.campaignId, adSetId: input.adSetId };
      }

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
      const config = await getMetaConfig();
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
      const config = await getMetaConfig();
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
      const config = await getMetaConfig();
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
    const config = await getMetaConfig();
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
    const config = await getMetaConfig();
    if (!config.accessToken || !config.adAccountId) {
      throw new Error("Meta Ads não configurado. Adicione ACCESS_TOKEN e ACCOUNT_ID.");
    }
    const result = await importAdsFromMeta(config.accessToken, config.adAccountId);
    return result;
  }),

  // Sincronizar tudo: importar + atualizar métricas
  syncAll: protectedProcedure.mutation(async () => {
    const config = await getMetaConfig();
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
      const config = await getMetaConfig();
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
  /**
   * Monta o Fluxo-Mestre de Triagem pronto para editar:
   * start → classifica intenção → ramifica (compra/pós-venda/informação/financeiro)
   * → para compra: verifica horário → agente Recepção → encaminha vendedor.
   * Usa os agentes que já existem (Recepção/Financeiro/Pós-venda).
   */
  seedMasterFlow: adminProcedure
    .input(z.object({
      postSaleNumber: z.string().optional(), // número do pós-venda
    }).optional())
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { createChatFlow, createChatFlowNode, createChatFlowEdge, getActiveAiAgents } = await import("./db");

      // Localiza os agentes por nome (criados no seedTemplates)
      const agents = await getActiveAiAgents();
      const byName = (n: string) => agents.find(a => a.name.toLowerCase().includes(n))?.id ?? null;
      const recepcaoId = byName("recep");
      const financeiroId = byName("financ");
      const posVendaId = byName("pós") ?? byName("pos");

      const flowId = await createChatFlow({
        name: "Triagem Automática",
        description: "Fluxo-mestre: classifica a intenção do cliente e encaminha para o agente/vendedor certo. Edite à vontade.",
        trigger: "first_contact",
        active: false, // você ativa quando quiser
        priority: 100,
        createdBy: ctx.user.id,
      } as any);

      const mk = async (nodeType: string, label: string, data: any, x: number, y: number) =>
        await createChatFlowNode({ flowId, nodeType: nodeType as any, label, data, positionX: x, positionY: y } as any);
      const link = async (from: any, to: any, handle = "default", label?: string) =>
        createChatFlowEdge({ flowId, sourceNodeId: from, targetNodeId: to, sourceHandle: handle, label } as any);

      // Nós
      const start = await mk("start", "Início", {}, 50, 300);
      const classify = await mk("classify_intent", "Classificar intenção", { categories: ["compra", "pos_venda", "informacao", "financeiro", "outro"] }, 300, 300);

      // Ramo COMPRA → horário → recepção → vendedor
      const hours = await mk("business_hours", "Horário comercial", {
        schedule: {
          "1": [["08:30", "11:30"], ["13:00", "18:00"]],
          "2": [["08:30", "11:30"], ["13:00", "18:00"]],
          "3": [["08:30", "11:30"], ["13:00", "18:00"]],
          "4": [["08:30", "11:30"], ["13:00", "18:00"]],
          "5": [["08:30", "11:30"], ["13:00", "18:00"]],
          "6": [["08:30", "12:00"]],
        },
      }, 600, 150);
      const recepDentro = await mk("ai_response", "IA Recepção (horário)", { agentId: recepcaoId, instruction: "Cumprimente, entenda o veículo de interesse, mande fotos e qualifique (cidade, pagamento, troca). Quando o cliente definir um veículo, encaminhe ao vendedor." }, 900, 80);
      const recepFora = await mk("ai_response", "IA Recepção (fora de hora)", { agentId: recepcaoId, instruction: "Atenda normalmente e qualifique, mas avise que um vendedor entrará em contato no próximo horário comercial. Colete nome, veículo de interesse e cidade." }, 900, 260);
      const assignSeller = await mk("assign_seller", "Encaminhar vendedor", { storeLocation: "Matriz" }, 1250, 150);

      // Ramo PÓS-VENDA → coleta + notifica número
      const posVendaAI = await mk("ai_response", "IA Pós-venda", { agentId: posVendaId, instruction: "Cliente já comprou. Colete nome, veículo comprado e o motivo do contato (garantia, revisão, documentação). Seja acolhedor." }, 600, 400);
      const notifyPos = await mk("notify_number", "Avisar Pós-venda", {
        number: (input?.postSaleNumber || "").replace(/\D/g, ""),
        label: "Pós-venda",
        template: "🔧 Pós-venda: {nome} ({telefone}) precisa de atendimento. Assunto coletado na conversa do CRM.",
      }, 900, 400);

      // Ramo INFORMAÇÃO → agente resolve (usa Recepção/padrão)
      const infoAI = await mk("ai_response", "IA Informação", { agentId: recepcaoId, instruction: "Responda dúvidas gerais (horário, endereço, o que temos em estoque). Resolva sem encaminhar a vendedor, a menos que vire interesse de compra." }, 600, 560);

      // Ramo FINANCEIRO → agente financeiro
      const finAI = await mk("ai_response", "IA Financeiro", { agentId: financeiroId, instruction: "Ajude com financiamento, entrada e simulação. Se o cliente definir veículo e condições, encaminhe ao vendedor." }, 600, 700);

      const endNode = await mk("end", "Fim", {}, 1550, 400);

      // Ligações
      await link(start, classify);
      await link(classify, hours, "compra");
      await link(classify, posVendaAI, "pos_venda");
      await link(classify, infoAI, "informacao");
      await link(classify, finAI, "financeiro");
      await link(classify, infoAI, "outro"); // "outro" cai em informação por padrão
      await link(hours, recepDentro, "dentro");
      await link(hours, recepFora, "fora");
      await link(recepDentro, assignSeller);
      await link(recepFora, endNode);
      await link(assignSeller, endNode);
      await link(posVendaAI, notifyPos);
      await link(notifyPos, endNode);

      return { flowId, message: "Fluxo 'Triagem Automática' criado (inativo). Edite e ative em Fluxos." };
    }),

  // Modelo pronto de pré-atendimento: saudação → pagamento → troca → encaminha ao vendedor.
  seedPreAtendimento: adminProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { createChatFlow, createChatFlowNode, createChatFlowEdge } = await import("./db");

      const flowId = await createChatFlow({
        name: "Pré-atendimento",
        description: "Saudação → pagamento → troca → encaminha ao vendedor. Amarre à conexão e ative.",
        trigger: "first_contact",
        active: false,
        priority: 50,
        createdBy: ctx.user.id,
      } as any);

      const mk = async (nodeType: string, label: string, data: any, x: number, y: number) =>
        await createChatFlowNode({ flowId, nodeType: nodeType as any, label, data, positionX: x, positionY: y } as any);
      const link = async (from: any, to: any, handle = "default") =>
        createChatFlowEdge({ flowId, sourceNodeId: from, targetNodeId: to, sourceHandle: handle } as any);

      const start = await mk("start", "Início", {}, 60, 240);
      const saud = await mk("send_message", "Saudação", {
        text: "Olá {{nome}}! 👋 Aqui é da Auto Inova. Vi o seu interesse e já vou te ajudar. 🚗\n\nSó preciso de 2 respostas rápidas pra adiantar seu atendimento:",
      }, 300, 240);
      const pag = await mk("send_buttons", "Forma de pagamento", {
        body: "Como você pretende pagar?",
        buttons: [{ text: "À vista" }, { text: "Financiamento" }, { text: "Ainda não sei" }],
        onInvalid: "ai",
      }, 560, 240);
      const troca = await mk("send_buttons", "Tem troca?", {
        body: "Você tem um veículo pra dar na troca?",
        buttons: [{ text: "Sim, tenho troca" }, { text: "Não" }],
        onInvalid: "ai",
      }, 820, 240);
      const coletaTroca = await mk("collect_with_ai", "Coletar dados da troca", {
        fields: [
          { key: "tradeVehicle", label: "veículo da troca (marca/modelo)" },
          { key: "tradeYear", label: "ano do veículo da troca" },
          { key: "tradeKm", label: "quilometragem (km) da troca" },
        ],
        instruction: "Colete os dados do veículo que o cliente quer dar na troca, de forma cordial e uma pergunta por vez. Se ele desviar, retome pedindo o que falta.",
        maxAttempts: 4,
        // Sem resposta: lembra 1x após 60min; se continuar mudo, avança com o que tiver.
        noReplyMinutes: 60,
        noReplyMaxAttempts: 1,
        noReplyMessage: "Oi! Só faltam os dados da troca pra eu adiantar seu atendimento. Consegue me passar? 🚗",
      }, 820, 420);
      const stage = await mk("update_lead_status", "Encaminhado", { funnelStatus: "encaminhado_vendedor" }, 1080, 240);
      const seller = await mk("assign_seller", "Encaminhar vendedor", {}, 1320, 240);
      const bye = await mk("send_message", "Passa pro vendedor", {
        text: "Perfeito, {{nome}}! ✅ Já registrei tudo e um consultor vai te chamar por aqui em instantes pra fechar os detalhes. 🚗✨",
      }, 1560, 240);
      const fim = await mk("end", "Fim", {}, 1800, 240);

      await link(start, saud);
      await link(saud, pag);
      // qualquer botão de pagamento → pergunta da troca
      await link(pag, troca, "button_0");
      await link(pag, troca, "button_1");
      await link(pag, troca, "button_2");
      // "Sim, tenho troca" → coleta os dados da troca com IA, depois encaminha
      await link(troca, coletaTroca, "button_0");
      await link(coletaTroca, stage); // avança quando coletar tudo (ou esgotar tentativas)
      // "Não" → encaminha direto
      await link(troca, stage, "button_1");
      await link(stage, seller);
      await link(seller, bye);
      await link(bye, fim);

      return { flowId, message: "Fluxo 'Pré-atendimento' criado (inativo). Amarre à conexão da Bianca e ative." };
    }),

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

  /**
   * Saúde da Jornada (arquitetura vendedor virtual): funil por nó, totais por
   * tipo de evento e últimos fallbacks — alimentado pelo decision log (flowEvents).
   */
  health: protectedProcedure
    .input(z.object({ flowId: z.number(), days: z.number().min(1).max(90).optional() }))
    .query(async ({ input }) => {
      const { getFlowHealthStats } = await import("./db");
      const stats = await getFlowHealthStats(input.flowId, input.days ?? 7);
      if (!stats) throw new Error("Database not available");
      return stats;
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      trigger: z.enum(["first_contact", "keyword", "button_click", "ad_click", "manual", "reactivation", "category_interest", "rescue", "tag_added", "tag_removed", "funnel_stage_entered"]),
      triggerValue: z.string().optional(),
      connectionType: z.string().optional(),
      instanceName: z.string().optional(),
      connectionId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await createChatFlow({
        name: input.name,
        description: input.description || null,
        trigger: input.trigger,
        triggerValue: input.triggerValue || null,
        connectionType: input.connectionType || null,
        instanceName: input.instanceName || null,
        connectionId: input.connectionId ?? null,
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
      trigger: z.enum(["first_contact", "keyword", "button_click", "ad_click", "manual", "reactivation", "category_interest", "rescue", "tag_added", "tag_removed", "funnel_stage_entered"]).optional(),
      triggerValue: z.string().optional(),
      active: z.boolean().optional(),
      priority: z.number().optional(),
      agentId: z.number().nullable().optional(),
      connectionType: z.string().nullable().optional(),
      instanceName: z.string().nullable().optional(),
      connectionId: z.number().nullable().optional(),
      conditions: z.array(z.array(z.object({
        field: z.string(),
        op: z.enum(["eq", "neq"]),
        value: z.string(),
      }))).nullable().optional(),
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

  // Verificar se há sessão de fluxo ativa para uma conversa (com nome do fluxo)
  getActiveSession: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const session = await getActiveFlowSession(input.conversationId);
      if (!session) return null;
      const flow = await getChatFlowById(session.flowId);
      return { ...session, flowName: flow?.name || `Fluxo #${session.flowId}` };
    }),

  // Iniciar um fluxo salvo manualmente para uma conversa
  startForConversation: protectedProcedure
    .input(z.object({ conversationId: z.number(), flowId: z.number() }))
    .mutation(async ({ input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new Error("Conversa não encontrada");
      if (!conv.phone) throw new Error("Conversa sem telefone");

      const { startFlowManually } = await import("./flowEngine");
      const flowResult = await startFlowManually({
        conversationId: input.conversationId,
        flowId: input.flowId,
        phone: conv.phone,
        contactName: conv.contactName || undefined,
      });

      // Persiste as mensagens enviadas pelo fluxo (mesmo padrão do debounce)
      for (const response of flowResult.responses) {
        const botMsg = await createMessage({
          conversationId: input.conversationId,
          content: response,
          senderType: "bot",
          senderName: "Auto Inova - Matriz IA",
          messageType: "text",
        });
        emitNewMessage(input.conversationId, botMsg);
      }
      for (const img of flowResult.imageMessages) {
        const imgMsg = await createMessage({
          conversationId: input.conversationId,
          content: img.caption || "[Imagem]",
          senderType: "bot",
          senderName: "Auto Inova - Matriz IA",
          messageType: "image",
          metadata: { mediaUrl: img.imageUrl, caption: img.caption },
        });
        emitNewMessage(input.conversationId, imgMsg);
      }
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
          conversationId: input.conversationId,
          content,
          senderType: "bot",
          senderName: "Auto Inova - Matriz IA",
          messageType: "text",
          metadata: interactiveMetadata,
        });
        emitNewMessage(input.conversationId, flowInteractiveMsg);
      }

      // Roteamento exclusivo: fluxo assume, IA pausa
      const routedConv = await updateConversation(input.conversationId, { aiActive: false, routingState: "flow" });
      emitConversationUpdate(input.conversationId, routedConv);

      return { success: true, messagesSent: flowResult.responses.length + flowResult.imageMessages.length + flowResult.interactiveMessages.length };
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
        nodeType: z.enum(["start", "send_message", "send_buttons", "send_list", "send_image", "condition", "ai_response", "update_lead", "assign_agent", "delay", "wait_input", "end", "goto_flow", "assign_seller", "send_vehicle_photos", "vehicle_presentation", "update_lead_status", "classify_intent", "business_hours", "notify_number", "collect_with_ai", "vehicle_discovery", "confirm_interest", "collect_sequence"]),
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
  { id: "transferir_para_vendedor", name: "Transferir para Vendedor", description: "Handoff atômico: registra resumo, move o funil, rodízio opcional e para de vender" },
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

  /**
   * "Quem responde esta conversa?" — retorna a cadeia avaliada (fluxo ativo?,
   * hierarquia de agente) e o vencedor com o motivo, SEM enviar mensagem.
   * Usa a MESMA função de resolução do atendimento, então nunca mente.
   */
  resolvePreview: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });
      const session = await getActiveFlowSession(input.conversationId);
      const sctx = (session?.context as any) || {};
      const hierarquia = await resolveAgentForConversation(conv as any);
      const handedOff = (conv as any).routingState === "handed_off";
      const modoFluxo = sctx.discoveryMode ? "apresentar_com_ia" : sctx.collectMode ? "coletar_com_ia" : session ? "fluxo" : null;

      let vencedor: { tipo: string; agentId: number | null; nome: string | null };
      if (session && sctx.nodeAgentId) {
        const nodeAgent = await getAiAgentById(sctx.nodeAgentId);
        vencedor = { tipo: "no_do_fluxo", agentId: sctx.nodeAgentId, nome: nodeAgent?.name ?? null };
      } else if (handedOff) {
        vencedor = { tipo: "pos_handoff", agentId: hierarquia.agentId, nome: hierarquia.agent?.name ?? null };
      } else {
        vencedor = { tipo: hierarquia.source, agentId: hierarquia.agentId, nome: hierarquia.agent?.name ?? null };
      }
      return {
        conversationId: input.conversationId,
        fluxoAtivo: session ? { flowId: session.flowId, modo: modoFluxo } : null,
        handedOff,
        hierarquia: { source: hierarquia.source, agentId: hierarquia.agentId, nome: hierarquia.agent?.name ?? null },
        vencedor,
      };
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

  /** Agente padrão da loja (usado quando nada mais específico se aplica) */
  getDefaultAgent: protectedProcedure.query(async () => {
    const id = await getSetting("default_agent_id");
    return id ? parseInt(id, 10) : null;
  }),

  setDefaultAgent: adminProcedure
    .input(z.object({ agentId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      // marca isDefault no agente (máx 1) e sincroniza o setting legado
      await setDefaultAiAgent(input.agentId);
      return { success: true };
    }),

  /** Atribuições de agente por instância Evolution */
  getInstanceAgents: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {};
    const { evolutionInstances } = await import("../drizzle/schema");
    const instances = await db.select().from(evolutionInstances);
    const map: Record<string, number | null> = {};
    for (const inst of instances) {
      const id = await getSetting(`instance_${inst.instanceName}_agent_id`);
      map[inst.instanceName] = id ? parseInt(id, 10) : null;
    }
    return map;
  }),

  setInstanceAgent: adminProcedure
    .input(z.object({ instanceName: z.string(), agentId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      await upsertSetting(`instance_${input.instanceName}_agent_id`, input.agentId ? String(input.agentId) : "");
      return { success: true };
    }),

  /**
   * Semeia os agentes-template de uma concessionária.
   * O agente "Recepção" herda os prompts globais atuais (nada se perde).
   */
  seedTemplates: adminProcedure.mutation(async ({ ctx }) => {
    const existing = await listAiAgents();
    const existingNames = new Set(existing.map(a => a.name.toLowerCase()));
    const { getCorePrompt, getCommercialPrompt, getPersonalityPrompt } = await import("./ai");

    const created: string[] = [];
    const allStockTools = ["buscar_veiculos", "buscar_veiculo_por_id", "apresentar_veiculo", "resumo_estoque", "atualizar_lead", "enviar_botoes", "enviar_lista"];

    // 1. Recepção/Vendas — herda a configuração atual da IA (vira o padrão)
    if (!existingNames.has("recepção") && !existingNames.has("recepcao")) {
      const personality = await getPersonalityPrompt();
      const rec = await createAiAgent({
        name: "Recepção",
        description: "Atendimento inicial e vendas — herda a configuração atual da sua IA. Apresenta veículos, qualifica o lead.",
        systemPrompt: personality,
        includeCoreLayers: true, // usa as camadas núcleo + comercial atuais
        model: "gpt-4o-mini",
        temperature: "0.7",
        maxTokens: 1024,
        enabledTools: allStockTools,
        active: true,
        createdBy: ctx.user.id,
      });
      await setDefaultAiAgent(rec.id); // marca isDefault + sincroniza setting
      created.push("Recepção (definido como padrão)");
    }

    // 2. Financeiro
    if (!existingNames.has("financeiro")) {
      await createAiAgent({
        name: "Financeiro",
        description: "Foco em financiamento, entrada e simulação. Não fica empurrando veículo.",
        systemPrompt: `Você é o especialista financeiro da Auto Inova. Seu foco é ajudar o cliente com financiamento, valor de entrada, parcelas e simulações.
Seja objetivo e transmita confiança. Pergunte o valor de entrada disponível e a renda quando fizer sentido, mas sem ser invasivo.
Explique as formas de pagamento (à vista, financiado, com troca). Registre os dados com atualizar_lead.
NÃO apresente veículos novos aqui — o cliente já escolheu; seu papel é viabilizar o negócio. Se ele quiser ver outro carro, sugira falar com a Recepção.
Tom: profissional, tranquilizador, direto. Sem markdown, máximo 3 parágrafos curtos.`,
        includeCoreLayers: true,
        model: "gpt-4o-mini",
        temperature: "0.5",
        maxTokens: 1024,
        enabledTools: ["atualizar_lead", "enviar_botoes"],
        active: true,
        createdBy: ctx.user.id,
      });
      created.push("Financeiro");
    }

    // 3. Pós-venda
    if (!existingNames.has("pós-venda") && !existingNames.has("pos-venda")) {
      await createAiAgent({
        name: "Pós-venda",
        description: "Para quem já comprou. Relacionamento, revisão, recompra e indicação — sem pressão de venda.",
        systemPrompt: `Você é o pós-venda da Auto Inova. O cliente JÁ COMPROU um veículo com a gente. Seu papel é relacionamento, não venda.
Trate com carinho e gratidão. Ajude com dúvidas sobre o veículo, revisões, documentação e garantia.
Se perceber interesse em trocar ou indicar alguém, colete a informação com atualizar_lead e passe para a Recepção com naturalidade.
NUNCA pressione para comprar. O objetivo é fidelizar e gerar indicação.
Tom: caloroso, atencioso, próximo. Sem markdown, máximo 3 parágrafos curtos.`,
        includeCoreLayers: true,
        model: "gpt-4o-mini",
        temperature: "0.7",
        maxTokens: 1024,
        enabledTools: ["atualizar_lead", "enviar_botoes"],
        active: true,
        createdBy: ctx.user.id,
      });
      created.push("Pós-venda");
    }

    return { created, count: created.length };
  }),

  /**
   * Cria o agente de produção "Atendente Principal" (jornada de 5 estágios +
   * playbook) e o define como agente PADRÃO da loja. Idempotente: se já existir,
   * apenas garante que está como padrão.
   */
  seedAtendentePrincipal: adminProcedure.mutation(async ({ ctx }) => {
    const existing = await listAiAgents();
    const found = existing.find(a => a.name.trim().toLowerCase() === "atendente principal");
    if (found) {
      await setDefaultAiAgent(found.id);
      return { created: false, id: found.id, name: found.name };
    }

    const systemPrompt = `=== PAPEL ===
Você é a atendente virtual da Auto Inova, concessionária de veículos seminovos.
Seu trabalho é conduzir CADA lead por uma jornada de 5 estágios: acolher, qualificar, apresentar veículos, coletar dados e entregar para o vendedor humano.
Você é o primeiro contato do cliente — seja o melhor vendedor da loja em educação, clareza e velocidade, sem nunca fingir ser humana.

=== JORNADA (siga os estágios na ordem; o estágio atual está no CONTEXTO DINÂMICO) ===

ESTÁGIO 1 — ACOLHIMENTO (funil: novo)
- Cumprimente pelo nome se souber. Pergunte o que a pessoa procura.
- Se o cliente já chegou dizendo o que quer (ex.: "quero uma Hilux"), pule direto para o estágio 2 sem cerimônia.
- Se veio de anúncio (contexto indica veículo), confirme o interesse nesse veículo específico.

ESTÁGIO 2 — QUALIFICAÇÃO (funil: novo → interesse_definido)
- Descubra UMA coisa de cada vez, em conversa natural (nunca interrogatório): tipo de veículo ou modelo desejado, faixa de preço, uso (trabalho/família), se tem veículo na troca, forma de pagamento pretendida.
- A cada dado novo, chame atualizar_lead IMEDIATAMENTE (intenção, veiculo_interesse, tem_troca, pagamento...). Não acumule para depois.
- Quando souber o que o cliente quer, marque etapa_funil: interesse_definido.

ESTÁGIO 3 — APRESENTAÇÃO DE VEÍCULOS
- SEMPRE use buscar_veiculos antes de falar de qualquer veículo. Se o cliente citou um ID (ex.: "vi o anúncio do ID 9"), use buscar_veiculo_por_id.
- Use apresentar_veiculo para mostrar com foto — nunca despeje dados em texto puro se a ferramenta de apresentação existe.
- 1 resultado → apresente direto. Vários → apresente os 2-3 melhores e pergunte qual chamou mais atenção.
- Zero resultado → diga honestamente que não tem no momento, ofereça alternativas próximas (busque por categoria/faixa) e, se nada servir, registre o interesse em notas para avisar quando chegar.
- Quando o cliente escolher um veículo: atualizar_lead(veiculo_interesse, veiculo_id). Se ele mudar de veículo: atualizar_lead(veiculo_interesse: novo, veiculo_id: null) e apresente o novo.

ESTÁGIO 4 — COLETA DE DADOS (funil: dados_pessoais / dados_troca)
- Só colete o que faz sentido para o momento: primeiro nome e cidade; dados de troca (modelo, ano, km) se houver troca; forma de pagamento e entrada.
- CPF e data de nascimento SOMENTE quando o cliente quiser simular financiamento — explique o porquê antes de pedir ("para simular nas financeiras, preciso do seu CPF e data de nascimento").
- NUNCA peça todos os dados de uma vez. Máximo 2 por mensagem.
- A cada dado, atualizar_lead com o campo correspondente (nunca jogue dados estruturados em notas: CPF vai em cpf, nascimento em data_nascimento, cidade em cidade).

ESTÁGIO 5 — HANDOFF PARA O VENDEDOR
Gatilhos (qualquer um):
  a) Cliente pediu vendedor/humano;
  b) Cliente escolheu veículo E definiu pagamento (com ou sem dados pessoais);
  c) Cliente quer negociar preço/condições;
  d) Cliente quer agendar visita ou test drive;
  e) Você não conseguiu ajudar após 2 tentativas.
Protocolo obrigatório:
  1) Chame a tool transferir_para_vendedor com: motivo (pediu_humano | negociacao | agendamento | dados_completos | sem_solucao) e resumo no formato fixo: "Interesse: <veículo> | Troca: <veículo/ano/km ou 'sem troca'> | Pagamento: <forma/entrada> | Dados: <o que já tem> | Pendência: <o que falta> | Observação: <1 frase sobre o cliente>". Ela move o funil e registra tudo — não precisa chamar atualizar_lead só para isso.
  2) Avise o cliente: "Já passei tudo para o vendedor, ele/ela vai te chamar aqui mesmo em instantes."
  3) PARE de vender. Se o cliente continuar falando depois do handoff, responda de forma breve e cordial, sem abrir negociação nova — quem conduz agora é o vendedor.

=== REGRAS DE FERRAMENTAS (INVIOLÁVEIS) ===
- PROIBIDO inventar veículo, preço, ano, km ou disponibilidade. Só fale o que buscar_veiculos / buscar_veiculo_por_id retornou. COPIE preço e ano exatamente.
- Se a ferramenta falhar ou não souber algo: diga que vai confirmar com a equipe e registre em notas. Nunca chute.
- atualizar_lead é sua memória: use-a em TODA informação nova do cliente.
- Não prometa aprovação de financiamento ("sujeito à análise").
- Não ofereça desconto, brinde ou condição especial — negociação é com o vendedor (isso é gatilho de handoff, estágio 5c).

=== FORMATO (WhatsApp) ===
- Texto corrido, sem markdown, sem listas com traços. Quebras de linha para separar ideias. Máximo 3 parágrafos curtos e 1-2 emojis por mensagem.
- Português brasileiro casual e profissional, como um bom vendedor de loja fala no WhatsApp. Nunca linguagem de robô ou de e-mail.
- Uma pergunta por mensagem. Nunca despeje 3 perguntas juntas.
- Preço sempre formatado: R$ 89.900.

=== PLAYBOOK DE SITUAÇÕES ===
Cliente manda áudio ou foto → trate como texto normal; confirme o que entendeu ("entendi, você quer...").
Cliente pergunta "tem como fazer só no nome de outra pessoa?", "aceita permuta?", "faz consórcio?" → responda o básico com honestidade e diga que o vendedor detalha as condições (registre a pergunta em notas).
Cliente quer pechinchar ("faz por 80?", "qual o menor valor?") → não negocie: "quem fecha condições é nosso vendedor, mas já vou passar sua proposta pra ele" → handoff (5c).
Cliente irritado ou frustrado → valide o sentimento, peça desculpas uma vez, resolva o que puder; se escalar, handoff imediato.
Cliente pergunta algo fora do escopo (IPVA, multas, mecânica, outras lojas) → responda brevemente se for simples e redirecione: "mas sobre o veículo, quer que eu...".
Cliente pergunta se você é robô/IA → verdade sempre: "sou a assistente virtual da Auto Inova, faço o primeiro atendimento e já te passo para o time".
Cliente manda spam, teste ou mensagem sem sentido → responda uma vez com cordialidade; se repetir, não insista.
Cliente retorna depois de dias → o contexto mostra o histórico: retome de onde parou ("da última vez você olhou a Hilux..."), não recomece do zero.
Dois assuntos na mesma mensagem → atenda os dois, mas feche com UMA pergunta só.
Cliente quer só o preço e some → informe o preço via apresentar_veiculo, faça 1 pergunta leve de qualificação. Não force conversa.
Horário fora do comercial → atenda normalmente; no handoff avise: "o vendedor te chama no próximo horário comercial".
Menor de idade / pedido estranho de dados → não colete CPF de terceiros nem dados de menores; direcione para o vendedor.
LGPD → só colete dados necessários ao estágio atual; se o cliente pedir para apagar dados ou parar de receber mensagens, registre em notas e informe que a equipe cuidará disso.

=== PRIORIDADE EM CONFLITOS ===
1) Verdade sobre veículos (só o banco). 2) Não negociar preço. 3) Handoff quando qualquer gatilho do estágio 5 ocorrer. 4) Simpatia. Se tiver que escolher entre ser simpática e ser correta, seja correta.`;

    const rec = await createAiAgent({
      name: "Atendente Principal",
      description: "Agente de produção: jornada de 5 estágios (acolher → qualificar → apresentar → coletar → handoff) com playbook completo.",
      systemPrompt,
      includeCoreLayers: true,
      model: "gpt-4o-mini",
      temperature: "0.5",
      maxTokens: 1024,
      enabledTools: ["buscar_veiculos", "buscar_veiculo_por_id", "apresentar_veiculo", "resumo_estoque", "atualizar_lead", "enviar_botoes", "transferir_para_vendedor"],
      active: true,
      createdBy: ctx.user.id,
    });
    await setDefaultAiAgent(rec.id); // vira o agente padrão da loja
    return { created: true, id: rec.id, name: "Atendente Principal" };
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
  /** Busca leve para o picker de nova conversa — nome OU número, case-insensitive */
  search: protectedProcedure
    .input(z.object({ q: z.string().min(1).max(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { contacts } = await import("../drizzle/schema");
      const { ilike, like: likeOp, or: orOp, and: andOp, eq, desc } = await import("drizzle-orm");
      const term = `%${input.q.trim()}%`;
      const digits = input.q.replace(/\D/g, "");
      const nameCond = ilike(contacts.name, term);
      const cond = digits.length >= 3
        ? orOp(nameCond, likeOp(contacts.phone, `%${digits}%`))!
        : nameCond;
      const rows = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
        .from(contacts)
        .where(andOp(eq(contacts.isActive, true), cond))
        .orderBy(desc(contacts.createdAt))
        .limit(10);
      return rows;
    }),

  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      tag: z.string().optional(),
      source: z.string().optional(),
      kind: z.string().optional(), // lead | cliente | custom
      createdByInstance: z.string().optional(), // "matriz" ou nome da instância
      limit: z.number().optional(),
      offset: z.number().optional(),
      campaignParticipant: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const result = await listContacts(input || {});
      const rows = (result as any).contacts || [];
      if (rows.length === 0) return result;

      // Enriquece com a última conversa (por conversationId ou telefone)
      try {
        const db = await getDb();
        if (db) {
          const { conversations: convTable } = await import("../drizzle/schema");
          const { inArray, ne: neOp, and: andOp } = await import("drizzle-orm");
          const phones = Array.from(new Set(rows.map((c: any) => c.phone).filter(Boolean)));
          const convs = phones.length > 0
            ? await db.select({
                id: convTable.id, phone: convTable.phone,
                lastMessageAt: convTable.lastMessageAt,
                lastMessagePreview: convTable.lastMessagePreview,
                status: convTable.status,
              }).from(convTable)
              .where(andOp(inArray(convTable.phone, phones as string[]), neOp(convTable.channel, "evolution" as any)))
            : [];
          const byPhone = new Map<string, any>();
          for (const cv of convs) {
            const prev = byPhone.get(cv.phone);
            if (!prev || (cv.lastMessageAt || 0) > (prev.lastMessageAt || 0)) byPhone.set(cv.phone, cv);
          }
          for (const c of rows) {
            const cv = byPhone.get(c.phone);
            c.lastConversation = cv ? {
              conversationId: cv.id,
              lastMessageAt: cv.lastMessageAt,
              preview: cv.lastMessagePreview,
              status: cv.status,
            } : null;
          }
        }
      } catch { /* enriquecimento é opcional */ }
      return result;
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
      kind: z.string().max(40).default("lead"),
      createdByInstance: z.string().max(100).nullable().optional(),
      cpf: z.string().max(14).optional(),
      birthDate: z.string().max(10).optional(),
      address: z.string().max(500).optional(),
      city: z.string().max(100).optional(),
      purchasedVehicle: z.string().max(300).optional(),
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
      kind: z.string().max(40).optional(),
      cpf: z.string().max(14).nullable().optional(),
      birthDate: z.string().max(10).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      city: z.string().max(100).nullable().optional(),
      purchasedVehicle: z.string().max(300).nullable().optional(),
      lastDealValue: z.number().nullable().optional(),
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
        kind: z.enum(["lead", "cliente"]).optional(),
        cpf: z.string().max(14).optional(),
        birthDate: z.string().max(10).optional(),
        address: z.string().max(500).optional(),
        city: z.string().max(100).optional(),
        purchasedVehicle: z.string().max(300).optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const rows = input.contacts.map(c => ({ ...c, source: "excel" as const }));
      return bulkCreateContacts(rows);
    }),

  tags: adminProcedure.query(async () => {
    return getAllContactTags();
  }),

  /**
   * Backfill: preenche a origem (instância) de contatos antigos que foram
   * salvos antes do campo existir, cruzando telefone → conversa Evolution.
   */
  backfillInstances: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const { contacts: contactsTable, conversations: convTable } = await import("../drizzle/schema");
    const { eq, and, isNull, inArray } = await import("drizzle-orm");

    // Contatos sem origem definida
    const orphans = await db.select().from(contactsTable).where(isNull(contactsTable.createdByInstance));
    let matched = 0;

    for (const c of orphans) {
      // Procura conversa Evolution com esse telefone (variações de 9º dígito)
      const variations = Array.from(new Set([c.phone, ...phoneVariations(c.phone)]));
      const evoConv = (await db.select({ instanceName: convTable.instanceName }).from(convTable)
        .where(and(
          eq(convTable.channel, "evolution" as any),
          inArray(convTable.phone, variations),
        )).limit(1))[0];

      if (evoConv?.instanceName) {
        await db.update(contactsTable).set({ createdByInstance: evoConv.instanceName }).where(eq(contactsTable.id, c.id));
        matched++;
      }
      // Contatos que só têm conversa na matriz ficam NULL de propósito (origem = matriz)
    }
    return { total: orphans.length, matched, matriz: orphans.length - matched };
  }),

  /** Tipos de contato customizados (além de lead/cliente) */
  kinds: protectedProcedure.query(async () => {
    const raw = await getSetting("contact_custom_kinds");
    let custom: string[] = [];
    try { custom = raw ? JSON.parse(raw) : []; } catch { custom = []; }
    return { builtin: ["lead", "cliente"], custom };
  }),

  addKind: adminProcedure
    .input(z.object({ name: z.string().min(1).max(40) }))
    .mutation(async ({ input }) => {
      const raw = await getSetting("contact_custom_kinds");
      let custom: string[] = [];
      try { custom = raw ? JSON.parse(raw) : []; } catch { custom = []; }
      const clean = input.name.trim().toLowerCase();
      if (["lead", "cliente"].includes(clean)) throw new Error("Esse tipo já existe");
      if (!custom.includes(clean)) custom.push(clean);
      await upsertSetting("contact_custom_kinds", JSON.stringify(custom));
      return { custom };
    }),

  removeKind: adminProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const raw = await getSetting("contact_custom_kinds");
      let custom: string[] = [];
      try { custom = raw ? JSON.parse(raw) : []; } catch { custom = []; }
      custom = custom.filter(k => k !== input.name.toLowerCase());
      await upsertSetting("contact_custom_kinds", JSON.stringify(custom));
      return { custom };
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

  // Fetch media URL on demand (for messages that were saved without mediaUrl)
  getMediaUrl: protectedProcedure
    .input(z.object({
      instanceName: z.string(),
      messageId: z.string(),
      remoteJid: z.string().optional(),
      fromMe: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { evolutionGetMediaBase64 } = await import("./evolutionService");
      const { storagePut } = await import("./storage");
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
      // Link to conversation AND update contactName so it shows in the list
      await updateEvolutionConversation(input.conversationId, { contactId, contactName: input.name } as any);
      return { contactId, success: true };
    }),
});

// ─── Quick Replies Router (respostas prontas via "/") ────────────────────────

const quickReplyRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { quickReplies } = await import("../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    return db.select().from(quickReplies).orderBy(desc(quickReplies.usageCount));
  }),

  create: protectedProcedure
    .input(z.object({
      shortcut: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, hífen"),
      title: z.string().min(1).max(100),
      content: z.string().min(1),
      category: z.string().max(50).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { quickReplies } = await import("../drizzle/schema");
      const result = await db.insert(quickReplies).values({ ...input, createdBy: ctx.user.id }).returning();
      return result[0];
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      shortcut: z.string().min(1).max(50).optional(),
      title: z.string().min(1).max(100).optional(),
      content: z.string().min(1).optional(),
      category: z.string().max(50).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { quickReplies } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { id, ...data } = input;
      await db.update(quickReplies).set({ ...data, updatedAt: new Date() }).where(eq(quickReplies.id, id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { quickReplies } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(quickReplies).where(eq(quickReplies.id, input.id));
      return { success: true };
    }),

  /** Incrementa contador de uso (para ordenar por mais usadas) */
  trackUsage: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const { quickReplies } = await import("../drizzle/schema");
      const { eq, sql: sqlOp } = await import("drizzle-orm");
      await db.update(quickReplies).set({ usageCount: sqlOp`${quickReplies.usageCount} + 1` }).where(eq(quickReplies.id, input.id));
      return { success: true };
    }),
});

// ─── Labels Router (etiquetas de conversa) ────────────────────────────────────

const labelRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { labels } = await import("../drizzle/schema");
    return db.select().from(labels).orderBy(labels.name);
  }),

  /** Todas as atribuições conversa<->etiqueta (client monta o mapa) */
  assignments: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { conversationLabels } = await import("../drizzle/schema");
    return db.select().from(conversationLabels);
  }),

  byConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversationLabels, labels } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      return db.select({ id: labels.id, name: labels.name, color: labels.color })
        .from(conversationLabels)
        .innerJoin(labels, eq(conversationLabels.labelId, labels.id))
        .where(eq(conversationLabels.conversationId, input.conversationId));
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(50), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { labels } = await import("../drizzle/schema");
      const result = await db.insert(labels).values(input).returning();
      return result[0];
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1).max(50).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { labels } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { id, ...data } = input;
      await db.update(labels).set(data).where(eq(labels.id, id));
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { labels, conversationLabels } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(conversationLabels).where(eq(conversationLabels.labelId, input.id));
      await db.delete(labels).where(eq(labels.id, input.id));
      return { success: true };
    }),

  /** Define o conjunto completo de etiquetas de uma conversa */
  setForConversation: protectedProcedure
    .input(z.object({ conversationId: z.number(), labelIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversationLabels, labels } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      // Etiquetas antes (para detectar adicionadas/removidas → gatilhos de CRM)
      const beforeRows = await db.select({ labelId: conversationLabels.labelId })
        .from(conversationLabels)
        .where(eq(conversationLabels.conversationId, input.conversationId));
      const beforeArr = beforeRows.map(r => r.labelId);
      const afterArr = input.labelIds;

      await db.delete(conversationLabels).where(eq(conversationLabels.conversationId, input.conversationId));
      if (input.labelIds.length > 0) {
        await db.insert(conversationLabels).values(
          input.labelIds.map(labelId => ({ conversationId: input.conversationId, labelId }))
        );
      }
      emitConversationUpdate(input.conversationId, { labelIds: input.labelIds });

      // Gatilhos de CRM: etiqueta adicionada / removida
      const addedIds = afterArr.filter(id => !beforeArr.includes(id));
      const removedIds = beforeArr.filter(id => !afterArr.includes(id));
      if (addedIds.length > 0 || removedIds.length > 0) {
        (async () => {
          try {
            const allLabels = await db.select({ id: labels.id, name: labels.name }).from(labels);
            const nameById = new Map(allLabels.map(l => [l.id, l.name]));
            const { triggerEventFlow } = await import("./flowEngine");
            for (const id of addedIds) {
              await triggerEventFlow({ conversationId: input.conversationId, triggerType: "tag_added", matchValue: nameById.get(id) || undefined });
            }
            for (const id of removedIds) {
              await triggerEventFlow({ conversationId: input.conversationId, triggerType: "tag_removed", matchValue: nameById.get(id) || undefined });
            }
          } catch (e) { console.error("[CRM trigger] etiqueta:", e); }
        })();
      }
      return { success: true };
    }),
});

// ─── Reminders Router (lembretes por conversa) ────────────────────────────────

const reminderRouter = router({
  create: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      remindAt: z.number(), // epoch ms
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.remindAt <= Date.now()) throw new Error("O lembrete precisa ser no futuro");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversationReminders } = await import("../drizzle/schema");
      const result = await db.insert(conversationReminders).values({
        conversationId: input.conversationId,
        teamMemberId: ctx.user.id,
        remindAt: input.remindAt,
        note: input.note || null,
      }).returning();
      return result[0];
    }),

  /** Lembretes pendentes do usuário logado (opcionalmente de uma conversa) */
  listMine: protectedProcedure
    .input(z.object({ conversationId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversationReminders } = await import("../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      const conditions = [
        eq(conversationReminders.teamMemberId, ctx.user.id),
        eq(conversationReminders.status, "pending"),
      ];
      if (input?.conversationId) conditions.push(eq(conversationReminders.conversationId, input.conversationId));
      return db.select().from(conversationReminders).where(andOp(...conditions)).orderBy(conversationReminders.remindAt);
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversationReminders } = await import("../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      await db.update(conversationReminders)
        .set({ status: "dismissed" })
        .where(andOp(eq(conversationReminders.id, input.id), eq(conversationReminders.teamMemberId, ctx.user.id)));
      return { success: true };
    }),
});

// ─── Scheduled Messages Router (mensagens agendadas) ──────────────────────────

const scheduledMessageRouter = router({
  create: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      content: z.string().min(1),
      scheduledAt: z.number(), // epoch ms
      fallbackTemplateName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.scheduledAt <= Date.now()) throw new Error("O horário precisa ser no futuro");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { scheduledMessages } = await import("../drizzle/schema");
      const result = await db.insert(scheduledMessages).values({
        conversationId: input.conversationId,
        content: input.content,
        scheduledAt: input.scheduledAt,
        fallbackTemplateName: input.fallbackTemplateName || null,
        createdBy: ctx.user.id,
        createdByName: ctx.user.name || "Atendente",
      }).returning();
      return result[0];
    }),

  listByConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { scheduledMessages } = await import("../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      return db.select().from(scheduledMessages)
        .where(andOp(eq(scheduledMessages.conversationId, input.conversationId), eq(scheduledMessages.status, "pending")))
        .orderBy(scheduledMessages.scheduledAt);
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { scheduledMessages } = await import("../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      await db.update(scheduledMessages)
        .set({ status: "cancelled" })
        .where(andOp(eq(scheduledMessages.id, input.id), eq(scheduledMessages.status, "pending")));
      return { success: true };
    }),
});

// ─── Meta CAPI Router (tracking avançado de anúncios) ─────────────────────────

const capiRouter = router({
  getConfig: adminProcedure.query(async () => {
    const { getCapiConfig } = await import("./metaConversions");
    const config = await getCapiConfig();
    return {
      enabled: config.enabled,
      datasetId: config.datasetId,
      hasToken: !!(await getSetting("capi_access_token")),
      testEventCode: config.testEventCode,
    };
  }),

  saveConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean(),
      datasetId: z.string().max(255),
      accessToken: z.string().max(1000).optional(), // vazio = mantém o atual
      testEventCode: z.string().max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("capi_enabled", input.enabled ? "true" : "false", ctx.user.id);
      await upsertSetting("capi_dataset_id", input.datasetId.trim(), ctx.user.id);
      if (input.accessToken && input.accessToken.trim()) {
        await upsertSetting("capi_access_token", input.accessToken.trim(), ctx.user.id);
      }
      await upsertSetting("capi_test_event_code", (input.testEventCode || "").trim(), ctx.user.id);
      return { success: true };
    }),

  sendTest: adminProcedure.mutation(async () => {
    const { sendTestEvent } = await import("./metaConversions");
    return sendTestEvent();
  }),

  listEvents: protectedProcedure
    .input(z.object({ limit: z.number().max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const { listCapiEvents } = await import("./metaConversions");
      return listCapiEvents(input?.limit ?? 50);
    }),
});

// ─── Zernio Router ────────────────────────────────────────────────────────────
const zernioRouter = router({
  // Instâncias Zernio CADASTRADAS (uma aba por conta). Lê da tabela dedicada —
  // nada a ver com Evolution.
  listInstances: protectedProcedure.query(async ({ ctx }) => {
    const { listZernioInstances } = await import("./db");
    let rows = await listZernioInstances();
    // Vendedor só vê as instâncias atribuídas a ele
    const member = await currentTeamMember(ctx);
    if (member && member.cargo === "vendedor") {
      rows = rows.filter((r: any) => r.assignedUserId === member.id);
    }
    return rows.map((r: any) => ({
      id: r.id,
      instanceName: `zernio:${r.accountId}`, // valor da aba/fonte no inbox
      accountId: r.accountId,
      displayName: r.displayName || r.phone || "WhatsApp (Zernio)",
      phone: r.phone,
      assignedUserId: r.assignedUserId ?? null,
      status: r.active ? "connected" : "disconnected",
      channel: "zernio" as const,
    }));
  }),

  /** Dispara manualmente o sincronizador (recupera mensagens perdidas). */
  sync: adminProcedure.mutation(async () => {
    const { runZernioSync } = await import("./zernioSync");
    return runZernioSync();
  }),

  /** Define o vendedor dono da instância Zernio (vê só ela no inbox). */
  assignUser: adminProcedure
    .input(z.object({ id: z.number(), userId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const { zernioInstances } = await import("../drizzle/schema");
      await db.update(zernioInstances).set({ assignedUserId: input.userId } as any).where(eq(zernioInstances.id, input.id));
      return { success: true };
    }),

  // Lista as contas disponíveis na conta Zernio (via API) para o usuário escolher
  // qual cadastrar. Aceita uma apiKey opcional (se ainda não estiver no .env).
  availableAccounts: protectedProcedure
    .input(z.object({ apiKey: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { zernioListAccounts } = await import("./zernioService");
        const accounts = await zernioListAccounts(input?.apiKey);
        return (accounts || [])
          .filter((a: any) => String(a?.platform || "").toLowerCase() === "whatsapp")
          .map((a: any) => ({
            accountId: a?._id || a?.id || a?.accountId,
            displayName: a?.displayName || a?.name || a?.username,
            phone: a?.username || a?.phoneNumber,
          }));
      } catch (err) {
        console.error("[Zernio] availableAccounts falhou:", err);
        return [];
      }
    }),

  // Cadastra (ou atualiza) uma instância Zernio
  createInstance: protectedProcedure
    .input(z.object({
      accountId: z.string().min(4),
      displayName: z.string().optional(),
      phone: z.string().optional(),
      apiKey: z.string().optional(),
      webhookSecret: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { createZernioInstance } = await import("./db");
      return createZernioInstance(input);
    }),

  deleteInstance: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteZernioInstance } = await import("./db");
      await deleteZernioInstance(input.id);
      return { success: true };
    }),
});

// ─── WhatsApp API Oficial (multi-número) Router ───────────────────────────────
const whatsappNumberRouter = router({
  // Lista números oficiais adicionais como "instâncias" (abas no inbox)
  listInstances: protectedProcedure.query(async ({ ctx }) => {
    // Vendedor não vê os números oficiais (só a instância dele)
    const member = await currentTeamMember(ctx);
    if (member && member.cargo === "vendedor") return [];
    const { listWhatsappNumbers } = await import("./whatsappMultiNumber");
    const rows = await listWhatsappNumbers();
    return (rows || []).map((r: any) => ({
      id: r.id,
      instanceName: `official:${r.phoneNumberId}`,
      phoneNumberId: r.phoneNumberId,
      displayName: r.displayName,
      phone: r.phoneDisplay,
      status: r.isActive ? "connected" : "disconnected",
      channel: "whatsapp" as const,
    }));
  }),

  createInstance: protectedProcedure
    .input(z.object({
      phoneNumberId: z.string().min(4),
      displayName: z.string().min(1),
      phoneDisplay: z.string().optional(),
      accessToken: z.string().optional(),
      wabaId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { createWhatsappNumber } = await import("./whatsappMultiNumber");
      return createWhatsappNumber(input);
    }),

  // Conexão de 1 clique a partir do Embedded Signup: assina a WABA no app do
  // provedor + salva o número (usa o token do provedor). Só admin.
  connectFromSignup: protectedProcedure
    .input(z.object({
      wabaId: z.string().min(4),
      phoneNumberId: z.string().min(4),
      displayName: z.string().optional(),
      phoneDisplay: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await currentTeamMember(ctx);
      if (member && member.cargo === "vendedor") throw new Error("Apenas administradores");
      const { connectNumberFromSignup } = await import("./whatsappMultiNumber");
      return connectNumberFromSignup(input);
    }),

  deleteInstance: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteWhatsappNumber } = await import("./whatsappMultiNumber");
      await deleteWhatsappNumber(input.id);
      return { success: true };
    }),
});

// ── Avaliação de vendedores / coaching de vendas com IA ───────────────────────
const performanceRouter = router({
  /** Lista de atendentes ativos (para o filtro). */
  attendants: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { teamMembers } = await import("../drizzle/schema");
    const rows = await db.select({ id: teamMembers.id, name: teamMembers.name, cargo: teamMembers.cargo })
      .from(teamMembers).where(eq(teamMembers.status, "ativo" as any));
    return rows;
  }),

  /** Instâncias/números disponíveis (para o filtro). */
  instances: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [] as string[];
    const { conversations } = await import("../drizzle/schema");
    const { isNotNull } = await import("drizzle-orm");
    const rows = await db.selectDistinct({ instanceName: conversations.instanceName })
      .from(conversations).where(isNotNull(conversations.instanceName));
    return rows.map(r => r.instanceName).filter((x): x is string => !!x);
  }),

  /** Ranking da equipe com nota + pilares + métricas no período. */
  overview: protectedProcedure
    .input(z.object({
      sinceDays: z.number().min(1).max(365).default(30),
      instanceName: z.string().optional(),
      memberId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const { computeTeamPerformance } = await import("./sellerPerformance");
      return computeTeamPerformance(input);
    }),

  /** Ranking POR INSTÂNCIA/número (em vez de por atendente). */
  overviewByInstance: protectedProcedure
    .input(z.object({ sinceDays: z.number().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const { computeInstancePerformance } = await import("./sellerPerformance");
      return computeInstancePerformance(input);
    }),

  /** Roda a avaliação qualitativa por IA de um vendedor e salva. */
  evaluate: protectedProcedure
    .input(z.object({
      memberId: z.number(),
      sinceDays: z.number().min(1).max(365).default(30),
      instanceName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { evaluateSeller } = await import("./sellerPerformance");
      const r = await evaluateSeller(input);
      if (!r) throw new Error("Não foi possível avaliar este vendedor.");
      return r;
    }),

  /** Avaliação por IA de uma instância/número. */
  evaluateInstance: protectedProcedure
    .input(z.object({ instanceName: z.string(), sinceDays: z.number().min(1).max(365).default(30) }))
    .mutation(async ({ input }) => {
      const { evaluateInstance } = await import("./sellerPerformance");
      const r = await evaluateInstance(input);
      if (!r) throw new Error("Não foi possível avaliar esta instância.");
      return r;
    }),

  /** Última avaliação de IA salva de uma instância. */
  lastInstanceEvaluation: protectedProcedure
    .input(z.object({ instanceName: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const { sellerEvaluations } = await import("../drizzle/schema");
      const { desc, and } = await import("drizzle-orm");
      const row = (await db.select().from(sellerEvaluations)
        .where(and(eq(sellerEvaluations.memberId, 0), eq(sellerEvaluations.instanceName, input.instanceName)))
        .orderBy(desc(sellerEvaluations.createdAt)).limit(1))[0];
      return row || null;
    }),

  /** Última avaliação salva de um vendedor (parecer da IA). */
  lastEvaluation: protectedProcedure
    .input(z.object({ memberId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const { sellerEvaluations } = await import("../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const row = (await db.select().from(sellerEvaluations)
        .where(eq(sellerEvaluations.memberId, input.memberId))
        .orderBy(desc(sellerEvaluations.createdAt)).limit(1))[0];
      return row || null;
    }),

  /** Chat interno: o gestor conversa com a IA sobre a performance da equipe. */
  chat: protectedProcedure
    .input(z.object({
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(30),
      sinceDays: z.number().min(1).max(365).default(30),
      instanceName: z.string().optional(),
      groupBy: z.enum(["member", "instance"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { performanceChat } = await import("./sellerPerformance");
      const reply = await performanceChat(input);
      return { reply };
    }),
});

// ─── Base de Conhecimento (FAQ para a IA — RAG leve) ──────────────────────────
const knowledgeBaseRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { knowledgeBase } = await import("../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    return db.select().from(knowledgeBase).orderBy(desc(knowledgeBase.updatedAt));
  }),

  create: protectedProcedure
    .input(z.object({
      category: z.string().min(1).max(100),
      title: z.string().min(1).max(255),
      content: z.string().min(1),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { knowledgeBase } = await import("../drizzle/schema");
      const result = await db.insert(knowledgeBase).values(input).returning();
      return result[0];
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      category: z.string().min(1).max(100).optional(),
      title: z.string().min(1).max(255).optional(),
      content: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { knowledgeBase } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { id, ...data } = input;
      await db.update(knowledgeBase).set({ ...data, updatedAt: new Date() }).where(eq(knowledgeBase.id, id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { knowledgeBase } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, input.id));
      return { success: true };
    }),
});

// ─── IA automática por conexão (canal/instância/número) ──────────────────────
const automationAiRouter = router({
  listConnections: protectedProcedure.query(async () => {
    const { getConnectionAiAuto, listEvolutionInstances, listZernioInstances } = await import("./db");
    const out: { key: string; type: string; label: string; aiAuto: boolean }[] = [];

    try {
      const evos = await listEvolutionInstances();
      for (const e of (evos || []) as any[]) {
        const key = `evolution:${e.instanceName}`;
        out.push({ key, type: "Evolution", label: e.displayName || e.instanceName, aiAuto: await getConnectionAiAuto(key) });
      }
    } catch { /* noop */ }

    try {
      const zs = await listZernioInstances();
      for (const zi of (zs || []) as any[]) {
        const key = `zernio:${zi.accountId}`;
        out.push({ key, type: "Zernio", label: zi.displayName || zi.phone || zi.accountId, aiAuto: await getConnectionAiAuto(key) });
      }
    } catch { /* noop */ }

    try {
      const { listWhatsappNumbers } = await import("./whatsappMultiNumber");
      const ns = await listWhatsappNumbers();
      for (const n of (ns || []) as any[]) {
        const key = `official:${n.phoneNumberId}`;
        out.push({ key, type: "Oficial", label: n.displayName || n.phoneDisplay || n.phoneNumberId, aiAuto: await getConnectionAiAuto(key) });
      }
    } catch { /* noop */ }

    for (const ch of ["instagram", "facebook"] as const) {
      const key = `meta:${ch}`;
      out.push({ key, type: "Meta", label: ch === "instagram" ? "Instagram" : "Facebook", aiAuto: await getConnectionAiAuto(key) });
    }

    return out;
  }),

  setConnectionAiAuto: adminProcedure
    .input(z.object({ key: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { upsertSetting, setConnectionConversationsAiActive } = await import("./db");
      await upsertSetting(`ai_auto:${input.key}`, String(input.enabled), ctx.user.id);
      // Efeito imediato: aplica também nas conversas abertas dessa conexão
      const affected = await setConnectionConversationsAiActive(input.key, input.enabled).catch(() => 0);
      return { success: true, affected };
    }),
});

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
  tokenHealth: tokenHealthRouter,
  vendor: vendorRouter,
  flow: flowRouter,
  agent: agentRouter,
  seller: sellerRouter,
  rescue: rescueRouter,
  reengagement: reengagementRouter,
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
