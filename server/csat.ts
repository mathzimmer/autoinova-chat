/**
 * CSAT — pesquisa de satisfação pós-atendimento.
 *
 * Fluxo:
 *  1. Atendente marca a conversa como "Resolvida" → requestCsat() envia
 *     "De 1 a 5, como você avalia nosso atendimento?" e registra pendência.
 *  2. Cliente responde um número 1-5 dentro do prazo → captureCsatReply()
 *     grava a nota, agradece e NÃO reabre a conversa nem aciona a IA.
 *  3. Fora do prazo, a resposta segue o fluxo normal (carência/reativação).
 *
 * Config (settings): csat_enabled ("true"/"false"), csat_window_minutes (padrão 15).
 */
import { eq, and, desc, gte } from "drizzle-orm";
import { csatRatings } from "../drizzle/schema";
import { getDb, getSetting, getConversationById, createMessage } from "./db";
import { emitNewMessage } from "./socket";

const DEFAULT_WINDOW_MINUTES = 15;

const CSAT_QUESTION = "Antes de encerrar: de *1 a 5*, como você avalia nosso atendimento? Sua opinião nos ajuda muito! 🙏";
const CSAT_THANKS: Record<number, string> = {
  1: "Obrigado pelo retorno. Sentimos muito pela experiência — vamos melhorar! 🙏",
  2: "Obrigado pelo retorno. Vamos trabalhar para melhorar! 🙏",
  3: "Obrigado pela avaliação! 🙏",
  4: "Obrigado pela avaliação! Ficamos felizes em ajudar. 😊",
  5: "Muito obrigado! ⭐⭐⭐⭐⭐ Ficamos muito felizes em ajudar!",
};

async function sendToConversation(conv: { channel: string; instanceName?: string | null; phone: string }, text: string): Promise<boolean> {
  try {
    if (conv.channel === "evolution" && conv.instanceName) {
      const { evolutionSendText } = await import("./evolutionService");
      await evolutionSendText(conv.instanceName, conv.phone, text);
      return true;
    }
    const { sendTextMessage, isConfigured } = await import("./whatsapp");
    if (isConfigured() && conv.phone) {
      const r = await sendTextMessage(conv.phone, text);
      return r.success;
    }
  } catch (err) {
    console.error("[CSAT] Erro ao enviar mensagem:", err);
  }
  return false;
}

/** Dispara a pesquisa ao resolver a conversa (fire-and-forget). */
export async function requestCsat(conversationId: number): Promise<void> {
  try {
    const enabled = await getSetting("csat_enabled");
    if (enabled !== "true") return;

    const db = await getDb();
    if (!db) return;
    const conv = await getConversationById(conversationId);
    if (!conv?.phone) return;

    // Evita pesquisa duplicada em sequência (1 por conversa a cada 24h)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await db.select({ id: csatRatings.id }).from(csatRatings)
      .where(and(eq(csatRatings.conversationId, conversationId), gte(csatRatings.requestedAt, dayAgo)))
      .limit(1);
    if (recent.length > 0) return;

    const sent = await sendToConversation(conv as any, CSAT_QUESTION);
    if (!sent) return;

    await db.insert(csatRatings).values({
      conversationId,
      teamMemberId: conv.assignedTo ?? null,
      status: "pending",
    });

    const msg = await createMessage({
      conversationId,
      content: CSAT_QUESTION,
      senderType: "bot",
      senderName: "Pesquisa de Satisfação",
      messageType: "text",
    });
    emitNewMessage(conversationId, msg);
    console.log(`[CSAT] Pesquisa enviada (conversa ${conversationId})`);
  } catch (err) {
    console.error("[CSAT] requestCsat erro:", err);
  }
}

/**
 * Tenta interpretar a mensagem do cliente como nota de CSAT pendente.
 * Retorna true se a mensagem foi consumida pela pesquisa (não seguir fluxo normal).
 */
export async function captureCsatReply(conversationId: number, content: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const windowMinutes = Number(await getSetting("csat_window_minutes")) || DEFAULT_WINDOW_MINUTES;
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);

    const pending = await db.select().from(csatRatings)
      .where(and(eq(csatRatings.conversationId, conversationId), eq(csatRatings.status, "pending")))
      .orderBy(desc(csatRatings.requestedAt))
      .limit(1);
    if (pending.length === 0) return false;

    const entry = pending[0];
    if (entry.requestedAt < cutoff) {
      // Prazo expirou — marca e segue fluxo normal
      await db.update(csatRatings).set({ status: "expired" }).where(eq(csatRatings.id, entry.id));
      return false;
    }

    // Aceita "5", "5 estrelas", "nota 4", emoji numérico etc. — primeiro dígito 1-5
    const match = content.trim().match(/^(?:nota\s*)?([1-5])(?:\D|$)/i);
    if (!match) return false; // não é nota → segue fluxo normal (pendência continua até expirar)

    const rating = Number(match[1]);
    await db.update(csatRatings).set({ rating, status: "rated", ratedAt: new Date() }).where(eq(csatRatings.id, entry.id));

    const conv = await getConversationById(conversationId);
    if (conv) {
      const thanks = CSAT_THANKS[rating] || CSAT_THANKS[3];
      await sendToConversation(conv as any, thanks);
      const msg = await createMessage({
        conversationId,
        content: thanks,
        senderType: "bot",
        senderName: "Pesquisa de Satisfação",
        messageType: "text",
      });
      emitNewMessage(conversationId, msg);
    }
    console.log(`[CSAT] Nota ${rating} registrada (conversa ${conversationId})`);
    return true;
  } catch (err) {
    console.error("[CSAT] captureCsatReply erro:", err);
    return false;
  }
}
