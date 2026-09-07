/**
 * AGENTE v2 — do zero, isolado do ai.ts/flowEngine.
 *
 * Objetivo desta fase: rodar num SIMULADOR de chat, lendo o estoque REAL do CRM
 * (somente leitura), pela sua LLM via OpenRouter. Sem tocar em webhook, conversas
 * ou fluxos. Quando estiver bom, plugamos no sistema.
 *
 * Princípios: entende o estoque, sabe disponibilidade, apresenta com foto,
 * identifica interesse, NUNCA inventa dado (loja/veículo) e conduz pro vendedor.
 */
import { getSetting, getVehicleById } from "./db";
import { searchVehiclesStructured } from "./stockSync";
import { DEFAULT_BUSINESS_INFO } from "./ai";

// ── Tipos ───────────────────────────────────────────────────────────────────
export type ChatRole = "user" | "assistant";
export interface ChatTurn { role: ChatRole; content: string }
export interface AgentImage { url: string; caption: string }
export interface ToolTraceItem { name: string; args: any; resultSummary: string }
export interface AgentResult {
  reply: string;
  images: AgentImage[];
  toolTrace: ToolTraceItem[];
  shownVehicles: { id: number; title: string }[];
}

// ── Memória por sessão (só na RAM; é simulador) ──────────────────────────────
const SESSIONS = new Map<string, { shown: { id: number; title: string }[] }>();
function sess(id: string) {
  if (!SESSIONS.has(id)) SESSIONS.set(id, { shown: [] });
  return SESSIONS.get(id)!;
}
export function resetSession(id: string) { SESSIONS.delete(id); }

function recordShown(id: string, items: { id: number; title: string }[]) {
  const s = sess(id);
  const byId = new Map<number, { id: number; title: string }>();
  for (const it of [...s.shown, ...items]) if (Number.isFinite(it.id)) byId.set(it.id, it);
  s.shown = Array.from(byId.values()).slice(-12);
}

// ── Config (editável na tela) ────────────────────────────────────────────────
const DEFAULT_PERSONA = `Você é a atendente virtual da Auto Inova (revenda de seminovos em Ivoti/RS e Estância Velha).
Faz pré-atendimento no WhatsApp: entende o que o cliente procura, apresenta veículos do estoque com foto, tira dúvidas e conduz para um vendedor humano ou agenda uma visita.
Tom: consultivo, simpático e direto — como um bom vendedor. Sem enrolação.`;

export async function getAgentV2Config(): Promise<{ model: string; persona: string; temperature: number }> {
  const model = (await getSetting("agentv2_model")) || "openai/gpt-4o-mini";
  const persona = (await getSetting("agentv2_persona")) || DEFAULT_PERSONA;
  const tRaw = await getSetting("agentv2_temperature");
  const temperature = tRaw ? Number(tRaw) : 0.5;
  return { model, persona, temperature };
}

async function getBusinessInfo(): Promise<string> {
  const saved = await getSetting("ai_business_info");
  return (saved && saved.trim()) ? saved : DEFAULT_BUSINESS_INFO;
}

// ── Cliente LLM (OpenRouter; cai pro OpenAI se não houver chave OpenRouter) ───
interface LLMMsg { role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }
async function chatCompletion(params: { model: string; messages: LLMMsg[]; tools?: any[]; temperature?: number }) {
  const orKey = process.env.OPENROUTER_API_KEY;

  // 1) Se houver chave OpenRouter → usa OpenRouter (Claude/Gemini/GPT via um endpoint).
  if (orKey) {
    const body: any = { model: params.model, messages: params.messages, temperature: params.temperature ?? 0.5, max_tokens: 900 };
    if (params.tools?.length) { body.tools = params.tools; body.tool_choice = "auto"; }
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${orKey}`,
        "HTTP-Referer": "https://autoinovacrm.com.br",
        "X-Title": "Auto Inova AgentV2",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const json: any = await resp.json();
    return json.choices?.[0]?.message ?? { role: "assistant", content: "" };
  }

  // 2) Sem OpenRouter → usa o MESMO caminho do CRM (OpenAI se houver chave,
  //    senão o LLM nativo/Forge embutido). Assim o simulador já funciona hoje.
  const { invokeAgentLLM } = await import("./openaiLLM");
  const result: any = await invokeAgentLLM({
    messages: params.messages as any,
    tools: params.tools,
    tool_choice: params.tools?.length ? "auto" : undefined,
    maxTokens: 900,
  } as any);
  return result?.choices?.[0]?.message ?? { role: "assistant", content: "" };
}

// ── Ferramentas ──────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "buscar_veiculos",
      description: "Busca veículos no estoque REAL. Use quando o cliente quer ver opções ou um modelo/tipo/faixa de preço. Cada resultado traz [ID:X] para você usar depois.",
      parameters: {
        type: "object",
        properties: {
          marca: { type: "string" }, modelo: { type: "string" },
          tipo: { type: "string", description: "picape, hatch, sedan, suv, etc." },
          preco_max: { type: "number" }, preco_min: { type: "number" },
          ano_min: { type: "number" }, combustivel: { type: "string" }, cambio: { type: "string" },
        },
        required: [], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apresentar_veiculo",
      description: "Envia a FOTO do veículo + dados. Use quando o cliente pedir foto ou você quiser mostrar um carro específico. Passe o veiculo_id do [ID:X].",
      parameters: {
        type: "object",
        properties: { veiculo_id: { type: "number" }, mensagem: { type: "string" } },
        required: ["veiculo_id"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transferir_para_vendedor",
      description: "Encaminha para um vendedor humano (handoff). Use quando: cliente pediu humano; escolheu carro E definiu pagamento; quer negociar/agendar visita.",
      parameters: {
        type: "object",
        properties: {
          resumo: { type: "string", description: "Resumo pro vendedor (interesse, troca, pagamento, pendências)." },
          motivo: { type: "string", enum: ["pediu_humano", "negociacao", "agendamento", "dados_completos"] },
        },
        required: ["resumo", "motivo"], additionalProperties: false,
      },
    },
  },
];

function fmtBRL(n: any) { return `R$ ${Number(n || 0).toLocaleString("pt-BR")}`; }

async function execBuscar(sessionId: string, args: any): Promise<string> {
  const qParts = [args.marca, args.modelo, args.tipo].filter(Boolean).join(" ");
  let list = await searchVehiclesStructured({
    q: qParts,
    maxPrice: args.preco_max, minPrice: args.preco_min,
    yearMin: args.ano_min, fuel: args.combustivel, limit: 8,
  });
  if (args.cambio) {
    const c = String(args.cambio).toLowerCase();
    list = list.filter(v => String(v.cambio || "").toLowerCase().includes(c.includes("auto") ? "auto" : "manual"));
  }
  if (list.length === 0) return "Nenhum veículo encontrado com esses critérios. Sugira ampliar a busca (ex: tirar um filtro).";
  recordShown(sessionId, list.map(v => ({ id: v.id, title: v.titulo })));
  const lines = list.map((v, i) =>
    `${i + 1}) [ID:${v.id}] ${v.titulo} — ${fmtBRL(v.preco)} · ${v.ano} · ${v.km ? v.km.toLocaleString("pt-BR") + " km" : "km n/i"} · ${v.cambio || ""}`.trim(),
  );
  return `RESULTADOS (${list.length}). Use SOMENTE o número dentro de [ID:X] como id de ferramenta (não o número da opção). Apresente com os dados EXATOS abaixo, sem inventar:\n${lines.join("\n")}`;
}

async function execApresentar(sessionId: string, args: any, images: AgentImage[]): Promise<string> {
  const id = Number(args.veiculo_id);
  const v: any = await getVehicleById(id);
  if (!v) return `[INTERNO] ID ${id} não existe. Use um [ID:X] real da lista mostrada; NÃO diga ao cliente que vendeu.`;
  if (v.available === false) return `O veículo ${v.brand} ${v.model} ${v.year} não está mais disponível (pode ter sido vendido).`;
  const title = v.title || `${v.brand} ${v.model} ${v.version || ""}`.trim();
  recordShown(sessionId, [{ id, title }]);
  // Fotos: até 5
  const raw: any[] = Array.isArray(v.images) ? v.images : (v.imageUrl ? [v.imageUrl] : []);
  const urls = raw.map((x: any) => (typeof x === "string" ? x : x?.IMAGE_URL || x?.url)).filter((u: any) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 5);
  const caption = `${title}\nAno: ${v.year} · ${v.mileage ? v.mileage.toLocaleString("pt-BR") + " km" : "km n/i"} · ${v.transmission || ""}\nPreço: ${fmtBRL(v.promotionPrice && v.promotionPrice < v.price ? v.promotionPrice : v.price)}${v.url ? `\n${v.url}` : ""}`;
  if (urls.length === 0) return `Veículo ${title} encontrado, mas sem foto no cadastro. Dados: ${caption}`;
  images.push({ url: urls[0], caption });
  for (const u of urls.slice(1)) images.push({ url: u, caption: "" });
  return `Foto de ${title} enviada (${urls.length}). NÃO repita os dados no texto — já estão na legenda. Avance: pergunte troca/pagamento ou ofereça visita.`;
}

// ── Runtime: um turno de conversa ────────────────────────────────────────────
export async function runAgentV2Turn(input: {
  sessionId: string;
  history: ChatTurn[];
  message: string;
}): Promise<AgentResult> {
  const cfg = await getAgentV2Config();
  const businessInfo = await getBusinessInfo();
  const s = sess(input.sessionId);

  const rules = `REGRAS:
- Escreva como WhatsApp: texto corrido, sem markdown, 1-2 emojis no máximo, curto.
- SÓ fale de veículos retornados por buscar_veiculos/apresentar_veiculo. COPIE preço e ano EXATOS. PROIBIDO inventar veículo, preço ou link.
- id de ferramenta = número dentro de [ID:X]. NUNCA use o número da opção (1,2,3) como id.
- Um veículo já mostrado ESTÁ disponível; nunca diga que foi vendido sem a ferramenta confirmar.
- Quando o cliente pedir foto, chame apresentar_veiculo com o [ID:X].
- NUNCA invente endereço/telefone/horário: use só "INFORMAÇÕES DA LOJA". Se faltar, diga que confirma com o vendedor.
- Ao definir veículo + pagamento (ou cliente pedir humano/visita), chame transferir_para_vendedor.`;

  const shownBlock = s.shown.length
    ? `\n\nVEÍCULOS JÁ MOSTRADOS (use estes IDs):\n${s.shown.map((x, i) => `${i + 1}) ${x.title} [ID:${x.id}]`).join("\n")}`
    : "";

  const system = `${cfg.persona}\n\n${rules}\n\n=== INFORMAÇÕES DA LOJA (use somente estas) ===\n${businessInfo}${shownBlock}`;

  const messages: LLMMsg[] = [{ role: "system", content: system }];
  for (const h of input.history.slice(-20)) messages.push({ role: h.role, content: h.content });
  messages.push({ role: "user", content: input.message });

  const images: AgentImage[] = [];
  const toolTrace: ToolTraceItem[] = [];
  let assistant = await chatCompletion({ model: cfg.model, messages, tools: TOOLS, temperature: cfg.temperature });

  let rounds = 5;
  while (assistant?.tool_calls?.length && rounds-- > 0) {
    messages.push({ role: "assistant", content: assistant.content || "", tool_calls: assistant.tool_calls });
    for (const tc of assistant.tool_calls) {
      let args: any = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* noop */ }
      let result = "";
      try {
        if (tc.function.name === "buscar_veiculos") result = await execBuscar(input.sessionId, args);
        else if (tc.function.name === "apresentar_veiculo") result = await execApresentar(input.sessionId, args, images);
        else if (tc.function.name === "transferir_para_vendedor") result = `Handoff registrado (simulação): ${args.motivo}. Dê UMA mensagem curta de encerramento; um vendedor assume.`;
        else result = "Ferramenta desconhecida.";
      } catch (e) {
        result = `Erro na ferramenta: ${e instanceof Error ? e.message : "desconhecido"}`;
      }
      toolTrace.push({ name: tc.function.name, args, resultSummary: result.slice(0, 300) });
      messages.push({ role: "tool", tool_call_id: tc.id, content: result } as any);
    }
    assistant = await chatCompletion({ model: cfg.model, messages, tools: TOOLS, temperature: cfg.temperature });
  }

  const reply = (assistant?.content || "").trim() || "…";
  return { reply, images, toolTrace, shownVehicles: s.shown };
}
