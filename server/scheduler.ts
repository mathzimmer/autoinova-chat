/**
 * Scheduler — worker periódico para lembretes de conversa e mensagens agendadas.
 * Roda a cada 30 segundos (mesmo padrão do rescueJob).
 */
import { eq, and, lte } from "drizzle-orm";
import { conversationReminders, scheduledMessages } from "../drizzle/schema";
import { getDb, getConversationById, createMessage, createTeamNotification } from "./db";
import { emitNewMessage } from "./socket";

const TICK_MS = 30_000;

// ─── Lembretes ───────────────────────────────────────────────────────────────

async function fireDueReminders(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = Date.now();
  // Claim atômico — evita notificação duplicada com ticks concorrentes
  const due = await db.update(conversationReminders)
    .set({ status: "fired", firedAt: new Date() })
    .where(and(eq(conversationReminders.status, "pending"), lte(conversationReminders.remindAt, now)))
    .returning();

  for (const reminder of due) {
    try {
      const conv = await getConversationById(reminder.conversationId);
      const who = conv?.contactName || conv?.phone || `conversa #${reminder.conversationId}`;
      await createTeamNotification({
        userId: reminder.teamMemberId,
        type: "reminder",
        title: `⏰ Lembrete: ${who}`,
        message: reminder.note || "Você pediu para ser lembrado desta conversa.",
        conversationId: reminder.conversationId,
      });
      console.log(`[Scheduler] Lembrete #${reminder.id} disparado (conversa ${reminder.conversationId})`);
    } catch (err) {
      console.error(`[Scheduler] Erro ao disparar lembrete #${reminder.id}:`, err);
    }
  }
}

// ─── Mensagens agendadas ─────────────────────────────────────────────────────

function isWindowExpired(conv: { lastCustomerMessageAt: number | null; windowExpired: number | null }): boolean {
  if (conv.windowExpired) return true;
  if (!conv.lastCustomerMessageAt) return true;
  return Date.now() - Number(conv.lastCustomerMessageAt) > 24 * 60 * 60 * 1000;
}

async function sendDueScheduledMessages(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = Date.now();
  // CLAIM ATÔMICO: marca como "sent" antes de enviar (where status=pending).
  // Se outro tick concorrente tentar, o returning vem vazio — evita envio duplicado.
  const due = await db.update(scheduledMessages)
    .set({ status: "sent", sentAt: new Date() })
    .where(and(eq(scheduledMessages.status, "pending"), lte(scheduledMessages.scheduledAt, now)))
    .returning();

  for (const sm of due) {
    try {
      const conv = await getConversationById(sm.conversationId);
      if (!conv) {
        await db.update(scheduledMessages).set({ status: "failed", error: "Conversa não encontrada" }).where(eq(scheduledMessages.id, sm.id));
        continue;
      }

      const expired = conv.channel === "whatsapp" && isWindowExpired(conv as any);

      if (expired && sm.fallbackTemplateName) {
        // Janela expirada → envia template aprovado como fallback
        const { sendWhatsAppTemplate } = await import("./whatsappTemplates");
        const result = await sendWhatsAppTemplate(conv.phone, sm.fallbackTemplateName);
        if (result.success) {
          const msg = await createMessage({
            conversationId: sm.conversationId,
            content: `[Template: ${sm.fallbackTemplateName}] (mensagem agendada — janela 24h expirada)`,
            senderType: "agent",
            senderName: sm.createdByName || "Agendamento",
            messageType: "text",
            metadata: { isTemplate: true, scheduledMessageId: sm.id },
            externalId: result.messageId,
          });
          emitNewMessage(sm.conversationId, msg);
          await db.update(scheduledMessages).set({ status: "sent", sentAt: new Date() }).where(eq(scheduledMessages.id, sm.id));
        } else {
          await failScheduled(sm, result.error || "Falha ao enviar template fallback");
        }
        continue;
      }

      if (expired) {
        await failScheduled(sm, "Janela de 24h expirada e sem template de fallback");
        continue;
      }

      // Janela aberta → envia texto normal
      const { sendTextMessage } = await import("./whatsapp");
      const result = await sendTextMessage(conv.phone, sm.content);
      if (result.success) {
        const msg = await createMessage({
          conversationId: sm.conversationId,
          content: sm.content,
          senderType: "agent",
          senderName: sm.createdByName || "Agendamento",
          messageType: "text",
          metadata: { scheduledMessageId: sm.id },
          externalId: result.messageId,
        });
        emitNewMessage(sm.conversationId, msg);
        await db.update(scheduledMessages).set({ status: "sent", sentAt: new Date() }).where(eq(scheduledMessages.id, sm.id));
        console.log(`[Scheduler] Mensagem agendada #${sm.id} enviada (conversa ${sm.conversationId})`);
      } else {
        await failScheduled(sm, result.error || "Falha no envio");
      }
    } catch (err) {
      console.error(`[Scheduler] Erro na mensagem agendada #${sm.id}:`, err);
      await failScheduled(sm, err instanceof Error ? err.message : String(err));
    }
  }
}

async function failScheduled(sm: { id: number; conversationId: number; createdBy: number | null }, error: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(scheduledMessages).set({ status: "failed", error }).where(eq(scheduledMessages.id, sm.id));
  if (sm.createdBy) {
    await createTeamNotification({
      userId: sm.createdBy,
      type: "scheduled_message_failed",
      title: "⚠️ Mensagem agendada não enviada",
      message: error,
      conversationId: sm.conversationId,
    }).catch(() => {});
  }
  console.warn(`[Scheduler] Mensagem agendada #${sm.id} falhou: ${error}`);
}

// ─── Loop ────────────────────────────────────────────────────────────────────

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (schedulerInterval) return;
  setTimeout(() => {
    tick().catch(err => console.error("[Scheduler] Erro na primeira execução:", err));
  }, 15_000);
  schedulerInterval = setInterval(() => {
    tick().catch(err => console.error("[Scheduler] Erro no tick:", err));
  }, TICK_MS);
  console.log("[Scheduler] Worker iniciado (lembretes + mensagens agendadas, a cada 30s)");
}

let tickRunning = false;

async function tick(): Promise<void> {
  if (tickRunning) return; // evita ticks sobrepostos (causa de envio duplicado)
  tickRunning = true;
  try {
    const { withJobLock } = await import("./jobLock");
    await withJobLock("scheduler_tick", async () => {
      await fireDueReminders();
      await sendDueScheduledMessages();
    });
  } finally {
    tickRunning = false;
  }
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
