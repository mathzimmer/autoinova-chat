/**
 * Coach de Vendas — avalia o atendimento do vendedor e gera dicas.
 *
 * Duas frentes:
 *  - AO VIVO: dicas curtas (usadas dentro do Copiloto) — ver `buildCoachHint`.
 *  - NO FIM: avaliação da conversa (início/meio/fim + porquê ganhou/perdeu),
 *    gravada em `conversationEvaluations` — ver `evaluateConversation`.
 *
 * A régua é parametrizável (settings `coach_config`): texto do padrão, critérios
 * (liga/desliga + peso), metas numéricas, tom e quais dicas ao vivo ficam ativas.
 */
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { getDb, getConversationById, listMessages, getSetting, getLeadByConversationId } from "./db";
import { conversationEvaluations, salesLessons, conversations as convTable } from "../drizzle/schema";

export interface CoachCriterio { id: string; label: string; etapa: "inicio" | "meio" | "fim"; enabled: boolean; peso: number; }

export interface CoachConfig {
  padraoInicio: string;
  padraoMeio: string;
  padraoFim: string;
  criterios: CoachCriterio[];
  slaMin: number;          // meta de 1ª resposta (min)
  gapMin: number;          // gap máximo sem responder (min)
  bancosEsperado: number;  // nº de bancos esperado na simulação
  tom: string;
  dicasAtivas: string[];   // tipos de dica ao vivo ativos
}

const CRITERIOS_PADRAO: CoachCriterio[] = [
  { id: "sla", label: "Rapidez da 1ª resposta", etapa: "inicio", enabled: true, peso: 3 },
  { id: "saudacao", label: "Saudação e cordialidade", etapa: "inicio", enabled: true, peso: 2 },
  { id: "qualificacao", label: "Qualificação (necessidade/pagamento/troca)", etapa: "inicio", enabled: true, peso: 3 },
  { id: "apresentacao", label: "Apresentação do veículo certo", etapa: "meio", enabled: true, peso: 3 },
  { id: "objecoes", label: "Contorno de objeções", etapa: "meio", enabled: true, peso: 3 },
  { id: "ofertas", label: "Ofertas e condições (simular em mais bancos, entrada)", etapa: "meio", enabled: true, peso: 2 },
  { id: "ritmo", label: "Objetividade e ritmo (1 pergunta/vez, sem sumir)", etapa: "meio", enabled: true, peso: 2 },
  { id: "portugues", label: "Clareza e português", etapa: "meio", enabled: true, peso: 1 },
  { id: "tom", label: "Cordialidade e tom", etapa: "meio", enabled: true, peso: 1 },
  { id: "cta", label: "CTA / trazer pra loja (visita/test-drive)", etapa: "fim", enabled: true, peso: 3 },
  { id: "fechamento", label: "Fechamento (urgência, próximo passo)", etapa: "fim", enabled: true, peso: 2 },
  { id: "followup", label: "Follow-up (não deixar esfriar)", etapa: "fim", enabled: true, peso: 2 },
];

export const DEFAULT_COACH_CONFIG: CoachConfig = {
  padraoInicio: "Responder rápido, cumprimentar, se identificar e qualificar: entender o que o cliente procura, forma de pagamento e se tem veículo na troca.",
  padraoMeio: "Apresentar o veículo certo (com foto e benefícios), contornar objeções (preço, troca, distância), oferecer condições/financiamento (simular em mais de um banco), ser objetivo e cordial, escrever com clareza.",
  padraoFim: "Puxar para uma visita/test-drive na loja, criar urgência saudável, combinar o próximo passo e fazer follow-up de quem esfriou.",
  criterios: CRITERIOS_PADRAO,
  slaMin: 5,
  gapMin: 30,
  bancosEsperado: 2,
  tom: "Direto, prático e respeitoso. Dicas curtas, acionáveis.",
  dicasAtivas: ["sla", "objecoes", "ofertas", "tom", "portugues", "cta", "followup"],
};

export async function getCoachConfig(): Promise<CoachConfig> {
  const raw = await getSetting("coach_config");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const crit = Array.isArray(parsed.criterios) && parsed.criterios.length ? parsed.criterios : CRITERIOS_PADRAO;
      return { ...DEFAULT_COACH_CONFIG, ...parsed, criterios: crit };
    } catch { /* usa default */ }
  }
  return DEFAULT_COACH_CONFIG;
}

/** Minutos desde a última mensagem do CLIENTE ainda sem resposta do vendedor. */
function minutosEsperando(msgs: any[]): number {
  const ordered = [...msgs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const last = ordered[ordered.length - 1];
  if (!last || last.senderType !== "customer") return 0;
  return Math.round((Date.now() - new Date(last.createdAt).getTime()) / 60000);
}

/**
 * Bloco de instrução para o COACH AO VIVO — injetado no prompt do Copiloto.
 * Faz o modelo devolver também `dicas` (1–2 dicas de coaching pro vendedor).
 */
export async function buildCoachHint(msgs: any[]): Promise<string> {
  const cfg = await getCoachConfig();
  const esperando = minutosEsperando(msgs);
  const criteriosAtivos = cfg.criterios.filter(c => c.enabled).map(c => `${c.id}: ${c.label}`).join("; ");

  // Aprendizado: injeta lições recentes (o que já deu certo / evitar na loja).
  let licoesTxt = "";
  try {
    const lessons = await getRecentLessons(6);
    const ganhou = lessons.filter((l: any) => l.kind === "ganhou").map((l: any) => l.lesson).slice(0, 3);
    const perdeu = lessons.filter((l: any) => l.kind === "perdeu").map((l: any) => l.lesson).slice(0, 3);
    if (ganhou.length || perdeu.length) {
      licoesTxt = `Lições da loja (use como referência) — o que já deu CERTO: ${ganhou.join("; ") || "-"}. O que EVITAR: ${perdeu.join("; ") || "-"}.`;
    }
  } catch { /* base opcional */ }

  const linhas = [
    "COACHING AO VIVO: além das sugestões de resposta, gere `dicas` = 1 a 2 dicas CURTAS e acionáveis para o VENDEDOR melhorar a negociação AGORA (não são mensagens pro cliente).",
    `Padrão esperado — Início: ${cfg.padraoInicio} Meio: ${cfg.padraoMeio} Fim: ${cfg.padraoFim}`,
    `Critérios a observar: ${criteriosAtivos}.`,
    `Metas: responder em até ${cfg.slaMin} min; não deixar gap acima de ${cfg.gapMin} min; simular em pelo menos ${cfg.bancosEsperado} bancos.`,
    `Tom das dicas: ${cfg.tom}`,
    licoesTxt,
    esperando >= cfg.slaMin ? `ATENÇÃO: o cliente está esperando há ~${esperando} min sem resposta — priorize uma dica de rapidez.` : "",
    "Exemplos de dica: 'Responda agora — cliente esperando 11 min', 'Ofereça simulação em 2–3 bancos', 'Seja mais cordial, use o nome', 'Revise o português', 'Sinal de compra: proponha test-drive'.",
  ];
  return linhas.filter(Boolean).join("\n");
}

export interface ConversationEvalResult {
  scoreOverall: number; scoreInicio: number; scoreMeio: number; scoreFim: number;
  strengths: string[]; errors: string[]; tips: string[]; reason: string; summary: string;
}

async function getLastEvalRow(conversationId: number): Promise<any | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(conversationEvaluations)
    .where(eq(conversationEvaluations.conversationId, conversationId))
    .orderBy(desc(conversationEvaluations.createdAt)).limit(1);
  return rows[0] || null;
}

export async function getLastEvaluation(conversationId: number) {
  return getLastEvalRow(conversationId);
}

/**
 * Avalia a conversa inteira contra a régua e grava em conversationEvaluations.
 * `outcome`: 'ganho' | 'perdido' | 'encerrado'. Dedup: ignora se já houve
 * avaliação nos últimos 3 minutos (evita gatilho duplo ganho+encerrar).
 */
export async function evaluateConversation(
  conversationId: number,
  outcome: "ganho" | "perdido" | "encerrado",
): Promise<ConversationEvalResult | null> {
  const db = await getDb();
  if (!db) return null;

  const recent = await getLastEvalRow(conversationId);
  if (recent && Date.now() - new Date(recent.createdAt).getTime() < 3 * 60 * 1000) {
    return null; // já avaliado agora há pouco
  }

  const conv = await getConversationById(conversationId);
  if (!conv) return null;
  const msgs = await listMessages(conversationId, 200);
  if (!msgs || msgs.length === 0) return null;

  const cfg = await getCoachConfig();
  const lead = await getLeadByConversationId(conversationId).catch(() => null);

  const ordered = [...msgs].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const transcript = ordered
    .filter((m: any) => m.senderType !== "internal")
    .map((m: any) => {
      const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Vendedor";
      return `${role}: ${m.content}`;
    }).join("\n");

  const criterios = cfg.criterios.filter(c => c.enabled);
  const criteriosTxt = criterios.map(c => `- [${c.etapa}] ${c.label} (peso ${c.peso})`).join("\n");

  const outcomeTxt = outcome === "ganho" ? "O NEGÓCIO FOI GANHO (fechado)."
    : outcome === "perdido" ? "O NEGÓCIO FOI PERDIDO." : "O atendimento foi encerrado.";

  const system = [
    "Você é um GERENTE DE VENDAS avaliando o atendimento de um VENDEDOR de uma concessionária.",
    outcomeTxt,
    "Avalie o atendimento contra o padrão (início/meio/fim) e os critérios abaixo. Seja específico e justo.",
    `Padrão — Início: ${cfg.padraoInicio}\nMeio: ${cfg.padraoMeio}\nFim: ${cfg.padraoFim}`,
    `Critérios (com peso):\n${criteriosTxt}`,
    `Metas: 1ª resposta em até ${cfg.slaMin} min; sem gaps acima de ${cfg.gapMin} min; simulação em pelo menos ${cfg.bancosEsperado} bancos.`,
    "Responda APENAS em JSON: {\"score_inicio\":0-100,\"score_meio\":0-100,\"score_fim\":0-100,\"score_geral\":0-100,\"pontos_fortes\":[\"...\"],\"erros\":[\"...\"],\"dicas\":[\"...\"],\"motivo\":\"por que ganhou/perdeu/encerrou\",\"resumo\":\"1-2 frases\",\"licoes\":[\"lição generalizável para outros atendimentos\"]}.",
  ].join("\n");

  const leadCtx = lead ? `\nLead: interesse ${(lead as any).vehicleInterest || "?"}; pagamento ${(lead as any).paymentMethod || "?"}; troca ${(lead as any).hasTrade ? "sim" : "não"}.` : "";
  const user = `Conversa completa:\n${transcript}\n${leadCtx}\n\nGere o JSON da avaliação.`;

  let parsed: any = {};
  try {
    const { invokeAgentLLM } = await import("./openaiLLM");
    const resp: any = await invokeAgentLLM({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      responseFormat: { type: "json_object" },
      maxTokens: 900,
    } as any);
    const raw = resp?.choices?.[0]?.message?.content;
    parsed = JSON.parse(typeof raw === "string" ? raw : "{}");
  } catch (e) {
    console.error("[Coach] avaliação falhou:", e);
    return null;
  }

  const clamp = (n: any) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const arr = (x: any): string[] => Array.isArray(x) ? x.filter((s) => typeof s === "string" && s.trim()) : [];
  const result: ConversationEvalResult = {
    scoreInicio: clamp(parsed.score_inicio),
    scoreMeio: clamp(parsed.score_meio),
    scoreFim: clamp(parsed.score_fim),
    scoreOverall: clamp(parsed.score_geral ?? (Number(parsed.score_inicio) + Number(parsed.score_meio) + Number(parsed.score_fim)) / 3),
    strengths: arr(parsed.pontos_fortes),
    errors: arr(parsed.erros),
    tips: arr(parsed.dicas),
    reason: typeof parsed.motivo === "string" ? parsed.motivo : "",
    summary: typeof parsed.resumo === "string" ? parsed.resumo : "",
  };

  try {
    await db.insert(conversationEvaluations).values({
      conversationId,
      sellerId: (conv as any).assignedTo || null,
      outcome,
      scoreOverall: result.scoreOverall,
      scoreInicio: result.scoreInicio,
      scoreMeio: result.scoreMeio,
      scoreFim: result.scoreFim,
      strengths: result.strengths,
      errors: result.errors,
      tips: result.tips,
      reason: result.reason,
      summary: result.summary,
    } as any);

    // Aprendizado: grava lições de negócios ganhos/perdidos.
    if (outcome === "ganho" || outcome === "perdido") {
      const kind = outcome === "ganho" ? "ganhou" : "perdeu";
      const licoes = arr(parsed.licoes);
      // fallback: se não veio "licoes", usa fortes (ganho) ou erros (perdido)
      const base = licoes.length ? licoes : (outcome === "ganho" ? result.strengths : result.errors);
      for (const lesson of base.slice(0, 3)) {
        await db.insert(salesLessons).values({
          conversationId, sellerId: (conv as any).assignedTo || null, kind, lesson,
        } as any).catch(() => {});
      }
    }
  } catch (e) {
    console.error("[Coach] falha ao gravar avaliação:", e);
  }

  return result;
}

// ─────────────────── Aprendizado + painel (Fase B/C) ───────────────────

export async function getRecentLessons(limit = 20, kind?: "ganhou" | "perdeu") {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(salesLessons);
  const rows = kind
    ? await q.where(eq(salesLessons.kind, kind)).orderBy(desc(salesLessons.createdAt)).limit(limit)
    : await q.orderBy(desc(salesLessons.createdAt)).limit(limit);
  return rows;
}

/** Média das avaliações por vendedor (últimos 90 dias). */
export async function getTeamEvalOverview() {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const rows = await db.select().from(conversationEvaluations)
    .where(gte(conversationEvaluations.createdAt, since));
  const bySeller = new Map<number, { sellerId: number; count: number; sOverall: number; sInicio: number; sMeio: number; sFim: number }>();
  for (const r of rows as any[]) {
    const sid = r.sellerId || 0;
    const acc = bySeller.get(sid) || { sellerId: sid, count: 0, sOverall: 0, sInicio: 0, sMeio: 0, sFim: 0 };
    acc.count++; acc.sOverall += r.scoreOverall; acc.sInicio += r.scoreInicio; acc.sMeio += r.scoreMeio; acc.sFim += r.scoreFim;
    bySeller.set(sid, acc);
  }
  return Array.from(bySeller.values()).map(a => ({
    sellerId: a.sellerId,
    count: a.count,
    avgOverall: Math.round(a.sOverall / a.count),
    avgInicio: Math.round(a.sInicio / a.count),
    avgMeio: Math.round(a.sMeio / a.count),
    avgFim: Math.round(a.sFim / a.count),
  })).sort((x, y) => y.avgOverall - x.avgOverall);
}

/** Coaching por vendedor: erros recorrentes + faça mais isso (resumo por IA). */
export async function getSellerCoaching(sellerId: number) {
  const db = await getDb();
  if (!db) return null;
  const evals = await db.select().from(conversationEvaluations)
    .where(eq(conversationEvaluations.sellerId, sellerId))
    .orderBy(desc(conversationEvaluations.createdAt)).limit(15);
  if (!evals || evals.length === 0) return { count: 0, avgOverall: 0, topErros: [], facaMais: [], resumo: "" };

  const count = evals.length;
  const avgOverall = Math.round((evals as any[]).reduce((s, e) => s + e.scoreOverall, 0) / count);
  const errosAll = (evals as any[]).flatMap(e => e.errors || []);
  const fortesAll = (evals as any[]).flatMap(e => e.strengths || []);

  let topErros: string[] = [];
  let facaMais: string[] = [];
  let resumo = "";
  try {
    const { invokeAgentLLM } = await import("./openaiLLM");
    const resp: any = await invokeAgentLLM({
      messages: [
        { role: "system", content: "Você é um gerente de vendas. Resuma o coaching de um vendedor a partir das avaliações. Responda em JSON: {\"top_erros\":[\"até 3 erros recorrentes\"],\"faca_mais\":[\"até 3 acertos a repetir\"],\"resumo\":\"1-2 frases motivadoras e diretas\"}." },
        { role: "user", content: `Erros observados: ${errosAll.join(" | ")}\nAcertos: ${fortesAll.join(" | ")}\nNota média: ${avgOverall}.` },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 500,
    } as any);
    const parsed = JSON.parse(resp?.choices?.[0]?.message?.content || "{}");
    topErros = Array.isArray(parsed.top_erros) ? parsed.top_erros.slice(0, 3) : [];
    facaMais = Array.isArray(parsed.faca_mais) ? parsed.faca_mais.slice(0, 3) : [];
    resumo = typeof parsed.resumo === "string" ? parsed.resumo : "";
  } catch { /* usa os brutos abaixo */ }

  if (topErros.length === 0) topErros = errosAll.slice(0, 3);
  if (facaMais.length === 0) facaMais = fortesAll.slice(0, 3);
  return { count, avgOverall, topErros, facaMais, resumo };
}

/** Alertas: atendimentos abaixo do padrão + leads esfriando (esperando resposta). */
export async function getCoachAlerts() {
  const db = await getDb();
  if (!db) return { foraDoPadrao: [], esfriando: [] };
  const cfg = await getCoachConfig();

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const recentes = await db.select().from(conversationEvaluations)
    .where(gte(conversationEvaluations.createdAt, since))
    .orderBy(desc(conversationEvaluations.createdAt)).limit(50);
  const foraDoPadrao = (recentes as any[])
    .filter(e => e.scoreOverall < 50)
    .slice(0, 15)
    .map(e => ({ conversationId: e.conversationId, sellerId: e.sellerId, scoreOverall: e.scoreOverall, outcome: e.outcome, reason: e.reason }));

  const now = Date.now();
  const gapMs = cfg.gapMin * 60 * 1000;
  const convs = await db.select().from(convTable)
    .where(and(eq(convTable.status, "open" as any), isNotNull(convTable.assignedTo)))
    .limit(300);
  const esfriando = (convs as any[])
    .filter(c => c.aiActive === false && c.lastCustomerMessageAt && (now - Number(c.lastCustomerMessageAt)) > gapMs && (now - Number(c.lastCustomerMessageAt)) < 24 * 3600 * 1000)
    .map(c => ({ conversationId: c.id, sellerId: c.assignedTo, phone: c.phone, contactName: c.contactName, minutos: Math.round((now - Number(c.lastCustomerMessageAt)) / 60000) }))
    .sort((a, b) => b.minutos - a.minutos)
    .slice(0, 15);

  return { foraDoPadrao, esfriando };
}
