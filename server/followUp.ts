/**
 * Follow-up Automático de Leads Frios — AutoInova Chat
 *
 * Roda periodicamente via setInterval (intervalo configurável).
 * Busca conversas com IA ativa que ficaram sem resposta do cliente.
 * Gera uma mensagem personalizada via IA e envia via WhatsApp.
 * Após 24h da janela, usa template aprovado pela Meta.
 * Configurações são lidas do banco (settings table).
 */

import { getDb, getSetting, upsertSetting } from "./db";
import { conversations, messages, leads, followUpLogs } from "../drizzle/schema";
import { eq, lt, and, desc, sql } from "drizzle-orm";
import { sendTextMessage, isConfigured as isWhatsAppConfigured } from "./whatsapp";
import { sendWhatsAppTemplate } from "./whatsappTemplates";
import { invokeLLM } from "./_core/llm";
import { createMessage } from "./db";

// ─── Default settings ────────────────────────────────────────────────────────

export const FOLLOW_UP_DEFAULTS = {
  enabled: true,
  maxAttempts: 3,
  inactiveHours: 24,
  intervalHours: 6,
  maxPerRun: 20,
  useTemplateAfter24h: true,
  templateName: "follow_up_reengajamento",
  messages: [
    "Primeira tentativa. Abordagem: curiosidade e disponibilidade. Tom: amigável e leve.",
    "Segunda tentativa. Abordagem: urgência suave (estoque limitado ou novidade). Tom: prestativo.",
    "Terceira e última tentativa. Abordagem: encerramento gentil. Deixar a porta aberta. Tom: respeitoso.",
  ],
};

export type FollowUpConfig = {
  enabled: boolean;
  maxAttempts: number;
  inactiveHours: number;
  intervalHours: number;
  maxPerRun: number;
  useTemplateAfter24h: boolean;
  templateName: string;
  messages: string[];
};

// ─── Read/Write config from DB ───────────────────────────────────────────────

export async function getFollowUpConfig(): Promise<FollowUpConfig> {
  const raw = await getSetting("followup_config");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return { ...FOLLOW_UP_DEFAULTS, ...parsed };
    } catch {
      // corrupted, return defaults
    }
  }
  return { ...FOLLOW_UP_DEFAULTS };
}

export async function saveFollowUpConfig(config: Partial<FollowUpConfig>, userId?: number): Promise<FollowUpConfig> {
  const current = await getFollowUpConfig();
  const merged = { ...current, ...config };
  await upsertSetting("followup_config", JSON.stringify(merged), userId);
  return merged;
}

// ─── Get follow-up history ───────────────────────────────────────────────────

export async function getFollowUpHistory(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };

  const [logsResult, countResult] = await Promise.all([
    db
      .select({
        id: followUpLogs.id,
        conversationId: followUpLogs.conversationId,
        phone: followUpLogs.phone,
        message: followUpLogs.message,
        sentAt: followUpLogs.sentAt,
        attemptNumber: followUpLogs.attemptNumber,
        contactName: conversations.contactName,
      })
      .from(followUpLogs)
      .leftJoin(conversations, eq(followUpLogs.conversationId, conversations.id))
      .orderBy(desc(followUpLogs.sentAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(followUpLogs),
  ]);

  return { logs: logsResult, total: countResult[0]?.count ?? 0 };
}

export async function getFollowUpStats() {
  const db = await getDb();
  if (!db) return { total: 0, last24h: 0, last7d: 0, byAttempt: [] as { attempt: number; count: number }[] };

  const now = Date.now();
  const h24 = now - 24 * 60 * 60 * 1000;
  const d7 = now - 7 * 24 * 60 * 60 * 1000;

  const [totalR, last24hR, last7dR, byAttemptR] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(followUpLogs),
    db.select({ count: sql<number>`count(*)` }).from(followUpLogs).where(sql`${followUpLogs.sentAt} >= FROM_UNIXTIME(${Math.floor(h24 / 1000)})`),
    db.select({ count: sql<number>`count(*)` }).from(followUpLogs).where(sql`${followUpLogs.sentAt} >= FROM_UNIXTIME(${Math.floor(d7 / 1000)})`),
    db.select({
      attempt: followUpLogs.attemptNumber,
      count: sql<number>`count(*)`,
    }).from(followUpLogs).groupBy(followUpLogs.attemptNumber),
  ]);

  return {
    total: totalR[0]?.count ?? 0,
    last24h: last24hR[0]?.count ?? 0,
    last7d: last7dR[0]?.count ?? 0,
    byAttempt: byAttemptR.map(r => ({ attempt: r.attempt, count: r.count })),
  };
}

// ─── Generate follow-up message via AI ───────────────────────────────────────
// Exportada para reuso pelo motor único de reengajamento (PR #6, estratégia ai_message).

export async function generateFollowUpMessage(
  customerName: string | null,
  leadData: {
    vehicleInterest?: string | null;
    intention?: string | null;
    paymentMethod?: string | null;
    attemptNumber: number;
  },
  config: FollowUpConfig
): Promise<string> {
  const nome = customerName || "cliente";
  const veiculo = leadData.vehicleInterest || "veículo";
  const tentativa = leadData.attemptNumber;

  const contexto = config.messages[Math.min(tentativa - 1, config.messages.length - 1)]
    || FOLLOW_UP_DEFAULTS.messages[Math.min(tentativa - 1, 2)];

  const prompt = `Você é assistente da Auto Inova - Matriz, concessionária em Ivoti-RS.

Escreva UMA mensagem de WhatsApp curta (2-3 linhas no máximo) de follow-up para ${nome}.
Esse cliente demonstrou interesse em: ${veiculo}.
${leadData.paymentMethod ? `Forma de pagamento: ${leadData.paymentMethod}.` : ""}

Contexto desta tentativa: ${contexto}

REGRAS ABSOLUTAS:
- Máximo 3 frases curtas
- NÃO use asteriscos, listas, markdown ou formatação
- NÃO mencione que está fazendo follow-up
- NÃO use frases genéricas como "posso ajudar"
- Seja específico sobre o ${veiculo}
- Termine com uma pergunta ou call to action simples
- Escreva em português brasileiro casual, como uma mensagem natural de WhatsApp`;

  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: "Você escreve mensagens curtas e naturais de WhatsApp para concessionária." },
        { role: "user", content: prompt },
      ],
    });

    const text = result.choices[0]?.message?.content;
    if (typeof text === "string" && text.trim().length > 0) {
      return text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .trim();
    }
  } catch (e) {
    console.error("[FollowUp] Falha ao gerar mensagem via IA:", e);
  }

  // Fallback
  const fallbacks = [
    `Oi ${nome}! Tudo bem? Vi que você tinha interesse ${veiculo ? `no ${veiculo}` : "em algum veículo"}. Ainda quer mais informações?`,
    `${nome}, o ${veiculo || "veículo"} que você consultou ainda está disponível. Quer agendar uma visita ou prefere mais detalhes por aqui?`,
    `Olá ${nome}! Encerrando nosso contato por enquanto. Quando quiser retomar, é só chamar aqui.`,
  ];
  return fallbacks[Math.min(leadData.attemptNumber - 1, 2)];
}

// ─── Main job ────────────────────────────────────────────────────────────────

export async function runFollowUpJob(): Promise<{ sent: number; skipped: number; errors: number }> {
  console.log("[FollowUp] Iniciando job de follow-up...");

  // Gate do motor v2 (PR #6): quando o motor único de reengajamento está ligado,
  // este job legado fica inerte (evita reengajamento duplo no mesmo lead).
  try {
    const { isReengagementV2Enabled } = await import("./reengagement");
    if (await isReengagementV2Enabled()) {
      console.log("[FollowUp] Motor v2 de reengajamento ativo — job legado inerte.");
      return { sent: 0, skipped: 0, errors: 0 };
    }
  } catch { /* módulo v2 indisponível → segue legado */ }

  const config = await getFollowUpConfig();

  if (!config.enabled) {
    console.log("[FollowUp] Follow-up desativado nas configurações.");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  if (!isWhatsAppConfigured()) {
    console.log("[FollowUp] WhatsApp não configurado, pulando.");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const db = await getDb();
  if (!db) {
    console.log("[FollowUp] Database indisponível, pulando.");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const cutoffTime = Date.now() - config.inactiveHours * 60 * 60 * 1000;

  try {
    const inactiveConversations = await db
      .select({
        id:            conversations.id,
        phone:         conversations.phone,
        contactName:   conversations.contactName,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, "open"),
          eq(conversations.aiActive, true),
          lt(conversations.lastMessageAt, cutoffTime),
        )
      )
      .limit(config.maxPerRun);

    console.log(`[FollowUp] ${inactiveConversations.length} conversas inativas encontradas.`);

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const conv of inactiveConversations) {
      try {
        // Count existing attempts
        const existingFollowUps = await db
          .select({ id: followUpLogs.id, attemptNumber: followUpLogs.attemptNumber })
          .from(followUpLogs)
          .where(eq(followUpLogs.conversationId, conv.id))
          .orderBy(desc(followUpLogs.sentAt))
          .limit(1);

        const lastAttempt = existingFollowUps[0];
        const attemptNumber = lastAttempt ? lastAttempt.attemptNumber + 1 : 1;

        if (lastAttempt && lastAttempt.attemptNumber >= config.maxAttempts) {
          skipped++;
          continue;
        }

        // Check if last message was from bot (don't re-send)
        const lastMessages = await db
          .select({ senderType: messages.senderType })
          .from(messages)
          .where(eq(messages.conversationId, conv.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        if (lastMessages.length > 0 && lastMessages[0].senderType === "bot") {
          skipped++;
          continue;
        }

        // Get lead data for personalization
        const leadRows = await db
          .select()
          .from(leads)
          .where(eq(leads.conversationId, conv.id))
          .limit(1);

        const leadData = leadRows[0];

        // Check if we're past the 24h window and should use template
        const hoursSinceLastMessage = conv.lastMessageAt
          ? (Date.now() - conv.lastMessageAt) / (60 * 60 * 1000)
          : 999;

        let followUpMsg: string;
        let usedTemplate = false;

        if (config.useTemplateAfter24h && hoursSinceLastMessage > 24 && config.templateName) {
          // Try to send via WhatsApp template (post-24h)
          try {
            const templateResult = await sendWhatsAppTemplate(
              conv.phone,
              config.templateName,
              [conv.contactName || "cliente"]
            );
            if (templateResult.success) {
              followUpMsg = `[Template: ${config.templateName}] Enviado com sucesso`;
              usedTemplate = true;
            } else {
              // Template failed, fall back to regular message
              followUpMsg = await generateFollowUpMessage(conv.contactName, {
                vehicleInterest: leadData?.vehicleInterest,
                intention: leadData?.intention,
                paymentMethod: leadData?.paymentMethod,
                attemptNumber,
              }, config);
            }
          } catch {
            followUpMsg = await generateFollowUpMessage(conv.contactName, {
              vehicleInterest: leadData?.vehicleInterest,
              intention: leadData?.intention,
              paymentMethod: leadData?.paymentMethod,
              attemptNumber,
            }, config);
          }
        } else {
          // Within 24h window, send regular message
          followUpMsg = await generateFollowUpMessage(conv.contactName, {
            vehicleInterest: leadData?.vehicleInterest,
            intention: leadData?.intention,
            paymentMethod: leadData?.paymentMethod,
            attemptNumber,
          }, config);
        }

        // Send via WhatsApp (if not already sent via template)
        if (!usedTemplate) {
          await sendTextMessage(conv.phone, followUpMsg);
        }

        // Save to database
        await createMessage({
          conversationId: conv.id,
          content: usedTemplate ? followUpMsg : followUpMsg,
          senderType: "bot",
          senderName: "Auto Inova - Matriz IA",
          messageType: "text",
        });

        await db.insert(followUpLogs).values({
          conversationId: conv.id,
          phone: conv.phone,
          message: followUpMsg,
          sentAt: new Date(),
          attemptNumber,
        });

        sent++;
        console.log(`[FollowUp] Follow-up #${attemptNumber} enviado para ${conv.phone}${usedTemplate ? " (template)" : ""}`);

        // Rate limit
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        console.error(`[FollowUp] Erro ao processar conversa #${conv.id}:`, err);
        errors++;
      }
    }

    console.log(`[FollowUp] Concluído: ${sent} enviados, ${skipped} pulados, ${errors} erros.`);
    return { sent, skipped, errors };

  } catch (err) {
    console.error("[FollowUp] Erro no job:", err);
    return { sent: 0, skipped: 0, errors: 1 };
  }
}

// ─── Start periodic job ──────────────────────────────────────────────────────

let followUpInterval: ReturnType<typeof setInterval> | null = null;

export function startFollowUpJob(): void {
  // Run after 30s delay on startup
  setTimeout(() => {
    runFollowUpJobLocked().catch(err => console.error("[FollowUp] Erro na primeira execução:", err));
  }, 30_000);

  // Schedule periodic runs (re-reads config each time for dynamic interval)
  async function scheduleNext() {
    const config = await getFollowUpConfig();
    const intervalMs = config.intervalHours * 60 * 60 * 1000;

    if (followUpInterval) clearInterval(followUpInterval);

    followUpInterval = setInterval(
      () => {
        runFollowUpJobLocked().catch(err => console.error("[FollowUp] Erro no job periódico:", err));
      },
      intervalMs
    );

    console.log(`[FollowUp] Job agendado: a cada ${config.intervalHours}h, inativo > ${config.inactiveHours}h, máx ${config.maxPerRun}/execução, ${config.enabled ? "ATIVO" : "DESATIVADO"}`);
  }

  scheduleNext();
}

// Lock distribuído (PR #5): evita execução dupla com múltiplos processos/containers
async function runFollowUpJobLocked(): Promise<void> {
  const { withJobLock } = await import("./jobLock");
  await withJobLock("followup_job", async () => { await runFollowUpJob(); });
}

export function restartFollowUpJob(): void {
  if (followUpInterval) clearInterval(followUpInterval);
  startFollowUpJob();
}
