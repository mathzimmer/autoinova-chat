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
} from "./db";
import { sendTextMessage, sendReplyButtons, sendListMessage, sendImageMessage } from "./whatsapp";
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
    .replace(/\{\{pagamento\}\}/gi, ctx.leadData?.paymentMethod || "");
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
      // No match - re-send the interactive message
      result.responses.push("Por favor, selecione uma das opções acima.");
      result.waitingForInput = true;
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
        };
        const leadField = fieldMap[variable] || variable;
        const validFields = ["name","city","tradeVehicle","paymentMethod","downPayment","vehicleInterest","notes","email","cpf"];
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
      await updateFlowSession(session.id, {
        currentNodeId: node.id,
        context: {
          ...((session.context as any) || {}),
          waitInputVariable: config.variable || null,
          waitInputLabel: config.label || "resposta",
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
    // Try exact match on button text
    for (let i = 0; i < buttons.length; i++) {
      const btnText = (buttons[i].text || "").toLowerCase().trim();
      if (msgLower === btnText || msgLower.includes(btnText)) {
        const edge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === `button_${i}`);
        if (edge) return edge.targetNodeId;
      }
    }
    // Fallback: try first matching edge
    const defaultEdge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === "default");
    if (defaultEdge) return defaultEdge.targetNodeId;
    // Try any edge from this node
    const anyEdge = edges.find(e => e.sourceNodeId === node.id);
    return anyEdge?.targetNodeId || null;
  }

  if (node.nodeType === "send_list") {
    const allRows = (config.sections || []).flatMap((s: any) => s.rows || []);
    for (let i = 0; i < allRows.length; i++) {
      const rowTitle = (allRows[i].title || "").toLowerCase().trim();
      if (msgLower === rowTitle || msgLower.includes(rowTitle)) {
        const edge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === `row_${i}`);
        if (edge) return edge.targetNodeId;
      }
    }
    const defaultEdge = edges.find(e => e.sourceNodeId === node.id && e.sourceHandle === "default");
    if (defaultEdge) return defaultEdge.targetNodeId;
    const anyEdge = edges.find(e => e.sourceNodeId === node.id);
    return anyEdge?.targetNodeId || null;
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
