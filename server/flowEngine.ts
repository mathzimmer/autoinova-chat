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
  getNextSellerInQueue,
  createSellerAssignment,
  getStoreLocationByVehicleId,
  getDistinctStoreLocations,
  getVehicleById,
} from "./db";
import { sendTextMessage, sendReplyButtons, sendListMessage, sendImageMessage, sendContactCard, sendSellerNotification } from "./whatsapp";
import type { ChatFlowNode, ChatFlowEdge } from "../drizzle/schema";

// ─── Types ───────────────────────────────────────────────────
interface FlowContext {
  conversationId: number;
  phone: string;
  customerMessage: string;
  contactName?: string;
  leadData?: Record<string, any>;
}

interface FlowResult {
  handled: boolean;           // true = flow handled the message, don't pass to AI
  responses: string[];        // Text messages sent
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
  return text
    .replace(/\{\{nome\}\}/gi, ctx.contactName || ctx.leadData?.name || "cliente")
    .replace(/\{\{telefone\}\}/gi, ctx.phone)
    .replace(/\{\{veiculo\}\}/gi, ctx.leadData?.vehicleInterest || "")
    .replace(/\{\{cidade\}\}/gi, ctx.leadData?.city || "")
    .replace(/\{\{troca\}\}/gi, ctx.leadData?.tradeVehicle || "")
    .replace(/\{\{pagamento\}\}/gi, ctx.leadData?.paymentMethod || "")
    .replace(/\{\{entrada\}\}/gi, ctx.leadData?.downPayment || "")
    .replace(/\{\{email\}\}/gi, ctx.leadData?.email || "")
    .replace(/\{\{cpf\}\}/gi, ctx.leadData?.cpf || "")
    .replace(/\{\{data_nascimento\}\}/gi, ctx.leadData?.birthDate || "")
    .replace(/\{\{notas\}\}/gi, ctx.leadData?.notes || "");
}

// ─── Find Matching Flow ──────────────────────────────────────
export async function findMatchingFlow(
  conversationId: number,
  customerMessage: string,
  isFirstContact: boolean,
  hasVehicleId: boolean,
): Promise<number | null> {
  const activeFlows = await getActiveChatFlows();
  if (activeFlows.length === 0) return null;

  for (const flow of activeFlows) {
    switch (flow.trigger) {
      case "first_contact":
        if (isFirstContact) return flow.id;
        break;
      case "keyword": {
        const keywords = (flow.triggerValue || "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
        const msgLower = customerMessage.toLowerCase();
        if (keywords.some(kw => msgLower.includes(kw))) return flow.id;
        break;
      }
      case "ad_click":
        if (hasVehicleId) return flow.id;
        break;
      case "category_interest": {
        const categories = (flow.triggerValue || "").split(",").map(c => c.trim().toLowerCase()).filter(Boolean);
        const msgLower = customerMessage.toLowerCase();
        if (categories.some(cat => msgLower.includes(cat))) return flow.id;
        break;
      }
      // manual and reactivation are triggered differently
    }
  }
  return null;
}

// ─── Process Flow Step ───────────────────────────────────────
export async function processFlowMessage(ctx: FlowContext): Promise<FlowResult> {
  const result: FlowResult = {
    handled: false,
    responses: [],
    interactiveMessages: [],
    waitingForInput: false,
    flowCompleted: false,
  };

  // Check for active session
  let session = await getActiveFlowSession(ctx.conversationId);

  if (!session) {
    // Check if a flow should be triggered
    const lead = await getLeadByConversationId(ctx.conversationId);
    const isFirstContact = !lead;
    const hasVehicleId = /\bID\s*(\d+)\b/i.test(ctx.customerMessage);

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

    const sessionId = await createFlowSession({
      conversationId: ctx.conversationId,
      flowId,
      currentNodeId: startNode.id,
      status: "active",
      context: {},
    });

    session = {
      id: sessionId,
      conversationId: ctx.conversationId,
      flowId,
      currentNodeId: startNode.id,
      status: "active",
      context: {},
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
      // No match - client sent free text instead of clicking a button/list item
      // Re-send the interactive message so they can select properly
      const config = (currentNode.data as any) || {};
      
      if (currentNode.nodeType === "send_buttons") {
        const body = replaceVariables(config.body || "", ctx);
        const buttons = (config.buttons || []).map((b: any, i: number) => ({
          id: `flow_btn_${currentNode.id}_${i}`,
          title: replaceVariables(b.text || `Opção ${i + 1}`, ctx).substring(0, 20),
        }));
        const retryMsg = "☝️ Por favor, toque em uma das opções abaixo para continuar:";
        await sendTextMessage(ctx.phone, retryMsg);
        if (body && buttons.length > 0) {
          await sendReplyButtons(ctx.phone, body, buttons);
        }
        result.responses.push(retryMsg);
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
        const retryMsg = "☝️ Por favor, selecione uma das opções da lista para continuar:";
        await sendTextMessage(ctx.phone, retryMsg);
        if (body && sections.length > 0) {
          await sendListMessage(ctx.phone, body, buttonText, sections);
        }
        result.responses.push(retryMsg);
      }
      
      result.waitingForInput = true;
      console.log(`[FlowEngine] Button/list re-prompt: client sent free text "${ctx.customerMessage}" instead of selecting an option`);
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
              const validFields = ["name","city","tradeVehicle","paymentMethod","downPayment","vehicleInterest","notes","email","cpf","birthDate"];
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
                senderName: "Auto Inova IA",
                messageType: "text",
              });
              emitNewMessage(ctx.conversationId, botMsg);
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
                senderName: "Auto Inova IA",
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
        const validFields = ["name","city","tradeVehicle","paymentMethod","downPayment","vehicleInterest","notes","email","cpf","birthDate"];
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
    interactiveMessages: [],
    waitingForInput: false,
    flowCompleted: false,
  };

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

  const config = (node.data as any) || {};

  switch (node.nodeType) {
    case "send_message": {
      const text = replaceVariables(config.text || "", ctx);
      if (text) {
        await sendTextMessage(ctx.phone, text);
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
        await sendReplyButtons(ctx.phone, body, buttons);
        result.interactiveMessages.push({ type: "buttons", data: { body, buttons } });
      }
      // Wait for customer response
      await updateFlowSession(session.id, { currentNodeId: node.id });
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
        await sendListMessage(ctx.phone, body, buttonText, sections);
        result.interactiveMessages.push({ type: "list", data: { body, buttonText, sections } });
      }
      // Wait for customer response
      await updateFlowSession(session.id, { currentNodeId: node.id });
      result.waitingForInput = true;
      break;
    }

    case "send_image": {
      const imageUrl = config.imageUrl || "";
      const caption = replaceVariables(config.caption || "", ctx);
      if (imageUrl) {
        await sendImageMessage(ctx.phone, imageUrl, caption);
        result.responses.push(caption || "[Imagem]");
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

    case "ai_response": {
      // Let AI handle this message - stop flow execution temporarily
      result.handled = false; // Pass to AI
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
        await sendTextMessage(ctx.phone, promptText);
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

    case "update_lead": {
      const field = config.field;
      const value = replaceVariables(config.value || "", ctx);
      if (field) {
        const updateData: Record<string, any> = {};
        if (field === "status") updateData.status = value;
        else if (field === "vehicleInterest") updateData.vehicleInterest = value;
        else if (field === "hasTrade") updateData.hasTrade = value === "true" || value === "sim";
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
          storeLocation = stores[0] || "Auto Inova";
          console.log(`[FlowEngine] assign_seller: using fallback store "${storeLocation}"`);
        }
      }

      // Get next seller from round-robin queue
      const seller = await getNextSellerInQueue(storeLocation);
      if (!seller) {
        const fallbackMsg = "Desculpe, no momento não temos vendedores disponíveis. Tente novamente em breve!";
        await sendTextMessage(ctx.phone, fallbackMsg);
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
      const defaultMsg = `Perfeito! Vou te conectar com um dos nossos vendedores \ud83d\udc47\n\nTe enviei o contato do *${seller.name}*.\n\nEle já vai te chamar para te atender melhor, mas se preferir você também pode chamar ele diretamente.`;
      const messageText = config.message
        ? replaceVariables(config.message.replace(/\{vendedor\}/gi, seller.name).replace(/\{loja\}/gi, storeLocation), ctx)
        : defaultMsg;

      await sendTextMessage(ctx.phone, messageText);
      result.responses.push(messageText);

      // Send seller photo as image message (WhatsApp API doesn't support photo in contact cards)
      if (seller.photoUrl) {
        await sendImageMessage(ctx.phone, seller.photoUrl, `${seller.name} - ${storeLocation}`);
      }

      // Send contact card
      const shouldSendContact = config.sendContact !== false;
      if (shouldSendContact) {
        await sendContactCard(ctx.phone, {
          name: seller.name,
          phone: seller.phone,
          organization: storeLocation,
        });
      }

      console.log(`[FlowEngine] assign_seller: assigned ${seller.name} (${storeLocation}) to conversation ${ctx.conversationId}`);

      // Send notification to the seller about the new lead
      const notifySeller = config.notifySeller !== false;
      if (notifySeller) {
        const customerName = ctx.contactName || leadForAssignment?.name || "Cliente";
        const customerPhone = ctx.phone;
        const vehicleInterest = leadForAssignment?.vehicleInterest || ctx.leadData?.vehicleInterest || "N\u00e3o informado";
        const conversationSummary = leadForAssignment?.notes || "Novo lead atribu\u00eddo via fluxo autom\u00e1tico.";

        await sendSellerNotification(seller.phone, {
          sellerName: seller.name,
          customerName,
          customerPhone,
          vehicleInterest,
          conversationSummary,
          storeLocation,
          customMessage: config.sellerMessage || undefined,
        });
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
      const lead = await getLeadByConversationId(ctx.conversationId);
      let vehicleId = lead?.vehicleId || null;

      // Fallback: tentar extrair ID do vehicleInterest
      if (!vehicleId) {
        const vehicleInterest = lead?.vehicleInterest || ctx.leadData?.vehicleInterest || "";
        const idMatch = vehicleInterest.match(/ID\s*:?\s*(\d+)/i);
        if (idMatch) vehicleId = parseInt(idMatch[1]);
      }

      // Fallback: session context
      const sessionCtx = (session.context as any) || {};
      if (!vehicleId && sessionCtx.vehicleId) {
        vehicleId = sessionCtx.vehicleId;
      }

      if (!vehicleId) {
        const fallback = config.fallbackMessage || "Desculpe, não consegui identificar o veículo de interesse. Pode me dizer qual carro você gostou?";
        await sendTextMessage(ctx.phone, fallback);
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
        await sendTextMessage(ctx.phone, fallback);
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
        await sendTextMessage(ctx.phone, intro);
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
          await sendImageMessage(ctx.phone, imageUrl, caption);
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
