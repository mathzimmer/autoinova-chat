// ─── Auto-qualificação de leads por IA ────────────────────────────────────────
// A cada execução, analisa conversas com mensagem nova do cliente e deixa a IA
// definir o estágio do funil, escrevendo no LEAD CANÔNICO (por telefone) — assim
// recepção e vendedor contam como uma pessoa só, e o CAPI reporta a qualificação
// atribuída ao anúncio. Só AVANÇA o funil (nunca regride) e respeita um teto
// (padrão "negociando"); a venda ("fechado") continua manual.

import {
  getDb, getSetting, getCanonicalLead, getLeadByConversationId,
  funnelRank, FUNNEL_ORDER, updateLeadFunnelStatus, updateConversation, logTimeline,
} from "./db";
import { conversations } from "../drizzle/schema";
import { and, gt, isNotNull, desc } from "drizzle-orm";
import { analyzeConversation } from "./conversationIntelligence";

const MAX_PER_RUN = 15;

export async function runAutoQualify(): Promise<void> {
  if ((await getSetting("auto_qualify_enabled")) !== "true") return;
  const db = await getDb();
  if (!db) return;

  const capStage = (await getSetting("auto_qualify_max_stage")) || "negociando";
  const capRank = funnelRank(capStage);
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000; // ativos nos últimos 3 dias

  let candidates;
  try {
    candidates = await db.select().from(conversations)
      .where(and(isNotNull(conversations.lastCustomerMessageAt), gt(conversations.lastCustomerMessageAt, cutoff)))
      .orderBy(desc(conversations.lastCustomerMessageAt))
      .limit(50);
  } catch (e) {
    console.error("[AutoQualify] falha ao listar conversas:", e);
    return;
  }

  let processed = 0;
  for (const conv of candidates) {
    if (processed >= MAX_PER_RUN) break;
    const meta = (conv.metadata as any) || {};
    const lastMsg = Number(conv.lastCustomerMessageAt || 0);
    const lastQ = Number(meta.autoQualifiedAt || 0);
    if (lastQ >= lastMsg) continue; // já analisado após a última mensagem do cliente

    // Precisa ter lead (senão não há o que qualificar) — marca como visto e segue
    const lead = (await getLeadByConversationId(conv.id)) || (conv.phone ? await getCanonicalLead(conv.phone) : undefined);
    if (!lead) {
      await updateConversation(conv.id, { metadata: { ...meta, autoQualifiedAt: Date.now() } }).catch(() => {});
      continue;
    }

    processed++;
    try {
      const insight = await analyzeConversation(conv.id);
      if (insight) {
        const canon = conv.phone ? await getCanonicalLead(conv.phone) : lead;
        const curRank = funnelRank(canon?.funnelStatus);
        const target = Math.min(funnelRank(insight.funnelStage), capRank);
        if (target > curRank) {
          await updateLeadFunnelStatus(conv.id, FUNNEL_ORDER[target]);
          console.log(`[AutoQualify] conversa ${conv.id}: ${canon?.funnelStatus || "novo"} → ${FUNNEL_ORDER[target]} (IA)`);
        }
        // IA comenta a negociação na timeline do lead (visão gerencial + vendedor)
        await logTimeline({
          conversationId: conv.id,
          action: "ia_comentario",
          details: {
            resumo: insight.summary,
            proximaAcao: insight.nextAction,
            temperatura: insight.temperature,
            score: insight.score,
            objecoes: insight.objections,
          },
        }).catch(() => {});
      }
    } catch (e) {
      console.error(`[AutoQualify] conversa ${conv.id}:`, e);
    }
    await updateConversation(conv.id, { metadata: { ...meta, autoQualifiedAt: Date.now() } }).catch(() => {});
  }

  if (processed > 0) console.log(`[AutoQualify] ${processed} conversa(s) analisada(s)`);
}
