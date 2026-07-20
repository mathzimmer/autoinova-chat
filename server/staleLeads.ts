/**
 * Encerramento automático de leads parados.
 *
 * Lead que fica sem NENHUMA resposta do cliente por X dias (padrão 14) e ainda
 * não foi finalizado vira "perdido". Isso:
 *   • mantém o funil limpo (só fica ali quem está realmente em jogo);
 *   • permite o CICLO recomeçar: se a pessoa voltar depois, o sistema reativa e
 *     abre uma oportunidade nova (em vez de continuar num ciclo velho e travado).
 *
 * Nunca mexe em lead "fechado" (venda) nem em quem já está "perdido".
 */
import { and, eq, lt, isNotNull, ne, inArray } from "drizzle-orm";
import { conversations, leads } from "../drizzle/schema";
import { getDb, getSetting, updateLeadFunnelStatus, logTimeline } from "./db";

const DEFAULT_DAYS = 14;
const MAX_PER_RUN = 100;

export async function runStaleLeadCheck(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Desligável e ajustável por configuração
  if ((await getSetting("stale_leads_enabled")) === "false") return;
  const days = Number(await getSetting("stale_leads_days")) || DEFAULT_DAYS;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    // Leads ainda em jogo (não fechados/perdidos e que são leads de verdade)
    const abertos = await db.select().from(leads)
      .where(and(
        ne(leads.funnelStatus, "fechado" as any),
        ne(leads.funnelStatus, "perdido" as any),
        eq(leads.isLead, true),
      ))
      .limit(1000);
    if (abertos.length === 0) return;

    // Última mensagem do cliente em QUALQUER conversa da pessoa
    const ids = abertos.map(l => l.id);
    const convs = await db.select({
      leadId: conversations.leadId,
      lastCustomerMessageAt: conversations.lastCustomerMessageAt,
      lastMessageAt: conversations.lastMessageAt,
    }).from(conversations).where(and(inArray(conversations.leadId, ids), isNotNull(conversations.leadId)));

    const ultimoContato = new Map<number, number>();
    for (const c of convs) {
      if (c.leadId == null) continue;
      const t = Number(c.lastCustomerMessageAt || c.lastMessageAt || 0);
      const cur = ultimoContato.get(c.leadId) || 0;
      if (t > cur) ultimoContato.set(c.leadId, t);
    }

    let encerrados = 0;
    for (const lead of abertos) {
      if (encerrados >= MAX_PER_RUN) break;
      const ultimo = ultimoContato.get(lead.id) || new Date(lead.createdAt as any).getTime();
      if (!ultimo || ultimo >= cutoff) continue; // ainda dentro do prazo

      try {
        // Marca como perdido (fecha a oportunidade aberta como "lost" no fluxo padrão)
        await updateLeadFunnelStatus(lead.conversationId, "perdido");
        await logTimeline({
          conversationId: lead.conversationId, leadId: lead.id,
          action: "lead_encerrado_automatico",
          details: { motivo: `sem resposta há mais de ${days} dias`, dias: days },
        }).catch(() => {});
        encerrados++;
      } catch (e) {
        console.error(`[StaleLeads] falha ao encerrar lead ${lead.id}:`, e);
      }
    }

    if (encerrados > 0) console.log(`[StaleLeads] ${encerrados} lead(s) encerrado(s) por inatividade (${days} dias)`);
  } catch (e) {
    console.error("[StaleLeads] erro:", e);
  }
}
