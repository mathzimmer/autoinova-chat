// ─── IA + Fluxos para conversas Evolution ────────────────────────────────────
// ATÉ AQUI, mensagens inbound da Evolution só eram salvas/espelhadas no inbox —
// NADA disparava fluxo nem IA (diferente de Matriz, Zernio e números oficiais).
// Este módulo é o gatilho que faltava: mesmo motor (processFlowMessage +
// processAIMessage), envio pela instância Evolution via getFlowSender.
//
// Espelha o zernioAI.ts: debounce por conversa → fluxo primeiro → IA "livre"
// só se aiActive + conexão com IA automática ligada.

import {
  getConversationById, listMessages, createMessage, getSetting,
} from "./db";
import { processFlowMessage } from "./flowEngine";
import { processAIMessage } from "./ai";
import { getFlowSender } from "./flowChannelSender";
import { emitNewMessage, emitTypingIndicator } from "./socket";
import { getDebounceDelay } from "./messageDebounce";
import { getStoreConfig } from "./storeConfig";

// ─── Debounce por conversa (mesmo padrão do zernioAI) ────────────────────────
const evolutionBuffers = new Map<number, { timer: ReturnType<typeof setTimeout>; parts: string[] }>();

/** Ponto de entrada: chamado pelo webhook da Evolution após espelhar a mensagem. */
export function runEvolutionAI(conversationId: number, customerMessage: string): void {
  const delay = getDebounceDelay();
  const existing = evolutionBuffers.get(conversationId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.parts.push(customerMessage);
  } else {
    evolutionBuffers.set(conversationId, { timer: null as any, parts: [customerMessage] });
  }
  const entry = evolutionBuffers.get(conversationId)!;
  entry.timer = setTimeout(() => {
    const grouped = entry.parts.join("\n").trim();
    evolutionBuffers.delete(conversationId);
    processEvolutionConversation(conversationId, grouped).catch((e) =>
      console.error(`[EvolutionAI] Conversa ${conversationId}: erro no processamento:`, e)
    );
  }, delay);
}

async function processEvolutionConversation(conversationId: number, customerMessage: string): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv || conv.channel !== "evolution" || !conv.instanceName) return;

  const storeCfg = await getStoreConfig();
  const botName = storeCfg.iaSenderName;

  // Fluxos rodam independente do aiActive (freio de emergência flows_global_enabled).
  const flowsEnabled = (await getSetting("flows_global_enabled")) !== "false";

  // Remetente pela instância Evolution desta conversa (nunca dispara a Matriz)
  const sender = getFlowSender(conv);
  if (!sender) {
    console.warn(`[EvolutionAI] Conversa ${conversationId}: sem sender (jid/metadata ausente)`);
    return;
  }

  emitTypingIndicator(conversationId, true, botName);
  try {
    // ── 1) Fluxo programado (o fluxo ENVIA via sender; aqui só persistimos+emitimos)
    if (flowsEnabled) {
      try {
        const flowResult = await processFlowMessage({
          conversationId,
          phone: conv.phone || "",
          customerMessage,
          contactName: conv.contactName || undefined,
          sender,
        });
        if (flowResult.handled) {
          console.log(`[EvolutionAI] Conversa ${conversationId}: processada pelo Flow Engine (${flowResult.responses.length} respostas)`);
          for (const response of flowResult.responses) {
            const botMsg = await createMessage({ conversationId, content: response, senderType: "bot", senderName: botName, messageType: "text" });
            emitNewMessage(conversationId, botMsg);
          }
          for (const img of flowResult.imageMessages) {
            const imgMsg = await createMessage({ conversationId, content: img.caption || "[Imagem]", senderType: "bot", senderName: botName, messageType: "image", metadata: { mediaUrl: img.imageUrl, caption: img.caption } });
            emitNewMessage(conversationId, imgMsg);
          }
          for (const im of flowResult.interactiveMessages) {
            const body = (im as any).data?.body || "";
            const imMsg = await createMessage({ conversationId, content: body || "[Mensagem interativa]", senderType: "bot", senderName: botName, messageType: "text", metadata: { interactiveType: im.type, interactiveData: (im as any).data } });
            emitNewMessage(conversationId, imMsg);
          }
          return; // fluxo tratou, não passa para a IA
        }
      } catch (flowErr) {
        console.error(`[EvolutionAI] Conversa ${conversationId}: erro no fluxo, fallback IA:`, flowErr);
      }
    }

    // IA "livre" só entra se: aiActive E a conexão permitir (IA automática ligada).
    const freshConv = await getConversationById(conversationId);
    const { isConnectionAiAllowed } = await import("./db");
    if (!freshConv?.aiActive || !(await isConnectionAiAllowed(freshConv))) return;

    // ── 2) Seleção de agente (nó do fluxo → fixado → instância → padrão) ──
    let flowAiOptions: { agentId?: number | null; flowInstruction?: string; onlyTools?: string[]; flowPrompt?: string } | undefined;
    let sessionCtx: any = {};
    try {
      const { getActiveFlowSession } = await import("./db");
      const fs = await getActiveFlowSession(conversationId);
      if (fs) sessionCtx = (fs.context as any) || {};
    } catch { /* noop */ }
    if (sessionCtx.nodeAgentId) {
      flowAiOptions = { agentId: sessionCtx.nodeAgentId, flowInstruction: sessionCtx.aiInstruction || undefined };
    } else {
      const { resolveAgentForConversation } = await import("./agentResolver");
      const r = await resolveAgentForConversation({ agentId: (conv as any).agentId, instanceName: conv.instanceName, channel: "evolution" });
      if (r.agentId) flowAiOptions = { agentId: r.agentId, flowInstruction: sessionCtx.aiInstruction || undefined };
    }
    if (sessionCtx.collectMode) {
      const only = Array.isArray(sessionCtx.collectTools) && sessionCtx.collectTools.length > 0 ? sessionCtx.collectTools : ["atualizar_lead"];
      flowAiOptions = { ...flowAiOptions, onlyTools: only };
    } else if (sessionCtx.discoveryMode && sessionCtx.discoveryPrompt) {
      const only = Array.isArray(sessionCtx.nodeOnlyTools) && sessionCtx.nodeOnlyTools.length > 0 ? sessionCtx.nodeOnlyTools : undefined;
      flowAiOptions = { flowPrompt: sessionCtx.discoveryPrompt, onlyTools: only };
    } else if (Array.isArray(sessionCtx.nodeOnlyTools) && sessionCtx.nodeOnlyTools.length > 0) {
      flowAiOptions = { ...flowAiOptions, onlyTools: sessionCtx.nodeOnlyTools };
    }

    const recent = await listMessages(conversationId, 30);
    const aiResult = await processAIMessage(freshConv as any, recent, customerMessage, flowAiOptions);
    if (aiResult.response) {
      const botMsg = await createMessage({ conversationId, content: aiResult.response, senderType: "bot", senderName: botName, messageType: "text" });
      emitNewMessage(conversationId, botMsg);
      await sender.text(aiResult.response);

      if (aiResult.interactiveMessages && aiResult.interactiveMessages.length > 0) {
        for (const im of aiResult.interactiveMessages) {
          if (im.type === "image" && (im as any).imageUrl) {
            const url = (im as any).imageUrl as string;
            const caption = (im as any).caption || (im as any).body || "";
            const imgMsg = await createMessage({ conversationId, content: caption || "[Imagem do veículo]", senderType: "bot", senderName: botName, messageType: "image", metadata: { mediaUrl: url, caption } });
            emitNewMessage(conversationId, imgMsg);
            if (sender.image) await sender.image(url, caption);
          }
        }
      }
    }
  } finally {
    emitTypingIndicator(conversationId, false, botName);
  }
}
