/**
 * Avaliação de vendedores / pré-vendedores — pensa como um gerente de vendas.
 *
 * A nota (0-100) é composta por 5 pilares ponderados:
 *   1. Conversão   (35%) — leads convertidos / recebidos vs. meta.
 *   2. Velocidade  (20%) — tempo médio de 1ª resposta (SLA).
 *   3. Condução    (25%) — a IA lê amostras das conversas e avalia a abordagem.
 *   4. Valor       (10%) — valor total vendido, relativo ao melhor da equipe.
 *   5. Atividade   (10%) — respondeu os leads? deixou algum sem resposta?
 *
 * Métricas quantitativas vêm do banco; a condução + dicas vêm da IA.
 */
import { and, eq, gte, inArray, ne, desc } from "drizzle-orm";
import {
  conversations as convTable,
  messages as messagesTable,
  leads as leadsTable,
  leadOpportunities,
  teamMembers,
  vehicles as vehiclesTable,
  sellerEvaluations,
} from "../drizzle/schema";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";

// ── Metas / benchmarks configuráveis (padrões de um gerente exigente) ──────────
const TARGET_CONVERSION = 0.2;      // 20% de conversão = nota máxima nesse pilar
const IDEAL_RESPONSE_SEC = 120;     // até 2 min = excelente
const BAD_RESPONSE_SEC = 30 * 60;   // 30 min ou mais = nota zero em velocidade

export type SellerMetrics = {
  memberId: number;
  name: string;
  cargo: string;
  leadsReceived: number;
  leadsConverted: number;
  conversionRate: number;
  avgFirstResponseSec: number;
  valueSoldCents: number;
  leadsNoReply: number;
  messagesSent: number;
  // pilares (0-100) — condução é preenchida só na avaliação com IA
  conversionScore: number;
  speedScore: number;
  valueScore: number;
  activityScore: number;
  conductScore: number;   // 0 até rodar a IA; usa último salvo se houver
  score: number;          // nota final parcial (sem IA) ou completa
  lastEvaluatedAt: Date | null;
};

function clamp(n: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, n)); }

function speedToScore(sec: number): number {
  if (sec <= 0) return 0;                       // sem dados
  if (sec <= IDEAL_RESPONSE_SEC) return 100;
  if (sec >= BAD_RESPONSE_SEC) return 0;
  // decai linearmente entre ideal e ruim
  return clamp(100 * (1 - (sec - IDEAL_RESPONSE_SEC) / (BAD_RESPONSE_SEC - IDEAL_RESPONSE_SEC)));
}

/** Nota final combinando os 5 pilares. conductScore null → redistribui o peso. */
export function combineScore(p: {
  conversionScore: number; speedScore: number; conductScore: number | null;
  valueScore: number; activityScore: number;
}): number {
  const w = { conversion: 0.35, speed: 0.2, conduct: 0.25, value: 0.1, activity: 0.1 };
  if (p.conductScore == null) {
    // sem análise de IA ainda — reponderar os outros 4 (peso da condução some)
    const total = w.conversion + w.speed + w.value + w.activity;
    return Math.round(clamp(
      (p.conversionScore * w.conversion + p.speedScore * w.speed +
       p.valueScore * w.value + p.activityScore * w.activity) / total,
    ));
  }
  return Math.round(clamp(
    p.conversionScore * w.conversion + p.speedScore * w.speed +
    p.conductScore * w.conduct + p.valueScore * w.value + p.activityScore * w.activity,
  ));
}

/**
 * Calcula as métricas de toda a equipe (ou de um atendente) num período.
 * instanceName: se informado, restringe às conversas daquela instância/número.
 */
export async function computeTeamPerformance(opts: {
  sinceDays: number; memberId?: number; instanceName?: string;
}): Promise<SellerMetrics[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000);

  // Atendentes ativos
  const membersRaw = await db.select().from(teamMembers).where(eq(teamMembers.status, "ativo" as any));
  const members = opts.memberId ? membersRaw.filter(m => m.id === opts.memberId) : membersRaw;
  if (members.length === 0) return [];
  const memberIds = members.map(m => m.id);

  // Conversas do período atribuídas a esses atendentes (+ filtro de instância)
  const convConds = [gte(convTable.lastMessageAt, since.getTime()), inArray(convTable.assignedTo, memberIds)];
  if (opts.instanceName) convConds.push(eq(convTable.instanceName, opts.instanceName));
  const convs = await db.select({
    id: convTable.id, assignedTo: convTable.assignedTo, leadId: convTable.leadId,
  }).from(convTable).where(and(...convConds));

  const convByMember = new Map<number, number[]>();
  const convIds: number[] = [];
  for (const c of convs) {
    if (c.assignedTo == null) continue;
    convIds.push(c.id);
    const arr = convByMember.get(c.assignedTo) || [];
    arr.push(c.id);
    convByMember.set(c.assignedTo, arr);
  }

  // Mensagens dessas conversas (para tempo de resposta + atividade)
  const msgs = convIds.length
    ? await db.select({
        conversationId: messagesTable.conversationId,
        senderType: messagesTable.senderType,
        createdAt: messagesTable.createdAt,
      }).from(messagesTable)
        .where(and(inArray(messagesTable.conversationId, convIds), gte(messagesTable.createdAt, since)))
        .orderBy(messagesTable.createdAt)
    : [];
  const msgsByConv = new Map<number, { senderType: string; t: number }[]>();
  for (const m of msgs) {
    const arr = msgsByConv.get(m.conversationId) || [];
    arr.push({ senderType: m.senderType as string, t: new Date(m.createdAt as any).getTime() });
    msgsByConv.set(m.conversationId, arr);
  }

  // Leads recebidos x convertidos + valor vendido (por atendente)
  const leadConds = [gte(leadsTable.createdAt, since), inArray(leadsTable.ownerId, memberIds), eq(leadsTable.isLead, true)];
  const leadRows = await db.select({
    id: leadsTable.id, ownerId: leadsTable.ownerId, funnelStatus: leadsTable.funnelStatus, vehicleId: leadsTable.vehicleId,
  }).from(leadsTable).where(and(...leadConds));

  // Oportunidades ganhas no período (valor de venda) — via lead → owner
  const leadIdToOwner = new Map<number, number>();
  for (const l of leadRows) if (l.ownerId != null) leadIdToOwner.set(l.id, l.ownerId);
  const wonOpps = leadRows.length
    ? await db.select({ leadId: leadOpportunities.leadId, valueCents: leadOpportunities.valueCents, vehicleId: leadOpportunities.vehicleId })
        .from(leadOpportunities)
        .where(and(eq(leadOpportunities.status, "won"), gte(leadOpportunities.closedAt, since)))
    : [];

  // Preço de veículos p/ estimar valor quando a oportunidade não tem valueCents
  const vehIds = Array.from(new Set([...leadRows.map(l => l.vehicleId), ...wonOpps.map(o => o.vehicleId)].filter((x): x is number => x != null)));
  const vehPrice = new Map<number, number>();
  if (vehIds.length) {
    const vrows = await db.select({ id: vehiclesTable.id, price: vehiclesTable.price }).from(vehiclesTable).where(inArray(vehiclesTable.id, vehIds));
    for (const v of vrows) vehPrice.set(v.id, v.price || 0);
  }

  // Agrega por atendente
  const perMember = new Map<number, { received: number; converted: number; valueCents: number }>();
  for (const m of members) perMember.set(m.id, { received: 0, converted: 0, valueCents: 0 });
  for (const l of leadRows) {
    if (l.ownerId == null) continue;
    const agg = perMember.get(l.ownerId); if (!agg) continue;
    agg.received++;
    if (l.funnelStatus === "fechado") agg.converted++;
  }
  for (const o of wonOpps) {
    const owner = leadIdToOwner.get(o.leadId); if (owner == null) continue;
    const agg = perMember.get(owner); if (!agg) continue;
    const val = (o.valueCents && o.valueCents > 0) ? o.valueCents : (o.vehicleId ? (vehPrice.get(o.vehicleId) || 0) * 100 : 0);
    agg.valueCents += val;
  }

  // Máximo de valor vendido (p/ normalizar o pilar de valor)
  const maxValue = Math.max(1, ...Array.from(perMember.values()).map(a => a.valueCents));

  const result: SellerMetrics[] = [];
  // Última avaliação de IA salva (p/ reaproveitar a nota de condução no ranking).
  // Resiliente: se a tabela ainda não existe (migração pendente), segue sem ela.
  type EvalRow = typeof sellerEvaluations.$inferSelect;
  const lastEvalByMember = new Map<number, EvalRow>();
  try {
    const lastEvals = await db.select().from(sellerEvaluations)
      .where(inArray(sellerEvaluations.memberId, memberIds))
      .orderBy(desc(sellerEvaluations.createdAt));
    for (const e of lastEvals) if (!lastEvalByMember.has(e.memberId)) lastEvalByMember.set(e.memberId, e);
  } catch (err) {
    console.warn("[Perf] sellerEvaluations indisponível (rode a migração):", err instanceof Error ? err.message : err);
  }

  for (const m of members) {
    const agg = perMember.get(m.id)!;
    const myConvs = convByMember.get(m.id) || [];

    // Tempo de 1ª resposta + atividade
    let respSum = 0, respCount = 0, messagesSent = 0, leadsNoReply = 0;
    for (const cid of myConvs) {
      const list = msgsByConv.get(cid) || [];
      let firstCustomer = -1, firstAgentAfter = -1, hasAgent = false;
      for (const ev of list) {
        if (ev.senderType === "agent") { hasAgent = true; messagesSent++; }
        if (firstCustomer < 0 && ev.senderType === "customer") firstCustomer = ev.t;
        if (firstCustomer >= 0 && firstAgentAfter < 0 && ev.senderType === "agent" && ev.t >= firstCustomer) firstAgentAfter = ev.t;
      }
      if (firstCustomer >= 0 && firstAgentAfter >= 0) {
        respSum += (firstAgentAfter - firstCustomer) / 1000;
        respCount++;
      }
      // conversa com cliente mas sem NENHUMA resposta humana = lead largado
      const hasCustomer = list.some(e => e.senderType === "customer");
      if (hasCustomer && !hasAgent) leadsNoReply++;
    }
    const avgResp = respCount ? Math.round(respSum / respCount) : 0;

    const conversionRate = agg.received ? agg.converted / agg.received : 0;
    const conversionScore = Math.round(clamp((conversionRate / TARGET_CONVERSION) * 100));
    const speedScore = Math.round(speedToScore(avgResp));
    const valueScore = Math.round(clamp((agg.valueCents / maxValue) * 100));
    const totalHandled = myConvs.length || 1;
    const activityScore = Math.round(clamp(100 * (1 - leadsNoReply / totalHandled)));

    const lastEval = lastEvalByMember.get(m.id) || null;
    const conductScore = lastEval?.conductScore ?? 0;
    const hasConduct = !!lastEval;

    const score = combineScore({
      conversionScore, speedScore, valueScore, activityScore,
      conductScore: hasConduct ? conductScore : null,
    });

    result.push({
      memberId: m.id, name: m.name, cargo: m.cargo as string,
      leadsReceived: agg.received, leadsConverted: agg.converted, conversionRate,
      avgFirstResponseSec: avgResp, valueSoldCents: agg.valueCents,
      leadsNoReply, messagesSent,
      conversionScore, speedScore, valueScore, activityScore,
      conductScore: hasConduct ? conductScore : 0,
      score, lastEvaluatedAt: lastEval?.createdAt ?? null,
    });
  }

  result.sort((a, b) => b.score - a.score);
  return result;
}

// ── Performance por INSTÂNCIA / número (em vez de por atendente) ────────────────

export type InstanceMetrics = {
  instanceName: string;
  label: string;
  leadsReceived: number;
  leadsConverted: number;
  conversionRate: number;
  avgFirstResponseSec: number;
  valueSoldCents: number;
  leadsNoReply: number;
  messagesSent: number;
  conversionScore: number;
  speedScore: number;
  valueScore: number;
  activityScore: number;
  conductScore: number;
  score: number;
  lastEvaluatedAt: Date | null;
};

/** Sentinela usada em sellerEvaluations.memberId para avaliações por instância. */
const INSTANCE_MEMBER_SENTINEL = 0;

export async function computeInstancePerformance(opts: { sinceDays: number }): Promise<InstanceMetrics[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000);
  const { isNotNull } = await import("drizzle-orm");

  // Conversas do período que têm instância definida
  const convs = await db.select({
    id: convTable.id, instanceName: convTable.instanceName, leadId: convTable.leadId,
  }).from(convTable).where(and(gte(convTable.lastMessageAt, since.getTime()), isNotNull(convTable.instanceName)));
  if (convs.length === 0) return [];

  const convsByInstance = new Map<string, number[]>();
  const leadsByInstance = new Map<string, Set<number>>();
  const allConvIds: number[] = [];
  for (const c of convs) {
    const inst = c.instanceName as string;
    if (!inst) continue;
    allConvIds.push(c.id);
    (convsByInstance.get(inst) || convsByInstance.set(inst, []).get(inst)!).push(c.id);
    if (c.leadId != null) (leadsByInstance.get(inst) || leadsByInstance.set(inst, new Set()).get(inst)!).add(c.leadId);
  }

  // Mensagens (tempo de resposta + atividade)
  const msgs = allConvIds.length
    ? await db.select({ conversationId: messagesTable.conversationId, senderType: messagesTable.senderType, createdAt: messagesTable.createdAt })
        .from(messagesTable).where(and(inArray(messagesTable.conversationId, allConvIds), gte(messagesTable.createdAt, since)))
        .orderBy(messagesTable.createdAt)
    : [];
  const msgsByConv = new Map<number, { senderType: string; t: number }[]>();
  for (const m of msgs) {
    (msgsByConv.get(m.conversationId) || msgsByConv.set(m.conversationId, []).get(m.conversationId)!)
      .push({ senderType: m.senderType as string, t: new Date(m.createdAt as any).getTime() });
  }

  // Leads envolvidos (recebidos/convertidos) + valor
  const allLeadIds = Array.from(new Set(convs.map(c => c.leadId).filter((x): x is number => x != null)));
  const leadRows = allLeadIds.length
    ? await db.select({ id: leadsTable.id, funnelStatus: leadsTable.funnelStatus, isLead: leadsTable.isLead })
        .from(leadsTable).where(inArray(leadsTable.id, allLeadIds))
    : [];
  const leadInfo = new Map<number, { fechado: boolean; isLead: boolean }>();
  for (const l of leadRows) leadInfo.set(l.id, { fechado: l.funnelStatus === "fechado", isLead: l.isLead });
  const wonOpps = allLeadIds.length
    ? await db.select({ leadId: leadOpportunities.leadId, valueCents: leadOpportunities.valueCents })
        .from(leadOpportunities).where(and(eq(leadOpportunities.status, "won"), gte(leadOpportunities.closedAt, since)))
    : [];
  const wonValueByLead = new Map<number, number>();
  for (const o of wonOpps) wonValueByLead.set(o.leadId, (o.valueCents && o.valueCents > 0) ? o.valueCents : 0);

  // Última avaliação de IA por instância (resiliente)
  const lastEvalByInstance = new Map<string, typeof sellerEvaluations.$inferSelect>();
  try {
    const evals = await db.select().from(sellerEvaluations)
      .where(eq(sellerEvaluations.memberId, INSTANCE_MEMBER_SENTINEL))
      .orderBy(desc(sellerEvaluations.createdAt));
    for (const e of evals) if (e.instanceName && !lastEvalByInstance.has(e.instanceName)) lastEvalByInstance.set(e.instanceName, e);
  } catch { /* migração pendente */ }

  // Agrega por instância
  const instValue = new Map<string, number>();
  for (const [inst, leadSet] of Array.from(leadsByInstance)) {
    let v = 0;
    for (const lid of Array.from(leadSet)) v += wonValueByLead.get(lid) || 0;
    instValue.set(inst, v);
  }
  const maxValue = Math.max(1, ...Array.from(instValue.values()));

  const result: InstanceMetrics[] = [];
  for (const [inst, convIds] of Array.from(convsByInstance)) {
    let respSum = 0, respCount = 0, messagesSent = 0, leadsNoReply = 0;
    for (const cid of convIds) {
      const list = msgsByConv.get(cid) || [];
      let firstCustomer = -1, firstAgentAfter = -1, hasAgent = false;
      for (const ev of list) {
        if (ev.senderType === "agent") { hasAgent = true; messagesSent++; }
        if (firstCustomer < 0 && ev.senderType === "customer") firstCustomer = ev.t;
        if (firstCustomer >= 0 && firstAgentAfter < 0 && ev.senderType === "agent" && ev.t >= firstCustomer) firstAgentAfter = ev.t;
      }
      if (firstCustomer >= 0 && firstAgentAfter >= 0) { respSum += (firstAgentAfter - firstCustomer) / 1000; respCount++; }
      if (list.some(e => e.senderType === "customer") && !hasAgent) leadsNoReply++;
    }
    const avgResp = respCount ? Math.round(respSum / respCount) : 0;

    const leadSet = leadsByInstance.get(inst) || new Set<number>();
    let received = 0, converted = 0;
    for (const lid of Array.from(leadSet)) {
      const info = leadInfo.get(lid);
      if (!info || !info.isLead) continue;
      received++;
      if (info.fechado) converted++;
    }
    const conversionRate = received ? converted / received : 0;
    const conversionScore = Math.round(clamp((conversionRate / TARGET_CONVERSION) * 100));
    const speedScore = Math.round(speedToScore(avgResp));
    const valueCents = instValue.get(inst) || 0;
    const valueScore = Math.round(clamp((valueCents / maxValue) * 100));
    const activityScore = Math.round(clamp(100 * (1 - leadsNoReply / (convIds.length || 1))));

    const lastEval = lastEvalByInstance.get(inst) || null;
    const hasConduct = !!lastEval;
    const conductScore = lastEval?.conductScore ?? 0;
    const score = combineScore({ conversionScore, speedScore, valueScore, activityScore, conductScore: hasConduct ? conductScore : null });

    result.push({
      instanceName: inst, label: inst,
      leadsReceived: received, leadsConverted: converted, conversionRate,
      avgFirstResponseSec: avgResp, valueSoldCents: valueCents, leadsNoReply, messagesSent,
      conversionScore, speedScore, valueScore, activityScore,
      conductScore: hasConduct ? conductScore : 0, score,
      lastEvaluatedAt: lastEval?.createdAt ?? null,
    });
  }
  result.sort((a, b) => b.score - a.score);
  return result;
}

// ── Análise qualitativa por IA (condução, forças, melhorias, dicas) ────────────

const COACH_SYSTEM = `Você é um GERENTE DE VENDAS SÊNIOR de uma concessionária, avaliando o atendimento de um vendedor no WhatsApp.
Você recebe (a) as métricas do vendedor no período e (b) amostras reais de conversas dele com clientes.
Avalie a QUALIDADE DA CONDUÇÃO do atendimento e devolva um JSON EXATO (sem texto fora do JSON):
{
  "conductScore": <0-100, qualidade da abordagem/condução>,
  "summary": "<2-3 frases: diagnóstico honesto do atendimento deste vendedor>",
  "strengths": ["<o que ele faz bem, concreto>"],
  "improvements": ["<onde ele perde vendas / o que precisa melhorar, concreto>"],
  "tips": ["<dicas práticas e acionáveis, no imperativo, que ele pode aplicar já>"]
}
Critérios de condução (avalie o que as conversas comprovam):
- Rapidez e presença (não deixar o cliente no vácuo).
- Qualificação: pergunta o que o cliente busca, forma de pagamento, troca?
- Apresentação: mostra o carro, benefícios, fotos, cria desejo?
- Contorno de objeções: preço, crédito, indecisão.
- Condução ao fechamento: propõe test-drive, proposta, próximo passo? Faz follow-up de quem sumiu?
- Tom: cordial, profissional, sem ser robótico nem agressivo.
Seja específico e direto como um gerente que quer o time vendendo mais. Cite padrões que viu nas conversas. 3 a 5 itens em cada lista.`;

export type SellerAnalysis = {
  conductScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  tips: string[];
};

/** Roda a IA sobre amostras de conversas do vendedor e salva a avaliação. */
export async function evaluateSeller(opts: {
  memberId: number; sinceDays: number; instanceName?: string;
}): Promise<{ metrics: SellerMetrics; analysis: SellerAnalysis } | null> {
  const db = await getDb();
  if (!db) return null;

  const metricsAll = await computeTeamPerformance({ sinceDays: opts.sinceDays, memberId: opts.memberId, instanceName: opts.instanceName });
  const metrics = metricsAll[0];
  if (!metrics) return null;
  const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000);

  // Amostra de conversas do vendedor (mais recentes) p/ a IA ler
  const convConds = [gte(convTable.lastMessageAt, since.getTime()), eq(convTable.assignedTo, opts.memberId)];
  if (opts.instanceName) convConds.push(eq(convTable.instanceName, opts.instanceName));
  const sampleConvs = await db.select({ id: convTable.id, name: convTable.contactName, phone: convTable.phone })
    .from(convTable).where(and(...convConds))
    .orderBy(desc(convTable.lastMessageAt)).limit(8);

  let transcripts = "";
  for (const c of sampleConvs) {
    const rows = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, c.id))
      .orderBy(desc(messagesTable.createdAt)).limit(30);
    const ordered = [...rows].reverse().filter(m => m.senderType !== "internal");
    if (ordered.length < 2) continue;
    const t = ordered.map(m => {
      const meta = m.metadata as Record<string, unknown> | null;
      const text = (meta?.transcribedText as string) || m.content || `[${m.messageType}]`;
      const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Vendedor";
      return `${role}: ${text}`;
    }).join("\n");
    transcripts += `\n--- Conversa com ${c.name || c.phone} ---\n${t}\n`;
  }

  let analysis: SellerAnalysis = { conductScore: 0, summary: "Sem conversas suficientes para avaliar a condução.", strengths: [], improvements: [], tips: [] };
  if (transcripts.trim()) {
    const metricLine = `Métricas do período (${opts.sinceDays} dias): leads recebidos ${metrics.leadsReceived}, convertidos ${metrics.leadsConverted} (${(metrics.conversionRate * 100).toFixed(0)}%), tempo médio de 1ª resposta ${fmtDuration(metrics.avgFirstResponseSec)}, leads sem resposta ${metrics.leadsNoReply}, valor vendido R$ ${(metrics.valueSoldCents / 100).toLocaleString("pt-BR")}.`;
    try {
      const resp = await invokeLLM({
        messages: [
          { role: "system", content: COACH_SYSTEM },
          { role: "user", content: `Vendedor: ${metrics.name}\n${metricLine}\n\nAmostras de conversas:\n${transcripts}\n\nRetorne o JSON da avaliação:` },
        ],
      });
      const rawContent = resp.choices?.[0]?.message?.content;
      let raw = (typeof rawContent === "string" ? rawContent : "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const j = JSON.parse(raw);
      analysis = {
        conductScore: clamp(Number(j.conductScore) || 0),
        summary: String(j.summary || "").slice(0, 800),
        strengths: Array.isArray(j.strengths) ? j.strengths.slice(0, 6).map(String) : [],
        improvements: Array.isArray(j.improvements) ? j.improvements.slice(0, 6).map(String) : [],
        tips: Array.isArray(j.tips) ? j.tips.slice(0, 6).map(String) : [],
      };
    } catch (err) {
      console.error(`[Perf] Falha ao avaliar vendedor ${opts.memberId}:`, err);
    }
  }

  // Recombina a nota agora COM a condução da IA
  const finalScore = combineScore({
    conversionScore: metrics.conversionScore, speedScore: metrics.speedScore,
    conductScore: analysis.conductScore, valueScore: metrics.valueScore, activityScore: metrics.activityScore,
  });
  metrics.conductScore = analysis.conductScore;
  metrics.score = finalScore;

  // Persiste a avaliação (histórico/tendência)
  await db.insert(sellerEvaluations).values({
    memberId: opts.memberId,
    instanceName: opts.instanceName || null,
    periodDays: opts.sinceDays,
    score: finalScore,
    conversionScore: metrics.conversionScore,
    speedScore: metrics.speedScore,
    conductScore: analysis.conductScore,
    valueScore: metrics.valueScore,
    activityScore: metrics.activityScore,
    leadsReceived: metrics.leadsReceived,
    leadsConverted: metrics.leadsConverted,
    avgFirstResponseSec: metrics.avgFirstResponseSec,
    valueSoldCents: metrics.valueSoldCents,
    leadsNoReply: metrics.leadsNoReply,
    summary: analysis.summary,
    strengths: analysis.strengths,
    improvements: analysis.improvements,
    tips: analysis.tips,
  });

  return { metrics, analysis };
}

/** Avaliação qualitativa por IA de uma INSTÂNCIA (número), salva com sentinela. */
export async function evaluateInstance(opts: { instanceName: string; sinceDays: number }): Promise<{ metrics: InstanceMetrics; analysis: SellerAnalysis } | null> {
  const db = await getDb();
  if (!db) return null;
  const all = await computeInstancePerformance({ sinceDays: opts.sinceDays });
  const metrics = all.find(i => i.instanceName === opts.instanceName);
  if (!metrics) return null;
  const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000);

  const sampleConvs = await db.select({ id: convTable.id, name: convTable.contactName, phone: convTable.phone })
    .from(convTable).where(and(gte(convTable.lastMessageAt, since.getTime()), eq(convTable.instanceName, opts.instanceName)))
    .orderBy(desc(convTable.lastMessageAt)).limit(8);

  let transcripts = "";
  for (const c of sampleConvs) {
    const rows = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, c.id)).orderBy(desc(messagesTable.createdAt)).limit(30);
    const ordered = [...rows].reverse().filter(m => m.senderType !== "internal");
    if (ordered.length < 2) continue;
    const t = ordered.map(m => {
      const meta = m.metadata as Record<string, unknown> | null;
      const text = (meta?.transcribedText as string) || m.content || `[${m.messageType}]`;
      const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Atendente";
      return `${role}: ${text}`;
    }).join("\n");
    transcripts += `\n--- Conversa com ${c.name || c.phone} ---\n${t}\n`;
  }

  let analysis: SellerAnalysis = { conductScore: 0, summary: "Sem conversas suficientes para avaliar a condução.", strengths: [], improvements: [], tips: [] };
  if (transcripts.trim()) {
    const metricLine = `Métricas da instância "${opts.instanceName}" (${opts.sinceDays} dias): leads recebidos ${metrics.leadsReceived}, convertidos ${metrics.leadsConverted} (${(metrics.conversionRate * 100).toFixed(0)}%), 1ª resposta ${fmtDuration(metrics.avgFirstResponseSec)}, leads sem resposta ${metrics.leadsNoReply}, vendido R$ ${(metrics.valueSoldCents / 100).toLocaleString("pt-BR")}.`;
    try {
      const resp = await invokeLLM({
        messages: [
          { role: "system", content: COACH_SYSTEM.replace(/vendedor/g, "atendimento da instância") },
          { role: "user", content: `Instância/número: ${opts.instanceName}\n${metricLine}\n\nAmostras de conversas:\n${transcripts}\n\nRetorne o JSON da avaliação:` },
        ],
      });
      const rawContent = resp.choices?.[0]?.message?.content;
      let raw = (typeof rawContent === "string" ? rawContent : "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const j = JSON.parse(raw);
      analysis = {
        conductScore: clamp(Number(j.conductScore) || 0),
        summary: String(j.summary || "").slice(0, 800),
        strengths: Array.isArray(j.strengths) ? j.strengths.slice(0, 6).map(String) : [],
        improvements: Array.isArray(j.improvements) ? j.improvements.slice(0, 6).map(String) : [],
        tips: Array.isArray(j.tips) ? j.tips.slice(0, 6).map(String) : [],
      };
    } catch (err) {
      console.error(`[Perf] Falha ao avaliar instância ${opts.instanceName}:`, err);
    }
  }

  const finalScore = combineScore({ conversionScore: metrics.conversionScore, speedScore: metrics.speedScore, conductScore: analysis.conductScore, valueScore: metrics.valueScore, activityScore: metrics.activityScore });
  metrics.conductScore = analysis.conductScore;
  metrics.score = finalScore;

  await db.insert(sellerEvaluations).values({
    memberId: INSTANCE_MEMBER_SENTINEL,
    instanceName: opts.instanceName,
    periodDays: opts.sinceDays,
    score: finalScore,
    conversionScore: metrics.conversionScore, speedScore: metrics.speedScore, conductScore: analysis.conductScore,
    valueScore: metrics.valueScore, activityScore: metrics.activityScore,
    leadsReceived: metrics.leadsReceived, leadsConverted: metrics.leadsConverted,
    avgFirstResponseSec: metrics.avgFirstResponseSec, valueSoldCents: metrics.valueSoldCents, leadsNoReply: metrics.leadsNoReply,
    summary: analysis.summary, strengths: analysis.strengths, improvements: analysis.improvements, tips: analysis.tips,
  });

  return { metrics, analysis };
}

// ── Chat interno de performance (gestor conversa com a IA) ─────────────────────

const CHAT_SYSTEM = `Você é o braço-direito do gerente de vendas de uma concessionária: um analista de performance comercial.
Você tem acesso às métricas atuais da equipe (abaixo). Responda às perguntas do gestor de forma direta, prática e orientada a AÇÃO.
- Fale como um gerente de vendas experiente: aponte quem está bem, quem precisa de atenção, e o que fazer.
- Baseie-se nos números fornecidos; se algo não estiver nos dados, diga que precisa de mais informação (ou sugira rodar a avaliação com IA daquele vendedor).
- Seja conciso. Use no máximo listas curtas quando ajudar. Sem enrolação.`;

export async function performanceChat(opts: {
  history: { role: "user" | "assistant"; content: string }[];
  sinceDays: number; instanceName?: string; groupBy?: "member" | "instance";
}): Promise<string> {
  let table: string; let unitLabel: string;
  if (opts.groupBy === "instance") {
    const rows = await computeInstancePerformance({ sinceDays: opts.sinceDays });
    unitLabel = "Instâncias/números (ordenados por nota)";
    table = rows.map(m =>
      `${m.label} — nota ${m.score}/100 | conversão ${(m.conversionRate * 100).toFixed(0)}% (${m.leadsConverted}/${m.leadsReceived}) | 1ª resp ${fmtDuration(m.avgFirstResponseSec)} | condução ${m.conductScore || "s/ IA"} | vendido R$ ${(m.valueSoldCents / 100).toLocaleString("pt-BR")} | s/ resposta ${m.leadsNoReply}`,
    ).join("\n");
  } else {
    const team = await computeTeamPerformance({ sinceDays: opts.sinceDays, instanceName: opts.instanceName });
    unitLabel = "Equipe (ordenada por nota)";
    table = team.map(m =>
      `${m.name} (${m.cargo}) — nota ${m.score}/100 | conversão ${(m.conversionRate * 100).toFixed(0)}% (${m.leadsConverted}/${m.leadsReceived}) | 1ª resp ${fmtDuration(m.avgFirstResponseSec)} | condução ${m.conductScore || "s/ IA"} | vendido R$ ${(m.valueSoldCents / 100).toLocaleString("pt-BR")} | s/ resposta ${m.leadsNoReply}`,
    ).join("\n");
  }
  const context = `Período: últimos ${opts.sinceDays} dias${opts.instanceName ? ` | instância ${opts.instanceName}` : ""}.\n${unitLabel}:\n${table || "Sem dados no período."}`;

  const resp = await invokeLLM({
    messages: [
      { role: "system", content: `${CHAT_SYSTEM}\n\n=== DADOS ATUAIS ===\n${context}` },
      ...opts.history.map(h => ({ role: h.role, content: h.content })),
    ],
  });
  const c = resp.choices?.[0]?.message?.content;
  return (typeof c === "string" ? c : "").trim() || "Não consegui gerar a análise agora.";
}

export function fmtDuration(sec: number): string {
  if (!sec) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  return `${(sec / 3600).toFixed(1)}h`;
}
