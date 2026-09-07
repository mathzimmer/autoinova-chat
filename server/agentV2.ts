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
import { getAllCuratedVehicles } from "./stockSync";
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
const SESSIONS = new Map<string, { shown: { id: number; title: string }[]; handedOff?: boolean; photosSent?: Record<number, number> }>();
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

// Regras de comportamento EDITÁVEIS (mude no simulador e veja na hora).
// As regras de segurança (anti-invenção, id) ficam fixas no código.
export const DEFAULT_RULES = `COMPORTAMENTO:
- BUSCAR JÁ: se o cliente cita um modelo, marca ou tipo (ex: "interesse na Compass", "quero um SUV"), chame buscar_veiculos IMEDIATAMENTE e mostre as opções — NÃO peça faixa de preço nem modelo antes. Só pergunte preço/uso se NÃO houver em estoque, ou depois de mostrar, pra refinar se vierem muitos resultados.
- LEAD DE ANÚNCIO: se a mensagem já traz um modelo, geralmente vinda de anúncio (ex: "Olá, tenho dúvidas sobre <modelo> ..." com link do Mercado Livre/OLX/Facebook), é um lead quente NAQUELE carro. Na PRIMEIRA resposta: apresente-se em uma linha e JÁ busque e mostre esse modelo — sem perguntar "o que você busca". Se der exatamente 1 resultado, mande a foto (apresentar_veiculo) de cara. Não consegue abrir links, então extraia o modelo do texto da mensagem.
- Foto: mande apresentar_veiculo ao mostrar um carro pela PRIMEIRA vez ou quando pedirem foto/"mais fotos". Ao pedir mais fotos, use o MESMO [ID:X] daquele carro (da lista "VEÍCULOS JÁ MOSTRADOS") — a ferramenta já envia várias fotos. NUNCA invente um id nem chame outro carro. Em simples confirmação de um já mostrado ("gostei", "esse"), NÃO reenvie a foto: só confirme e AVANCE (troca/pagamento/visita).
- Troca: se o cliente tem carro na troca, pergunte modelo, ano e km ANTES de transferir. Nunca prometa valor — a avaliação é presencial.
- FINANCIAMENTO/SIMULAÇÃO: se o cliente quer financiar ou simular, colete ANTES de transferir, uma pergunta por vez: (1) CPF, (2) data de nascimento, (3) valor de parcela que consegue pagar por mês (e entrada, se tiver). VALIDE: CPF tem exatamente 11 dígitos; data no formato dd/mm/aaaa. Se vier algo que claramente não é CPF/data válida, peça de novo com gentileza — NÃO transfira com dado inválido. Só transfira depois dos 3 dados válidos, e inclua todos no resumo.
- PARCELA ≠ PREÇO: valor "por mês"/parcela (ex: "R$1.300 por mês") é dado de FINANCIAMENTO, nunca o preço do carro. NUNCA use isso como preço na busca. Registre como parcela e siga.
- NUNCA DEAD-END: se o cliente demonstra intenção de compra/financiamento (ex: tem crédito aprovado) e você não tem o modelo exato ou na condição pedida, NÃO responda só "não temos". Mostre o carro/parecido que tem e conduza: colete os dados (troca, e no financiamento CPF/nascimento/parcela) e encaminhe pro vendedor. Sempre dê um próximo passo.
- NÃO AFIRME O QUE NÃO FEZ: só diga "agendei" depois de ter loja + dia + horário E chamar transferir_para_vendedor. Nunca diga "fiz o agendamento" se ainda vai perguntar loja/dia. Descreva só ações que realmente aconteceram.
- Handoff: transfira UMA única vez, e só no momento REAL de conversão: agendou visita, pediu falar com humano, ou entrou em negociação de preço/condições. NÃO transfira só porque pediu "mais informações/detalhes" — responda o que puder (opcionais, dados do carro) e siga. Depois de transferir, apenas dê uma mensagem curta de encerramento; NUNCA transfira de novo nem continue fazendo perguntas de qualificação.
- SEJA HUMANA: fale de forma natural e calorosa, variando as frases — não robótica. Use o nome do cliente se souber. NÃO repita a mesma pergunta padrão ("tem troca? como vai pagar?") a cada mensagem; pergunte no momento certo e uma coisa por vez.
- Visita: confirme a loja, o dia e o horário e, DEPOIS de confirmar os três, CHAME transferir_para_vendedor (motivo: agendamento) com o resumo incluindo a visita (carro, dia, hora, loja, troca/pagamento). É a ferramenta que registra e avisa o vendedor — NUNCA confirme um agendamento sem chamá-la.
- FLEXIBILIDADE: se não houver o veículo exato pedido, NUNCA responda só "não temos". Ofereça alternativas próximas (mesma faixa de preço, perfil parecido) que a busca trouxe, explicando por que servem (espaço pra família, economia, custo-benefício). Sempre dê um caminho.
- INFORMAÇÃO QUE NÃO TEM (pneus, revisão, estado detalhado, garantia específica): NUNCA prometa "vou verificar e te aviso depois" — você não faz follow-up sozinho. Seja honesto e diga que esse detalhe é conferido na VISITA/test-drive ou direto com o vendedor, e já ofereça agendar a visita ou falar com um vendedor. Nunca deixe o cliente esperando um retorno que não vai acontecer.
- AÇÃO NA HORA (crítico): QUALQUER ação (mandar foto, transferir pro vendedor, agendar) é executada CHAMANDO a ferramenta na MESMA resposta em que você fala dela. NUNCA anuncie e espere ("vou enviar", "vou transferir agora", "um momento", "aguarde") sem já chamar a ferramenta — você não tem um próximo turno garantido; o cliente pode não responder e a ação nunca acontece. Se disse que vai transferir, o transferir_para_vendedor tem que estar nessa mesma resposta.
- CONDUZA SEMPRE: toda resposta termina com uma pergunta ou um próximo passo (mostrar outro carro, falar de troca/pagamento, agendar visita). Nunca deixe a conversa parada.
- Faça UMA pergunta por vez. Seja curto e natural.`;

export async function getAgentV2Config(): Promise<{ model: string; persona: string; rules: string; temperature: number }> {
  const model = (await getSetting("agentv2_model")) || "openai/gpt-4o-mini";
  const persona = (await getSetting("agentv2_persona")) || DEFAULT_PERSONA;
  const rules = (await getSetting("agentv2_rules")) || DEFAULT_RULES;
  const tRaw = await getSetting("agentv2_temperature");
  const temperature = tRaw ? Number(tRaw) : 0.5;
  return { model, persona, rules, temperature };
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
      description: "Busca veículos no estoque REAL, com filtros ricos. Use quando o cliente quer opções ou descreve o que procura. Traduza o pedido do cliente para os filtros: 'SUV pra família até 100 mil' → tipo:'suv', preco_max:100000. 'carro com teto solar' → requisitos:'teto solar'. 'automático' → cambio:'automatico'. Cada resultado traz [ID:X], categoria, cor, câmbio e opcionais.",
      parameters: {
        type: "object",
        properties: {
          marca: { type: "string", description: "Ex: Toyota, VW, Fiat" },
          modelo: { type: "string", description: "Ex: Corolla, Onix" },
          tipo: { type: "string", description: "Carroceria/categoria: suv, sedan, hatch, picape/caminhonete, 4x4/offroad, moto, van." },
          cor: { type: "string" },
          cambio: { type: "string", description: "automatico ou manual" },
          combustivel: { type: "string", description: "flex, gasolina, diesel, híbrido, elétrico" },
          requisitos: { type: "string", description: "Opcionais/características em texto livre: 'teto solar', 'couro', 'multimídia', 'automático completo'. Busca nos opcionais e na descrição." },
          preco_max: { type: "number", description: "Preço TOTAL do veículo em reais (ex: 80000). NUNCA coloque aqui valor de parcela mensal — 'R$1.300 por mês' é parcela de financiamento, não o preço do carro." },
          preco_min: { type: "number", description: "Preço TOTAL mínimo em reais." },
          ano_min: { type: "number" },
          km_max: { type: "number", description: "Quilometragem MÁXIMA. Ex: 'até 50 mil km' → km_max: 50000." },
        },
        required: [], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apresentar_veiculo",
      description: "Envia a FOTO do veículo + dados. Use ao mostrar um carro específico pela primeira vez ou quando pedirem foto. Passe o veiculo_id do [ID:X]. NÃO reenvie a foto de um carro que você já mostrou nesta conversa.",
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

// ── Config das ferramentas (editável no simulador): descrição + on/off ───────
export interface ToolOverride { enabled: boolean; description: string }
export async function getToolsConfig(): Promise<Record<string, ToolOverride>> {
  let saved: Record<string, Partial<ToolOverride>> = {};
  try { const raw = await getSetting("agentv2_tools"); if (raw) saved = JSON.parse(raw); } catch { /* padrão */ }
  const out: Record<string, ToolOverride> = {};
  for (const t of TOOLS) {
    const name = t.function.name;
    const desc = saved[name]?.description;
    out[name] = {
      enabled: saved[name]?.enabled !== false, // default ligado
      description: (desc && desc.trim()) ? desc : t.function.description,
    };
  }
  return out;
}
/** Lista pras telas: nome, estado, descrição atual e a padrão. */
export async function getAgentV2Tools() {
  const cfg = await getToolsConfig();
  return TOOLS.map(t => ({
    name: t.function.name,
    enabled: cfg[t.function.name].enabled,
    description: cfg[t.function.name].description,
    defaultDescription: t.function.description,
  }));
}
function buildEffectiveTools(cfg: Record<string, ToolOverride>) {
  return TOOLS.filter(t => cfg[t.function.name].enabled).map(t => ({
    ...t,
    function: { ...t.function, description: cfg[t.function.name].description },
  }));
}

function fmtBRL(n: any) { return `R$ ${Number(n || 0).toLocaleString("pt-BR")}`; }

function norm(s: any): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
// Sinônimos de tipo/carroceria → o que procurar em category+vehicleType+descrição.
const TYPE_SYNONYMS: Record<string, string[]> = {
  suv: ["suv", "utilitario esportivo"],
  sedan: ["sedan", "seda"],
  hatch: ["hatch", "hatchback"],
  picape: ["picape", "pickup", "caminhonete", "camionete"],
  offroad: ["4x4", "4 x 4", "quatro por quatro", "offroad", "off road", "awd", "4wd", "jipe", "jeep"],
  moto: ["moto", "motocicleta", "scooter", "naked", "trail"],
  van: ["van", "furgao", "utilitario", "minivan"],
};
function matchTipo(vehText: string, tipoRaw: string): boolean {
  const t = norm(tipoRaw);
  let syns: string[] = [];
  for (const [key, arr] of Object.entries(TYPE_SYNONYMS)) {
    if (key === t || arr.some(a => t.includes(a) || a.includes(t))) { syns = [key, ...arr]; break; }
  }
  if (syns.length === 0) syns = [t]; // tipo desconhecido → usa o texto cru
  return syns.some(s => vehText.includes(s));
}

async function execBuscar(sessionId: string, args: any): Promise<string> {
  let all = await getAllCuratedVehicles();
  // Barra não-carros que às vezes vêm no feed (barco, lancha, jet ski).
  all = all.filter((v: any) => {
    const j = norm(`${v.brand} ${v.model} ${v.category} ${v.vehicleType}`);
    return !(j.includes("barco") || j.includes("lancha") || j.includes("jet ski") || j.includes("jetski"));
  });

  const cambioAuto = args.cambio ? norm(args.cambio).includes("auto") : null;
  const reqWords = args.requisitos ? norm(args.requisitos).split(/\s+/).filter((w: string) => w.length >= 3) : [];

  const filtered = all.filter((v: any) => {
    if (args.preco_max && v.price > args.preco_max) return false;
    if (args.preco_min && v.price < args.preco_min) return false;
    if (args.ano_min && v.year < args.ano_min) return false;
    if (args.km_max && v.mileage && v.mileage > args.km_max) return false;
    if (args.marca && !norm(v.brand).includes(norm(args.marca))) return false;
    if (args.modelo) {
      const mtxt = norm(`${v.model} ${v.version || ""} ${v.title || ""}`);
      if (!mtxt.includes(norm(args.modelo))) return false;
    }
    if (args.cor && !norm(v.color).includes(norm(args.cor))) return false;
    if (args.combustivel && !norm(v.fuel).includes(norm(args.combustivel))) return false;
    if (cambioAuto !== null) {
      const isAuto = norm(v.transmission).includes("auto");
      if (cambioAuto !== isAuto) return false;
    }
    const bodyText = norm(`${v.category || ""} ${v.vehicleType || ""} ${v.model || ""} ${v.title || ""}`);
    if (args.tipo && !matchTipo(bodyText, args.tipo)) return false;
    if (reqWords.length) {
      const feat = norm(`${(Array.isArray(v.features) ? v.features.join(" ") : "")} ${v.description || ""} ${v.title || ""}`);
      if (!reqWords.every((w: string) => feat.includes(w))) return false;
    }
    return true;
  }).sort((a: any, b: any) => a.price - b.price).slice(0, 8);

  const fmtLine = (v: any, i: number) => {
    const cambio = norm(v.transmission).includes("auto") ? "automático" : "manual";
    const tipo = v.vehicleType || v.category || "";
    const feats = Array.isArray(v.features) && v.features.length ? ` · opcionais: ${v.features.slice(0, 5).join(", ")}` : "";
    const title = v.title || `${v.brand} ${v.model} ${v.version || ""}`.trim();
    return `${i + 1}) [ID:${v.id}] ${title} — ${fmtBRL(v.promotionPrice && v.promotionPrice < v.price ? v.promotionPrice : v.price)} · ${v.year} · ${v.mileage ? v.mileage.toLocaleString("pt-BR") + " km" : "km n/i"} · ${cambio} · ${v.color || "cor n/i"}${tipo ? " · " + tipo : ""}${feats}`;
  };

  if (filtered.length > 0) {
    recordShown(sessionId, filtered.map((v: any) => ({ id: v.id, title: v.title || `${v.brand} ${v.model}` })));
    return `RESULTADOS (${filtered.length}). Use SOMENTE o número dentro de [ID:X] como id de ferramenta (não o número da opção). Apresente com os dados EXATOS abaixo, sem inventar. Se o cliente citou um opcional (ex: teto solar) e ele aparece em "opcionais", destaque isso:\n${filtered.map(fmtLine).join("\n")}`;
  }

  // FLEXIBILIDADE: sem match exato → relaxa os filtros "moles", mantém ORÇAMENTO e ano.
  const hasBudget = !!(args.preco_max || args.preco_min);
  const altAll = all.filter((v: any) => {
    if (args.preco_max && v.price > args.preco_max) return false;
    if (args.preco_min && v.price < args.preco_min) return false;
    if (args.ano_min && v.year < args.ano_min) return false;
    return true;
  });

  if (altAll.length === 0) return "Não há veículos nessa faixa de preço/ano. Sugira ampliar o orçamento. NÃO invente veículos.";

  // Sem nenhuma pista (nem preço, nem tipo, nem modelo/marca) → pergunte a faixa.
  if (!hasBudget && !args.tipo && !args.modelo && !args.marca) {
    return "SEM MATCH EXATO e o cliente NÃO informou preço, tipo nem modelo. Faça UMA pergunta curta: qual o orçamento (faixa de preço) dele? NÃO liste carros aleatórios agora.";
  }

  // SIMILARIDADE: descobre o "tipo alvo" — o informado, ou o segmento do modelo pedido.
  const reqModel = args.modelo ? norm(args.modelo) : "";
  const reqBrand = args.marca ? norm(args.marca) : "";
  let targetType = args.tipo ? norm(args.tipo) : "";
  if (!targetType && reqModel) {
    const sameModelAny = all.find((v: any) => norm(`${v.model} ${v.version || ""} ${v.title || ""}`).includes(reqModel));
    if (sameModelAny) targetType = norm(`${sameModelAny.vehicleType || sameModelAny.category || ""}`);
  }

  // Pontua cada candidato: mesmo modelo (100) > mesma marca (20) + mesmo segmento (50).
  const scored = altAll.map((v: any) => {
    const modelText = norm(`${v.brand} ${v.model} ${v.version || ""} ${v.title || ""}`);
    const bodyText = norm(`${v.category || ""} ${v.vehicleType || ""} ${v.model || ""} ${v.title || ""}`);
    let score = 0;
    if (reqModel && modelText.includes(reqModel)) score += 100;
    if (reqBrand && norm(v.brand).includes(reqBrand)) score += 20;
    if (targetType && matchTipo(bodyText, targetType)) score += 50;
    return { v, score };
  });

  // Se há candidatos parecidos (mesmo modelo/segmento), mostra SÓ eles — nunca carro sem relação.
  const strong = scored.filter((s) => s.score > 0);
  const pool = strong.length ? strong : scored;
  const alt = pool
    .sort((a, b) => (b.score - a.score) || (hasBudget ? b.v.price - a.v.price : a.v.price - b.v.price))
    .slice(0, 5)
    .map((s) => s.v);

  recordShown(sessionId, alt.map((v: any) => ({ id: v.id, title: v.title || `${v.brand} ${v.model}` })));
  return `SEM MATCH EXATO no pedido, mas achei opções PARECIDAS (mesmo modelo ou mesmo tipo primeiro). NÃO diga só "não tenho". Se aparecer o mesmo modelo com outra config (ex: automático em vez de manual), ofereça deixando claro a diferença. Só ofereça carros com relação com o pedido. Use o [ID:X]:\n${alt.map(fmtLine).join("\n")}`;
}

async function execApresentar(sessionId: string, args: any, images: AgentImage[]): Promise<string> {
  const id = Number(args.veiculo_id);
  const v: any = await getVehicleById(id);
  if (!v) return `[INTERNO] ID ${id} não existe. Use um [ID:X] real da lista mostrada; NÃO diga ao cliente que vendeu.`;
  if (v.available === false) return `O veículo ${v.brand} ${v.model} ${v.year} não está mais disponível (pode ter sido vendido).`;
  const title = v.title || `${v.brand} ${v.model} ${v.version || ""}`.trim();
  recordShown(sessionId, [{ id, title }]);

  // Fotos disponíveis (até 10). Legenda enxuta: modelo, ano, km, preço.
  const raw: any[] = Array.isArray(v.images) ? v.images : (v.imageUrl ? [v.imageUrl] : []);
  const urls = raw.map((x: any) => (typeof x === "string" ? x : x?.IMAGE_URL || x?.url)).filter((u: any) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 10);
  const kmStr = v.mileage ? `${v.mileage.toLocaleString("pt-BR")} km` : "km não informado";
  const caption = `${title}\n${v.year} · ${kmStr}\nPreço: ${fmtBRL(v.promotionPrice && v.promotionPrice < v.price ? v.promotionPrice : v.price)}`;
  if (urls.length === 0) return `Veículo ${title} encontrado, mas sem foto no cadastro. Dados: ${caption}. Ofereça ver no anúncio (${v.url || "link"}) ou na visita.`;

  // Envia em LOTE: não reenvia fotos já mandadas nesta sessão.
  const st = sess(sessionId);
  st.photosSent = st.photosSent || {};
  const already = st.photosSent[id] || 0;
  if (already >= urls.length) {
    return `Todas as ${urls.length} fotos que temos desse carro já foram enviadas. NÃO reenvie as mesmas. Diga que essas são as fotos disponíveis aqui e que o restante ele vê no anúncio (${v.url || "link"}) ou pessoalmente na visita. Puxe pra visita/vendedor.`;
  }
  const batch = urls.slice(already, already + 5);
  st.photosSent[id] = already + batch.length;
  images.push({ url: batch[0], caption: already === 0 ? caption : "" });
  for (const u of batch.slice(1)) images.push({ url: u, caption: "" });
  const restam = urls.length - st.photosSent[id];
  return `Enviadas ${batch.length} foto(s) de ${title}${restam > 0 ? ` (há mais ${restam} se pedir)` : " (essas são todas as fotos que temos aqui)"}. NÃO repita os dados no texto — já estão na legenda. Avance: pergunte troca/pagamento ou ofereça visita.`;
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

  // Regras de SEGURANÇA (fixas — não editáveis; evitam alucinação/erro de id).
  const coreRules = `REGRAS FIXAS:
- Escreva como WhatsApp: texto corrido, sem markdown, 1-2 emojis no máximo, curto.
- SÓ fale de veículos retornados por buscar_veiculos/apresentar_veiculo. COPIE preço e ano EXATOS. PROIBIDO inventar veículo, preço ou link.
- id de ferramenta = número dentro de [ID:X]. NUNCA use o número da opção (1,2,3) como id.
- Um veículo já mostrado ESTÁ disponível; nunca diga que foi vendido sem a ferramenta confirmar.
- NUNCA escreva links ou imagens no texto (nada de markdown ![]() nem URLs de foto). A foto é enviada SOMENTE pela ferramenta apresentar_veiculo. Só use links que vierem da ferramenta.
- NUNCA invente endereço/telefone/horário: use só "INFORMAÇÕES DA LOJA". Se faltar, diga que confirma com o vendedor.`;

  const shownBlock = s.shown.length
    ? `\n\nVEÍCULOS JÁ MOSTRADOS (use estes IDs):\n${s.shown.map((x, i) => `${i + 1}) ${x.title} [ID:${x.id}]`).join("\n")}`
    : "";

  // Ordem: persona → regras editáveis (comportamento) → regras fixas → info da loja → memória.
  const system = `${cfg.persona}\n\n${cfg.rules}\n\n${coreRules}\n\n=== INFORMAÇÕES DA LOJA (use somente estas) ===\n${businessInfo}${shownBlock}`;

  const messages: LLMMsg[] = [{ role: "system", content: system }];
  for (const h of input.history.slice(-20)) messages.push({ role: h.role, content: h.content });
  messages.push({ role: "user", content: input.message });

  const toolsCfg = await getToolsConfig();
  const effectiveTools = buildEffectiveTools(toolsCfg);

  const images: AgentImage[] = [];
  const toolTrace: ToolTraceItem[] = [];
  let assistant = await chatCompletion({ model: cfg.model, messages, tools: effectiveTools, temperature: cfg.temperature });

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
        else if (tc.function.name === "transferir_para_vendedor") {
          const st = sess(input.sessionId);
          if (st.handedOff) {
            result = "JÁ TRANSFERIDO nesta conversa — NÃO transfira de novo. O vendedor já foi acionado. Se surgiu um detalhe novo (ex: agendou visita), apenas registre na conversa e dê uma mensagem curta; sem chamar a ferramenta outra vez.";
          } else {
            st.handedOff = true;
            result = `Handoff registrado (simulação): ${args.motivo}. Um vendedor assume. Dê UMA mensagem curta de encerramento e NÃO transfira novamente nesta conversa.`;
          }
        }
        else result = "Ferramenta desconhecida.";
      } catch (e) {
        result = `Erro na ferramenta: ${e instanceof Error ? e.message : "desconhecido"}`;
      }
      toolTrace.push({ name: tc.function.name, args, resultSummary: result.slice(0, 300) });
      messages.push({ role: "tool", tool_call_id: tc.id, content: result } as any);
    }
    assistant = await chatCompletion({ model: cfg.model, messages, tools: effectiveTools, temperature: cfg.temperature });
  }

  let reply = (assistant?.content || "").trim() || "…";

  // REDE DE SEGURANÇA: se prometeu transferir/chamar o vendedor mas NÃO chamou a
  // ferramenta neste turno, força a transferência agora (senão o lead se perde).
  const prometeuTransferir = /(vou|irei|já vou|vou já)\s+(transferir|chamar|encaminhar|passar)|chamar (o|um) vendedor|passar (pro|para o) vendedor|encaminhar (seu|sua|suas|para)/i.test(reply);
  if (!sess(input.sessionId).handedOff && prometeuTransferir) {
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: "[SISTEMA: você indicou que vai transferir/chamar o vendedor mas NÃO chamou a ferramenta. Chame transferir_para_vendedor AGORA com um resumo completo (interesse, troca, pagamento/financiamento com CPF/nascimento/parcela se houver, pendências). Não escreva 'um momento'.]" });
    try {
      const forced = await chatCompletion({ model: cfg.model, messages, tools: effectiveTools, temperature: cfg.temperature });
      if (forced?.tool_calls?.length) {
        messages.push({ role: "assistant", content: forced.content || "", tool_calls: forced.tool_calls });
        for (const tc of forced.tool_calls) {
          if (tc.function?.name === "transferir_para_vendedor") {
            const st = sess(input.sessionId);
            let a: any = {}; try { a = JSON.parse(tc.function.arguments || "{}"); } catch { /* noop */ }
            if (!st.handedOff) { st.handedOff = true; toolTrace.push({ name: "transferir_para_vendedor", args: a, resultSummary: "handoff forçado (rede de segurança)" }); }
          }
          messages.push({ role: "tool", tool_call_id: tc.id, content: "Handoff registrado. Dê UMA mensagem curta de encerramento; um vendedor assume." } as any);
        }
        const fecho = await chatCompletion({ model: cfg.model, messages, tools: effectiveTools, temperature: cfg.temperature });
        reply = (fecho?.content || reply).trim();
      }
    } catch { /* mantém a resposta original */ }
  }

  return { reply, images, toolTrace, shownVehicles: sess(input.sessionId).shown };
}
