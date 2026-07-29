/**
 * Flow Engine — Motor de execução de fluxos de conversa.
 * Processa nós sequencialmente, envia mensagens interativas, e avança baseado nas respostas do cliente.
 */
import {
  getActiveChatFlows,
  listChatFlowNodes,
  listChatFlowEdges,
  getActiveFlowSession,
  createFlowSession,
  updateFlowSession,
  getChatFlowNodeById,
  getLeadByConversationId,
  upsertLead,
  updateLeadFunnelStatus,
  getNextSellerInQueue,
  createSellerAssignment,
  getStoreLocationByVehicleId,
  getDistinctStoreLocations,
  getVehicleById,
  listActiveFlowSessions,
  getConversationById,
  createMessage,
} from "./db";
import { sendTextMessage, sendReplyButtons, sendListMessage, sendImageMessage, sendContactCard, sendSellerNotification } from "./whatsapp";
import { getFlowSender } from "./flowChannelSender";
import { emitNewMessage } from "./socket";
import type { ChatFlowNode, ChatFlowEdge } from "../drizzle/schema";

// ─── Types ───────────────────────────────────────────────────
interface FlowContext {
  conversationId: number;
  phone: string;
  customerMessage: string;
  contactName?: string;
  leadData?: Record<string, any>;
  /**
   * Remetente por canal. Quando presente (Zernio, número oficial adicional, etc.),
   * o fluxo envia por aqui em vez de usar a Matriz oficial. Sem isso, usa o
   * número padrão (comportamento original).
   */
  sender?: {
    text: (body: string) => Promise<any>;
    image: (url: string, caption?: string) => Promise<any>;
    buttons?: (body: string, buttons: Array<{ id: string; title: string }>) => Promise<any>;
    list?: (body: string, buttonText: string, sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>) => Promise<any>;
  };
}

// Wrappers: roteiam o envio para o remetente do canal (se houver) ou para a Matriz.
function outText(ctx: FlowContext, body: string) {
  return ctx.sender ? ctx.sender.text(body) : sendTextMessage(ctx.phone, body);
}
function outImage(ctx: FlowContext, url: string, caption?: string) {
  return ctx.sender ? ctx.sender.image(url, caption) : sendImageMessage(ctx.phone, url, caption);
}
function outButtons(ctx: FlowContext, body: string, buttons: Array<{ id: string; title: string }>) {
  return ctx.sender?.buttons ? ctx.sender.buttons(body, buttons) : sendReplyButtons(ctx.phone, body, buttons);
}
function outList(ctx: FlowContext, body: string, buttonText: string, sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>) {
  return ctx.sender?.list ? ctx.sender.list(body, buttonText, sections) : sendListMessage(ctx.phone, body, buttonText, sections);
}

interface FlowResult {
  handled: boolean;           // true = flow handled the message, don't pass to AI
  responses: string[];        // Text messages sent
  imageMessages: Array<{      // Image messages sent (to save in DB)
    imageUrl: string;
    caption: string;
  }>;
  interactiveMessages: Array<{
    type: "buttons" | "list";
    data: any;
  }>;
  waitingForInput: boolean;   // true = flow is waiting for customer response
  flowCompleted: boolean;     // true = flow reached end node
}

// ─── Template Variables ──────────────────────────────────────
function replaceVariables(text: string, ctx: FlowContext): string {
  if (!text) return text;
  
  // Consolidar dados de troca em um formato legível
  const tradeDataParts: string[] = [];
  if (ctx.leadData?.tradeVehicle) tradeDataParts.push(`Veículo: ${ctx.leadData.tradeVehicle}`);
  if (ctx.leadData?.tradeYear) tradeDataParts.push(`Ano: ${ctx.leadData.tradeYear}`);
  if (ctx.leadData?.tradeKm) tradeDataParts.push(`KM: ${ctx.leadData.tradeKm}`);
  const tradeDataConsolidated = tradeDataParts.length > 0 ? tradeDataParts.join(" | ") : "";

  const clientName = ctx.contactName || ctx.leadData?.name || "cliente";
  const clientFullName = ctx.leadData?.fullName || ctx.leadData?.name || ctx.contactName || "";
  const clientPhone = ctx.phone || ctx.leadData?.phone || "";
  
  return text
    // Nome do cliente (Aliases: cliente_nome, cliente, nome)
    .replace(/\{\{cliente_nome\}\}/gi, clientName)
    .replace(/\{\{cliente\}\}/gi, clientName)
    .replace(/\{\{nome\}\}/gi, clientName)
    .replace(/\{\{nome_completo\}\}/gi, clientFullName)
    // Telefone (Aliases: cliente_telefone, telefone)
    .replace(/\{\{cliente_telefone\}\}/gi, clientPhone)
    .replace(/\{\{telefone\}\}/gi, clientPhone)
    // Veículo (Aliases: veiculo_interesse, veiculo)
    .replace(/\{\{veiculo_interesse\}\}/gi, ctx.leadData?.vehicleInterest || "")
    .replace(/\{\{veiculo\}\}/gi, ctx.leadData?.vehicleInterest || "")
    // Veículo de troca (Aliases: veiculo_troca, troca)
    .replace(/\{\{veiculo_troca\}\}/gi, ctx.leadData?.tradeVehicle || "")
    .replace(/\{\{troca\}\}/gi, ctx.leadData?.tradeVehicle || "")
    .replace(/\{\{troca_completa\}\}/gi, tradeDataConsolidated)
    // Forma de pagamento (Aliases: forma_pagamento, pagamento)
    .replace(/\{\{forma_pagamento\}\}/gi, ctx.leadData?.paymentMethod || "")
    .replace(/\{\{pagamento\}\}/gi, ctx.leadData?.paymentMethod || "")
    // Demais dados do lead
    .replace(/\{\{cidade\}\}/gi, ctx.leadData?.city || "")
    .replace(/\{\{entrada\}\}/gi, ctx.leadData?.downPayment || "")
    .replace(/\{\{email\}\}/gi, ctx.leadData?.email || "")
    .replace(/\{\{cpf\}\}/gi, ctx.leadData?.cpf || "")
    .replace(/\{\{data_nascimento\}\}/gi, ctx.leadData?.birthDate || "")
    .replace(/\{\{notas\}\}/gi, ctx.leadData?.notes || "")
    .replace(/\{\{etapa_funil\}\}/gi, ctx.leadData?.funnelStatus || "novo")
    .replace(/\{\{temperatura\}\}/gi, ctx.leadData?.temperature || "frio")
    .replace(/\{\{intencao\}\}/gi, ctx.leadData?.intention || "")
    .replace(/\{\{tentativa_resgate\}\}/gi, String(ctx.leadData?._rescueAttemptNumber || 1));
}

// ─── Avaliação de condições "Somente se" (grupos E/OU) ───────────────────────
// flow.conditions = array de grupos. Dentro do grupo, todas as condições precisam
// valer (E). Entre grupos, basta um valer (OU). Sem condições = sempre passa.
export async function evaluateFlowConditions(flow: any, conversationId: number): Promise<boolean> {
  const groups = flow?.conditions;
  if (!Array.isArray(groups) || groups.length === 0) return true;

  const conv = await getConversationById(conversationId);
  const lead: any = await getLeadByConversationId(conversationId).catch(() => null);

  let tags: string[] = [];
  try {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (db) {
      const { conversationLabels, labels } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select({ name: labels.name }).from(conversationLabels)
        .innerJoin(labels, eq(conversationLabels.labelId, labels.id))
        .where(eq(conversationLabels.conversationId, conversationId));
      tags = rows.map((r: any) => String(r.name).toLowerCase());
    }
  } catch { /* sem tags */ }

  const fields: Record<string, string> = {
    funnel_stage: String(lead?.funnelStatus || "").toLowerCase(),
    temperature: String(lead?.temperature || "").toLowerCase(),
    channel: String(conv?.channel || "").toLowerCase(),
    quality: String(lead?.quality || "").toLowerCase(),
    payment: String(lead?.paymentMethod || "").toLowerCase(),
    // Já comprou (fechou negócio) → cliente
    is_customer: (lead?.funnelStatus === "fechado") ? "sim" : "nao",
    // Já teve reabertura de ciclo → voltou / retornou
    is_returning: (Number((lead as any)?.reactivations || 0) > 0) ? "sim" : "nao",
  };

  const evalCond = (c: any): boolean => {
    const field = String(c?.field || "");
    const op = String(c?.op || "eq");
    const val = String(c?.value || "").toLowerCase();
    if (field === "tag") {
      const has = tags.includes(val);
      return op === "neq" ? !has : has;
    }
    const cur = fields[field] ?? "";
    return op === "neq" ? cur !== val : cur === val;
  };

  for (const group of groups) {
    if (Array.isArray(group) && group.length > 0 && group.every(evalCond)) return true;
  }
  return false;
}

// ─── Find Matching Flow ──────────────────────────────────────
export async function findMatchingFlow(
  conversationId: number,
  customerMessage: string,
  isFirstContact: boolean,
  hasVehicleId: boolean,
): Promise<number | null> {
  const conv = await getConversationById(conversationId);
  if (!conv) return null;

  const { getActiveFlowsForConnection } = await import("./db");
  const activeFlows = await getActiveFlowsForConnection({
    connectionType: conv.connectionType,
    connectionId: conv.connectionId,
    instanceName: conv.instanceName,
    channel: conv.channel,
  });

  console.log(`[FlowEngine] findMatchingFlow conv=${conversationId} channel=${conv.channel} instance=${conv.instanceName} connType=${conv.connectionType} → ${activeFlows.length} fluxo(s) ativo(s) nesta conexão`);
  if (activeFlows.length === 0) return null;

  for (const flow of activeFlows) {
    let triggerMatched = false;
    switch (flow.trigger) {
      case "first_contact":
        triggerMatched = isFirstContact;
        break;
      case "keyword": {
        const keywords = (flow.triggerValue || "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
        const msgLower = customerMessage.toLowerCase();
        triggerMatched = keywords.some(kw => msgLower.includes(kw));
        break;
      }
      case "ad_click":
        triggerMatched = hasVehicleId;
        break;
      case "category_interest": {
        const categories = (flow.triggerValue || "").split(",").map(c => c.trim().toLowerCase()).filter(Boolean);
        const msgLower = customerMessage.toLowerCase();
        triggerMatched = categories.some(cat => msgLower.includes(cat));
        break;
      }
      // manual, reactivation e gatilhos de CRM disparam por outros caminhos
    }
    if (triggerMatched && await evaluateFlowConditions(flow, conversationId)) return flow.id;
  }
  return null;
}

// ─── Process Flow Step ───────────────────────────────────────
export async function processFlowMessage(ctx: FlowContext): Promise<FlowResult> {
  const result: FlowResult = {
    handled: false,
    responses: [],
    imageMessages: [],
    interactiveMessages: [],
    waitingForInput: false,
    flowCompleted: false,
  };

  if (!ctx.sender) {
    try {
      const { resolveChannelSender } = await import("./channelAdapter");
      ctx.sender = await resolveChannelSender(ctx.conversationId);
    } catch (err) {
      console.error("[FlowEngine] Failed to resolve channel sender in processFlowMessage:", err);
    }
  }

  // Always load lead data so variables work in all nodes
  try {
    const existingLead = await getLeadByConversationId(ctx.conversationId);
    if (existingLead) {
      ctx.leadData = existingLead;
      if (existingLead.name && !ctx.contactName) {
        ctx.contactName = existingLead.name;
      }
    }
  } catch (err) {
    console.error(`[FlowEngine] Failed to load lead data:`, err);
  }

  // Check for active session
  let session = await getActiveFlowSession(ctx.conversationId);

  if (!session) {
    // Guarda anti-interrupção: não inicia um fluxo novo se um humano está atendendo
    // (conversa atribuída a alguém e IA desligada). Sessões já ativas continuam.
    const convForGuard = await getConversationById(ctx.conversationId);
    if (convForGuard && convForGuard.assignedTo && !convForGuard.aiActive) {
      return result;
    }

    // Check if a flow should be triggered
    const lead = await getLeadByConversationId(ctx.conversationId);
    const isFirstContact = !lead;
    const vehicleIdMatch = ctx.customerMessage.match(/\bID\s*:?\s*(\d+)\b/i);
    const hasVehicleId = !!vehicleIdMatch;
    const extractedVehicleId = vehicleIdMatch ? parseInt(vehicleIdMatch[1]) : null;

    const flowId = await findMatchingFlow(
      ctx.conversationId,
      ctx.customerMessage,
      isFirstContact,
      hasVehicleId,
    );

    if (!flowId) return result; // No matching flow

    // Start new session
    const nodes = await listChatFlowNodes(flowId);
    const startNode = nodes.find(n => n.nodeType === "start");
    if (!startNode) return result;

    // Save extracted vehicleId in session context so vehicle_presentation can use it
    const sessionContext: Record<string, any> = {};
    if (extractedVehicleId) {
      sessionContext.vehicleId = extractedVehicleId;
      console.log(`[FlowEngine] Extracted vehicleId=${extractedVehicleId} from message, saving to session context`);
      // Also update the lead's vehicleId and vehicleInterest so it's always fresh
      try {
        const linkedVehicle = await getVehicleById(extractedVehicleId);
        const vehicleTitle = linkedVehicle
          ? (linkedVehicle.title || `${linkedVehicle.brand || ""} ${linkedVehicle.model || ""}`.trim())
          : undefined;
        await upsertLead({
          conversationId: ctx.conversationId,
          phone: ctx.phone,
          vehicleId: extractedVehicleId,
          ...(vehicleTitle ? { vehicleInterest: vehicleTitle } : {}),
        });
        if (vehicleTitle) {
          console.log(`[FlowEngine] Auto-synced vehicleInterest to "${vehicleTitle}" from vehicleId=${extractedVehicleId}`);
        }
      } catch (err) {
        console.error(`[FlowEngine] Failed to update lead vehicleId:`, err);
      }
    }

    const sessionId = await createFlowSession({
      conversationId: ctx.conversationId,
      flowId,
      currentNodeId: startNode.id,
      status: "active",
      context: sessionContext,
    });

    session = {
      id: sessionId,
      conversationId: ctx.conversationId,
      flowId,
      currentNodeId: startNode.id,
      status: "active",
      context: sessionContext,
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    };
  }

  // Load flow data
  const nodes = await listChatFlowNodes(session.flowId);
  const edges = await listChatFlowEdges(session.flowId);

  // Get current node
  const currentNode = nodes.find(n => n.id === session!.currentNodeId);
  if (!currentNode) {
    await updateFlowSession(session.id, { status: "completed" });
    return result;
  }

  result.handled = true;

  // If current node is waiting for input (buttons/list), match the response
  if (currentNode.nodeType === "send_buttons" || currentNode.nodeType === "send_list") {
    const nextNodeId = matchResponseToEdge(currentNode, edges, ctx.customerMessage);
    if (nextNodeId) {
      // Advance to next node and execute it
      await executeFromNode(nextNodeId, nodes, edges, session, ctx, result);
    } else {
      // Cliente digitou texto livre em vez de clicar. Comportamento configurável:
      //  - onInvalid "ai": passa o texto para a IA interpretar (não trava)
      //  - onInvalid "repeat" (padrão): reenvia com mensagem personalizável, até
      //    maxInvalidRetries; ao estourar, cai para a IA.
      // (Rotear para outro nó já é possível ligando a saída "default" no editor.)
      const config = (currentNode.data as any) || {};
      const sessionCtx = (session.context as any) || {};
      const invalidKey = `invalidCount_${currentNode.id}`;
      const invalidCount = (sessionCtx[invalidKey] || 0) + 1;
      const maxRetries = config.maxInvalidRetries ?? 3;
      const onInvalid = config.onInvalid || "repeat";

      if (onInvalid === "ai" || invalidCount > maxRetries) {
        await updateFlowSession(session.id, { context: { ...sessionCtx, [invalidKey]: 0 } });
        result.handled = false; // deixa a IA interpretar o texto livre
        console.log(`[FlowEngine] entrada inesperada → IA (count=${invalidCount}, onInvalid=${onInvalid})`);
        return result;
      }

      await updateFlowSession(session.id, { context: { ...sessionCtx, [invalidKey]: invalidCount } });
      const defaultMsg = currentNode.nodeType === "send_buttons"
        ? "☝️ Por favor, toque em uma das opções abaixo para continuar:"
        : "☝️ Por favor, selecione uma das opções da lista para continuar:";
      const retryMsg = replaceVariables(config.invalidMessage || defaultMsg, ctx);
      await outText(ctx, retryMsg);
      result.responses.push(retryMsg);

      if (currentNode.nodeType === "send_buttons") {
        const body = replaceVariables(config.body || "", ctx);
        const buttons = (config.buttons || []).map((b: any, i: number) => ({
          id: `flow_btn_${currentNode.id}_${i}`,
          title: replaceVariables(b.text || `Opção ${i + 1}`, ctx).substring(0, 20),
        }));
        if (body && buttons.length > 0) await outButtons(ctx, body, buttons);
      } else if (currentNode.nodeType === "send_list") {
        const body = replaceVariables(config.body || "", ctx);
        const buttonText = config.buttonText || "Ver Opções";
        const sections = (config.sections || []).map((s: any) => ({
          title: replaceVariables(s.title || "", ctx),
          rows: (s.rows || []).map((r: any, i: number) => ({
            id: `flow_row_${currentNode.id}_${i}`,
            title: replaceVariables(r.title || "", ctx).substring(0, 24),
            description: replaceVariables(r.description || "", ctx).substring(0, 72),
          })),
        }));
        if (body && sections.length > 0) await outList(ctx, body, buttonText, sections);
      }

      result.waitingForInput = true;
      console.log(`[FlowEngine] Button/list re-prompt (${invalidCount}/${maxRetries}): texto livre "${ctx.customerMessage}"`);
    }
    return result;
  }

  // For start node, find the next node and execute
  if (currentNode.nodeType === "start") {
    const nextEdge = edges.find(e => e.sourceNodeId === currentNode.id);
    if (nextEdge) {
      await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result);
    }
    return result;
  }

  // For ai_response node - let AI handle, it will continue via continueFlowAfterAI
  if (currentNode.nodeType === "ai_response") {
    result.handled = false; // Pass to AI
    return result;
  }

  // For wait_input node - customer responded with free text
  if (currentNode.nodeType === "wait_input") {
    const sessionCtx = (session.context as any) || {};
    const variable = sessionCtx.waitInputVariable;
    const nodeConfig = (currentNode.data as any) || {};
    
    // Timeout de agrupamento: aguarda X segundos após a última mensagem antes de avançar
    const groupTimeout = (nodeConfig.groupTimeoutSeconds || 0) * 1000; // 0 = desativado (avança imediato)
    
    if (groupTimeout > 0) {
      // === MODO AGRUPAMENTO: acumula mensagens até o timeout expirar ===
      const collectedMessages: string[] = sessionCtx.waitInputCollectedMessages || [];
      collectedMessages.push(ctx.customerMessage);
      const now = Date.now();
      
      // Salvar mensagens acumuladas e timestamp no contexto da sessão
      await updateFlowSession(session.id, {
        context: {
          ...sessionCtx,
          waitInputCollectedMessages: collectedMessages,
          waitInputLastMessageAt: now,
        },
      });
      
      console.log(`[FlowEngine] wait_input grouping: collected ${collectedMessages.length} message(s), waiting ${groupTimeout}ms for more...`);
      
      // Agendar verificação após o timeout
      // Usamos o padrão de "verificar após timeout" - se nenhuma nova mensagem chegou, avançar
      setTimeout(async () => {
        try {
          // Recarregar sessão para verificar se houve novas mensagens
          const freshSession = await getActiveFlowSession(ctx.conversationId);
          if (!freshSession || freshSession.id !== session.id) return; // sessão mudou
          
          const freshCtx = (freshSession.context as any) || {};
          const lastMsgAt = freshCtx.waitInputLastMessageAt || 0;
          
          // Se o timestamp da última mensagem é o mesmo que salvamos, significa que não chegou nova mensagem
          // Então podemos avançar
          if (lastMsgAt !== now) {
            console.log(`[FlowEngine] wait_input grouping: new message arrived since timeout was set, skipping advance`);
            return; // Nova mensagem chegou, outro timeout vai ser criado
          }
          
          const allMessages = freshCtx.waitInputCollectedMessages || [];
          const groupedMessage = allMessages.join("\n");
          
          console.log(`[FlowEngine] wait_input grouping: timeout expired, advancing with ${allMessages.length} grouped message(s)`);
          
          // Salvar a resposta agrupada no lead
          if (variable && groupedMessage) {
            try {
              const fieldMap: Record<string, string> = {
                nome: "name", name: "name",
                nome_completo: "fullName", fullName: "fullName",
                cidade: "city", city: "city",
                veiculo_troca: "tradeVehicle", tradeVehicle: "tradeVehicle",
                pagamento: "paymentMethod", paymentMethod: "paymentMethod",
                entrada: "downPayment", downPayment: "downPayment",
                veiculo_interesse: "vehicleInterest", vehicleInterest: "vehicleInterest",
                notas: "notes", notes: "notes",
                email: "email",
                cpf: "cpf",
                data_nascimento: "birthDate", birthDate: "birthDate",
              };
              const leadField = fieldMap[variable] || variable;
              const validFields = ["name","fullName","city","tradeVehicle","paymentMethod","downPayment","vehicleInterest","notes","email","cpf","birthDate"];
              if (validFields.includes(leadField)) {
                await upsertLead({
                  conversationId: ctx.conversationId,
                  phone: ctx.phone,
                  [leadField]: groupedMessage,
                } as any);
                console.log(`[FlowEngine] Saved grouped wait_input to lead.${leadField}: "${groupedMessage.substring(0, 100)}..."`);
              }
            } catch (err) {
              console.error(`[FlowEngine] Failed to save grouped wait_input response:`, err);
            }
          }
          
          // Limpar contexto de agrupamento e avançar
          const cleanCtx = { ...freshCtx };
          delete cleanCtx.waitInputVariable;
          delete cleanCtx.waitInputLabel;
          delete cleanCtx.waitInputCollectedMessages;
          delete cleanCtx.waitInputLastMessageAt;
          await updateFlowSession(session.id, { context: cleanCtx });
          
          // Avançar para o próximo nó
          const freshNodes = await listChatFlowNodes(freshSession.flowId);
          const freshEdges = await listChatFlowEdges(freshSession.flowId);
          const nextEdge = freshEdges.find(e => e.sourceNodeId === currentNode.id);
          if (nextEdge) {
            const advanceCtx: FlowContext = {
              ...ctx,
              customerMessage: groupedMessage,
            };
            const advanceResult: FlowResult = {
              handled: true,
              responses: [],
              imageMessages: [],
              interactiveMessages: [],
              waitingForInput: false,
              flowCompleted: false,
            };
            await executeFromNode(nextEdge.targetNodeId, freshNodes, freshEdges, freshSession, advanceCtx, advanceResult);
            
            // Emitir respostas do fluxo (importar funções necessárias inline)
            // As mensagens já foram enviadas pelo WhatsApp dentro do executeFromNode
            // Precisamos salvar no banco e emitir via socket
            const { createMessage, getConversationById } = await import("./db");
            const { emitNewMessage } = await import("./socket");
            
            for (const response of advanceResult.responses) {
              const botMsg = await createMessage({
                conversationId: ctx.conversationId,
                content: response,
                senderType: "bot",
                senderName: "Auto Inova - Matriz IA",
                messageType: "text",
              });
              emitNewMessage(ctx.conversationId, botMsg);
            }
            // Save image messages to DB
            for (const img of advanceResult.imageMessages) {
              const imgMsg = await createMessage({
                conversationId: ctx.conversationId,
                content: img.caption || "[Imagem]",
                senderType: "bot",
                senderName: "Auto Inova - Matriz IA",
                messageType: "image",
                metadata: { mediaUrl: img.imageUrl, caption: img.caption },
              });
              emitNewMessage(ctx.conversationId, imgMsg);
            }
            for (const im of advanceResult.interactiveMessages) {
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
                conversationId: ctx.conversationId,
                content,
                senderType: "bot",
                senderName: "Auto Inova - Matriz IA",
                messageType: "text",
                metadata: interactiveMetadata,
              });
              emitNewMessage(ctx.conversationId, flowInteractiveMsg);
            }
          }
        } catch (err) {
          console.error(`[FlowEngine] wait_input grouping timeout error:`, err);
        }
      }, groupTimeout);
      
      // Retornar como "handled" mas sem avançar - estamos acumulando
      result.handled = true;
      result.waitingForInput = true;
      return result;
    }
    
    // === MODO IMEDIATO (padrão): avança na primeira mensagem ===
    // Save the customer's response to lead data if variable is specified
    if (variable && ctx.customerMessage) {
      try {
        // Map variable names to lead fields
        const fieldMap: Record<string, string> = {
          nome: "name", name: "name",
          nome_completo: "fullName", fullName: "fullName",
          cidade: "city", city: "city",
          veiculo_troca: "tradeVehicle", tradeVehicle: "tradeVehicle",
          pagamento: "paymentMethod", paymentMethod: "paymentMethod",
          entrada: "downPayment", downPayment: "downPayment",
          veiculo_interesse: "vehicleInterest", vehicleInterest: "vehicleInterest",
          notas: "notes", notes: "notes",
          email: "email",
          cpf: "cpf",
          data_nascimento: "birthDate", birthDate: "birthDate",
        };
        const leadField = fieldMap[variable] || variable;
        const validFields = ["name","fullName","city","tradeVehicle","paymentMethod","downPayment","vehicleInterest","notes","email","cpf","birthDate"];
        if (validFields.includes(leadField)) {
          await upsertLead({
            conversationId: ctx.conversationId,
            phone: ctx.phone,
            [leadField]: ctx.customerMessage,
          } as any);
          console.log(`[FlowEngine] Saved wait_input response to lead.${leadField}: "${ctx.customerMessage}"`);
        }
      } catch (err) {
        console.error(`[FlowEngine] Failed to save wait_input response:`, err);
      }
    }

    // Clear wait context and advance to next node
    const newCtx = { ...sessionCtx };
    delete newCtx.waitInputVariable;
    delete newCtx.waitInputLabel;
    delete newCtx.waitInputCollectedMessages;
    delete newCtx.waitInputLastMessageAt;
    await updateFlowSession(session.id, { context: newCtx });

    // Find next edge and continue
    const nextEdge = edges.find(e => e.sourceNodeId === currentNode.id);
    if (nextEdge) {
      await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result);
    }
    return result;
  }

  // Nó "Coletar com IA": cliente respondeu → reavalia o que falta e decide
  if (currentNode.nodeType === "collect_with_ai") {
    return handleCollectStep(currentNode, edges, nodes, session, ctx, result, true);
  }

  // For condition node waiting for input
  if (currentNode.nodeType === "condition") {
    const condResult = evaluateCondition(currentNode, ctx);
    const handle = condResult ? "yes" : "no";
    const nextEdge = edges.find(e => e.sourceNodeId === currentNode.id && e.sourceHandle === handle);
    if (nextEdge) {
      await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result);
    }
    return result;
  }

  return result;
}

// ─── Continue Flow After AI ─────────────────────────────────
/**
 * After AI responds in an ai_response node, call this to continue the flow
 * from the pendingNextNodeId stored in the session context.
 */
export async function continueFlowAfterAI(conversationId: number, ctx: FlowContext): Promise<FlowResult> {
  const result: FlowResult = {
    handled: false,
    responses: [],
    imageMessages: [],
    interactiveMessages: [],
    waitingForInput: false,
    flowCompleted: false,
  };

  if (!ctx.sender) {
    try {
      const { resolveChannelSender } = await import("./channelAdapter");
      ctx.sender = await resolveChannelSender(conversationId);
    } catch (err) {
      console.error("[FlowEngine] Failed to resolve channel sender in continueFlowAfterAI:", err);
    }
  }

  // Load lead data so variables work
  try {
    const lead = await getLeadByConversationId(conversationId);
    if (lead) {
      ctx.leadData = lead;
      if (lead.name && !ctx.contactName) ctx.contactName = lead.name;
    }
  } catch (err) {
    console.error(`[FlowEngine] Failed to load lead data in continueFlowAfterAI:`, err);
  }

  const session = await getActiveFlowSession(conversationId);
  if (!session) return result;

  const sessionCtx = (session.context as any) || {};
  const pendingNextNodeId = sessionCtx.pendingNextNodeId;
  if (!pendingNextNodeId) return result;

  // Clear the pending flag
  const newContext = { ...sessionCtx };
  delete newContext.pendingNextNodeId;
  await updateFlowSession(session.id, { context: newContext });

  // Load flow data and execute from the pending node
  const nodes = await listChatFlowNodes(session.flowId);
  const edges = await listChatFlowEdges(session.flowId);

  result.handled = true;
  await executeFromNode(pendingNextNodeId, nodes, edges, session, ctx, result);
  return result;
}

// ─── Execute From Node ───────────────────────────────────────
// Nó "Coletar com IA": a IA pede os campos que faltam e insiste; ao completar OU
// esgotar as tentativas, avança (com o que coletou). Chamado na 1ª entrada
// (isResume=false) e a cada resposta do cliente (isResume=true).
async function handleCollectStep(
  node: ChatFlowNode,
  edges: ChatFlowEdge[],
  nodes: ChatFlowNode[],
  session: { id: number; conversationId: number; flowId: number; context: any },
  ctx: FlowContext,
  result: FlowResult,
  isResume: boolean,
): Promise<FlowResult> {
  const cfg = (node.data as any) || {};
  const fields: { key: string; label: string }[] = Array.isArray(cfg.fields) ? cfg.fields : [];
  const lead: any = await getLeadByConversationId(ctx.conversationId).catch(() => null);
  const missing = fields.filter(f => f && f.key && !(lead && lead[f.key]));
  const sctx = (session.context as any) || {};
  const attempts = isResume ? (Number(sctx.collectAttempts || 0) + 1) : 1;
  const maxAttempts = Number(cfg.maxAttempts ?? 4);

  // Completou tudo OU esgotou tentativas → avança (com o que tiver)
  if (fields.length === 0 || missing.length === 0 || attempts > maxAttempts) {
    const clean = { ...sctx };
    delete clean.collectAttempts; delete clean.aiInstruction; delete clean.nodeAgentId;
    await updateFlowSession(session.id, { context: clean });
    if (missing.length > 0) {
      console.log(`[FlowEngine] collect_with_ai: avançando parcial (faltou: ${missing.map(m => m.label).join(", ")})`);
    }
    const nextEdge = edges.find(e => e.sourceNodeId === node.id && (e.sourceHandle === "default" || !e.sourceHandle));
    if (nextEdge) await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result);
    else await updateFlowSession(session.id, { status: "completed" });
    return result;
  }

  // Ainda falta dado → a IA pede/insiste (e extrai a resposta no turno da IA)
  const base = cfg.instruction || "Colete os dados abaixo do cliente de forma cordial, uma pergunta por vez. Se ele desviar do assunto, retome educadamente pedindo o que ainda falta.";
  const instr = `${base}\nDADOS QUE AINDA FALTAM: ${missing.map(m => m.label).join(", ")}.`;
  await updateFlowSession(session.id, {
    currentNodeId: node.id,
    context: { ...sctx, collectAttempts: attempts, aiInstruction: instr, nodeAgentId: cfg.agentId || null, pendingNextNodeId: null, waitingSince: Date.now() },
  });
  try { const { updateConversation } = await import("./db"); await updateConversation(ctx.conversationId, { aiActive: true, routingState: "ai_agent" } as any); } catch { /* noop */ }
  result.handled = false; // passa pra IA pedir e extrair os dados
  result.waitingForInput = true;
  return result;
}

async function executeFromNode(
  nodeId: number,
  nodes: ChatFlowNode[],
  edges: ChatFlowEdge[],
  session: { id: number; conversationId: number; flowId: number; context: any },
  ctx: FlowContext,
  result: FlowResult,
  depth = 0,
): Promise<void> {
  if (depth > 20) return; // Prevent infinite loops

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;

  // Always reload lead data from DB so variables are up-to-date
  try {
    const freshLead = await getLeadByConversationId(ctx.conversationId);
    if (freshLead) {
      ctx.leadData = freshLead;
      // Also update contactName from lead if available
      if (freshLead.name && !ctx.contactName) {
        ctx.contactName = freshLead.name;
      }
    }
  } catch (err) {
    console.error(`[FlowEngine] Failed to reload lead data:`, err);
  }

  const config = (node.data as any) || {};

  switch (node.nodeType) {
    case "send_message": {
      const text = replaceVariables(config.text || "", ctx);
      if (text) {
        await outText(ctx, text);
        result.responses.push(text);
      }
      // Auto-advance to next node
      const nextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (nextEdge) {
        await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "send_buttons": {
      const body = replaceVariables(config.body || "", ctx);
      const buttons = (config.buttons || []).map((b: any, i: number) => ({
        id: `flow_btn_${node.id}_${i}`,
        title: replaceVariables(b.text || `Opção ${i + 1}`, ctx).substring(0, 20),
      }));
      if (body && buttons.length > 0) {
        await outButtons(ctx, body, buttons);
        result.interactiveMessages.push({ type: "buttons", data: { body, buttons } });
      }
      // Aguarda resposta do cliente — registra o início da espera p/ o lembrete de sem-resposta
      await updateFlowSession(session.id, { currentNodeId: node.id, context: { ...((session.context as any) || {}), waitingSince: Date.now(), noReplyAttempts: 0 } });
      result.waitingForInput = true;
      break;
    }

    case "send_list": {
      const body = replaceVariables(config.body || "", ctx);
      const buttonText = config.buttonText || "Ver Opções";
      const sections = (config.sections || []).map((s: any) => ({
        title: replaceVariables(s.title || "", ctx),
        rows: (s.rows || []).map((r: any, i: number) => ({
          id: `flow_row_${node.id}_${i}`,
          title: replaceVariables(r.title || "", ctx).substring(0, 24),
          description: replaceVariables(r.description || "", ctx).substring(0, 72),
        })),
      }));
      if (body && sections.length > 0) {
        await outList(ctx, body, buttonText, sections);
        result.interactiveMessages.push({ type: "list", data: { body, buttonText, sections } });
      }
      // Aguarda resposta — registra início da espera p/ o lembrete de sem-resposta
      await updateFlowSession(session.id, { currentNodeId: node.id, context: { ...((session.context as any) || {}), waitingSince: Date.now(), noReplyAttempts: 0 } });
      result.waitingForInput = true;
      break;
    }

    case "send_image": {
      const imageUrl = config.imageUrl || "";
      const caption = replaceVariables(config.caption || "", ctx);
      if (imageUrl) {
        await outImage(ctx, imageUrl, caption);
        result.imageMessages.push({ imageUrl, caption: caption || "[Imagem]" });
      }
      const nextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (nextEdge) {
        await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "condition": {
      const condResult = evaluateCondition(node, ctx);
      const handle = condResult ? "yes" : "no";
      const nextEdge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === handle);
      if (nextEdge) {
        await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "classify_intent": {
      // IA classifica a intenção da mensagem e roteia pela edge com o handle
      // igual à categoria. Config: { categories: ["compra","pos_venda","informacao","financeiro","outro"] }
      const categories: string[] = (config.categories && config.categories.length > 0)
        ? config.categories
        : ["compra", "pos_venda", "informacao", "financeiro", "outro"];
      const recent = ctx.customerMessage || "";
      let intent = categories[categories.length - 1]; // fallback = última (ex.: "outro")
      try {
        const { invokeAgentLLM: classifyLLM } = await import("./openaiLLM");
        const resp = await classifyLLM({
          messages: [
            { role: "system", content: `Você classifica a intenção de uma mensagem de um cliente de concessionária de veículos. Responda APENAS com UMA palavra, exatamente uma destas opções: ${categories.join(", ")}.
Guia: "compra" = interesse em comprar/ver um veículo, preço, disponibilidade. "pos_venda" = já é cliente, garantia, revisão, problema no carro comprado, documentação. "informacao" = horário, endereço, dúvida geral. "financeiro" = financiamento, entrada, simulação, parcelas. "outro" = qualquer coisa fora disso.` },
            { role: "user", content: recent || "(sem texto)" },
          ],
        });
        const raw = resp.choices?.[0]?.message?.content;
        const answer = (typeof raw === "string" ? raw : "").toLowerCase().trim();
        const found = categories.find(c => answer.includes(c.toLowerCase()));
        if (found) intent = found;
        console.log(`[FlowEngine] classify_intent: "${recent.substring(0, 40)}" → ${intent}`);
      } catch (err) {
        console.error("[FlowEngine] classify_intent falhou:", err);
      }
      // Salva a intenção no contexto do lead/sessão
      await updateFlowSession(session.id, { context: { ...((session.context as any) || {}), intent } });
      const intentEdge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === intent)
        || edges.find(e => e.sourceNodeId === node.id); // fallback: primeira edge
      if (intentEdge) {
        await executeFromNode(intentEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "business_hours": {
      // Verifica se AGORA (horário de Brasília) está dentro do expediente.
      // Config: { schedule: { "1": [["08:30","11:30"],["13:00","18:00"]], "6": [["08:30","12:00"]], ... } }
      // chave = dia da semana (0=dom ... 6=sáb). Roteia handle "dentro" | "fora".
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const dow = String(now.getDay());
      const mins = now.getHours() * 60 + now.getMinutes();
      const schedule: Record<string, [string, string][]> = config.schedule || {};
      const ranges = schedule[dow] || [];
      const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
      const isOpen = ranges.some(([a, b]) => mins >= toMin(a) && mins <= toMin(b));
      const handle = isOpen ? "dentro" : "fora";
      console.log(`[FlowEngine] business_hours: ${now.toLocaleString("pt-BR")} → ${handle}`);
      const hoursEdge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === handle)
        || edges.find(e => e.sourceNodeId === node.id);
      if (hoursEdge) {
        await executeFromNode(hoursEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "notify_number": {
      // Envia os dados coletados do lead para um número fixo (ex.: pós-venda).
      // Config: { number: "5551...", template: "..." }
      const targetNumber = (config.number || "").replace(/\D/g, "");
      if (targetNumber) {
        const lead = ctx.leadData || {};
        const body = (config.template
          ? replaceVariables(config.template, ctx)
          : `🔔 Novo contato de ${config.label || "atendimento"}\n\nCliente: ${ctx.contactName || lead.name || "—"}\nTelefone: ${ctx.phone}\nAssunto: ${(lead as any).intention || ctx.customerMessage || "—"}`);
        try {
          await sendTextMessage(targetNumber, body);
          console.log(`[FlowEngine] notify_number: enviado para ${targetNumber}`);
        } catch (err) {
          console.error("[FlowEngine] notify_number falhou:", err);
        }
      }
      const nextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (nextEdge) {
        await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "ai_response": {
      // Let AI handle this message - stop flow execution temporarily
      result.handled = false; // Pass to AI
      // O fluxo chamou a IA: garante que ela responda mesmo com IA automática da conexão desligada
      try { const { updateConversation } = await import("./db"); await updateConversation(ctx.conversationId, { aiActive: true, routingState: "ai_agent" } as any); } catch { /* noop */ }
      // Store instruction + pendingNextNodeId + node agentId in session context
      const nextEdge = edges.find(e => e.sourceNodeId === node.id);
      await updateFlowSession(session.id, {
        currentNodeId: node.id,
        context: {
          ...((session.context as any) || {}),
          aiInstruction: config.instruction || "",
          nodeAgentId: config.agentId || null,
          pendingNextNodeId: nextEdge?.targetNodeId || null,
        },
      });
      break;
    }

    case "wait_input": {
      // Send prompt message if configured
      const promptText = replaceVariables(config.promptText || "", ctx);
      if (promptText) {
        await outText(ctx, promptText);
        result.responses.push(promptText);
      }
      // Wait for customer response - store which variable to save the response to
      // Also store groupTimeoutSeconds for message grouping
      await updateFlowSession(session.id, {
        currentNodeId: node.id,
        context: {
          ...((session.context as any) || {}),
          waitInputVariable: config.variable || null,
          waitInputLabel: config.label || "resposta",
          waitInputCollectedMessages: [], // Reset collected messages
          waitInputLastMessageAt: null,
        },
      });
      result.waitingForInput = true;
      break;
    }

    case "collect_with_ai": {
      await handleCollectStep(node, edges, nodes, session, ctx, result, false);
      break;
    }

    case "update_lead": {
      const field = config.field;
      const value = replaceVariables(config.value || "", ctx);
      if (field) {
        const updateData: Record<string, any> = {};
        if (field === "status") updateData.status = value;
        else if (field === "vehicleInterest") updateData.vehicleInterest = value;
        else if (field === "hasTrade") updateData.hasTrade = value === "true" || value === "sim";
        else if (field === "tradeVehicle") updateData.tradeVehicle = value;
        else if (field === "tradeYear") updateData.tradeYear = parseInt(value) || null;
        else if (field === "tradeKm") updateData.tradeKm = parseInt(value) || null;
        else if (field === "tradeDataConsolidated") {
          // Parse consolidated trade data (format: "Veículo: X | Ano: Y | KM: Z")
          updateData.notes = (updateData.notes || "") + (updateData.notes ? "\n" : "") + `Troca: ${value}`;
        }
        else if (field === "paymentMethod") updateData.paymentMethod = value;
        else if (field === "intention") updateData.intention = value;
        else if (field === "notes") updateData.notes = value;

        await upsertLead({
          conversationId: ctx.conversationId,
          phone: ctx.phone,
          ...updateData,
        });
      }
      const nextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (nextEdge) {
        await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "assign_agent": {
      // Mark as needing human attention
      result.responses.push("Transferindo para um atendente humano...");
      await updateFlowSession(session.id, { status: "paused" });
      break;
    }

    case "delay": {
      const seconds = config.seconds || 3;
      // In production, we'd use a job queue. For now, simple timeout.
      await new Promise(resolve => setTimeout(resolve, Math.min(seconds, 10) * 1000));
      const nextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (nextEdge) {
        await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "end": {
      await updateFlowSession(session.id, { status: "completed", completedAt: new Date() });
      result.flowCompleted = true;
      break;
    }

    case "assign_seller": {
      /**
       * Atribuir vendedor da fila (rodízio por loja).
       * config.storeLocation: loja específica (opcional, pode ser "auto" para detectar pelo veículo)
       * config.message: mensagem personalizada para o cliente
       * config.sendContact: se deve enviar o cartão de contato do vendedor (default: true)
       */
      let storeLocation = config.storeLocation || "auto";

      // Se "auto", tentar detectar a loja pelo veículo no contexto do lead
      if (storeLocation === "auto") {
        const lead = await getLeadByConversationId(ctx.conversationId);

        // 1. Prioridade: usar vehicleId gravado no lead pela IA (atualizar_lead com veiculo_id)
        if (lead?.vehicleId) {
          const detectedStore = await getStoreLocationByVehicleId(lead.vehicleId);
          if (detectedStore) {
            storeLocation = detectedStore;
            console.log(`[FlowEngine] assign_seller: detected store "${storeLocation}" from lead.vehicleId=${lead.vehicleId}`);
          }
        }

        // 2. Fallback: tentar extrair ID do texto de vehicleInterest (ex: "Hilux 2012 [ID:42]")
        if (storeLocation === "auto") {
          const vehicleInterest = lead?.vehicleInterest || ctx.leadData?.vehicleInterest || "";
          const vehicleIdMatch = vehicleInterest.match(/ID\s*:?\s*(\d+)/i);
          if (vehicleIdMatch) {
            const vehicleId = parseInt(vehicleIdMatch[1]);
            const detectedStore = await getStoreLocationByVehicleId(vehicleId);
            if (detectedStore) {
              storeLocation = detectedStore;
              console.log(`[FlowEngine] assign_seller: detected store "${storeLocation}" from vehicleInterest text ID=${vehicleId}`);
            }
          }
        }

        // 3. Fallback: verificar session context (pode ter sido setado por outro nó)
        const sessionCtx = (session.context as any) || {};
        if (storeLocation === "auto" && sessionCtx.vehicleId) {
          const detectedStore = await getStoreLocationByVehicleId(sessionCtx.vehicleId);
          if (detectedStore) {
            storeLocation = detectedStore;
            console.log(`[FlowEngine] assign_seller: detected store "${storeLocation}" from session.vehicleId=${sessionCtx.vehicleId}`);
          }
        }

        // 4. Final fallback: usar primeira loja disponível
        if (storeLocation === "auto") {
          const stores = await getDistinctStoreLocations();
          storeLocation = stores[0] || "Auto Inova - Matriz";
          console.log(`[FlowEngine] assign_seller: using fallback store "${storeLocation}"`);
        }
      }

      // Get next seller from round-robin queue
      const seller = await getNextSellerInQueue(storeLocation);
      if (!seller) {
        const fallbackMsg = "Desculpe, no momento não temos vendedores disponíveis. Tente novamente em breve!";
        await outText(ctx, fallbackMsg);
        result.responses.push(fallbackMsg);
        const nextEdge = edges.find(e => e.sourceNodeId === node.id);
        if (nextEdge) {
          await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
        }
        break;
      }

      // Create assignment record (inclui vehicleId se disponível)
      const leadForAssignment = await getLeadByConversationId(ctx.conversationId);
      await createSellerAssignment({
        sellerId: seller.id,
        conversationId: ctx.conversationId,
        storeLocation,
        vehicleId: leadForAssignment?.vehicleId || null,
        customerPhone: ctx.phone,
        customerName: ctx.contactName || leadForAssignment?.name || null,
        status: "pending",
      });

      // Build message
      const contactMode = config.contactMode || "contact_card"; // "contact_card" | "wa_link"

      // Build wa.me link if mode is wa_link
      let waLink = "";
      if (contactMode === "wa_link") {
        const lead = await getLeadByConversationId(ctx.conversationId);
        const linkVars: Record<string, string> = {
          vendedor: seller.name,
          loja: storeLocation,
          nome: ctx.contactName || lead?.name || "Cliente",
          nome_completo: lead?.fullName || lead?.name || ctx.contactName || "Cliente",
          telefone: ctx.phone,
          veiculo: lead?.vehicleInterest || ctx.leadData?.vehicleInterest || "",
          troca: lead?.tradeVehicle || ctx.leadData?.tradeVehicle || "",
          pagamento: lead?.paymentMethod || ctx.leadData?.paymentMethod || "",
          entrada: lead?.downPayment || ctx.leadData?.downPayment || "",
          cidade: lead?.city || ctx.leadData?.city || "",
          cpf: lead?.cpf || "",
          email: lead?.email || "",
          data_nascimento: lead?.birthDate || "",
        };
        const defaultLinkText = `Olá ${seller.name}, vim pelo atendimento da ${storeLocation}.\nMeu nome é ${linkVars.nome}.\nVeículo de interesse: ${linkVars.veiculo}`;
        let linkText = config.waLinkMessage || defaultLinkText;
        // Substitui {{var}} (duplas) PRIMEIRO e depois {var} (simples). Se fizer o
        // simples antes, ele come o miolo de {{var}} e sobra "{valor}".
        Object.entries(linkVars).forEach(([key, val]) => {
          linkText = linkText.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), val);
        });
        Object.entries(linkVars).forEach(([key, val]) => {
          linkText = linkText.replace(new RegExp(`\\{${key}\\}`, "gi"), val);
        });
        linkText = replaceVariables(linkText, ctx);
        // Remove linhas de campo vazio ("Cidade:", "E-mail:") e excesso de linhas.
        linkText = linkText
          .split("\n")
          .filter((l: string) => !/^\s*[^:\n]{1,40}:\s*$/.test(l))
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        // WhatsApp corta a parte clicável de URLs muito longas → mantém a mensagem
        // curta (o vendedor recebe o cadastro completo no CRM, não precisa no link).
        if (linkText.length > 350) {
          const cut = linkText.slice(0, 350);
          const nl = cut.lastIndexOf("\n");
          linkText = (nl > 150 ? cut.slice(0, nl) : cut).trim();
        }
        const cleanPhone = seller.phone.replace(/\D/g, "");
        waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(linkText)}`;
      }

      // Default messages differ by mode
      let defaultMsg: string;
      if (contactMode === "wa_link") {
        defaultMsg = `Perfeito! Vou te conectar com um dos nossos vendedores \ud83d\udc47\n\nClique no link abaixo para falar diretamente com *${seller.name}*:\n\n${waLink}\n\nEle já vai te chamar para te atender melhor, mas se preferir você também pode chamar ele diretamente pelo link acima.`;
      } else {
        defaultMsg = `Perfeito! Vou te conectar com um dos nossos vendedores \ud83d\udc47\n\nTe enviei o contato do *${seller.name}*.\n\nEle já vai te chamar para te atender melhor, mas se preferir você também pode chamar ele diretamente.`;
      }

      let messageText = config.message
        ? replaceVariables(
            config.message
              .replace(/\{vendedor\}/gi, seller.name)
              .replace(/\{loja\}/gi, storeLocation)
              .replace(/\{link\}/gi, waLink),
            ctx
          )
        : defaultMsg;

      await outText(ctx, messageText);
      result.responses.push(messageText);

      // Send seller photo as image message (WhatsApp API doesn't support photo in contact cards)
      if (seller.photoUrl) {
        const sellerCaption = `${seller.name} - ${storeLocation}`;
        await outImage(ctx, seller.photoUrl, sellerCaption);
        result.imageMessages.push({ imageUrl: seller.photoUrl, caption: sellerCaption });
      }

      // Send contact card or wa.me link based on mode
      if (contactMode === "contact_card") {
        const shouldSendContact = config.sendContact !== false;
        if (shouldSendContact) {
          await sendContactCard(ctx.phone, {
            name: seller.name,
            phone: seller.phone,
            organization: storeLocation,
          });
        }
      }

      console.log(`[FlowEngine] assign_seller: assigned ${seller.name} (${storeLocation}) to conversation ${ctx.conversationId}`);

      // Send notification to the seller about the new lead
      const notifySeller = config.notifySeller !== false;
      if (notifySeller) {
        const customerName = leadForAssignment?.fullName || ctx.contactName || leadForAssignment?.name || "Cliente";
        const customerPhone = ctx.phone;
        const vehicleInterest = leadForAssignment?.vehicleInterest || ctx.leadData?.vehicleInterest || "N\u00e3o informado";
        const conversationSummary = leadForAssignment?.notes || "Novo lead atribu\u00eddo via fluxo autom\u00e1tico.";

        // Texto da notifica\u00e7\u00e3o (custom ou padr\u00e3o)
        const notifyText = (config.sellerMessage
          ? config.sellerMessage
              .replace(/\{vendedor\}/gi, seller.name)
              .replace(/\{cliente\}/gi, customerName)
              .replace(/\{telefone\}/gi, customerPhone)
              .replace(/\{veiculo\}/gi, vehicleInterest)
              .replace(/\{resumo\}/gi, conversationSummary)
              .replace(/\{loja\}/gi, storeLocation)
          : `\ud83d\udd14 Novo lead para voc\u00ea, ${seller.name}!\n\nCliente: ${customerName}\nTelefone: ${customerPhone}\nVe\u00edculo: ${vehicleInterest}\nLoja: ${storeLocation}\n\nResumo: ${conversationSummary}\n\nChame o cliente o quanto antes!`);

        let notified = false;
        let zernioAcc: string | undefined;
        // 1) TEXTO LIVRE pela MESMA inst\u00e2ncia Zernio da conversa (ex.: bianca) \u2014
        // s\u00f3 funciona se o vendedor j\u00e1 tem conversa aberta nessa inst\u00e2ncia (24h).
        try {
          const convNow = await getConversationById(ctx.conversationId);
          if (convNow?.channel === "zernio") {
            zernioAcc = ((convNow.metadata as any)?.zernioAccountId as string | undefined) || (convNow as any).instanceName || undefined;
            const { findZernioConversationByPhone } = await import("./db");
            const sellerZConv = await findZernioConversationByPhone(seller.phone, zernioAcc);
            if (sellerZConv) {
              const { zernioReply } = await import("./zernioService");
              const r = await zernioReply(sellerZConv, notifyText, zernioAcc);
              notified = !!r.success;
              console.log(`[FlowEngine] assign_seller: texto livre via Zernio (${zernioAcc}) ${notified ? "OK" : "falhou"}`);
            }
          }
        } catch (e) { console.error("[FlowEngine] notifica\u00e7\u00e3o Zernio (texto) ao vendedor falhou:", e); }

        // 2) TEMPLATE pela bianca (Zernio) \u2014 garante entrega mesmo com vendedor "frio".
        if (!notified && zernioAcc) {
          try {
            const { getSetting } = await import("./db");
            const tplName = (await getSetting("seller_notify_template_name")) || "novo_lead_vendedor";
            const { zernioSendTemplate } = await import("./zernioService");
            const r = await zernioSendTemplate(
              seller.phone, tplName,
              [seller.name, customerName, customerPhone, vehicleInterest, storeLocation, conversationSummary],
              "pt_BR", zernioAcc,
            );
            notified = !!r.success;
            console.log(`[FlowEngine] assign_seller: template via Zernio (${zernioAcc}) ${notified ? "OK" : "falhou"} ${r.error || ""}`);
          } catch (e) { console.error("[FlowEngine] template Zernio ao vendedor falhou:", e); }
        }

        // 3) Fallback final: n\u00famero OFICIAL (texto livre \u2192 template)
        if (!notified) {
          await sendSellerNotification(seller.phone, {
            sellerName: seller.name,
            customerName, customerPhone, vehicleInterest, conversationSummary, storeLocation,
            customMessage: config.sellerMessage || undefined,
          });
        }
        console.log(`[FlowEngine] assign_seller: notification sent to seller ${seller.name} (${seller.phone})`);
      }

      // Pause the flow (transfer to human)
      await updateFlowSession(session.id, { status: "paused" });
      break;
    }

    case "send_vehicle_photos": {
      /**
       * Enviar fotos do veículo de interesse com legendas personalizáveis.
       * config.photoSlots: array de { position: number, caption: string }
       * config.introMessage: mensagem antes das fotos (opcional)
       * config.fallbackMessage: mensagem se não houver veículo (opcional)
       * config.photoSource: "vehicle_interest" (padrão)
       */
      // Always reload lead from DB to get the freshest vehicleId
      const lead = await getLeadByConversationId(ctx.conversationId);
      let vehicleId: number | null = null;

      // Priority 1: session context vehicleId (set when flow started from ad_click)
      const sessionCtx = (session.context as any) || {};
      if (sessionCtx.vehicleId) {
        vehicleId = sessionCtx.vehicleId;
        console.log(`[FlowEngine] send_vehicle_photos: using vehicleId=${vehicleId} from session context`);
      }

      // Priority 2: lead.vehicleId (updated by AI or previous flow)
      if (!vehicleId && lead?.vehicleId) {
        vehicleId = lead.vehicleId;
        console.log(`[FlowEngine] send_vehicle_photos: using vehicleId=${vehicleId} from lead record`);
      }

      // Priority 3: extract ID from customerMessage
      if (!vehicleId) {
        const msgIdMatch = ctx.customerMessage.match(/\bID\s*:?\s*(\d+)\b/i);
        if (msgIdMatch) {
          vehicleId = parseInt(msgIdMatch[1]);
          console.log(`[FlowEngine] send_vehicle_photos: extracted vehicleId=${vehicleId} from customer message`);
        }
      }

      // Priority 4: extract ID from vehicleInterest text
      if (!vehicleId) {
        const vehicleInterest = lead?.vehicleInterest || ctx.leadData?.vehicleInterest || "";
        const idMatch = vehicleInterest.match(/ID\s*:?\s*(\d+)/i);
        if (idMatch) {
          vehicleId = parseInt(idMatch[1]);
          console.log(`[FlowEngine] send_vehicle_photos: extracted vehicleId=${vehicleId} from vehicleInterest text`);
        }
      }

      if (!vehicleId) {
        const fallback = config.fallbackMessage || "Desculpe, não consegui identificar o veículo de interesse. Pode me dizer qual carro você gostou?";
        await outText(ctx, fallback);
        result.responses.push(fallback);
        const nextEdge = edges.find(e => e.sourceNodeId === node.id);
        if (nextEdge) {
          await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
        }
        break;
      }

      const vehicle = await getVehicleById(vehicleId);
      if (!vehicle) {
        const fallback = config.fallbackMessage || "Desculpe, não encontrei as fotos desse veículo no momento.";
        await outText(ctx, fallback);
        result.responses.push(fallback);
        const nextEdge = edges.find(e => e.sourceNodeId === node.id);
        if (nextEdge) {
          await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
        }
        break;
      }

      const vehicleImages: string[] = Array.isArray(vehicle.images) ? vehicle.images : [];
      const vehicleName = `${vehicle.brand} ${vehicle.model}`.trim();
      const vehicleSeller = vehicle.seller || "";

      // Send intro message if configured
      if (config.introMessage) {
        let intro = config.introMessage
          .replace(/\{\{nome\}\}/gi, ctx.contactName || lead?.name || "")
          .replace(/\{\{veiculo_interesse\}\}/gi, vehicleName)
          .replace(/\{\{loja\}\}/gi, vehicleSeller);
        intro = replaceVariables(intro, ctx);
        await outText(ctx, intro);
        result.responses.push(intro);
      }

      // Send photos with captions
      const photoSlots: Array<{ position: number; caption: string }> = config.photoSlots || [
        { position: 1, caption: "Vista frontal" },
        { position: 2, caption: "Vista traseira" },
        { position: 3, caption: "Interior" },
        { position: 4, caption: "Painel" },
      ];

      // Delay configurável entre fotos (padrão: 1 segundo, máximo: 10 segundos)
      const photoDelay = Math.min(Math.max((config.delayBetweenPhotos || 1) * 1000, 500), 10000);

      let sentCount = 0;
      for (const slot of photoSlots) {
        const imgIndex = slot.position - 1; // position is 1-based
        if (imgIndex >= 0 && imgIndex < vehicleImages.length) {
          const imageUrl = vehicleImages[imgIndex];
          let caption = slot.caption
            .replace(/\{\{veiculo\}\}/gi, vehicleName)
            .replace(/\{\{marca\}\}/gi, vehicle.brand || "")
            .replace(/\{\{modelo\}\}/gi, vehicle.model || "")
            .replace(/\{\{ano\}\}/gi, vehicle.year?.toString() || "")
            .replace(/\{\{preco\}\}/gi, vehicle.price ? `R$ ${Number(vehicle.price).toLocaleString("pt-BR")}` : "")
            .replace(/\{\{loja\}\}/gi, vehicleSeller);
          await outImage(ctx, imageUrl, caption);
          result.imageMessages.push({ imageUrl, caption });
          sentCount++;
          // Configurable delay between images
          if (sentCount < photoSlots.length) {
            await new Promise(resolve => setTimeout(resolve, photoDelay));
          }
        } else {
          console.log(`[FlowEngine] send_vehicle_photos: skipping slot position ${slot.position} - vehicle has ${vehicleImages.length} images`);
        }
      }

      console.log(`[FlowEngine] send_vehicle_photos: sent ${sentCount}/${photoSlots.length} photos for vehicle ${vehicleId} (${vehicleName})`);

      const nextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (nextEdge) {
        await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "vehicle_presentation": {
      /**
       * Apresentação personalizada do veículo com dados do banco.
       * config.message: mensagem principal com variáveis do veículo
       * config.photoSlots: array de { position: number, caption: string }
       * config.fallbackMessage: mensagem se não houver veículo identificado
       * config.delayBetweenPhotos: delay em segundos entre fotos
       * Variáveis disponíveis: {{v_marca}}, {{v_modelo}}, {{v_ano}}, {{v_km}}, {{v_preco}},
       *   {{v_cor}}, {{v_cambio}}, {{v_combustivel}}, {{v_preco_normal}}, {{v_preco_promo}},
       *   {{v_loja}}, {{v_tipo}}, {{v_portas}}, {{v_titulo}}, {{v_versao}}, {{v_descricao}}
       *   + todas as variáveis do lead ({{nome}}, {{telefone}}, etc.)
       */
      // Always reload lead from DB to get the freshest vehicleId
      const vpLead = await getLeadByConversationId(ctx.conversationId);
      let vpVehicleId: number | null = null;

      // Priority 1: session context vehicleId (set when flow started from ad_click)
      const vpSessionCtx = (session.context as any) || {};
      if (vpSessionCtx.vehicleId) {
        vpVehicleId = vpSessionCtx.vehicleId;
        console.log(`[FlowEngine] vehicle_presentation: using vehicleId=${vpVehicleId} from session context`);
      }

      // Priority 2: lead.vehicleId (updated by AI or previous flow)
      if (!vpVehicleId && vpLead?.vehicleId) {
        vpVehicleId = vpLead.vehicleId;
        console.log(`[FlowEngine] vehicle_presentation: using vehicleId=${vpVehicleId} from lead record`);
      }

      // Priority 3: extract ID from customerMessage (in case of new ad click mid-flow)
      if (!vpVehicleId) {
        const msgIdMatch = ctx.customerMessage.match(/\bID\s*:?\s*(\d+)\b/i);
        if (msgIdMatch) {
          vpVehicleId = parseInt(msgIdMatch[1]);
          console.log(`[FlowEngine] vehicle_presentation: extracted vehicleId=${vpVehicleId} from customer message`);
        }
      }

      // Priority 4: extract ID from vehicleInterest text
      if (!vpVehicleId) {
        const vi = vpLead?.vehicleInterest || ctx.leadData?.vehicleInterest || "";
        const idMatch = vi.match(/ID\s*:?\s*(\d+)/i);
        if (idMatch) {
          vpVehicleId = parseInt(idMatch[1]);
          console.log(`[FlowEngine] vehicle_presentation: extracted vehicleId=${vpVehicleId} from vehicleInterest text`);
        }
      }

      if (!vpVehicleId) {
        const fallback = config.fallbackMessage || "Desculpe, não consegui identificar o veículo de interesse. Pode me dizer qual carro você gostou?";
        await outText(ctx, replaceVariables(fallback, ctx));
        result.responses.push(fallback);
        const nextEdge = edges.find(e => e.sourceNodeId === node.id);
        if (nextEdge) await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
        break;
      }

      const vpVehicle = await getVehicleById(vpVehicleId);
      if (!vpVehicle) {
        const fallback = config.fallbackMessage || "Desculpe, não encontrei os dados desse veículo no momento.";
        await outText(ctx, replaceVariables(fallback, ctx));
        result.responses.push(fallback);
        const nextEdge = edges.find(e => e.sourceNodeId === node.id);
        if (nextEdge) await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
        break;
      }

      // Helper to format price
      const formatPrice = (val: number | null | undefined) => val ? `R$ ${Number(val).toLocaleString("pt-BR")}` : "";
      const formatKm = (val: number | null | undefined) => val != null ? `${Number(val).toLocaleString("pt-BR")} km` : "";

      // Build vehicle variables map
      const vpVars: Record<string, string> = {
        v_marca: vpVehicle.brand || "",
        v_modelo: vpVehicle.model || "",
        v_ano: vpVehicle.year?.toString() || "",
        v_km: formatKm(vpVehicle.mileage),
        v_preco: formatPrice(vpVehicle.price),
        v_cor: vpVehicle.color || "",
        v_cambio: vpVehicle.transmission || "",
        v_combustivel: vpVehicle.fuel || "",
        v_preco_normal: formatPrice(vpVehicle.regularPrice),
        v_preco_promo: formatPrice(vpVehicle.promotionPrice),
        v_loja: vpVehicle.seller || "",
        v_tipo: vpVehicle.vehicleType || "",
        v_portas: vpVehicle.doors?.toString() || "",
        v_titulo: vpVehicle.title || `${vpVehicle.brand} ${vpVehicle.model}`.trim(),
        v_versao: vpVehicle.version || "",
        v_descricao: vpVehicle.description || "",
      };

      // Replace vehicle variables in text
      const replaceVehicleVars = (text: string): string => {
        let result = text;
        Object.entries(vpVars).forEach(([key, val]) => {
          result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), val);
        });
        // Also replace lead variables
        result = replaceVariables(result, ctx);
        return result;
      };

      // Send main message if configured
      if (config.message) {
        const msg = replaceVehicleVars(config.message);
        await outText(ctx, msg);
        result.responses.push(msg);
      }

      // Send photos with captions
      const vpImages: string[] = Array.isArray(vpVehicle.images) ? vpVehicle.images : [];
      const vpPhotoSlots: Array<{ position: number; caption: string }> = config.photoSlots || [];
      const vpPhotoDelay = Math.min(Math.max((config.delayBetweenPhotos || 1) * 1000, 500), 10000);

      let vpSentCount = 0;
      for (const slot of vpPhotoSlots) {
        const imgIndex = slot.position - 1;
        if (imgIndex >= 0 && imgIndex < vpImages.length) {
          const imageUrl = vpImages[imgIndex];
          const caption = replaceVehicleVars(slot.caption);
          await outImage(ctx, imageUrl, caption);
          result.imageMessages.push({ imageUrl, caption });
          vpSentCount++;
          if (vpSentCount < vpPhotoSlots.length) {
            await new Promise(resolve => setTimeout(resolve, vpPhotoDelay));
          }
        } else {
          console.log(`[FlowEngine] vehicle_presentation: skipping slot position ${slot.position} - vehicle has ${vpImages.length} images`);
        }
      }

      console.log(`[FlowEngine] vehicle_presentation: presented vehicle ${vpVehicleId} (${vpVars.v_titulo}) - message: ${!!config.message}, photos: ${vpSentCount}/${vpPhotoSlots.length}`);

      const vpNextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (vpNextEdge) {
        await executeFromNode(vpNextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "update_lead_status": {
      /**
       * Atualizar status/temperatura do lead no funil.
       * config.funnelStatus: novo status do funil
       * A temperatura é calculada automaticamente.
       */
      const newFunnelStatus = config.funnelStatus;
      if (newFunnelStatus) {
        try {
          const updatedLead = await updateLeadFunnelStatus(ctx.conversationId, newFunnelStatus);
          if (updatedLead) {
            console.log(`[FlowEngine] update_lead_status: set funnel="${newFunnelStatus}" temp="${updatedLead.temperature}" for conversation ${ctx.conversationId}`);
            // Update ctx.leadData so subsequent nodes see the new status
            ctx.leadData = { ...ctx.leadData, ...updatedLead };
          }
        } catch (err) {
          console.error(`[FlowEngine] update_lead_status error:`, err);
        }
      }
      const ulsNextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (ulsNextEdge) {
        await executeFromNode(ulsNextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
      break;
    }

    case "goto_flow": {
      // Ir para outro fluxo (subfluxo)
      const targetFlowId = config.targetFlowId;
      if (!targetFlowId) {
        console.error(`[FlowEngine] goto_flow node ${node.id} has no targetFlowId`);
        break;
      }

      // Encerrar sessão atual
      await updateFlowSession(session.id, { status: "completed", completedAt: new Date() });
      console.log(`[FlowEngine] goto_flow: ending session ${session.id}, starting flow ${targetFlowId}`);

      // Carregar nós do fluxo destino
      const targetNodes = await listChatFlowNodes(targetFlowId);
      const targetStartNode = targetNodes.find(n => n.nodeType === "start");
      if (!targetStartNode) {
        console.error(`[FlowEngine] goto_flow: target flow ${targetFlowId} has no start node`);
        result.flowCompleted = true;
        break;
      }

      // Criar nova sessão no fluxo destino
      const newSessionId = await createFlowSession({
        conversationId: ctx.conversationId,
        flowId: targetFlowId,
        currentNodeId: targetStartNode.id,
        status: "active",
        context: {},
      });

      // Carregar edges do fluxo destino
      const targetEdges = await listChatFlowEdges(targetFlowId);
      const newSession = {
        id: newSessionId,
        conversationId: ctx.conversationId,
        flowId: targetFlowId,
        currentNodeId: targetStartNode.id,
        context: {},
      };

      // Executar a partir do start node do fluxo destino
      const startEdge = targetEdges.find(e => e.sourceNodeId === targetStartNode.id);
      if (startEdge) {
        await executeFromNode(startEdge.targetNodeId, targetNodes, targetEdges, newSession, ctx, result, 0);
      }
      break;
    }

    default: {
      // Unknown node type, try to advance
      const nextEdge = edges.find(e => e.sourceNodeId === node.id);
      if (nextEdge) {
        await executeFromNode(nextEdge.targetNodeId, nodes, edges, session, ctx, result, depth + 1);
      }
    }
  }
}

// ─── Match Response to Edge ──────────────────────────────────
function matchResponseToEdge(
  node: ChatFlowNode,
  edges: ChatFlowEdge[],
  customerMessage: string,
): number | null {
  const config = (node.data as any) || {};
  const msgLower = customerMessage.toLowerCase().trim();

  if (node.nodeType === "send_buttons") {
    const buttons = config.buttons || [];

    // 1. Try exact match on button ID (WhatsApp interactive reply callback)
    //    WhatsApp sends the button ID (e.g. "flow_btn_123_0") when user taps a button
    for (let i = 0; i < buttons.length; i++) {
      const expectedId = `flow_btn_${node.id}_${i}`;
      if (msgLower === expectedId.toLowerCase()) {
        const edge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === `button_${i}`);
        if (edge) return edge.targetNodeId;
      }
    }

    // 2. Try exact match on button text (for when WhatsApp sends the button title)
    for (let i = 0; i < buttons.length; i++) {
      const btnText = (buttons[i].text || "").toLowerCase().trim();
      if (btnText && msgLower === btnText) {
        const edge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === `button_${i}`);
        if (edge) return edge.targetNodeId;
      }
    }

    // 3. NO FALLBACK for free text — buttons MUST be clicked
    //    Only allow explicit "default" handle if configured
    const defaultEdge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === "default");
    if (defaultEdge) return defaultEdge.targetNodeId;

    // Return null = no match, flow will re-prompt the user
    return null;
  }

  if (node.nodeType === "send_list") {
    const allRows = (config.sections || []).flatMap((s: any) => s.rows || []);

    // 1. Try exact match on row ID (WhatsApp interactive list reply callback)
    for (let i = 0; i < allRows.length; i++) {
      const expectedId = `flow_row_${node.id}_${i}`;
      if (msgLower === expectedId.toLowerCase()) {
        const edge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === `row_${i}`);
        if (edge) return edge.targetNodeId;
      }
    }

    // 2. Try exact match on row title
    for (let i = 0; i < allRows.length; i++) {
      const rowTitle = (allRows[i].title || "").toLowerCase().trim();
      if (rowTitle && msgLower === rowTitle) {
        const edge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === `row_${i}`);
        if (edge) return edge.targetNodeId;
      }
    }

    // 3. NO FALLBACK for free text — list items MUST be selected
    const defaultEdge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === "default");
    if (defaultEdge) return defaultEdge.targetNodeId;

    return null;
  }

  return null;
}

// ─── Evaluate Condition ──────────────────────────────────────
function evaluateCondition(node: ChatFlowNode, ctx: FlowContext): boolean {
  const config = (node.data as any) || {};
  const field = config.field || "";
  const operator = config.operator || "equals";
  const value = (config.value || "").toLowerCase();

  let fieldValue = "";
  if (field === "lastMessage") {
    fieldValue = ctx.customerMessage.toLowerCase();
  } else if (ctx.leadData && field in ctx.leadData) {
    fieldValue = String(ctx.leadData[field] || "").toLowerCase();
  }

  switch (operator) {
    case "equals": return fieldValue === value;
    case "not_equals": return fieldValue !== value;
    case "contains": return fieldValue.includes(value);
    case "not_empty": return fieldValue.length > 0;
    case "is_empty": return fieldValue.length === 0;
    case "is_true": return fieldValue === "true" || fieldValue === "1" || fieldValue === "sim";
    case "is_false": return fieldValue === "false" || fieldValue === "0" || fieldValue === "não" || fieldValue === "nao" || fieldValue === "";
    default: return false;
  }
}

// ─── Cancel Active Session ───────────────────────────────────
export async function cancelFlowSession(conversationId: number): Promise<void> {
  const session = await getActiveFlowSession(conversationId);
  if (session) {
    await updateFlowSession(session.id, { status: "cancelled" });
  }
}

/**
 * Inicia um fluxo manualmente para uma conversa (disparado pelo atendente no painel).
 * Cancela qualquer sessão ativa anterior e executa a partir do nó inicial.
 */
export async function startFlowManually(params: {
  conversationId: number;
  flowId: number;
  phone: string;
  contactName?: string;
}): Promise<FlowResult> {
  // Cancela sessão anterior (só pode haver 1 fluxo ativo por conversa)
  await cancelFlowSession(params.conversationId);

  const nodes = await listChatFlowNodes(params.flowId);
  const startNode = nodes.find(n => n.nodeType === "start");
  if (!startNode) throw new Error("Este fluxo não tem nó inicial (start)");

  await createFlowSession({
    conversationId: params.conversationId,
    flowId: params.flowId,
    currentNodeId: startNode.id,
    status: "active",
    context: { manualStart: true },
  });

  // processFlowMessage encontra a sessão ativa no nó start e executa a partir dele
  return processFlowMessage({
    conversationId: params.conversationId,
    phone: params.phone,
    customerMessage: "",
    contactName: params.contactName,
  });
}

// ─── Entrega das mensagens de um FlowResult (persiste + emite no inbox) ────────
// Usado por disparos que não vêm de uma mensagem do cliente (ex: gatilhos de CRM).
export async function deliverFlowResult(conversationId: number, result: FlowResult): Promise<number> {
  const { createMessage } = await import("./db");
  const { emitNewMessage } = await import("./socket");
  const senderName = "Auto Inova - Matriz IA";
  let sent = 0;
  for (const response of result.responses) {
    const m = await createMessage({ conversationId, content: response, senderType: "bot", senderName, messageType: "text" });
    emitNewMessage(conversationId, m); sent++;
  }
  for (const img of result.imageMessages) {
    const m = await createMessage({ conversationId, content: img.caption || "[Imagem]", senderType: "bot", senderName, messageType: "image", metadata: { mediaUrl: img.imageUrl, caption: img.caption } });
    emitNewMessage(conversationId, m); sent++;
  }
  for (const im of result.interactiveMessages) {
    const meta: any = { interactiveType: im.type, interactiveData: im.data };
    let content = im.data.body || "";
    if (im.type === "buttons" && im.data.buttons) {
      content += `\n\n[Botões: ${im.data.buttons.map((b: any) => b.title).join(" | ")}]`;
      meta.buttons = im.data.buttons;
    } else if (im.type === "list" && im.data.sections) {
      content += `\n\n[Lista: ${im.data.sections.flatMap((s: any) => (s.rows || []).map((r: any) => r.title)).join(" | ")}]`;
      meta.sections = im.data.sections;
      meta.buttonText = im.data.buttonText;
    }
    const m = await createMessage({ conversationId, content, senderType: "bot", senderName, messageType: "text", metadata: meta });
    emitNewMessage(conversationId, m); sent++;
  }
  return sent;
}

// ─── Disparo por evento de CRM (etiqueta / etapa do funil) ────────────────────
// triggerType: "tag_added" | "tag_removed" | "funnel_stage_entered"
// matchValue: nome da etiqueta ou valor da etapa. Se o fluxo tiver triggerValue,
// ele precisa bater (lista separada por vírgula); se estiver vazio, vale para qualquer.
export async function triggerEventFlow(params: {
  conversationId: number;
  triggerType: "tag_added" | "tag_removed" | "funnel_stage_entered";
  matchValue?: string;
}): Promise<boolean> {
  try {
    const { getSetting } = await import("./db");
    const flowsEnabled = (await getSetting("flows_global_enabled")) !== "false";
    if (!flowsEnabled) return false;

    const conv = await getConversationById(params.conversationId);
    if (!conv || !conv.phone) return false;

    // Não interrompe um fluxo já ativo
    const existing = await getActiveFlowSession(params.conversationId);
    if (existing) return false;

    const { getActiveFlowsForConnection } = await import("./db");
    const flows = await getActiveFlowsForConnection({
      connectionType: conv.connectionType,
      connectionId: conv.connectionId,
      instanceName: conv.instanceName,
      channel: conv.channel,
    });

    const wanted = params.matchValue?.toLowerCase();
    const candidates = flows.filter((f: any) => {
      if (f.trigger !== params.triggerType) return false;
      const tv = (f.triggerValue || "").trim();
      if (!tv) return true; // sem filtro = vale para qualquer etiqueta/etapa
      const opts = tv.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
      return wanted ? opts.includes(wanted) : false;
    });
    // Primeiro candidato que também passa nas condições "Somente se"
    let match: any = null;
    for (const c of candidates) {
      if (await evaluateFlowConditions(c, params.conversationId)) { match = c; break; }
    }
    if (!match) return false;

    const result = await startFlowManually({
      conversationId: params.conversationId,
      flowId: match.id,
      phone: conv.phone,
      contactName: conv.contactName || undefined,
    });
    await deliverFlowResult(params.conversationId, result);

    // Roteamento exclusivo: fluxo assume, IA pausa
    const { updateConversation } = await import("./db");
    const { emitConversationUpdate } = await import("./socket");
    await updateConversation(params.conversationId, { aiActive: false, routingState: "flow" } as any);
    emitConversationUpdate(params.conversationId, { aiActive: false, routingState: "flow" });
    console.log(`[FlowEngine] Gatilho de CRM "${params.triggerType}" (${params.matchValue || "*"}) iniciou fluxo ${match.id} na conversa ${params.conversationId}`);
    return true;
  } catch (err) {
    console.error("[FlowEngine] Erro em triggerEventFlow:", err);
    return false;
  }
}


// ─── Worker: lembrete de "sem resposta" nos nós de espera ─────────────────────
// Roda periodicamente (via scheduler). Para cada sessão ativa parada num nó de
// botões/lista com no-reply configurado: se o cliente não respondeu no tempo,
// manda lembrete(s); ao esgotar, dá o desfecho (marcar frio / avisar vendedor /
// rota "sem resposta" / encerrar).
export async function runFlowNoReplyCheck(): Promise<void> {
  let sessions: any[] = [];
  try { sessions = await listActiveFlowSessions(); } catch { return; }
  const now = Date.now();

  for (const session of sessions) {
    try {
      const sctx = (session.context as any) || {};
      const waitingSince = sctx.waitingSince as number | undefined;
      if (!waitingSince || !session.currentNodeId) continue;

      const nodes = await listChatFlowNodes(session.flowId);
      const node = nodes.find(n => n.id === session.currentNodeId);
      if (!node) continue;
      const cfg = (node.data as any) || {};
      const minutes = Number(cfg.noReplyMinutes || 0);
      if (!minutes) continue; // no-reply não configurado neste nó

      const maxAttempts = Number(cfg.noReplyMaxAttempts ?? 1);
      const attempts = Number(sctx.noReplyAttempts || 0);
      const dueAt = waitingSince + minutes * 60000 * (attempts + 1);
      if (now < dueAt) continue;

      const conv = await getConversationById(session.conversationId);
      if (!conv) continue;
      const edges = await listChatFlowEdges(session.flowId);
      const ctx: FlowContext = {
        conversationId: conv.id,
        phone: conv.phone || "",
        customerMessage: "",
        contactName: conv.contactName || undefined,
        sender: getFlowSender(conv),
      };

      if (attempts < maxAttempts) {
        // Envia lembrete
        const msg = replaceVariables(cfg.noReplyMessage || "Oi! Ainda posso te ajudar? 😊", ctx);
        if (ctx.sender) await ctx.sender.text(msg); else await sendTextMessage(ctx.phone, msg);
        const botMsg = await createMessage({ conversationId: conv.id, content: msg, senderType: "bot", senderName: "Auto Inova - IA", messageType: "text" });
        emitNewMessage(conv.id, botMsg);
        await updateFlowSession(session.id, { context: { ...sctx, noReplyAttempts: attempts + 1 } });
        console.log(`[FlowNoReply] lembrete ${attempts + 1}/${maxAttempts} (conversa ${conv.id})`);
      } else {
        // Esgotou → desfecho configurado
        console.log(`[FlowNoReply] sem resposta após ${maxAttempts} lembrete(s) (conversa ${conv.id})`);
        if (cfg.noReplyMarkCold) { try { await updateLeadFunnelStatus(conv.id, "frio"); } catch { /* noop */ } }
        if (cfg.noReplyNotifySeller && cfg.noReplyNotifyNumber) {
          try { await sendTextMessage(String(cfg.noReplyNotifyNumber), `⏰ Lead sem resposta: ${conv.contactName || conv.phone}`); } catch { /* noop */ }
        }
        // limpa o estado de espera (0 = não aguardando)
        await updateFlowSession(session.id, { context: { ...sctx, waitingSince: 0, noReplyAttempts: 0 } });

        const noReplyEdge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === "noreply");
        // "Coletar com IA": sem resposta → avança pelo DEFAULT com o que já coletou (não encerra)
        const advanceEdge = noReplyEdge || (node.nodeType === "collect_with_ai"
          ? edges.find(e => e.sourceNodeId === node.id && (e.sourceHandle === "default" || !e.sourceHandle))
          : undefined);
        if (advanceEdge) {
          const result: FlowResult = { handled: true, responses: [], imageMessages: [], interactiveMessages: [], waitingForInput: false, flowCompleted: false };
          await executeFromNode(advanceEdge.targetNodeId, nodes, edges, session, ctx, result);
          for (const r of result.responses) {
            const bm = await createMessage({ conversationId: conv.id, content: r, senderType: "bot", senderName: "Auto Inova - IA", messageType: "text" });
            emitNewMessage(conv.id, bm);
          }
        } else if (cfg.noReplyEndFlow !== false) {
          await updateFlowSession(session.id, { status: "completed", completedAt: new Date() });
        }
      }
    } catch (err) {
      console.error(`[FlowNoReply] erro na sessão ${session.id}:`, err);
    }
  }
}
