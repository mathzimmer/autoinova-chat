/**
 * Rescue Job — Gatilho de Tempo para Resgate de Leads Inativos
 *
 * Roda periodicamente via setInterval (a cada 2 minutos).
 * Busca leads inativos (sem resposta do cliente há X minutos).
 * Dispara um fluxo de resgate contextualizado com dados do lead.
 * Respeita limite de tentativas e intervalo entre tentativas.
 * Considera o status do funil para não disparar em leads fechados/perdidos.
 */

import { getDb, getSetting, upsertSetting, createRescueAttempt, getInactiveLeadsForRescue, getLastRescueAttempt, updateRescueAttemptStatus, createMessage } from "./db";
import { conversations, rescueAttempts } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { isConfigured as isWhatsAppConfigured } from "./whatsapp";
// Socket events are emitted via createMessage

// ─── Types ──────────────────────────────────────────────────────

export type RescueConfig = {
  enabled: boolean;
  inactivityMinutes: number;    // Tempo de inatividade mínimo (em minutos)
  maxAttempts: number;           // Máximo de tentativas (1-5)
  intervalMinutes: number;       // Intervalo entre tentativas (em minutos)
  rescueFlowId: number | null;  // ID do fluxo de resgate a executar
  maxPerRun: number;             // Máximo de resgates por execução
  checkIntervalMinutes: number;  // A cada quantos minutos o job roda
};

export const RESCUE_DEFAULTS: RescueConfig = {
  enabled: false,
  inactivityMinutes: 30,
  maxAttempts: 3,
  intervalMinutes: 60,
  rescueFlowId: null,
  maxPerRun: 20,
  checkIntervalMinutes: 2,
};

// ─── Read/Write config from DB ──────────────────────────────────

export async function getRescueConfig(): Promise<RescueConfig> {
  const raw = await getSetting("rescue_config");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return { ...RESCUE_DEFAULTS, ...parsed };
    } catch {
      // corrupted, return defaults
    }
  }
  return { ...RESCUE_DEFAULTS };
}

export async function saveRescueConfig(config: Partial<RescueConfig>, userId?: number): Promise<RescueConfig> {
  const current = await getRescueConfig();
  const merged = { ...current, ...config };
  await upsertSetting("rescue_config", JSON.stringify(merged), userId);
  return merged;
}

// ─── Stats ──────────────────────────────────────────────────────

export async function getRescueStats() {
  const db = await getDb();
  if (!db) return { total: 0, last24h: 0, last7d: 0, responded: 0, byAttempt: [] as { attempt: number; count: number }[] };

  const { sql } = await import("drizzle-orm");
  const now = Date.now();
  const h24 = now - 24 * 60 * 60 * 1000;
  const d7 = now - 7 * 24 * 60 * 60 * 1000;

  const [totalR, last24hR, last7dR, respondedR, byAttemptR] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(rescueAttempts),
    db.select({ count: sql<number>`count(*)` }).from(rescueAttempts).where(sql`${rescueAttempts.sentAt} >= FROM_UNIXTIME(${Math.floor(h24 / 1000)})`),
    db.select({ count: sql<number>`count(*)` }).from(rescueAttempts).where(sql`${rescueAttempts.sentAt} >= FROM_UNIXTIME(${Math.floor(d7 / 1000)})`),
    db.select({ count: sql<number>`count(*)` }).from(rescueAttempts).where(eq(rescueAttempts.status, "responded")),
    db.select({
      attempt: rescueAttempts.attemptNumber,
      count: sql<number>`count(*)`,
    }).from(rescueAttempts).groupBy(rescueAttempts.attemptNumber),
  ]);

  return {
    total: totalR[0]?.count ?? 0,
    last24h: last24hR[0]?.count ?? 0,
    last7d: last7dR[0]?.count ?? 0,
    responded: respondedR[0]?.count ?? 0,
    byAttempt: byAttemptR.map(r => ({ attempt: r.attempt, count: r.count })),
  };
}

// ─── History ────────────────────────────────────────────────────

export async function getRescueHistory(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };

  const { sql } = await import("drizzle-orm");

  const [logsResult, countResult] = await Promise.all([
    db
      .select({
        id: rescueAttempts.id,
        conversationId: rescueAttempts.conversationId,
        leadId: rescueAttempts.leadId,
        flowId: rescueAttempts.flowId,
        attemptNumber: rescueAttempts.attemptNumber,
        status: rescueAttempts.status,
        sentAt: rescueAttempts.sentAt,
        respondedAt: rescueAttempts.respondedAt,
        contactName: conversations.contactName,
        phone: conversations.phone,
      })
      .from(rescueAttempts)
      .leftJoin(conversations, eq(rescueAttempts.conversationId, conversations.id))
      .orderBy(desc(rescueAttempts.sentAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(rescueAttempts),
  ]);

  return { logs: logsResult, total: countResult[0]?.count ?? 0 };
}

// ─── Execute rescue flow for a single lead ──────────────────────

async function executeRescueForLead(
  lead: any,
  conversation: any,
  attemptNumber: number,
  flowId: number,
): Promise<boolean> {
  // Dynamically import to avoid circular dependencies
  const { listChatFlowNodes, listChatFlowEdges } = await import("./db");
  const { resolveChannelSender } = await import("./channelAdapter");

  const nodes = await listChatFlowNodes(flowId);
  const edges = await listChatFlowEdges(flowId);

  if (nodes.length === 0) {
    console.log(`[Rescue] Fluxo ${flowId} não tem nós.`);
    return false;
  }

  const startNode = nodes.find((n: any) => n.nodeType === "start");
  if (!startNode) {
    console.log(`[Rescue] Fluxo ${flowId} não tem nó de início.`);
    return false;
  }

  const channelSender = await resolveChannelSender(conversation.id);

  // Helper function to replace variables in text nodes
  function replaceVars(text: string): string {
    if (!text) return "";
    return text
      .replace(/\{\{nome\}\}/gi, lead.name || conversation.contactName || "cliente")
      .replace(/\{\{nome_completo\}\}/gi, lead.fullName || lead.name || conversation.contactName || "")
      .replace(/\{\{telefone\}\}/gi, conversation.phone || "")
      .replace(/\{\{veiculo\}\}/gi, lead.vehicleInterest || "")
      .replace(/\{\{cidade\}\}/gi, lead.city || "")
      .replace(/\{\{troca\}\}/gi, lead.tradeVehicle || "")
      .replace(/\{\{pagamento\}\}/gi, lead.paymentMethod || "")
      .replace(/\{\{entrada\}\}/gi, lead.downPayment || "")
      .replace(/\{\{email\}\}/gi, lead.email || "")
      .replace(/\{\{notas\}\}/gi, lead.notes || "")
      .replace(/\{\{etapa_funil\}\}/gi, lead.funnelStatus || "novo")
      .replace(/\{\{temperatura\}\}/gi, lead.temperature || "frio")
      .replace(/\{\{intencao\}\}/gi, lead.intention || "")
      .replace(/\{\{tentativa_resgate\}\}/gi, String(attemptNumber));
  }

  // Execute nodes sequentially from start
  let currentNodeId = startNode.id;
  let messagesSent = 0;
  const maxNodes = 20; // Safety limit
  let nodeCount = 0;

  while (currentNodeId && nodeCount < maxNodes) {
    nodeCount++;
    const currentNode = nodes.find((n: any) => n.id === currentNodeId);
    if (!currentNode) break;

    const data = (currentNode.data || {}) as Record<string, any>;

    switch (currentNode.nodeType) {
      case "start":
        // Just advance to next node
        break;

      case "send_message": {
        const text = replaceVars(data.message || "");
        if (text) {
          await channelSender.text(text);
          await createMessage({
            conversationId: conversation.id,
            content: text,
            senderType: "bot",
            senderName: "Auto Inova - Matriz IA (Resgate)",
            messageType: "text",
          });
          messagesSent++;
        }
        break;
      }

      case "send_buttons": {
        const bodyText = replaceVars(data.body || "");
        const buttons = (data.buttons || []).map((b: any) => ({
          id: b.id || b.payload || `btn_${Math.random().toString(36).slice(2, 8)}`,
          title: replaceVars(b.title || b.text || ""),
        }));
        if (bodyText && buttons.length > 0) {
          if (channelSender.buttons) {
            await channelSender.buttons(bodyText, buttons);
          } else {
            await channelSender.text(`${bodyText}\n\n${buttons.map((b: any) => `* [${b.title}]`).join("\n")}`);
          }
          const btnText = `${bodyText}\n\n${buttons.map((b: any) => `[${b.title}]`).join(" ")}`;
          await createMessage({
            conversationId: conversation.id,
            content: btnText,
            senderType: "bot",
            senderName: "Auto Inova - Matriz IA (Resgate)",
            messageType: "text",
          });
          messagesSent++;
        }
        break;
      }

      case "send_image": {
        const imageUrl = data.imageUrl || data.url || "";
        const caption = replaceVars(data.caption || "");
        if (imageUrl) {
          await channelSender.image(imageUrl, caption);
          await createMessage({
            conversationId: conversation.id,
            content: caption || "[Imagem]",
            senderType: "bot",
            senderName: "Auto Inova - Matriz IA (Resgate)",
            messageType: "image",
            metadata: { mediaUrl: imageUrl },
          });
          messagesSent++;
        }
        break;
      }

      case "delay": {
        const seconds = data.seconds || data.delay || 2;
        await new Promise(r => setTimeout(r, Math.min(seconds, 10) * 1000));
        break;
      }

      case "end":
        // Flow completed
        currentNodeId = 0;
        continue;

      case "condition": {
        // Evaluate condition based on lead data
        const field = data.field || "";
        const operator = data.operator || "equals";
        const value = data.value || "";
        let fieldValue = "";

        // Map field names to lead data
        const fieldMap: Record<string, string> = {
          etapa_funil: lead.funnelStatus || "novo",
          temperatura: lead.temperature || "frio",
          intencao: lead.intention || "",
          veiculo: lead.vehicleInterest || "",
          tem_troca: lead.hasTrade ? "sim" : "nao",
          pagamento: lead.paymentMethod || "",
          cidade: lead.city || "",
          tentativa: String(attemptNumber),
        };
        fieldValue = fieldMap[field] || "";

        let conditionMet = false;
        switch (operator) {
          case "equals": conditionMet = fieldValue === value; break;
          case "not_equals": conditionMet = fieldValue !== value; break;
          case "contains": conditionMet = fieldValue.includes(value); break;
          case "not_empty": conditionMet = fieldValue.length > 0; break;
          case "empty": conditionMet = fieldValue.length === 0; break;
          case "greater_than": conditionMet = Number(fieldValue) > Number(value); break;
          case "less_than": conditionMet = Number(fieldValue) < Number(value); break;
        }

        // Find the correct edge based on condition result
        const handle = conditionMet ? "yes" : "no";
        const condEdge = edges.find((e: any) => e.sourceNodeId === currentNodeId && e.sourceHandle === handle);
        if (condEdge) {
          currentNodeId = condEdge.targetNodeId;
          continue;
        }
        // If no matching edge, try default
        const defaultEdge = edges.find((e: any) => e.sourceNodeId === currentNodeId && (e.sourceHandle === "default" || !e.sourceHandle));
        if (defaultEdge) {
          currentNodeId = defaultEdge.targetNodeId;
          continue;
        }
        currentNodeId = 0;
        continue;
      }

      default:
        // Skip unsupported node types in rescue context
        console.log(`[Rescue] Tipo de nó não suportado no resgate: ${currentNode.nodeType}`);
        break;
    }

    // Find next node via edge
    const nextEdge = edges.find((e: any) => e.sourceNodeId === currentNodeId && (e.sourceHandle === "default" || !e.sourceHandle));
    if (nextEdge) {
      currentNodeId = nextEdge.targetNodeId;
    } else {
      break;
    }
  }

  return messagesSent > 0;
}

// ─── Main Job ───────────────────────────────────────────────────

export async function runRescueJob(): Promise<{ sent: number; skipped: number; errors: number }> {
  console.log("[Rescue] Iniciando job de resgate...");

  // Gate do motor v2 (PR #6): quando o motor único de reengajamento está ligado,
  // este job legado fica inerte (evita reengajamento duplo no mesmo lead).
  try {
    const { isReengagementV2Enabled } = await import("./reengagement");
    if (await isReengagementV2Enabled()) {
      console.log("[Rescue] Motor v2 de reengajamento ativo — job legado inerte.");
      return { sent: 0, skipped: 0, errors: 0 };
    }
  } catch { /* módulo v2 indisponível → segue legado */ }

  const config = await getRescueConfig();

  if (!config.enabled) {
    console.log("[Rescue] Resgate desativado nas configurações.");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  if (!config.rescueFlowId) {
    console.log("[Rescue] Nenhum fluxo de resgate configurado.");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  if (!isWhatsAppConfigured()) {
    console.log("[Rescue] WhatsApp não configurado, pulando.");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  try {
    const inactiveLeads = await getInactiveLeadsForRescue(
      config.inactivityMinutes,
      config.maxAttempts,
      config.intervalMinutes,
    );

    console.log(`[Rescue] ${inactiveLeads.length} leads inativos encontrados.`);

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const { lead, conversation, attemptCount } of inactiveLeads) {
      if (sent >= config.maxPerRun) {
        console.log(`[Rescue] Limite de ${config.maxPerRun} por execução atingido.`);
        break;
      }

      const attemptNumber = attemptCount + 1;

      try {
        console.log(`[Rescue] Tentativa #${attemptNumber} para lead ${lead.id} (${conversation.contactName || conversation.phone}) - Etapa: ${lead.funnelStatus}, Temp: ${lead.temperature}`);

        const success = await executeRescueForLead(
          lead,
          conversation,
          attemptNumber,
          config.rescueFlowId,
        );

        if (success) {
          // Register rescue attempt
          await createRescueAttempt({
            conversationId: conversation.id,
            leadId: lead.id,
            flowId: config.rescueFlowId,
            attemptNumber,
            status: "sent",
          });

          sent++;
          console.log(`[Rescue] Resgate #${attemptNumber} enviado para ${conversation.phone} (lead: ${lead.name || "sem nome"})`);

          // Conversation updated via createMessage
        } else {
          skipped++;
          console.log(`[Rescue] Nenhuma mensagem enviada para ${conversation.phone} (fluxo vazio?)`);
        }

        // Rate limit between sends
        await new Promise(r => setTimeout(r, 1500));

      } catch (err) {
        console.error(`[Rescue] Erro ao processar lead ${lead.id}:`, err);
        errors++;
      }
    }

    console.log(`[Rescue] Concluído: ${sent} enviados, ${skipped} pulados, ${errors} erros.`);
    return { sent, skipped, errors };

  } catch (err) {
    console.error("[Rescue] Erro no job:", err);
    return { sent: 0, skipped: 0, errors: 1 };
  }
}

// ─── Mark rescue as responded ───────────────────────────────────

export async function markRescueResponded(conversationId: number): Promise<void> {
  try {
    const lastAttempt = await getLastRescueAttempt(conversationId);
    if (lastAttempt && lastAttempt.status === "sent") {
      await updateRescueAttemptStatus(lastAttempt.id, "responded", new Date());
      console.log(`[Rescue] Tentativa #${lastAttempt.attemptNumber} marcada como respondida para conversa ${conversationId}`);
    }
  } catch (err) {
    console.error(`[Rescue] Erro ao marcar resgate como respondido:`, err);
  }
}

// ─── Start periodic job ─────────────────────────────────────────

let rescueInterval: ReturnType<typeof setInterval> | null = null;

// Lock distribuído: evita execução dupla com múltiplos processos/containers
async function runRescueJobLocked(): Promise<void> {
  const { withJobLock } = await import("./jobLock");
  await withJobLock("rescue_job", async () => { await runRescueJob(); });
}

export function startRescueJob(): void {
  // Run after 60s delay on startup
  setTimeout(() => {
    runRescueJobLocked().catch(err => console.error("[Rescue] Erro na primeira execução:", err));
  }, 60_000);

  // Schedule periodic runs
  async function scheduleNext() {
    const config = await getRescueConfig();
    const intervalMs = config.checkIntervalMinutes * 60 * 1000;

    if (rescueInterval) clearInterval(rescueInterval);

    rescueInterval = setInterval(
      () => {
        runRescueJobLocked().catch(err => console.error("[Rescue] Erro no job periódico:", err));
      },
      Math.max(intervalMs, 60_000) // Mínimo 1 minuto
    );

    console.log(`[Rescue] Job agendado: a cada ${config.checkIntervalMinutes}min, inativo > ${config.inactivityMinutes}min, máx ${config.maxAttempts} tentativas, intervalo ${config.intervalMinutes}min, ${config.enabled ? "ATIVO" : "DESATIVADO"}`);
  }

  scheduleNext();
}

export function restartRescueJob(): void {
  if (rescueInterval) clearInterval(rescueInterval);
  startRescueJob();
}

export function stopRescueJob(): void {
  if (rescueInterval) {
    clearInterval(rescueInterval);
    rescueInterval = null;
    console.log("[Rescue] Job parado.");
  }
}
