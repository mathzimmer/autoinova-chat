// ═══════════════════════════════════════════════════════════════════════════════
// ARQUIVO: server/followUp.ts  (ARQUIVO NOVO — criar do zero)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Follow-up Automático de Leads Frios — AutoInova Chat
 *
 * Roda a cada 6 horas via setInterval.
 * Busca conversas com IA ativa que ficaram sem resposta do cliente por 24h.
 * Gera uma mensagem personalizada via IA e envia via WhatsApp.
 * Limita a 3 tentativas por lead (evita spam).
 */

import { getDb } from "./db";
import { conversations, messages, leads, followUpLogs } from "../drizzle/schema";
import { eq, lt, and, isNull, desc, sql, gte } from "drizzle-orm";
import { sendTextMessage, isConfigured as isWhatsAppConfigured } from "./whatsapp";
import { invokeLLM } from "./_core/llm";
import { createMessage } from "./db";

const MAX_ATTEMPTS    = 3;          // Máximo de follow-ups por lead
const INACTIVE_HOURS  = 24;         // Horas de inatividade para disparar follow-up
const INTERVAL_HOURS  = 6;          // Com que frequência o job roda
const MAX_PER_RUN     = 20;         // Máximo de follow-ups por execução (evita spammar)

// ─── Gerar mensagem de follow-up personalizada via IA ─────────────────────────

async function generateFollowUpMessage(
  customerName: string | null,
  leadData: {
    vehicleInterest?: string | null;
    intention?: string | null;
    paymentMethod?: string | null;
    attemptNumber: number;
  }
): Promise<string> {
  const nome = customerName || "cliente";
  const veiculo = leadData.vehicleInterest || "veículo";
  const tentativa = leadData.attemptNumber;

  // Diferentes abordagens para cada tentativa
  const contextos = [
    `Primeira tentativa. Abordagem: curiosidade e disponibilidade. Tom: amigável e leve.`,
    `Segunda tentativa. Abordagem: urgência suave (estoque limitado ou novidade). Tom: prestativo.`,
    `Terceira e última tentativa. Abordagem: encerramento gentil. Deixar a porta aberta. Tom: respeitoso.`,
  ];
  const contexto = contextos[Math.min(tentativa - 1, 2)];

  const prompt = `Você é assistente da Auto Inova, concessionária em Ivoti-RS.

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
      // Limpar formatação que possa ter vazado
      return text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .trim();
    }
  } catch (e) {
    console.error("[FollowUp] Falha ao gerar mensagem via IA:", e);
  }

  // Fallback manual caso IA falhe
  const fallbacks = [
    `Oi ${nome}! Tudo bem? Vi que você tinha interesse ${veiculo ? `no ${veiculo}` : "em algum veículo"}. Ainda quer mais informações?`,
    `${nome}, o ${veiculo || "veículo"} que você consultou ainda está disponível. Quer agendar uma visita ou prefere mais detalhes por aqui?`,
    `Olá ${nome}! Encerrando nosso contato por enquanto. Quando quiser retomar, é só chamar aqui. 😊`,
  ];
  return fallbacks[Math.min(leadData.attemptNumber - 1, 2)];
}

// ─── Job principal ────────────────────────────────────────────────────────────

export async function runFollowUpJob(): Promise<void> {
  console.log("[FollowUp] Iniciando job de follow-up...");

  if (!isWhatsAppConfigured()) {
    console.log("[FollowUp] WhatsApp não configurado, pulando.");
    return;
  }

  const db = await getDb();
  if (!db) {
    console.log("[FollowUp] Database indisponível, pulando.");
    return;
  }

  const cutoffTime = Date.now() - INACTIVE_HOURS * 60 * 60 * 1000;

  try {
    // Buscar conversas abertas, com IA ativa, inativas há mais de INACTIVE_HOURS
    const inactiveConversations = await db
      .select({
        id:          conversations.id,
        phone:       conversations.phone,
        contactName: conversations.contactName,
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
      .limit(MAX_PER_RUN);

    console.log(`[FollowUp] ${inactiveConversations.length} conversas inativas encontradas.`);

    let sent = 0;
    let skipped = 0;

    for (const conv of inactiveConversations) {
      try {
        // Contar tentativas já feitas para este lead
        const existingFollowUps = await db
          .select({ id: followUpLogs.id, attemptNumber: followUpLogs.attemptNumber })
          .from(followUpLogs)
          .where(eq(followUpLogs.conversationId, conv.id))
          .orderBy(desc(followUpLogs.sentAt))
          .limit(1);

        const lastAttempt = existingFollowUps[0];
        const attemptNumber = lastAttempt ? lastAttempt.attemptNumber + 1 : 1;

        // Já enviou o máximo de tentativas → pular
        if (lastAttempt && lastAttempt.attemptNumber >= MAX_ATTEMPTS) {
          skipped++;
          continue;
        }

        // Verificar se a última mensagem FOI do cliente (não do bot)
        // Se a última mensagem já foi do bot, não re-mandar
        const lastMessages = await db
          .select({ senderType: messages.senderType, createdAt: messages.createdAt })
          .from(messages)
          .where(eq(messages.conversationId, conv.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        if (lastMessages.length > 0 && lastMessages[0].senderType === "bot") {
          // Já mandamos algo, esperar o cliente responder
          skipped++;
          continue;
        }

        // Buscar dados do lead para personalizar a mensagem
        const leadRows = await db
          .select()
          .from(leads)
          .where(eq(leads.conversationId, conv.id))
          .limit(1);

        const leadData = leadRows[0];

        // Gerar mensagem personalizada
        const followUpMsg = await generateFollowUpMessage(conv.contactName, {
          vehicleInterest: leadData?.vehicleInterest,
          intention:       leadData?.intention,
          paymentMethod:   leadData?.paymentMethod,
          attemptNumber,
        });

        // Enviar via WhatsApp
        await sendTextMessage(conv.phone, followUpMsg);

        // Salvar no banco de dados
        await createMessage({
          conversationId: conv.id,
          content:    followUpMsg,
          senderType: "bot",
          senderName: "Auto Inova IA",
          messageType: "text",
        });

        await db.insert(followUpLogs).values({
          conversationId: conv.id,
          phone:          conv.phone,
          message:        followUpMsg,
          sentAt:         new Date(),
          attemptNumber,
        });

        sent++;
        console.log(`[FollowUp] ✅ Follow-up #${attemptNumber} enviado para ${conv.phone}`);

        // Rate limit: 1 mensagem por segundo
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        console.error(`[FollowUp] Erro ao processar conversa #${conv.id}:`, err);
      }
    }

    console.log(`[FollowUp] Concluído: ${sent} enviados, ${skipped} pulados.`);

  } catch (err) {
    console.error("[FollowUp] Erro no job:", err);
  }
}

// ─── Inicializar job periódico ────────────────────────────────────────────────

export function startFollowUpJob(): void {
  // Rodar imediatamente na inicialização (30s de delay para o servidor subir)
  setTimeout(() => {
    runFollowUpJob().catch(err => console.error("[FollowUp] Erro na primeira execução:", err));
  }, 30_000);

  // Agendar execuções periódicas
  setInterval(
    () => {
      runFollowUpJob().catch(err => console.error("[FollowUp] Erro no job periódico:", err));
    },
    INTERVAL_HOURS * 60 * 60 * 1000
  );

  console.log(`[FollowUp] Job agendado: a cada ${INTERVAL_HOURS}h, inativo > ${INACTIVE_HOURS}h, máx ${MAX_PER_RUN}/execução`);
}
