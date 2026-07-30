/**
 * NLU Engine — Arquitetura "vendedor virtual" (fase 2).
 *
 * Transforma linguagem natural em ESTRUTURA. A LLM nunca decide o fluxo:
 * ela só classifica intenção e extrai entidades, com saída JSON estrita.
 * Atalhos determinísticos (botões, números, regex) resolvem a maioria das
 * mensagens sem custo/latência de LLM — a LLM só roda quando necessário.
 *
 * Contrato de uso:
 *   const nlu = await classifyMessage({ text, buttonId, context });
 *   // → { intent, entities, confidence, via }
 *   // O Policy/Journey Engine decide a transição com base nisso.
 */
import { invokeAgentLLM } from "./openaiLLM";

// ─── Intents (enum fechado — versionado junto com a jornada) ──
export const NLU_INTENTS = [
  "SELECT_VEHICLE",      // escolheu um veículo (número, "esse", "o branco")
  "SEARCH_VEHICLE",      // descreveu o que procura (modelo, tipo, preço, combustível)
  "ASK_PHOTOS",          // quer mais fotos
  "ASK_VIDEO",           // quer vídeo
  "ASK_TECHNICAL",       // dúvida técnica sobre o veículo (4x4, consumo, câmbio…)
  "REQUEST_FINANCING",   // quer financiar / simular parcelas
  "HAS_TRADE",           // tem veículo na troca
  "PROVIDE_DATA",        // respondeu um dado pedido (valor, prazo, CPF, ano, km…)
  "SCHEDULE_VISIT",      // quer agendar visita / ir à loja
  "REQUEST_HUMAN",       // quer falar com vendedor/atendente
  "AFFIRM",              // sim / confirmação genérica
  "DENY",                // não / recusa genérica
  "GREETING",            // saudação
  "OFF_TOPIC",           // assunto fora de vendas/pós-venda
  "UNKNOWN",             // não classificou com segurança
] as const;

export type NluIntent = (typeof NLU_INTENTS)[number];

export interface NluEntities {
  vehicleRef?: string;       // marca/modelo citado ("compass", "hilux")
  vehicleIndex?: number;     // posição na lista apresentada (1-based)
  priceMax?: number;
  priceMin?: number;
  fuel?: string;
  bodyType?: string;         // suv, sedan, hatch, picape…
  downPayment?: number;      // valor de entrada
  termMonths?: number;       // prazo em meses
  cpf?: string;
  tradeModel?: string;
  tradeYear?: number;
  tradeKm?: number;
  [key: string]: unknown;
}

export interface NluResult {
  intent: NluIntent;
  entities: NluEntities;
  confidence: number;        // 0..1
  via: "shortcut_button" | "shortcut_number" | "shortcut_regex" | "llm" | "fallback";
}

export interface NluContext {
  /** Quantos veículos foram apresentados na última rodada (0 = nenhum). */
  presentedCount?: number;
  /** Estado atual da máquina de estados (ex.: "FIN_PRAZO") — orienta atalhos. */
  state?: string;
  /** Última pergunta feita pelo sistema (ex.: "down_payment", "term_months"). */
  expecting?: string;
}

// ─── Parsers auxiliares ───────────────────────────────────────
function parseMoneyBR(text: string): number | null {
  // "30 mil", "R$ 30.000", "30000", "20k", "15,5 mil"
  const m = text.match(/(?:r\$\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(mil|k)?/i);
  if (!m) return null;
  const raw = m[1].replace(/[.\s]/g, "").replace(",", ".");
  let val = parseFloat(raw);
  if (isNaN(val)) return null;
  if (m[2]) val *= 1000;
  else if (val <= 200 && /mil|entrada|entrada de|dou de/i.test(text)) val *= 1000;
  return Math.round(val);
}

const BODY_TYPES: Record<string, string[]> = {
  suv: ["suv", "utilitário esportivo"],
  sedan: ["sedan", "sedã"],
  hatch: ["hatch", "hatchback"],
  picape: ["picape", "caminhonete", "pickup", "pick-up", "camionete"],
  van: ["van", "minivan", "utilitário"],
};

function detectBodyType(text: string): string | undefined {
  for (const [type, terms] of Object.entries(BODY_TYPES)) {
    if (terms.some(t => text.includes(t))) return type;
  }
  return undefined;
}

// ─── Atalhos determinísticos (sem LLM) ────────────────────────
function shortcutClassify(text: string, ctx: NluContext): NluResult | null {
  const t = text.toLowerCase().trim();

  // Número puro com veículos apresentados → seleção de veículo
  if ((ctx.presentedCount ?? 0) > 0) {
    const num = t.match(/^(\d{1,2})[.)!]?\s*$/) || t.match(/^(?:op[cç][aã]o|n[úu]mero|o)\s+(\d{1,2})[.)!]?\s*$/i);
    if (num) {
      const idx = Number(num[1]);
      if (idx >= 1 && idx <= (ctx.presentedCount ?? 0)) {
        return { intent: "SELECT_VEHICLE", entities: { vehicleIndex: idx }, confidence: 1, via: "shortcut_number" };
      }
    }
  }

  // CPF
  const cpf = t.match(/\b(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2})\b/);
  if (cpf) {
    return { intent: "PROVIDE_DATA", entities: { cpf: cpf[1].replace(/\D/g, "") }, confidence: 0.99, via: "shortcut_regex" };
  }

  // Dado esperado pelo estado (máquina perguntou → resposta curta é o dado)
  if (ctx.expecting === "down_payment") {
    const money = parseMoneyBR(t);
    if (money && money >= 500) return { intent: "PROVIDE_DATA", entities: { downPayment: money }, confidence: 0.98, via: "shortcut_regex" };
  }
  if (ctx.expecting === "term_months") {
    const term = t.match(/(\d{1,2})\s*(x|vezes|meses|m[eê]s)?/);
    if (term && /^\d{1,2}\s*(x|vezes|meses|m[eê]s)?\s*$/.test(t)) {
      const n = Number(term[1]);
      if (n >= 6 && n <= 84) return { intent: "PROVIDE_DATA", entities: { termMonths: n }, confidence: 0.97, via: "shortcut_regex" };
    }
  }
  if (ctx.expecting === "trade_year") {
    const year = t.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    if (year && t.length <= 10) return { intent: "PROVIDE_DATA", entities: { tradeYear: Number(year[1]) }, confidence: 0.97, via: "shortcut_regex" };
  }
  if (ctx.expecting === "trade_km") {
    const km = t.match(/(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*(km)?/i);
    if (km && /^[\d.\s]+(km)?$/i.test(t)) {
      return { intent: "PROVIDE_DATA", entities: { tradeKm: Number(km[1].replace(/[.\s]/g, "")) }, confidence: 0.97, via: "shortcut_regex" };
    }
  }

  // Sim / Não curtos
  if (/^(sim|s|isso|isso mesmo|aham|claro|com certeza|pode ser|quero|bora|fechou|fechado|ok|okay|beleza|top|topo|show|perfeito|gostei|adorei|amei|curti)[.!\s]*$/i.test(t)) {
    return { intent: "AFFIRM", entities: {}, confidence: 0.95, via: "shortcut_regex" };
  }
  if (/^(n[aã]o|n|nada|deixa|deixa pra l[aá]|desisto|nenhum|nem)[.!\s]*$/i.test(t)) {
    return { intent: "DENY", entities: {}, confidence: 0.95, via: "shortcut_regex" };
  }

  // Fotos / vídeo
  if (/\b(foto|fotos|imagem|imagens)\b/.test(t) && t.length <= 60) {
    return { intent: "ASK_PHOTOS", entities: {}, confidence: 0.9, via: "shortcut_regex" };
  }
  if (/\b(v[ií]deo|video)\b/.test(t) && t.length <= 60) {
    return { intent: "ASK_VIDEO", entities: {}, confidence: 0.9, via: "shortcut_regex" };
  }

  // Humano
  if (/\b(vendedor|atendente|pessoa|humano|algu[eé]m|gerente|consultor)\b/.test(t) && /\b(falar|conversar|chamar|quero|atender)\b/.test(t)) {
    return { intent: "REQUEST_HUMAN", entities: {}, confidence: 0.93, via: "shortcut_regex" };
  }

  // Agendamento
  if (/\b(agendar|agendamento|visita|visitar|ir a[ií]|passar a[ií]|ver o carro|test[\s-]?drive|conhecer a loja)\b/.test(t)) {
    return { intent: "SCHEDULE_VISIT", entities: {}, confidence: 0.88, via: "shortcut_regex" };
  }

  // Financiamento
  if (/\b(financiamento|financiar|financia|parcela|parcelas|prestacao|presta[cç][aã]o|entrada|cdc|cons[oó]rcio)\b/.test(t)) {
    const entities: NluEntities = {};
    const money = parseMoneyBR(t);
    if (money && money >= 500 && /entrada/.test(t)) entities.downPayment = money;
    return { intent: "REQUEST_FINANCING", entities, confidence: 0.9, via: "shortcut_regex" };
  }

  // Troca
  if (/\b(troca|trocar|meu carro|meu ve[ií]culo|dar na troca|na troca|usado na troca)\b/.test(t)) {
    return { intent: "HAS_TRADE", entities: {}, confidence: 0.88, via: "shortcut_regex" };
  }

  // Busca rica em uma frase ("caminhonete diesel até 150 mil", "suv automático até 80 mil")
  const bodyType = detectBodyType(t);
  const fuel = /diesel/.test(t) ? "diesel" : /flex/.test(t) ? "flex" : /gasolina/.test(t) ? "gasolina" : undefined;
  const priceMatch = t.match(/at[eé]\s*(?:r\$\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*(mil|k)?/i);
  if (bodyType || priceMatch) {
    const entities: NluEntities = {};
    if (bodyType) entities.bodyType = bodyType;
    if (fuel) entities.fuel = fuel;
    if (priceMatch) {
      let p = parseFloat(priceMatch[1].replace(/[.\s]/g, ""));
      if (priceMatch[2] || p <= 500) p *= 1000;
      entities.priceMax = Math.round(p);
    }
    if (/autom[aá]tico/.test(t)) entities.transmission = "automatico";
    if (/manual/.test(t)) entities.transmission = "manual";
    return { intent: "SEARCH_VEHICLE", entities, confidence: 0.88, via: "shortcut_regex" };
  }

  // Saudação pura
  if (/^(oi+|ol[aá]|bom dia|boa tarde|boa noite|hey|opa|eai|e a[ií])[\s!.👋]*$/i.test(t)) {
    return { intent: "GREETING", entities: {}, confidence: 0.95, via: "shortcut_regex" };
  }

  return null; // cai para a LLM
}

// ─── Classificação via LLM (saída JSON estrita) ───────────────
const NLU_JSON_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "nlu_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        intent: { type: "string", enum: [...NLU_INTENTS] },
        confidence: { type: "number" },
        entities: {
          type: "object",
          properties: {
            vehicleRef: { type: ["string", "null"] },
            vehicleIndex: { type: ["number", "null"] },
            priceMax: { type: ["number", "null"] },
            priceMin: { type: ["number", "null"] },
            fuel: { type: ["string", "null"] },
            bodyType: { type: ["string", "null"] },
            downPayment: { type: ["number", "null"] },
            termMonths: { type: ["number", "null"] },
            cpf: { type: ["string", "null"] },
            tradeModel: { type: ["string", "null"] },
            tradeYear: { type: ["number", "null"] },
            tradeKm: { type: ["number", "null"] },
          },
          required: ["vehicleRef", "vehicleIndex", "priceMax", "priceMin", "fuel", "bodyType", "downPayment", "termMonths", "cpf", "tradeModel", "tradeYear", "tradeKm"],
          additionalProperties: false,
        },
      },
      required: ["intent", "confidence", "entities"],
      additionalProperties: false,
    },
  },
};

const NLU_SYSTEM_PROMPT = `Você é o classificador de intenção de um CRM de concessionária (WhatsApp).
Sua ÚNICA função: ler a mensagem do cliente e retornar a intenção + entidades, em JSON.
Você NÃO responde o cliente. Você NÃO decide o que acontece depois.

INTENTS:
- SELECT_VEHICLE: escolheu um carro já apresentado ("esse", "o 2", "o branco", "gostei do primeiro")
- SEARCH_VEHICLE: descreveu o que procura (modelo, tipo, preço, combustível, câmbio)
- ASK_PHOTOS / ASK_VIDEO: quer mais fotos / quer vídeo
- ASK_TECHNICAL: dúvida técnica sobre um veículo (4x4, consumo, motor, câmbio, opcionais)
- REQUEST_FINANCING: financiamento, parcelas, simulação, entrada
- HAS_TRADE: tem carro na troca
- PROVIDE_DATA: respondeu um dado solicitado (valor, prazo, CPF, ano, km, modelo da troca)
- SCHEDULE_VISIT: quer ir à loja / agendar / test-drive
- REQUEST_HUMAN: quer falar com vendedor/pessoa
- AFFIRM / DENY: sim ou não genéricos
- GREETING: saudação
- OFF_TOPIC: assunto alheio a compra/pós-venda de veículos
- UNKNOWN: não dá pra classificar com segurança

Regras:
- Extraia entidades numéricas já normalizadas (preço em reais inteiros, km inteiro, ano 4 dígitos).
- "até 50 mil" → priceMax 50000. "30 mil de entrada" → downPayment 30000.
- Em dúvida entre dois intents, escolha o mais específico e reduza confidence.
- NUNCA invente entidades não presentes na mensagem.`;

async function llmClassify(text: string, ctx: NluContext): Promise<NluResult> {
  try {
    const contextNote = [
      ctx.state ? `Estado atual da conversa: ${ctx.state}.` : "",
      ctx.presentedCount ? `Veículos apresentados na última rodada: ${ctx.presentedCount}.` : "",
      ctx.expecting ? `O sistema acabou de perguntar: ${ctx.expecting}.` : "",
    ].filter(Boolean).join(" ");

    const res = await invokeAgentLLM({
      messages: [
        { role: "system", content: NLU_SYSTEM_PROMPT },
        { role: "user", content: `${contextNote ? contextNote + "\n" : ""}Mensagem do cliente: "${text}"` },
      ],
      responseFormat: NLU_JSON_SCHEMA as any,
      maxTokens: 300,
    });

    const content = res.choices?.[0]?.message?.content;
    const parsed = JSON.parse(typeof content === "string" ? content : "{}");
    const intent: NluIntent = (NLU_INTENTS as readonly string[]).includes(parsed.intent) ? parsed.intent : "UNKNOWN";
    const entities: NluEntities = {};
    for (const [k, v] of Object.entries(parsed.entities || {})) {
      if (v !== null && v !== undefined) entities[k] = v as any;
    }
    return { intent, entities, confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5, via: "llm" };
  } catch (err) {
    console.error("[NLU] Falha na classificação LLM:", err);
    return { intent: "UNKNOWN", entities: {}, confidence: 0, via: "fallback" };
  }
}

// ─── API pública ──────────────────────────────────────────────
/**
 * Classifica uma mensagem do cliente. Ordem: botão → atalhos → LLM → UNKNOWN.
 * Botões/listas são intenções pré-classificadas: quem chama informa o mapeamento
 * quando conhecido (ex.: { "btn_sim": "AFFIRM" }).
 */
export async function classifyMessage(input: {
  text: string;
  buttonId?: string | null;
  buttonIntentMap?: Record<string, NluIntent>;
  context?: NluContext;
}): Promise<NluResult> {
  const { text, buttonId, buttonIntentMap, context = {} } = input;

  if (buttonId) {
    const mapped = buttonIntentMap?.[buttonId];
    if (mapped) return { intent: mapped, entities: {}, confidence: 1, via: "shortcut_button" };
  }

  const trimmed = (text || "").trim();
  if (!trimmed) return { intent: "UNKNOWN", entities: {}, confidence: 0, via: "fallback" };

  const shortcut = shortcutClassify(trimmed, context);
  if (shortcut) return shortcut;

  return llmClassify(trimmed, context);
}
