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
type ListItem = { id: number; title: string; year?: number; color?: string; price?: number; auto?: boolean };
type LeadData = {
  nome?: string; cidade?: string;
  veiculoId?: number; veiculoInteresse?: string;
  temTroca?: boolean; trocaModelo?: string; trocaAno?: string; trocaKm?: string;
  pagamento?: "avista" | "financiado";
  finCpf?: string; finNascimento?: string; finParcela?: string; finEntrada?: string;
};
const SESSIONS = new Map<string, { shown: { id: number; title: string }[]; handedOff?: boolean; photosSent?: Record<number, number>; lastList?: ListItem[]; lead?: LeadData }>();
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
- LEAD DE ANÚNCIO: se a mensagem já traz um modelo, geralmente vinda de anúncio (ex: "Olá, tenho dúvidas sobre <modelo> ..." com link do Mercado Livre/OLX/Facebook), é um lead quente NAQUELE carro. Na PRIMEIRA resposta: apresente-se em uma linha e JÁ busque e mostre esse modelo — sem perguntar "o que você busca". Se der exatamente 1 resultado, mande a foto (apresentar_veiculo) de cara. Não consegue abrir links, então extraia o modelo do TEXTO da mensagem. Se o link NÃO tiver o nome/modelo do carro (ex: só um número), NÃO chute nem busque aleatório — pergunte simpaticamente qual carro ele viu/procura.
- Foto: mande apresentar_veiculo ao mostrar um carro pela PRIMEIRA vez ou quando pedirem foto/"mais fotos". Ao pedir mais fotos, use o MESMO [ID:X] daquele carro (da lista "VEÍCULOS JÁ MOSTRADOS") — a ferramenta já envia várias fotos. NUNCA invente um id nem chame outro carro. Em simples confirmação de um já mostrado ("gostei", "esse"), NÃO reenvie a foto: só confirme e AVANCE (troca/pagamento/visita).
- Troca: se o cliente tem carro na troca, pergunte modelo, ano e km ANTES de transferir. Nunca prometa valor — a avaliação é presencial.
- FINANCIAMENTO/SIMULAÇÃO: se o cliente quer financiar ou simular, colete ANTES de transferir, uma pergunta por vez: (1) CPF, (2) data de nascimento, (3) valor de parcela que consegue pagar por mês (e entrada, se tiver). VALIDE: CPF tem exatamente 11 dígitos; data no formato dd/mm/aaaa. Se vier algo que claramente não é CPF/data válida, peça de novo com gentileza — NÃO transfira com dado inválido. Só transfira depois dos 3 dados válidos, e inclua todos no resumo.
- PARCELA ≠ PREÇO: valor "por mês"/parcela (ex: "R$1.300 por mês") é dado de FINANCIAMENTO, nunca o preço do carro. NUNCA use isso como preço na busca. Registre como parcela e siga.
- NUNCA DEAD-END: se o cliente demonstra intenção de compra/financiamento (ex: tem crédito aprovado) e você não tem o modelo exato ou na condição pedida, NÃO responda só "não temos". Mostre o carro/parecido que tem e conduza: colete os dados (troca, e no financiamento CPF/nascimento/parcela) e encaminhe pro vendedor. Sempre dê um próximo passo.
- DADOS DO CLIENTE: ao longo da conversa, colete com naturalidade o NOME e a CIDADE do cliente (uma coisa por vez, sem interrogatório). Inclua no resumo do handoff.
- MORA LONGE / OUTRA CIDADE: se o cliente disser que mora longe ou é de outra cidade, ofereça ATENDIMENTO ONLINE — vídeos e fotos detalhadas do veículo e simulação de financiamento à distância — e encaminhe pro vendedor dar sequência. Nunca perca o lead por causa da distância.
- NÃO AFIRME O QUE NÃO FEZ: só diga "agendei" depois de ter loja + dia + horário E chamar transferir_para_vendedor. Nunca diga "fiz o agendamento" se ainda vai perguntar loja/dia. Descreva só ações que realmente aconteceram.
- Handoff: transfira UMA única vez, e só no momento REAL de conversão: agendou visita, pediu falar com humano, ou entrou em negociação de preço/condições. NÃO transfira só porque pediu "mais informações/detalhes" — responda o que puder (opcionais, dados do carro) e siga. Depois de transferir, apenas dê uma mensagem curta de encerramento; NUNCA transfira de novo nem continue fazendo perguntas de qualificação.
- SEJA HUMANA: fale de forma natural e calorosa, variando as frases — não robótica. Use o nome do cliente se souber. NÃO repita a mesma pergunta padrão ("tem troca? como vai pagar?") a cada mensagem; pergunte no momento certo e uma coisa por vez.
- Visita: confirme a loja, o dia e o horário e, DEPOIS de confirmar os três, CHAME transferir_para_vendedor (motivo: agendamento) com o resumo incluindo a visita (carro, dia, hora, loja, troca/pagamento). É a ferramenta que registra e avisa o vendedor — NUNCA confirme um agendamento sem chamá-la.
- FLEXIBILIDADE: se não houver o veículo exato pedido, NUNCA responda só "não temos". Ofereça alternativas próximas (mesma faixa de preço, perfil parecido) que a busca trouxe, explicando por que servem (espaço pra família, economia, custo-benefício). Sempre dê um caminho.
- INFORMAÇÃO QUE NÃO TEM (pneus, revisão, estado detalhado, garantia específica): NUNCA prometa "vou verificar e te aviso depois" — você não faz follow-up sozinho. Seja honesto e diga que esse detalhe é conferido na VISITA/test-drive ou direto com o vendedor, e já ofereça agendar a visita ou falar com um vendedor. Nunca deixe o cliente esperando um retorno que não vai acontecer.
- AÇÃO NA HORA (crítico): QUALQUER ação (mandar foto, transferir pro vendedor, agendar) é executada CHAMANDO a ferramenta na MESMA resposta em que você fala dela. NUNCA anuncie e espere ("vou enviar", "vou transferir agora", "um momento", "aguarde") sem já chamar a ferramenta — você não tem um próximo turno garantido; o cliente pode não responder e a ação nunca acontece. Se disse que vai transferir, o transferir_para_vendedor tem que estar nessa mesma resposta.
- OBJEÇÕES: se o cliente objetar ("tá caro", "vou pensar", "muito rodado", "meu carro vale mais", "só olhando"), NUNCA desista nem encerre. Use o bloco "FAQ E CONTORNO DE OBJEÇÕES": reconheça, contorne com valor (procedência, opcionais, simulação, troca) e conduza pro próximo passo (visita/vendedor/foto).
- CONDUZA SEMPRE: toda resposta termina com uma pergunta ou um próximo passo (mostrar outro carro, falar de troca/pagamento, agendar visita). Nunca deixe a conversa parada.
- Faça UMA pergunta por vez. Seja curto e natural.`;

export async function getAgentV2Config(): Promise<{ model: string; persona: string; rules: string; faq: string; temperature: number }> {
  const model = (await getSetting("agentv2_model")) || "openai/gpt-4o-mini";
  const persona = (await getSetting("agentv2_persona")) || DEFAULT_PERSONA;
  const rules = (await getSetting("agentv2_rules")) || DEFAULT_RULES;
  const faq = (await getSetting("agentv2_faq")) || DEFAULT_FAQ;
  const tRaw = await getSetting("agentv2_temperature");
  const temperature = tRaw ? Number(tRaw) : 0.5;
  return { model, persona, rules, faq, temperature };
}

async function getBusinessInfo(): Promise<string> {
  const saved = await getSetting("ai_business_info");
  return (saved && saved.trim()) ? saved : DEFAULT_BUSINESS_INFO;
}

// FAQ + contorno de objeções — editável (setting agentv2_faq). O agente usa pra
// responder dúvidas comuns e NÃO desistir quando o cliente objeta.
export const DEFAULT_FAQ = `PERGUNTAS FREQUENTES:
- Aceita troca? Sim, avaliamos seu usado (presencial ou por fotos/vídeo).
- Faz financiamento? Sim, com +12 financeiras; com ou sem entrada; analisamos até com restrição.
- Atende de outra cidade? Sim, atendimento online com vídeos, fotos e simulação.

CONTORNO DE OBJEÇÕES (nunca desista — reconheça, contorne e conduza pra visita/vendedor):
- "Tá caro": mostre o valor (estado, opcionais, procedência) e ofereça simular parcela ou avaliar a troca pra encaixar no orçamento.
- "Vou pensar": tudo bem, mas ofereça já garantir uma visita/test-drive sem compromisso, ou mandar mais fotos/vídeo. Descubra a real objeção (preço? parcela? modelo?).
- "É muito rodado": destaque revisões/procedência e ofereça alternativas com menos km na mesma faixa.
- "Meu carro vale mais na troca": a avaliação é presencial e justa; vale trazer pra avaliar sem compromisso.
- "Achei mais barato em outro lugar": foque no custo-benefício, procedência e atendimento; ofereça a visita pra comparar de perto.
- "Só estou olhando": ok! Pergunte o que procura e ofereça ajudar a achar a melhor opção quando decidir.`;

async function getFaq(): Promise<string> {
  const saved = await getSetting("agentv2_faq");
  return (saved && saved.trim()) ? saved : DEFAULT_FAQ;
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
      name: "coletar_dado",
      description: "Registra dados do cliente conforme você descobre na conversa. CHAME sempre que o cliente informar qualquer um destes: nome, cidade, troca, forma de pagamento ou dados de financiamento. Pode chamar várias vezes.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string" },
          cidade: { type: "string" },
          veiculo_id: { type: "number", description: "ID do veículo de interesse escolhido." },
          tem_troca: { type: "boolean", description: "true se o cliente tem carro na troca, false se não tem." },
          troca_modelo: { type: "string" }, troca_ano: { type: "string" }, troca_km: { type: "string" },
          pagamento: { type: "string", enum: ["avista", "financiado"] },
          cpf: { type: "string" }, data_nascimento: { type: "string" }, parcela: { type: "string" }, entrada: { type: "string" },
        },
        required: [], additionalProperties: false,
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

// Resolve DETERMINISTICAMENTE a seleção do cliente sobre a última lista mostrada
// (número, "o primeiro", ano, cor, câmbio, "mais barato"). Retorna o ID ou null.
const ORD_WORDS: Record<string, number> = {
  primeiro: 0, primeira: 0, segundo: 1, segunda: 1, terceiro: 2, terceira: 2,
  quarto: 3, quarta: 3, quinto: 4, quinta: 4, ultimo: -1, ultima: -1,
};
function resolveSelection(msg: string, list?: ListItem[]): number | null {
  if (!list || list.length === 0) return null;
  const m = norm(msg).trim();
  if (m.length > 30) return null;
  // Negação/troca de opção → NÃO force seleção (ex: "não quero a 2012", "quero outra").
  if (/\bnao\b|\bnunca\b|sem interesse|nao quero|nao gostei|esquece|\boutro\b|\boutra\b/.test(m)) return null;
  // número puro ("1", "o 2", "opção 3")
  const num = m.match(/^(?:o|a|no|na|op(?:c|ç)ao|numero|quero o|quero a|quero)?\s*(\d{1,2})\s*$/);
  if (num) { const i = Number(num[1]) - 1; if (list[i]) return list[i].id; }
  // ordinal por extenso
  for (const [w, idx] of Object.entries(ORD_WORDS)) {
    if (m.includes(w)) { const i = idx < 0 ? list.length - 1 : idx; if (list[i]) return list[i].id; }
  }
  // ano (4 dígitos)
  const yr = m.match(/\b(19|20)\d{2}\b/);
  if (yr) { const hit = list.find(v => v.year === Number(yr[0])); if (hit) return hit.id; }
  // cor
  for (const c of ["branco", "preto", "prata", "cinza", "vermelho", "azul", "verde", "amarelo", "dourado", "marrom", "bege", "vinho", "laranja"]) {
    if (m.includes(c)) { const hit = list.find(v => norm(v.color).includes(c)); if (hit) return hit.id; }
  }
  // câmbio
  if (m.includes("automat")) { const hit = list.find(v => v.auto); if (hit) return hit.id; }
  if (/\bmanual\b/.test(m)) { const hit = list.find(v => !v.auto); if (hit) return hit.id; }
  // mais barato / mais caro
  if (m.includes("barat")) return [...list].sort((a, b) => (a.price || 0) - (b.price || 0))[0].id;
  if (m.includes("caro")) return [...list].sort((a, b) => (b.price || 0) - (a.price || 0))[0].id;
  return null;
}

async function execBuscar(sessionId: string, args: any): Promise<string> {
  let all = await getAllCuratedVehicles();
  // Barra não-carros que às vezes vêm no feed (barco, lancha, jet ski).
  all = all.filter((v: any) => {
    const j = norm(`${v.brand} ${v.model} ${v.category} ${v.vehicleType}`);
    return !(j.includes("barco") || j.includes("lancha") || j.includes("jet ski") || j.includes("jetski"));
  });

  // Ignora "modelo"/"marca" que são só números (ex: id de link do Marketplace/OLX).
  const isNumericJunk = (s: any) => /^\d{4,}$/.test(String(s || "").replace(/\D/g, "")) && String(s || "").replace(/[^a-zA-Z]/g, "").length < 2;
  if (isNumericJunk(args.modelo)) delete args.modelo;
  if (isNumericJunk(args.marca)) delete args.marca;

  // Sem NENHUM critério útil (ex: cliente mandou só um link sem citar o carro) →
  // não despeje estoque aleatório; peça qual veículo ele procura.
  const temCriterio = !!(args.marca || args.modelo || args.tipo || args.cor || args.combustivel || args.requisitos || args.preco_max || args.preco_min || args.ano_min || args.km_max);
  if (!temCriterio) {
    return "SEM CRITÉRIO: o cliente não disse qual carro quer (ex: mandou só um link sem o nome/modelo). Pergunte, de forma simpática, qual veículo, tipo ou faixa de preço ele procura. NÃO liste carros aleatórios.";
  }

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

  const toListItem = (v: any): ListItem => ({
    id: v.id, title: v.title || `${v.brand} ${v.model}`, year: v.year, color: v.color,
    price: (v.promotionPrice && v.promotionPrice < v.price) ? v.promotionPrice : v.price,
    auto: norm(v.transmission).includes("auto"),
  });

  if (filtered.length > 0) {
    sess(sessionId).lastList = filtered.map(toListItem);
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

  sess(sessionId).lastList = alt.map(toListItem);
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

// ── Funil guiado: captura de dados + próximo passo + completude ──────────────
function execColetar(sessionId: string, args: any): string {
  const st = sess(sessionId);
  const lead: LeadData = st.lead || (st.lead = {});
  if (args.nome) lead.nome = String(args.nome).trim();
  if (args.cidade) lead.cidade = String(args.cidade).trim();
  if (args.veiculo_id != null) lead.veiculoId = Number(args.veiculo_id);
  if (typeof args.tem_troca === "boolean") lead.temTroca = args.tem_troca;
  if (args.troca_modelo) lead.trocaModelo = String(args.troca_modelo);
  if (args.troca_ano) lead.trocaAno = String(args.troca_ano);
  if (args.troca_km) lead.trocaKm = String(args.troca_km);
  if (args.pagamento === "avista" || args.pagamento === "financiado") lead.pagamento = args.pagamento;
  if (args.cpf) lead.finCpf = String(args.cpf).replace(/\D/g, "");
  if (args.data_nascimento) lead.finNascimento = String(args.data_nascimento);
  if (args.parcela) lead.finParcela = String(args.parcela);
  if (args.entrada) lead.finEntrada = String(args.entrada);
  // Dedução: se veio qualquer dado de financiamento, a forma de pagamento É financiado.
  if ((lead.finCpf || lead.finNascimento || lead.finParcela || lead.finEntrada) && lead.pagamento !== "avista") {
    lead.pagamento = "financiado";
  }
  return `Dados registrados. ${nextStep(lead)}`;
}

/** Próximo passo obrigatório do funil, na ordem. "" = checklist completo. */
function nextStep(lead: LeadData): string {
  if (!lead.nome) return "PRÓXIMO PASSO: descubra e registre o NOME do cliente.";
  if (!lead.cidade) return "PRÓXIMO PASSO: descubra a CIDADE do cliente (e se mora longe, ofereça atendimento online).";
  if (!lead.veiculoId && !lead.veiculoInteresse) return "PRÓXIMO PASSO: descubra o VEÍCULO de interesse (busque e mostre).";
  if (lead.temTroca === undefined) return "PRÓXIMO PASSO: pergunte se o cliente tem carro na TROCA.";
  if (lead.temTroca && !lead.trocaModelo) return "PRÓXIMO PASSO: pegue os dados da TROCA (modelo, ano, km).";
  if (!lead.pagamento) return "PRÓXIMO PASSO: pergunte a forma de PAGAMENTO (à vista ou financiado).";
  if (lead.pagamento === "financiado" && (!lead.finCpf || !lead.finNascimento || !lead.finParcela)) return "PRÓXIMO PASSO: colete os dados do FINANCIAMENTO (CPF, data de nascimento, valor de parcela).";
  return "CHECKLIST COMPLETO: pode agendar visita ou transferir pro vendedor com transferir_para_vendedor.";
}

/** true se todos os obrigatórios do caminho estão preenchidos. */
function leadCompleto(lead?: LeadData): boolean {
  if (!lead) return false;
  if (!lead.nome || !lead.cidade) return false;
  if (!lead.veiculoId && !lead.veiculoInteresse) return false;
  if (lead.temTroca === undefined) return false;
  if (lead.temTroca && !lead.trocaModelo) return false;
  if (!lead.pagamento) return false;
  if (lead.pagamento === "financiado" && (!lead.finCpf || !lead.finNascimento || !lead.finParcela)) return false;
  return true;
}

function faltamNoLead(lead?: LeadData): string[] {
  const f: string[] = [];
  if (!lead?.nome) f.push("nome");
  if (!lead?.cidade) f.push("cidade");
  if (!lead?.veiculoId && !lead?.veiculoInteresse) f.push("veículo de interesse");
  if (lead?.temTroca === undefined) f.push("se tem troca");
  else if (lead?.temTroca && !lead?.trocaModelo) f.push("dados da troca");
  if (!lead?.pagamento) f.push("forma de pagamento");
  else if (lead?.pagamento === "financiado" && (!lead?.finCpf || !lead?.finNascimento || !lead?.finParcela)) f.push("dados do financiamento (CPF/nascimento/parcela)");
  return f;
}

function resumoLead(lead?: LeadData): string {
  if (!lead) return "";
  const p: string[] = [];
  if (lead.nome) p.push(`Nome: ${lead.nome}`);
  if (lead.cidade) p.push(`Cidade: ${lead.cidade}`);
  if (lead.veiculoId) p.push(`Veículo: [ID:${lead.veiculoId}]`);
  else if (lead.veiculoInteresse) p.push(`Veículo: ${lead.veiculoInteresse}`);
  if (lead.temTroca === false) p.push("Troca: não");
  else if (lead.temTroca) p.push(`Troca: ${lead.trocaModelo || "?"} ${lead.trocaAno || ""} ${lead.trocaKm || ""}`.trim());
  if (lead.pagamento) p.push(`Pagamento: ${lead.pagamento}`);
  if (lead.pagamento === "financiado") p.push(`Financiamento: CPF ${lead.finCpf || "?"}, nasc ${lead.finNascimento || "?"}, parcela ${lead.finParcela || "?"}${lead.finEntrada ? `, entrada ${lead.finEntrada}` : ""}`);
  return p.join(" | ");
}

// ── Runtime: um turno de conversa ────────────────────────────────────────────
export async function runAgentV2Turn(input: {
  sessionId: string;
  history: ChatTurn[];
  message: string;
}): Promise<AgentResult> {
  const cfg = await getAgentV2Config();
  const businessInfo = await getBusinessInfo();
  const faq = await getFaq();
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

  // Seleção determinística sobre a última lista ("1", "o azul", "a 2012", "automático"...).
  const selectedId = resolveSelection(input.message, s.lastList);
  let selBlock = "";
  if (selectedId != null) {
    const it = (s.lastList || []).find((x) => x.id === selectedId);
    selBlock = `\n\n⚠️ SELEÇÃO DETECTADA: o cliente se refere ao veículo [ID:${selectedId}]${it ? ` (${it.title} ${it.year || ""} ${it.color || ""})`.trim() : ""} da última lista. Para apresentar/confirmar/mandar foto, use veiculo_id: ${selectedId}. NUNCA use outro id.`;
  }

  // Auto-captura: seleção de carro já vira interesse no funil.
  if (selectedId != null) { const lead = s.lead || (s.lead = {}); lead.veiculoId = selectedId; }

  // Funil guiado: estado + próximo passo obrigatório (a "trilha" que garante a ordem).
  const funnelBlock = `\n\n=== FUNIL DE ATENDIMENTO (dados já coletados) ===\n${resumoLead(s.lead) || "(nada ainda)"}\n➡️ ${nextStep(s.lead || {})}\n\nORDEM OBRIGATÓRIA: a SUA próxima pergunta deve ser SOMENTE sobre o PRÓXIMO PASSO acima. É PROIBIDO perguntar sobre etapas seguintes antes de concluir a atual (ex: não peça CPF/pagamento se ainda falta nome ou cidade). Se o cliente trouxer outra informação ou fizer uma pergunta, RESPONDA e registre com coletar_dado, e em seguida volte para o PRÓXIMO PASSO. Uma pergunta por vez, natural, sem parecer formulário. Nunca pule etapas. NUNCA pergunte de novo algo que já aparece em "dados já coletados" acima — se já tem, siga em frente.`;

  // Ordem: persona → regras editáveis (comportamento) → regras fixas → info da loja → memória → funil.
  const system = `${cfg.persona}\n\n${cfg.rules}\n\n${coreRules}\n\n=== INFORMAÇÕES DA LOJA (use somente estas) ===\n${businessInfo}\n\n=== FAQ E CONTORNO DE OBJEÇÕES ===\n${faq}${shownBlock}${selBlock}${funnelBlock}`;

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
        else if (tc.function.name === "apresentar_veiculo") {
          // Rede de segurança: se houve seleção determinística e o modelo mandou outro id, corrige.
          if (selectedId != null && Number(args.veiculo_id) !== selectedId) args.veiculo_id = selectedId;
          result = await execApresentar(input.sessionId, args, images);
          // Auto-captura: carro apresentado vira interesse no funil.
          if (args.veiculo_id) { const st = sess(input.sessionId); (st.lead || (st.lead = {})).veiculoId = Number(args.veiculo_id); }
        }
        else if (tc.function.name === "coletar_dado") {
          result = execColetar(input.sessionId, args);
        }
        else if (tc.function.name === "transferir_para_vendedor") {
          const st = sess(input.sessionId);
          if (st.handedOff) {
            result = "JÁ TRANSFERIDO nesta conversa — NÃO transfira de novo. O vendedor já foi acionado. Se surgiu um detalhe novo, apenas registre e dê uma mensagem curta; sem chamar a ferramenta outra vez.";
          } else {
            // Trava FLEXÍVEL: exige o checklist, MAS libera se o cliente pediu humano.
            const pediuHumano = args.motivo === "pediu_humano" || /\b(humano|atendente|vendedor|pessoa|liga|ligar|whats)\b/i.test(input.message);
            const falta = faltamNoLead(st.lead);
            if (falta.length > 0 && !pediuHumano) {
              result = `AINDA NÃO PODE TRANSFERIR. Faltam: ${falta.join(", ")}. Colete esses dados (siga o PRÓXIMO PASSO do funil) antes de transferir. Não transfira agora.`;
            } else {
              st.handedOff = true;
              const resumo = resumoLead(st.lead);
              const pend = falta.length ? ` | PENDÊNCIAS (cliente pediu humano): ${falta.join(", ")}` : "";
              result = `Handoff registrado (simulação): ${args.motivo}. RESUMO PRO VENDEDOR → ${resumo || args.resumo || "(sem dados)"}${pend}. Dê UMA mensagem curta de encerramento e NÃO transfira de novo.`;
            }
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
