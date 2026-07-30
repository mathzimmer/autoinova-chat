/**
 * Inteligência de Conversa — a IA lê a conversa (inclusive áudios transcritos)
 * e classifica temperatura, score, objeções, sinais de compra, situação de
 * crédito e a próxima ação sugerida ao vendedor.
 *
 * Roda sob demanda (botão do gestor). Não interfere no atendimento.
 */
import { eq, desc, and, gte, inArray } from "drizzle-orm";
import { conversationInsights, messages as messagesTable, conversations as convTable } from "../drizzle/schema";
import { getDb, getSetting, calculateTemperature } from "./db";
import { invokeLLM } from "./_core/llm";
import { validateLeadArgs } from "./leadValidation";
import { scoreLead, temperatureFromScore, combineTemperature } from "./leadScore";

/** Diretriz de formato do resumo (comentário da IA no lead), configurável. */
async function commentStyleDirective(): Promise<string> {
  const style = (await getSetting("ia_comment_style")) || "objetivo";
  if (style === "detalhado")
    return `\n\nESTILO DO "summary": resumo completo (3 a 5 frases) com contexto e nuances da negociação, considerando o que o CLIENTE e o VENDEDOR disseram.`;
  if (style === "equilibrado")
    return `\n\nESTILO DO "summary": 2 frases curtas e objetivas sobre em que pé está a negociação (cliente + vendedor).`;
  // objetivo (padrão)
  return `\n\nESTILO DO "summary": 3 a 4 PONTOS-CHAVE curtos, um por linha, cada um começando com "• " e no máximo ~8 palavras. Sem texto corrido. Foque no que o cliente quer, na objeção principal e no próximo passo. Considere o que o CLIENTE e o VENDEDOR disseram.`;
}

export type InsightResult = {
  temperature: "frio" | "morno" | "quente" | "muito_quente";
  score: number;
  summary: string;
  buyingSignals: string[];
  objections: string[];
  creditStatus: string;
  nextAction: string;
  vehicleInterest: string;
  hasTrade: boolean | null;
  tradeVehicle: string;
  visitedStore: boolean | null;
  leadQuality: "bom" | "ruim" | null;
  qualityReason: string;
  funnelStage: "novo" | "interesse_definido" | "pagamento_definido" | "dados_pessoais" | "dados_troca" | "negociando";
  // Dados cadastrais extraídos (só o que o cliente informou explicitamente)
  nomeCompleto: string;
  email: string;
  cidade: string;
  cpf: string;
  dataNascimento: string;
  anoTroca: string;
  kmTroca: string;
  formaPagamento: string;
  entrada: string;
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
  "vehicleInterest": "<veículo(s) de interesse ou 'não definido'>",
  "hasTrade": true | false | null,
  "tradeVehicle": "<se tem carro na troca, qual (marca/modelo/ano); senão vazio>",
  "visitedStore": true | false | null,
  "leadQuality": "bom" | "ruim" | null,
  "qualityReason": "<1 frase curta: por que é bom ou ruim>",
  "funnelStage": "novo" | "interesse_definido" | "pagamento_definido" | "dados_pessoais" | "dados_troca" | "negociando",
  "nomeCompleto": "<nome completo do cliente se ele informou, senão ''>",
  "email": "<email se o cliente informou, senão ''>",
  "cidade": "<cidade do cliente se informada, senão ''>",
  "cpf": "<CPF SOMENTE se o cliente informou explicitamente, senão ''>",
  "dataNascimento": "<data de nascimento como o cliente informou (ex: 1990-05-20 ou 20/05/1990), senão ''>",
  "anoTroca": "<ano do veículo de troca se informado, senão ''>",
  "kmTroca": "<quilometragem do veículo de troca se informada, senão ''>",
  "formaPagamento": "<'financiamento' | 'a_vista' | 'consorcio' | 'troca' se informado, senão ''>",
  "entrada": "<valor de entrada informado, só números (ex: 20000), senão ''>"
}
Critérios do funnelStage (escolha o mais avançado que a conversa JÁ atingiu de fato):
- novo: só cumprimentou ou pergunta genérica, sem veículo definido.
- interesse_definido: demonstrou interesse claro num veículo específico.
- pagamento_definido: falou como vai pagar (à vista, financiamento, entrada).
- dados_pessoais: forneceu dados pessoais (nome completo, CPF, etc.).
- dados_troca: falou de um veículo na troca.
- negociando: discutindo condições/proposta/valores finais para fechar.
Nunca escolha um estágio que a conversa não comprova. Não existe "fechado" aqui — a venda é confirmada manualmente.
Critérios de temperatura:
- muito_quente: cliente quer fechar, pediu proposta/condições finais, definiu veículo e pagamento.
- quente: interesse claro num veículo específico, discutindo preço/troca/financiamento.
- morno: pesquisando, comparando, sem veículo definido, mas engajado.
- frio: só perguntou preço e sumiu, resposta vaga, ou muito no início.
Seja realista. Cliente que não responde há tempo ou só fez uma pergunta genérica é frio. Score deve refletir a chance REAL.

QUALIDADE DO LEAD (leadQuality) — isso define quais clientes vamos buscar em anúncios, então seja criterioso:
Marque "bom" quando houver SINAL CONCRETO de capacidade e intenção real de compra, por exemplo:
- Visitou a loja ou agendou visita/test-drive (sinal MUITO forte → visitedStore: true).
- Tem veículo na troca com valor real, ou vai dar entrada relevante.
- Vai pagar à vista, tem financiamento aprovado, ou já falou com banco.
- Está negociando valores/condições finais, pediu proposta, definiu veículo.
Marque "ruim" quando houver sinal claro de que NÃO vai comprar, por exemplo:
- Crédito negado / nome restrito / sem entrada e sem troca.
- Só pesquisando preço, sem intenção real, ou quer valor muito abaixo.
- É revenda/concorrente/curioso, ou pede coisa que a loja não trabalha.
Use null quando a conversa AINDA não dá base — não chute. Prefira null a errar.

DADOS CADASTRAIS (nomeCompleto, email, cidade, cpf, dataNascimento, anoTroca, kmTroca, formaPagamento, entrada):
Extraia SOMENTE o que o CLIENTE informou EXPLICITAMENTE na conversa. NUNCA invente, deduza ou gere números.
- Se o cliente não disse, devolva string vazia "".
- CPF e data de nascimento: só preencha se o próprio cliente escreveu esses dados. Jamais gere um CPF.
- entrada: apenas o número (ex.: "20000"), sem "R$" nem pontuação.`;

function tempToScore(t: string): number {
  return t === "muito_quente" ? 85 : t === "quente" ? 65 : t === "morno" ? 40 : 15;
}

/** Analisa uma conversa e salva o insight (upsert). Retorna o insight ou null. */
export async function analyzeConversation(conversationId: number): Promise<InsightResult | null> {
  const db = await getDb();
  if (!db) return null;

  // Contexto COMPLETO do lead: mensagens de TODAS as conversas/instâncias da
  // pessoa (recepção → vendedor), rotuladas com a origem — para a IA entender a
  // jornada inteira em vez de analisar cada número isoladamente.
  const thisConv = (await db.select().from(convTable).where(eq(convTable.id, conversationId)).limit(1))[0];
  let convs = thisConv ? [thisConv] : [];
  if (thisConv?.leadId) {
    convs = await db.select().from(convTable).where(eq(convTable.leadId, thisConv.leadId));
  } else if (thisConv?.phone) {
    convs = await db.select().from(convTable).where(eq(convTable.phone, thisConv.phone));
  }
  const convIds = convs.map(c => c.id);
  const instLabel = new Map<number, string>(convs.map(c => [c.id,
    c.channel === "evolution" ? `Vendedor ${c.instanceName || ""}`.trim()
    : c.channel === "zernio" ? "Recepção" : c.instanceName ? `Oficial ${c.instanceName}` : "Matriz",
  ]));
  const rows = await db.select().from(messagesTable)
    .where(inArray(messagesTable.conversationId, convIds.length ? convIds : [conversationId]))
    .orderBy(desc(messagesTable.createdAt))
    .limit(60);
  if (rows.length === 0) return null;

  const multiInstance = convIds.length > 1;
  const ordered = [...rows].reverse();
  const transcript = ordered
    .filter(m => m.senderType !== "internal")
    .map(m => {
      const meta = m.metadata as Record<string, unknown> | null;
      const text = (meta?.transcribedText as string) || m.content || `[${m.messageType}]`;
      const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Vendedor";
      const tag = multiInstance ? `[${instLabel.get(m.conversationId) || "?"}] ` : "";
      return `${tag}${role}: ${text}`;
    }).join("\n");

  if (!transcript.trim()) return null;

  let parsed: InsightResult;
  try {
    const styleDirective = await commentStyleDirective();
    const resp = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM + styleDirective },
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
      hasTrade: typeof json.hasTrade === "boolean" ? json.hasTrade : null,
      tradeVehicle: String(json.tradeVehicle || "").slice(0, 200),
      visitedStore: typeof json.visitedStore === "boolean" ? json.visitedStore : null,
      leadQuality: (json.leadQuality === "bom" || json.leadQuality === "ruim") ? json.leadQuality : null,
      qualityReason: String(json.qualityReason || "").slice(0, 200),
      funnelStage: (["novo", "interesse_definido", "pagamento_definido", "dados_pessoais", "dados_troca", "negociando"].includes(json.funnelStage) ? json.funnelStage : "novo"),
      nomeCompleto: String(json.nomeCompleto || "").slice(0, 255).trim(),
      email: String(json.email || "").slice(0, 255).trim(),
      cidade: String(json.cidade || "").slice(0, 120).trim(),
      cpf: String(json.cpf || "").slice(0, 20).trim(),
      dataNascimento: String(json.dataNascimento || "").slice(0, 20).trim(),
      anoTroca: String(json.anoTroca || "").slice(0, 10).trim(),
      kmTroca: String(json.kmTroca || "").slice(0, 20).trim(),
      formaPagamento: String(json.formaPagamento || "").slice(0, 30).trim(),
      entrada: String(json.entrada || "").slice(0, 30).trim(),
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
    const { getCanonicalLead } = await import("./db");
    const conv0 = (await db.select({ phone: convTable.phone }).from(convTable).where(eq(convTable.id, conversationId)).limit(1))[0];
    const lead = (conv0?.phone ? await getCanonicalLead(conv0.phone) : undefined)
      || (await db.select().from(leads).where(eq(leads.conversationId, conversationId)).limit(1))[0];
    if (lead) {
      const upd: Record<string, unknown> = { temperature: parsed.temperature as any, score: parsed.score };
      // Preenche o que a IA detectou SEM sobrescrever cadastro manual existente
      if ((!lead.vehicleInterest || lead.vehicleInterest === "não definido") && parsed.vehicleInterest && parsed.vehicleInterest !== "não definido") upd.vehicleInterest = parsed.vehicleInterest;
      if (lead.hasTrade == null && parsed.hasTrade != null) upd.hasTrade = parsed.hasTrade;
      if (!lead.tradeVehicle && parsed.tradeVehicle) upd.tradeVehicle = parsed.tradeVehicle;

      // PR#3 — dados cadastrais estruturados: valida (mesmo validador da tool,
      // PR#1) e preenche SOMENTE colunas vazias (não sobrescreve cadastro manual).
      try {
        const { cleaned } = validateLeadArgs({
          email: parsed.email || undefined,
          cidade: parsed.cidade || undefined,
          cpf: parsed.cpf || undefined,
          ano_troca: parsed.anoTroca || undefined,
          km_troca: parsed.kmTroca || undefined,
          entrada: parsed.entrada || undefined,
          forma_pagamento: parsed.formaPagamento || undefined,
        });
        const setIfEmpty = (col: string, val: unknown) => {
          if (val != null && val !== "" && !(lead as any)[col]) upd[col] = val;
        };
        setIfEmpty("email", cleaned.email);
        setIfEmpty("city", cleaned.cidade);
        setIfEmpty("cpf", cleaned.cpf);
        setIfEmpty("tradeYear", cleaned.ano_troca);
        setIfEmpty("tradeKm", cleaned.km_troca);
        setIfEmpty("downPayment", cleaned.entrada);
        setIfEmpty("paymentMethod", cleaned.forma_pagamento);
        setIfEmpty("fullName", parsed.nomeCompleto);
        // Data de nascimento: aceita só se parecer uma data (dd/mm/aaaa ou aaaa-mm-dd)
        if (parsed.dataNascimento && /(\d{2}\D\d{2}\D\d{4}|\d{4}-\d{2}-\d{2})/.test(parsed.dataNascimento) && !lead.birthDate) {
          upd.birthDate = parsed.dataNascimento;
        }
      } catch { /* extração cadastral é best-effort — nunca quebra a análise */ }

      // PR#4 — score/temperatura DETERMINÍSTICOS: score por completude do lead
      // (já considerando o que acabou de ser extraído em `upd`); temperatura = a
      // mais quente entre a faixa do score, o piso do funil e a urgência da IA.
      const mergedLead = { ...lead, ...upd } as any;
      const compScore = scoreLead(mergedLead);
      const funnelTemp = calculateTemperature(String(mergedLead.funnelStatus || "novo"));
      upd.score = compScore;
      upd.temperature = combineTemperature(
        temperatureFromScore(compScore),
        funnelTemp,
        parsed.temperature === "muito_quente",
      );

      // A IA NÃO decide qualidade nem visita — quem marca é o VENDEDOR.
      // Ela continua analisando e o resultado fica disponível como leitura
      // (objeções, próxima ação), mas não grava julgamento no lead.
      await db.update(leads).set(upd as any).where(eq(leads.id, lead.id));
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
