/**
 * Motor ÚNICO de Reengajamento (PR #6) — substitui os dois motores legados:
 *   - followUp.ts   (mensagem via IA após 24h — estava morto, nunca era iniciado)
 *   - rescueJob.ts  (fluxo de resgate após 30min — interpretador de fluxo duplicado)
 *
 * Uma fila por conversa (reengagementAttempts) + escalonamento único configurável:
 *   passo 1: 30min → fluxo de resgate (via flowEngine DIRETO, triggerRescueFlow)
 *   passo 2: 24h   → mensagem gerada por IA (generateFollowUpMessage do followUp)
 *   passo 3: 48h   → template aprovado pela Meta
 *
 * GARANTIA anti-duplo: a tentativa N só dispara quando a inatividade desde a
 * última mensagem DO CLIENTE atinge o limiar do passo N (limiares crescentes),
 * e conversas cuja última mensagem é do bot são puladas — 1 lead nunca recebe
 * 2 reengajamentos concorrentes.
 *
 * FEATURE FLAG: só roda quando reengagement_config.enabled = true. Enquanto
 * false, os jobs legados seguem ativos (gates em followUp.ts/rescueJob.ts
 * tornam o cutover instantâneo e reversível).
 */

import { getDb, getSetting, upsertSetting, createMessage, getLeadByConversationId } from "./db";
import { getStoreConfig } from "./storeConfig";
import { conversations, leads, messages, reengagementAttempts } from "../drizzle/schema";
import { and, desc, eq, inArray, isNotNull, lt, notInArray, or, sql } from "drizzle-orm";
import { isConfigured as isWhatsAppConfigured } from "./whatsapp";
import { sendWhatsAppTemplate } from "./whatsappTemplates";

// ─── Config ──────────────────────────────────────────────────────────────────

export type ReengagementStrategy = "flow" | "ai_message" | "template";

export interface ReengagementStep {
  /** Minutos de inatividade (desde a última msg do cliente) para este passo disparar. */
  afterMinutes: number;
  strategy: ReengagementStrategy;
  /** Obrigatório quando strategy = "flow". */
  flowId?: number | null;
  /** Obrigatório quando strategy = "template". */
  templateName?: string | null;
}

export type ReengagementConfig = {
  enabled: boolean;
  maxAttempts: number;
  maxPerRun: number;
  checkIntervalMinutes: number;
  steps: ReengagementStep[];
  /** Instruções de tom por tentativa para a estratégia ai_message. */
  aiMessages: string[];
};

export const REENGAGEMENT_DEFAULTS: ReengagementConfig = {
  enabled: false, // FEATURE FLAG — cutover quando ligar
  maxAttempts: 3,
  maxPerRun: 20,
  checkIntervalMinutes: 2,
  steps: [
    { afterMinutes: 30, strategy: "flow", flowId: null },
    { afterMinutes: 1440, strategy: "ai_message" },
    { afterMinutes: 2880, strategy: "template", templateName: "follow_up_reengajamento" },
  ],
  aiMessages: [
    "Primeira tentativa. Abordagem: curiosidade e disponibilidade. Tom: amigável e leve.",
    "Segunda tentativa. Abordagem: urgência suave (estoque limitado ou novidade). Tom: prestativo.",
    "Terceira e última tentativa. Abordagem: encerramento gentil. Deixar a porta aberta. Tom: respeitoso.",
  ],
};

export async function getReengagementConfig(): Promise<ReengagementConfig> {
  const raw = await getSetting("reengagement_config");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return { ...REENGAGEMENT_DEFAULTS, ...parsed };
    } catch { /* corrompido → defaults */ }
  }
  return { ...REENGAGEMENT_DEFAULTS };
}

export async function saveReengagementConfig(config: Partial<ReengagementConfig>, userId?: number): Promise<ReengagementConfig> {
  const current = await getReengagementConfig();
  const merged = { ...current, ...config };
  await upsertSetting("reengagement_config", JSON.stringify(merged), userId);
  return merged;
}

export async function isReengagementV2Enabled(): Promise<boolean> {
  const config = await getReengagementConfig();
  return config.enabled;
}

// ─── Máquina de estados (pura — testada em reengagement.test.ts) ────────────

export interface NextAttemptDecision {
  attemptNumber: number;
  step: ReengagementStep;
}

/**
 * Decide a próxima tentativa para uma conversa, ou null se não for elegível.
 * - attemptNumber = tentativas já feitas + 1 (limitado por maxAttempts e nº de passos)
 * - elegível somente se a inatividade atingiu o limiar do passo correspondente
 * - se a última mensagem da conversa é do bot, aguarda o cliente (anti-duplo)
 */
export function decideNextAttempt(
  config: ReengagementConfig,
  attemptsMade: number,
  lastCustomerMessageAt: number,
  lastMessageSenderType: string | null,
  now: number = Date.now(),
): NextAttemptDecision | null {
  const attemptNumber = attemptsMade + 1;
  const maxSteps = Math.min(config.maxAttempts, config.steps.length);
  if (attemptNumber > maxSteps) return null;

  // Já mandamos mensagem e o cliente não respondeu → aguarda (anti-duplo)
  if (lastMessageSenderType === "bot" || lastMessageSenderType === "agent") return null;

  const step = config.steps[attemptNumber - 1];
  if (!step) return null;

  const inactiveMs = now - lastCustomerMessageAt;
  if (inactiveMs < step.afterMinutes * 60_000) return null;

  return { attemptNumber, step };
}

// ─── Job principal ───────────────────────────────────────────────────────────

export async function runReengagementJob(): Promise<{ sent: number; skipped: number; errors: number }> {
  const config = await getReengagementConfig();

  if (!config.enabled) {
    return { sent: 0, skipped: 0, errors: 0 }; // feature flag desligada — legados ativos
  }

  if (!isWhatsAppConfigured()) {
    console.log("[Reengagement] WhatsApp não configurado, pulando.");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const db = await getDb();
  if (!db) return { sent: 0, skipped: 0, errors: 0 };

  // Limiar mais cedo dos passos — candidatas têm ALGUM nível de inatividade
  const earliestMinutes = Math.min(...config.steps.map(s => s.afterMinutes));
  const cutoff = Date.now() - earliestMinutes * 60_000;

  try {
    const candidates = await db
      .select({
        id: conversations.id,
        phone: conversations.phone,
        contactName: conversations.contactName,
        lastCustomerMessageAt: conversations.lastCustomerMessageAt,
        funnelStatus: leads.funnelStatus,
      })
      .from(conversations)
      .leftJoin(leads, eq(leads.conversationId, conversations.id))
      .where(
        and(
          inArray(conversations.status, ["open", "pending"]),
          eq(conversations.aiActive, true),
          isNotNull(conversations.lastCustomerMessageAt),
          lt(conversations.lastCustomerMessageAt, cutoff),
          or(
            sql`${leads.funnelStatus} IS NULL`,
            notInArray(leads.funnelStatus, ["fechado", "perdido", "encaminhado_vendedor"]),
          ),
        )
      )
      .limit(config.maxPerRun * 3); // margem — o filtro fino é por conversa

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    // PR #9: remetente por loja (era "Auto Inova - Matriz IA" hardcoded)
    const storeCfg = await getStoreConfig();
    const botSenderName = `${storeCfg.iaSenderName} (Reengajamento)`;

    for (const conv of candidates) {
      if (sent >= config.maxPerRun) break;

      try {
        // Tentativas já feitas (motor v2)
        const attempts = await db
          .select({ id: reengagementAttempts.id })
          .from(reengagementAttempts)
          .where(eq(reengagementAttempts.conversationId, conv.id));
        const attemptsMade = attempts.length;

        // Última mensagem (anti-duplo: se é nossa, aguarda o cliente)
        const lastMsg = await db
          .select({ senderType: messages.senderType })
          .from(messages)
          .where(eq(messages.conversationId, conv.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        const decision = decideNextAttempt(
          config,
          attemptsMade,
          Number(conv.lastCustomerMessageAt),
          lastMsg[0]?.senderType ?? null,
        );

        if (!decision) {
          skipped++;
          continue;
        }

        const lead = await getLeadByConversationId(conv.id);
        const { step, attemptNumber } = decision;
        let ok = false;
        let usedMessage = "";
        let usedFlowId: number | null = null;

        if (step.strategy === "flow") {
          const flowId = step.flowId ?? null;
          if (!flowId) {
            console.log(`[Reengagement] Passo ${attemptNumber} é "flow" mas não tem flowId — configure em reengagement_config`);
            skipped++;
            continue;
          }
          usedFlowId = flowId;
          const { triggerRescueFlow } = await import("./flowEngine");
          ok = await triggerRescueFlow(conv.id, flowId, conv.phone, conv.contactName || undefined, attemptNumber);
          usedMessage = `[Fluxo de resgate #${flowId}, tentativa ${attemptNumber}]`;
        } else if (step.strategy === "ai_message") {
          const { generateFollowUpMessage, FOLLOW_UP_DEFAULTS } = await import("./followUp");
          usedMessage = await generateFollowUpMessage(conv.contactName, {
            vehicleInterest: lead?.vehicleInterest,
            intention: lead?.intention,
            paymentMethod: lead?.paymentMethod,
            attemptNumber,
          }, { ...FOLLOW_UP_DEFAULTS, messages: config.aiMessages });

          const { resolveChannelSender } = await import("./channelAdapter");
          const sender = await resolveChannelSender(conv.id);
          await sender.text(usedMessage);
          await createMessage({
            conversationId: conv.id,
            content: usedMessage,
            senderType: "bot",
            senderName: botSenderName,
            messageType: "text",
          });
          ok = true;
        } else {
          // template
          const templateName = step.templateName || "follow_up_reengajamento";
          const result = await sendWhatsAppTemplate(conv.phone, templateName, [conv.contactName || "cliente"]);
          ok = result.success;
          usedMessage = `[Template: ${templateName}]${ok ? "" : ` falhou: ${result.error || "?"}`}`;
          if (ok) {
            await createMessage({
              conversationId: conv.id,
              content: `[Template: ${templateName}] (reengajamento pós-24h)`,
              senderType: "bot",
              senderName: botSenderName,
              messageType: "text",
              metadata: { isTemplate: true },
            });
          }
        }

        await db.insert(reengagementAttempts).values({
          conversationId: conv.id,
          leadId: lead?.id ?? null,
          attemptNumber,
          strategy: step.strategy,
          status: ok ? "sent" : "failed",
          flowId: usedFlowId,
          message: usedMessage || null,
          error: ok ? null : "estratégia não enviou mensagem",
        });

        if (ok) {
          sent++;
          console.log(`[Reengagement] Tentativa #${attemptNumber} (${step.strategy}) enviada para ${conv.phone}`);
        } else {
          errors++;
        }

        // Rate limit entre envios
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        console.error(`[Reengagement] Erro ao processar conversa #${conv.id}:`, err);
        errors++;
      }
    }

    console.log(`[Reengagement] Concluído: ${sent} enviados, ${skipped} pulados, ${errors} erros.`);
    return { sent, skipped, errors };
  } catch (err) {
    console.error("[Reengagement] Erro no job:", err);
    return { sent: 0, skipped: 0, errors: 1 };
  }
}

// ─── Marcar como respondido quando o cliente volta ──────────────────────────

export async function markReengagementResponded(conversationId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const last = await db
      .select()
      .from(reengagementAttempts)
      .where(eq(reengagementAttempts.conversationId, conversationId))
      .orderBy(desc(reengagementAttempts.sentAt))
      .limit(1);
    if (last[0] && last[0].status === "sent") {
      await db.update(reengagementAttempts)
        .set({ status: "responded", respondedAt: new Date() })
        .where(eq(reengagementAttempts.id, last[0].id));
      console.log(`[Reengagement] Tentativa #${last[0].attemptNumber} respondida (conversa ${conversationId})`);
    }
  } catch (err) {
    console.error("[Reengagement] Erro ao marcar respondido:", err);
  }
}

// ─── Stats / History ─────────────────────────────────────────────────────────

export async function getReengagementStats() {
  const db = await getDb();
  if (!db) return { total: 0, last24h: 0, last7d: 0, responded: 0, byStrategy: [] as { strategy: string; count: number }[] };

  const h24 = new Date(Date.now() - 24 * 3600_000);
  const d7 = new Date(Date.now() - 7 * 24 * 3600_000);

  const [totalR, last24hR, last7dR, respondedR, byStrategyR] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(reengagementAttempts),
    db.select({ count: sql<number>`count(*)` }).from(reengagementAttempts).where(sql`${reengagementAttempts.sentAt} >= ${h24}`),
    db.select({ count: sql<number>`count(*)` }).from(reengagementAttempts).where(sql`${reengagementAttempts.sentAt} >= ${d7}`),
    db.select({ count: sql<number>`count(*)` }).from(reengagementAttempts).where(eq(reengagementAttempts.status, "responded")),
    db.select({ strategy: reengagementAttempts.strategy, count: sql<number>`count(*)` })
      .from(reengagementAttempts).groupBy(reengagementAttempts.strategy),
  ]);

  return {
    total: totalR[0]?.count ?? 0,
    last24h: last24hR[0]?.count ?? 0,
    last7d: last7dR[0]?.count ?? 0,
    responded: respondedR[0]?.count ?? 0,
    byStrategy: byStrategyR.map(r => ({ strategy: String(r.strategy), count: r.count })),
  };
}

export async function getReengagementHistory(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };

  const [logsResult, countResult] = await Promise.all([
    db.select({
      id: reengagementAttempts.id,
      conversationId: reengagementAttempts.conversationId,
      attemptNumber: reengagementAttempts.attemptNumber,
      strategy: reengagementAttempts.strategy,
      status: reengagementAttempts.status,
      sentAt: reengagementAttempts.sentAt,
      respondedAt: reengagementAttempts.respondedAt,
      contactName: conversations.contactName,
      phone: conversations.phone,
    })
      .from(reengagementAttempts)
      .leftJoin(conversations, eq(reengagementAttempts.conversationId, conversations.id))
      .orderBy(desc(reengagementAttempts.sentAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(reengagementAttempts),
  ]);

  return { logs: logsResult, total: countResult[0]?.count ?? 0 };
}

// ─── Loop periódico (com job lock — PR #5) ───────────────────────────────────

let reengagementInterval: ReturnType<typeof setInterval> | null = null;

async function runReengagementJobLocked(): Promise<void> {
  const { withJobLock } = await import("./jobLock");
  await withJobLock("reengagement_job", async () => { await runReengagementJob(); });
}

export function startReengagementJob(): void {
  setTimeout(() => {
    runReengagementJobLocked().catch(err => console.error("[Reengagement] Erro na primeira execução:", err));
  }, 45_000);

  async function scheduleNext() {
    const config = await getReengagementConfig();
    const intervalMs = Math.max(config.checkIntervalMinutes * 60_000, 60_000);
    if (reengagementInterval) clearInterval(reengagementInterval);
    reengagementInterval = setInterval(() => {
      runReengagementJobLocked().catch(err => console.error("[Reengagement] Erro no job periódico:", err));
    }, intervalMs);
    console.log(`[Reengagement] Motor v2 agendado: a cada ${config.checkIntervalMinutes}min, passos=${config.steps.map(s => `${s.afterMinutes}min:${s.strategy}`).join(" → ")}, ${config.enabled ? "ATIVO (legados inertes)" : "DESATIVADO (legados ativos)"}`);
  }

  scheduleNext();
}

export function restartReengagementJob(): void {
  if (reengagementInterval) clearInterval(reengagementInterval);
  startReengagementJob();
}
