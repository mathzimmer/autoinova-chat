/**
 * Inteligência de Conversa — a IA lê a conversa (inclusive áudios transcritos)
 * e classifica temperatura, score, objeções, sinais de compra, situação de
 * crédito e a próxima ação sugerida ao vendedor.
 *
 * Roda sob demanda (botão do gestor). Não interfere no atendimento.
 */
import { eq, desc, and, gte } from "drizzle-orm";
import { conversationInsights, messages as messagesTable, conversations as convTable } from "../drizzle/schema";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";

export type InsightResult = {
  temperature: "frio" | "morno" | "quente" | "muito_quente";
  score: number;
  summary: string;
  buyingSignals: string[];
  objections: string[];
  creditStatus: string;
  nextAction: string;
  vehicleInterest: string;
};

const SYSTEM = `Você é um gerente comercial experiente de uma concessionária de veículos analisando uma conversa de WhatsApp entre um cliente e um vendedor/atendente.
Sua tarefa é avaliar friamente o potencial de fechamento e retornar um JSON EXATO com esta estrutura (sem texto fora do JSON):
{
  "temperature": "frio" | "morno" | "quente" | "muito_quente",
  "score": <número 0 a 100, probabilidade real de fechar a venda>,
  "summary": "<2 frases: em que pé está a negociação>",
  "buyingSignals": ["<sinais positivos concretos ditos pelo cliente>"],
  "objections": ["<travas/objeções: preço, crédito, indecisão, prazo, troca...>"],
  "creditStatus": "<situação de pagamento/crédito mencionada: entrada, financiamento, à vista, restrição, ou 'não mencionado'>",
  "nextAction": "<a próxima ação mais eficaz para o vendedor fazer AGORA>",
  "vehicleInterest": "<veículo(s) de interesse ou 'não definido'>"
}
Critérios de temperatura:
- muito_quente: cliente quer fechar, pediu proposta/condições finais, definiu veículo e pagamento.
- quente: interesse claro num veículo específico, discutindo preço/troca/financiamento.
- morno: pesquisando, comparando, sem veículo definido, mas engajado.
- frio: só perguntou preço e sumiu, resposta vaga, ou muito no início.
Seja realista. Cliente que não responde há tempo ou só fez uma pergunta genérica é frio. Score deve refletir a chance REAL.`;

function tempToScore(t: string): number {
  return t === "muito_quente" ? 85 : t === "quente" ? 65 : t === "morno" ? 40 : 15;
}

/** Analisa uma conversa e salva o insight (upsert). Retorna o insight ou null. */
export async function analyzeConversation(conversationId: number): Promise<InsightResult | null> {
  const db = await getDb();
  if (!db) return null;

  // Últimas 40 mensagens, em ordem cronológica (usa transcrição de áudio quando houver)
  const rows = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(40);
  if (rows.length === 0) return null;

  const ordered = [...rows].reverse();
  const transcript = ordered
    .filter(m => m.senderType !== "internal")
    .map(m => {
      const meta = m.metadata as Record<string, unknown> | null;
      const text = (meta?.transcribedText as string) || m.content || `[${m.messageType}]`;
      const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Vendedor";
      return `${role}: ${text}`;
    }).join("\n");

  if (!transcript.trim()) return null;

  let parsed: InsightResult;
  try {
    const resp = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Conversa (${ordered.length} mensagens):\n\n${transcript}\n\nRetorne o JSON de análise:` },
      ],
    });
    const rawContent = resp.choices?.[0]?.message?.content;
    let raw = (typeof rawContent === "string" ? rawContent : "").trim();
    // Remove cercas de código se vierem
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const json = JSON.parse(raw);
    const temp = ["frio", "morno", "quente", "muito_quente"].includes(json.temperature) ? json.temperature : "frio";
    parsed = {
      temperature: temp,
      score: Math.max(0, Math.min(100, Number(json.score) || tempToScore(temp))),
      summary: String(json.summary || "").slice(0, 500),
      buyingSignals: Array.isArray(json.buyingSignals) ? json.buyingSignals.slice(0, 6).map(String) : [],
      objections: Array.isArray(json.objections) ? json.objections.slice(0, 6).map(String) : [],
      creditStatus: String(json.creditStatus || "não mencionado").slice(0, 200),
      nextAction: String(json.nextAction || "").slice(0, 500),
      vehicleInterest: String(json.vehicleInterest || "não definido").slice(0, 300),
    };
  } catch (err) {
    console.error(`[Intel] Falha ao analisar conversa ${conversationId}:`, err);
    return null;
  }

  // Upsert do insight
  const existing = (await db.select({ id: conversationInsights.id }).from(conversationInsights)
    .where(eq(conversationInsights.conversationId, conversationId)).limit(1))[0];
  const data = {
    conversationId,
    temperature: parsed.temperature,
    score: parsed.score,
    summary: parsed.summary,
    buyingSignals: parsed.buyingSignals,
    objections: parsed.objections,
    creditStatus: parsed.creditStatus,
    nextAction: parsed.nextAction,
    vehicleInterest: parsed.vehicleInterest,
    messageCount: ordered.length,
    analyzedAt: new Date(),
  };
  if (existing) {
    await db.update(conversationInsights).set(data).where(eq(conversationInsights.id, existing.id));
  } else {
    await db.insert(conversationInsights).values(data);
  }

  // Reflete a temperatura no lead (se houver) para o funil/kanban
  try {
    const { updateLeadFunnelStatus } = await import("./db");
    void updateLeadFunnelStatus; // no-op guard
    const { leads } = await import("../drizzle/schema");
    const lead = (await db.select({ id: leads.id }).from(leads).where(eq(leads.conversationId, conversationId)).limit(1))[0];
    if (lead) {
      await db.update(leads).set({ temperature: parsed.temperature as any, score: parsed.score }).where(eq(leads.id, lead.id));
    }
  } catch { /* opcional */ }

  console.log(`[Intel] Conversa ${conversationId}: ${parsed.temperature} (score ${parsed.score})`);
  return parsed;
}

/**
 * Analisa em lote as conversas de uma fonte/período.
 * source: "matriz" ou nome de instância; sinceDays: janela (1 = hoje, 7 = semana).
 */
export async function analyzeBulk(opts: { source?: string; sinceDays: number; limit?: number }): Promise<{ analyzed: number }> {
  const db = await getDb();
  if (!db) return { analyzed: 0 };
  const { ne } = await import("drizzle-orm");
  const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000);

  const conds = [gte(convTable.lastMessageAt, since.getTime()), eq(convTable.archived, false)];
  if (!opts.source || opts.source === "matriz") conds.push(ne(convTable.channel, "evolution" as any));
  else { conds.push(eq(convTable.channel, "evolution" as any)); conds.push(eq(convTable.instanceName, opts.source)); }

  const convs = await db.select({ id: convTable.id }).from(convTable)
    .where(and(...conds)).orderBy(desc(convTable.lastMessageAt)).limit(opts.limit ?? 40);

  let analyzed = 0;
  for (const c of convs) {
    const r = await analyzeConversation(c.id);
    if (r) analyzed++;
  }
  return { analyzed };
}
