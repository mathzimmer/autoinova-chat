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
import { getAllCuratedVehicles, podeOfertar } from "./stockSync";
import { tagsFromRequest, labelsForTags } from "./vehicleFeatures";
import { DEFAULT_BUSINESS_INFO } from "./ai";

// ── Tipos ───────────────────────────────────────────────────────────────────
export type ChatRole = "user" | "assistant";
export interface ChatTurn { role: ChatRole; content: string }
export interface AgentImage { url: string; caption: string }
export interface ToolTraceItem { name: string; args: any; resultSummary: string }
export interface AgentResult {
  reply: string;
  messages: string[]; // reply dividido em várias mensagens (bolhas) separadas por "|||"
  images: AgentImage[];
  toolTrace: ToolTraceItem[];
  shownVehicles: ShownVehicle[];
  handoff?: { motivo: string; resumo: string }; // preenchido quando transferir_para_vendedor rodou neste turno
  lead?: LeadData;                                // dados coletados (pro canal gravar no CRM/atribuir vendedor)
}

/**
 * Divide a resposta em várias mensagens (bolhas). Usa "|||" quando o modelo separa,
 * senão quebra por linha em branco e por itens numerados ("1) ..."), pra ficar no
 * estilo WhatsApp mesmo quando o modelo manda um bloco.
 */
function splitMessages(reply: string): string[] {
  let parts = reply.split(/\s*\|\|\|\s*|\n\s*---\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) parts = reply.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    let buf: string[] = [];
    for (const line of p.split("\n")) {
      if (/^\s*\d{1,2}[\)\.\-]\s+/.test(line)) {
        if (buf.length) { out.push(buf.join("\n").trim()); buf = []; }
        out.push(line.trim());
      } else buf.push(line);
    }
    if (buf.length) out.push(buf.join("\n").trim());
  }
  const final = out.map((s) => s.trim()).filter(Boolean);
  return final.length ? final : [reply.trim()].filter(Boolean);
}

// ── Memória por sessão (só na RAM; é simulador) ──────────────────────────────
type ListItem = { id: number; title: string; year?: number; color?: string; price?: number; auto?: boolean };
type LeadData = {
  nome?: string; cidade?: string;
  veiculoId?: number; veiculoInteresse?: string;
  temTroca?: boolean; trocaModelo?: string; trocaAno?: string; trocaKm?: string;
  pagamento?: "avista" | "financiado";
  finCpf?: string; finNascimento?: string; finParcela?: string; finEntrada?: string; finCpfRecusado?: boolean;
};
type ShownVehicle = { id: number; title: string; year?: number; km?: number; price?: number; cambio?: string; cor?: string };
const SESSIONS = new Map<string, { shown: ShownVehicle[]; handedOff?: boolean; photosSent?: Record<number, number>; lastList?: ListItem[]; lead?: LeadData }>();
function sess(id: string) {
  if (!SESSIONS.has(id)) SESSIONS.set(id, { shown: [] });
  return SESSIONS.get(id)!;
}
export function resetSession(id: string) { SESSIONS.delete(id); }

function recordShown(id: string, items: ShownVehicle[]) {
  const s = sess(id);
  const byId = new Map<number, ShownVehicle>();
  for (const it of [...s.shown, ...items]) if (Number.isFinite(it.id)) byId.set(it.id, { ...byId.get(it.id), ...it });
  s.shown = Array.from(byId.values()).slice(-12);
}
/** Extrai os dados de um veículo do banco para a memória (pro modelo responder km/câmbio/cor sem inventar). */
function toShown(v: any): ShownVehicle {
  return {
    id: v.id,
    title: v.title || `${v.brand} ${v.model} ${v.version || ""}`.trim(),
    year: v.year,
    km: v.mileage ?? undefined,
    price: (v.promotionPrice && v.promotionPrice < v.price) ? v.promotionPrice : v.price,
    cambio: String(v.transmission || "").toLowerCase().includes("auto") ? "automático" : "manual",
    cor: v.color ?? undefined,
  };
}

// ── Config (editável na tela) ────────────────────────────────────────────────
const DEFAULT_PERSONA = `Você é a atendente virtual da Auto Inova (revenda de seminovos em Ivoti/RS e Estância Velha).
Faz pré-atendimento no WhatsApp: entende o que o cliente procura, apresenta veículos do estoque com foto, tira dúvidas e conduz para um vendedor humano ou agenda uma visita.
Tom: consultivo, simpático e direto — como um bom vendedor. Sem enrolação.`;

// Regras de comportamento EDITÁVEIS (mude no simulador e veja na hora).
// As regras de segurança (anti-invenção, id) ficam fixas no código.
export const DEFAULT_RULES = `COMPORTAMENTO:
- VÁRIAS MENSAGENS: responda como um vendedor no WhatsApp — em 2 a 4 mensagens CURTAS, separadas por "|||" (cada trecho vira uma bolha). Uma ideia por mensagem. NUNCA mande um bloco gigante. Ex: "Excelente escolha, Matheus!|||Tenho 2 T-Cross disponíveis:|||T-Cross 2020 1.0 TSI Aut. — R$ 89.900|||Quer ver as fotos ou já simular?".
- PERSUASÃO: seja caloroso e vendedor — use o nome do cliente, destaque diferenciais/benefícios (segurança, economia, procedência, +12 financeiras) e sempre convide pro próximo passo. Ao listar carros, padrão limpo: "Modelo Ano — R$ preço" (uma por mensagem).
- BUSCAR JÁ: se o cliente cita um modelo, marca ou tipo (ex: "interesse na Compass", "quero um SUV"), chame buscar_veiculos IMEDIATAMENTE e mostre as opções — NÃO peça faixa de preço nem modelo antes. Só pergunte preço/uso se NÃO houver em estoque, ou depois de mostrar, pra refinar se vierem muitos resultados.
- LEAD DE ANÚNCIO: se a mensagem já traz um modelo, geralmente vinda de anúncio (ex: "Olá, tenho dúvidas sobre <modelo> ..." com link do Mercado Livre/OLX/Facebook), é um lead quente NAQUELE carro. Na PRIMEIRA resposta: apresente-se em uma linha e JÁ busque e mostre esse modelo em TEXTO — sem perguntar "o que você busca" e sem mandar foto ainda (ofereça enviar as fotos). Não consegue abrir links, então extraia o modelo do TEXTO da mensagem. Se o link NÃO tiver o nome/modelo do carro (ex: só um número), NÃO chute nem busque aleatório — pergunte simpaticamente qual carro ele viu/procura.
- FOTO AO ESCOLHER: ao LISTAR várias opções, mande só TEXTO (sem foto). Quando o cliente ESCOLHE/mostra interesse num carro específico ("o cherry", "esse", "o t-cross", "1"), aí sim chame apresentar_veiculo (fotos sem legenda) e, depois das fotos, mande um ELOGIO variado + pergunte se GOSTOU. Também mande foto se pedirem. Ao pedir mais fotos, use o MESMO [ID:X]. Nunca invente id; se já mostrou aquele carro, não reenvie.
- Troca: se o cliente tem carro na troca, pergunte modelo, ano e km ANTES de transferir. Nunca prometa valor — a avaliação é presencial.
- FINANCIAMENTO/SIMULAÇÃO: se o cliente quer financiar ou simular, colete ANTES de transferir, uma pergunta por vez: CPF, data de nascimento e valor de parcela que consegue pagar por mês (e entrada, se tiver). VALIDE: CPF tem 11 dígitos; data dd/mm/aaaa. Se o cliente NÃO quiser passar o CPF, NÃO insista nem bloqueie: registre com coletar_dado(recusou_cpf: true), diga que tudo bem (dá pra simular com CPF de um familiar, ou o vendedor resolve depois) e SIGA em frente. Nascimento e parcela ainda são necessários.
- PARCELA ≠ PREÇO: valor "por mês"/parcela (ex: "R$1.300 por mês") é dado de FINANCIAMENTO, nunca o preço do carro. NUNCA use isso como preço na busca. Registre como parcela e siga.
- NÃO DEDUZA PAGAMENTO: só registre a forma de pagamento (à vista ou financiado) quando o cliente DISSER claramente. Orçamento/faixa de preço ("até 100 mil") NÃO é forma de pagamento — não marque financiado por causa disso.
- NUNCA DEAD-END: se o cliente demonstra intenção de compra/financiamento (ex: tem crédito aprovado) e você não tem o modelo exato ou na condição pedida, NÃO responda só "não temos". Mostre o carro/parecido que tem e conduza: colete os dados (troca, e no financiamento CPF/nascimento/parcela) e encaminhe pro vendedor. Sempre dê um próximo passo.
- DADOS DO CLIENTE: ao longo da conversa, colete com naturalidade o NOME e a CIDADE do cliente (uma coisa por vez, sem interrogatório). Inclua no resumo do handoff.
- MORA LONGE / OUTRA CIDADE: se o cliente disser que mora longe ou é de outra cidade, ofereça ATENDIMENTO ONLINE — vídeos e fotos detalhadas do veículo e simulação de financiamento à distância — e encaminhe pro vendedor dar sequência. Nunca perca o lead por causa da distância.
- NÃO AFIRME O QUE NÃO FEZ: só diga "agendei" depois de ter loja + dia + horário E chamar transferir_para_vendedor. Nunca diga "fiz o agendamento" se ainda vai perguntar loja/dia. Descreva só ações que realmente aconteceram.
- RECUSA DE DADOS: se o cliente recusar QUALQUER informação pedida (CPF, cidade, nome, etc.), NÃO insista nem repita o pedido. Diga que tudo bem e pergunte se ele prefere já falar direto com um vendedor. Se ele aceitar (ou pedir humano), transfira na hora com transferir_para_vendedor (motivo: pediu_humano), com o que já tem e marcando o que ficou pendente. Se for só o CPF, use também coletar_dado(recusou_cpf: true) e siga o funil.
- Handoff: transfira UMA única vez, e só no momento REAL de conversão: agendou visita, pediu falar com humano, ou entrou em negociação de preço/condições. NÃO transfira só porque pediu "mais informações/detalhes" — responda o que puder (opcionais, dados do carro) e siga. Depois de transferir, apenas dê uma mensagem curta de encerramento; NUNCA transfira de novo nem continue fazendo perguntas de qualificação.
- SEJA HUMANA: fale de forma natural e calorosa, variando as frases — não robótica. Use o nome do cliente se souber. NÃO repita a mesma pergunta padrão ("tem troca? como vai pagar?") a cada mensagem; pergunte no momento certo e uma coisa por vez.
- Visita: confirme a loja, o dia e o horário e, DEPOIS de confirmar os três, CHAME transferir_para_vendedor (motivo: agendamento) com o resumo incluindo a visita (carro, dia, hora, loja, troca/pagamento). É a ferramenta que registra e avisa o vendedor — NUNCA confirme um agendamento sem chamá-la.
- FLEXIBILIDADE: se não houver o veículo exato pedido, NUNCA responda só "não temos". Ofereça alternativas próximas (mesma faixa de preço, perfil parecido) que a busca trouxe, explicando por que servem (espaço pra família, economia, custo-benefício). Sempre dê um caminho.
- INFORMAÇÃO QUE NÃO TEM (pneus, revisão, estado detalhado, garantia específica): NUNCA prometa "vou verificar e te aviso depois" — você não faz follow-up sozinho. Seja honesto e diga que esse detalhe é conferido na VISITA/test-drive ou direto com o vendedor, e já ofereça agendar a visita ou falar com um vendedor. Nunca deixe o cliente esperando um retorno que não vai acontecer.
- AÇÃO NA HORA (crítico): QUALQUER ação (mandar foto, transferir pro vendedor, agendar) é executada CHAMANDO a ferramenta na MESMA resposta em que você fala dela. NUNCA anuncie e espere ("vou enviar", "vou transferir agora", "um momento", "aguarde") sem já chamar a ferramenta — você não tem um próximo turno garantido; o cliente pode não responder e a ação nunca acontece. Se disse que vai transferir, o transferir_para_vendedor tem que estar nessa mesma resposta.
- OBJEÇÕES: se o cliente objetar ("tá caro", "vou pensar", "muito rodado", "meu carro vale mais", "só olhando"), NUNCA desista nem encerre. Use o bloco "FAQ E CONTORNO DE OBJEÇÕES": reconheça, contorne com valor (procedência, opcionais, simulação, troca) e conduza pro próximo passo (visita/vendedor/foto).
- CONDUZA SEMPRE: toda resposta termina com uma pergunta ou um próximo passo (mostrar outro carro, falar de troca/pagamento, agendar visita). Nunca deixe a conversa parada.
- Faça UMA pergunta por vez. Seja curto e natural.`;

export async function getAgentV2Config(): Promise<{ model: string; persona: string; rules: string; faq: string; temperature: number; search: SearchCfg }> {
  const model = (await getSetting("agentv2_model")) || "openai/gpt-4o-mini";
  const persona = (await getSetting("agentv2_persona")) || DEFAULT_PERSONA;
  const rules = (await getSetting("agentv2_rules")) || DEFAULT_RULES;
  const faq = (await getSetting("agentv2_faq")) || DEFAULT_FAQ;
  const tRaw = await getSetting("agentv2_temperature");
  const temperature = tRaw ? Number(tRaw) : 0.5;
  const search = await getSearchConfig();
  return { model, persona, rules, faq, temperature, search };
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

// Config da busca (quantos carros e critério de ordenação) — editável na tela.
export type SearchCfg = { limit: number; ordem: "barato" | "caro" | "novo" | "km"; fotoPrimeiro: boolean };
export const DEFAULT_SEARCH: SearchCfg = { limit: 6, ordem: "barato", fotoPrimeiro: true };
export async function getSearchConfig(): Promise<SearchCfg> {
  try {
    const raw = await getSetting("agentv2_search");
    if (raw) {
      const p = JSON.parse(raw);
      return {
        limit: Math.min(Math.max(Number(p.limit) || 6, 1), 12),
        ordem: ["barato", "caro", "novo", "km"].includes(p.ordem) ? p.ordem : "barato",
        fotoPrimeiro: p.fotoPrimeiro !== false,
      };
    }
  } catch { /* padrão */ }
  return { ...DEFAULT_SEARCH };
}
function temFoto(v: any): number {
  return (v.imageUrl || (Array.isArray(v.images) && v.images.length)) ? 1 : 0;
}
function ordenarVeiculos(list: any[], cfg: SearchCfg): any[] {
  return [...list].sort((a, b) => {
    if (cfg.fotoPrimeiro) { const d = temFoto(b) - temFoto(a); if (d) return d; }
    if (cfg.ordem === "caro") return (b.price || 0) - (a.price || 0);
    if (cfg.ordem === "novo") return (b.year || 0) - (a.year || 0);
    if (cfg.ordem === "km") return (a.mileage || 1e9) - (b.mileage || 1e9);
    return (a.price || 0) - (b.price || 0); // barato
  }).slice(0, cfg.limit);
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
          recusou_cpf: { type: "boolean", description: "true se o cliente NÃO quer passar o CPF. Registre e siga em frente — não insista nem bloqueie." },
        },
        required: [], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_por_caracteristica",
      description: "Busca veículos por OPCIONAIS/características específicas. Use quando o cliente pede um item: 'tem carro com teto solar?', 'algum com câmera de ré e couro?', '4x4', '7 lugares'. Passe as características em `caracteristicas`.",
      parameters: {
        type: "object",
        properties: {
          caracteristicas: { type: "array", items: { type: "string" }, description: "Ex: ['teto solar','couro','câmera de ré','4x4','multimídia','7 lugares']." },
        },
        required: ["caracteristicas"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "veiculos_parecidos",
      description: "Encontra veículos SEMELHANTES a um já mostrado (mesmo estilo/segmento e faixa de preço). Use quando o cliente diz 'tem algum parecido?', 'algo do mesmo estilo', ou quando o carro que ele queria não está disponível.",
      parameters: {
        type: "object",
        properties: { veiculo_id: { type: "number" }, limite: { type: "number" } },
        required: ["veiculo_id"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verificar_disponibilidade",
      description: "Confirma se um veículo AINDA está disponível ANTES de oferecer/agendar. Use quando o cliente pergunta 'ainda tem?', 'está disponível?', ou antes de confirmar uma visita.",
      parameters: {
        type: "object",
        properties: { veiculo_id: { type: "number" } },
        required: ["veiculo_id"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "comparar_veiculos",
      description: "Compara 2 a 4 veículos lado a lado (preço, ano, km, câmbio, combustível, opcionais). Use quando o cliente pede 'qual é melhor?', 'compara esses dois', ou está em dúvida entre carros já mostrados.",
      parameters: {
        type: "object",
        properties: { ids: { type: "array", items: { type: "number" }, description: "IDs [ID:X] dos veículos já mostrados." } },
        required: ["ids"], additionalProperties: false,
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
/** Remove tudo que não é letra/número — "Ix 35" = "ix-35" = "ix35". */
function squash(s: any): string {
  return norm(s).replace(/[^a-z0-9]/g, "");
}
/** Distância de edição (Levenshtein) — pra tolerar 1 erro de digitação. */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}
function closeWord(searchable: string, token: string): boolean {
  if (token.length < 4) return false;
  return searchable.split(/\s+/).some((w) => w.length >= 4 && lev(w, token) <= 1);
}
/** Match tolerante a grafia: sem espaço/hífen/acento, por tokens, e 1 erro de digitação. */
function matchTermo(searchable: string, termo: string): boolean {
  const sq = squash(searchable);
  const q = norm(termo).trim();
  if (!q) return true;
  if (sq.includes(squash(q))) return true; // "ix 35" -> "ix35"
  const tokens = q.split(/\s+/).filter((t) => t.length >= 1);
  return tokens.every((t) => searchable.includes(t) || sq.includes(squash(t)) || closeWord(searchable, t));
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

  const searchCfg = await getSearchConfig();
  const cambioAuto = args.cambio ? norm(args.cambio).includes("auto") : null;
  // Requisitos: tags canônicas reconhecidas + palavras soltas (fallback).
  const reqTags: string[] = args.requisitos ? tagsFromRequest(args.requisitos) : [];
  const reqWords = args.requisitos ? norm(args.requisitos).split(/\s+/).filter((w: string) => w.length >= 3) : [];

  // Filtro DURO (elimina quem não atende os critérios objetivos).
  const survivors = all.filter((v: any) => {
    if (args.preco_max && v.price > args.preco_max) return false;
    if (args.preco_min && v.price < args.preco_min) return false;
    if (args.ano_min && v.year < args.ano_min) return false;
    if (args.km_max && v.mileage && v.mileage > args.km_max) return false;
    if (args.marca && !matchTermo(norm(`${v.brand}`), args.marca)) return false;
    if (args.modelo) {
      const mtxt = norm(`${v.brand} ${v.model} ${v.version || ""} ${v.title || ""}`);
      if (!matchTermo(mtxt, args.modelo)) return false;
    }
    if (args.cor && !norm(v.color).includes(norm(args.cor))) return false;
    if (args.combustivel && !norm(v.fuel).includes(norm(args.combustivel))) return false;
    if (cambioAuto !== null) {
      const isAuto = norm(v.transmission).includes("auto");
      if (cambioAuto !== isAuto) return false;
    }
    const bodyText = norm(`${v.category || ""} ${v.vehicleType || ""} ${v.model || ""} ${v.title || ""}`);
    if (args.tipo && !matchTipo(bodyText, args.tipo)) return false;
    // Requisitos: se reconhecemos tags E o veículo tem featuresCanon → exige as tags.
    // Senão, cai no comportamento antigo (substring nos opcionais/descrição).
    const canon: string[] = Array.isArray(v.featuresCanon) ? v.featuresCanon : [];
    if (reqTags.length && canon.length) {
      if (!reqTags.every((t) => canon.includes(t))) return false;
    } else if (reqWords.length) {
      const feat = norm(`${(Array.isArray(v.features) ? v.features.join(" ") : "")} ${v.description || ""} ${v.title || ""}`);
      if (!reqWords.every((w: string) => feat.includes(w))) return false;
    }
    return true;
  });

  // RANKING (Fase 1): pontua relevância e guarda os MOTIVOS do match.
  // Fórmula (documentada): orçamento folgado +25 / no limite +15; tipo +20;
  // câmbio pedido +15; cada opcional pedido presente +12; ano recente +10 (2020+);
  // km baixo +8 (<60k); tem foto +5. Empate → foto, depois a ordem configurada.
  const scoreOf = (v: any): { score: number; reasons: string[] } => {
    let score = 0; const reasons: string[] = [];
    const preco = (v.promotionPrice && v.promotionPrice < v.price) ? v.promotionPrice : v.price;
    if (args.preco_max) {
      if (preco <= args.preco_max * 0.9) { score += 25; reasons.push("dentro do orçamento"); }
      else if (preco <= args.preco_max) { score += 15; reasons.push("no limite do orçamento"); }
    }
    if (args.tipo) { score += 20; reasons.push(String(args.tipo).toUpperCase()); }
    if (cambioAuto !== null) { score += 15; reasons.push(cambioAuto ? "câmbio automático" : "câmbio manual"); }
    const canon: string[] = Array.isArray(v.featuresCanon) ? v.featuresCanon : [];
    for (const t of reqTags) { if (canon.includes(t)) { score += 12; reasons.push(labelsForTags([t])[0]); } }
    if ((v.year || 0) >= 2020) { score += 10; }
    if (v.mileage != null && v.mileage < 60000) { score += 8; reasons.push("baixa quilometragem"); }
    if (temFoto(v)) score += 5;
    return { score, reasons };
  };

  const tieBreak = (a: any, b: any): number => {
    if (searchCfg.fotoPrimeiro) { const d = temFoto(b) - temFoto(a); if (d) return d; }
    if (searchCfg.ordem === "caro") return (b.price || 0) - (a.price || 0);
    if (searchCfg.ordem === "novo") return (b.year || 0) - (a.year || 0);
    if (searchCfg.ordem === "km") return (a.mileage || 1e9) - (b.mileage || 1e9);
    return (a.price || 0) - (b.price || 0);
  };

  const ranked = survivors
    .map((v: any) => ({ v, ...scoreOf(v) }))
    .sort((a, b) => (b.score - a.score) || tieBreak(a.v, b.v))
    .slice(0, searchCfg.limit);
  const filtered = ranked.map((s) => s.v);
  const reasonsById = new Map<number, string[]>(ranked.map((s) => [s.v.id, s.reasons]));

  // Formato de exibição: *Modelo | Ano | R$ valor* (negrito WhatsApp, sem opcionais).
  // O [ID:X] e o (match: ...) são INTERNOS — pro modelo usar/explicar, não pro cliente ver cru.
  const fmtLine = (v: any, i: number) => {
    const title = v.title || `${v.brand} ${v.model} ${v.version || ""}`.trim();
    const preco = fmtBRL(v.promotionPrice && v.promotionPrice < v.price ? v.promotionPrice : v.price);
    const rs = reasonsById.get(v.id) || [];
    const matchHint = rs.length ? ` — (match: ${rs.join(", ")})` : "";
    return `${i + 1}) [ID:${v.id}] *${title} | ${v.year} | ${preco}*${matchHint}`;
  };

  const toListItem = (v: any): ListItem => ({
    id: v.id, title: v.title || `${v.brand} ${v.model}`, year: v.year, color: v.color,
    price: (v.promotionPrice && v.promotionPrice < v.price) ? v.promotionPrice : v.price,
    auto: norm(v.transmission).includes("auto"),
  });

  if (filtered.length === 1) {
    // Resultado ÚNICO: já é o carro de interesse. Não pergunte "qual desses".
    const only = filtered[0];
    sess(sessionId).lastList = filtered.map(toListItem);
    recordShown(sessionId, filtered.map(toShown));
    const lead = sess(sessionId).lead || (sess(sessionId).lead = {});
    lead.veiculoId = only.id; // fixa o interesse (era o único resultado)
    return `RESULTADO ÚNICO [ID:${only.id}]. É o ÚNICO carro que bate com o pedido, então JÁ é o carro de interesse do cliente — NÃO pergunte "qual desses". Mostre-o em uma mensagem em NEGRITO com os dados reais (ex: *Mitsubishi L200 Triton | 2013 | R$ 119.990*, sem cabeçalho, sem opcionais, sem [ID:X]) e, na MESMA resposta, ofereça as fotos ou avance o funil (${nextStep(lead)}). Se o cliente já deu um sinal de interesse (perguntou de troca, financiamento, km, preço, visita), trate como CONFIRMADO e siga direto o próximo passo.\n${filtered.map(fmtLine).join("\n")}`;
  }
  if (filtered.length > 0) {
    sess(sessionId).lastList = filtered.map(toListItem);
    recordShown(sessionId, filtered.map(toShown));
    return `RESULTADOS (${filtered.length}), já ORDENADOS do mais relevante pro menos. Liste TODOS os ${filtered.length} carros abaixo DE UMA VEZ (não mande um e espere o cliente pedir "outras"), cada um em uma mensagem, em NEGRITO, trocando pelos dados reais — exemplo: *Toyota Corolla | 2020 | R$ 90.000*. NÃO escreva cabeçalho, NÃO mostre opcionais, NÃO mostre o [ID:X] nem o "(match: ...)" — isso é interno. Use os motivos do "(match: ...)" só pra EXPLICAR ao cliente por que recomenda um carro (ex: "esse tá dentro do seu orçamento e é automático"). Não invente dados. Depois pergunte qual interessou.\n${filtered.map(fmtLine).join("\n")}`;
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
    .slice(0, searchCfg.limit)
    .map((s) => s.v);

  sess(sessionId).lastList = alt.map(toListItem);
  recordShown(sessionId, alt.map(toShown));
  return `SEM MATCH EXATO no pedido, mas achei opções PARECIDAS (mesmo modelo ou mesmo tipo primeiro). NÃO diga só "não tenho". Se aparecer o mesmo modelo com outra config (ex: automático em vez de manual), ofereça deixando claro a diferença. Só ofereça carros com relação com o pedido. Use o [ID:X]:\n${alt.map(fmtLine).join("\n")}`;
}

// ── Fase 2: ferramentas dedicadas ────────────────────────────────────────────

const precoDe = (v: any) => (v.promotionPrice && v.promotionPrice < v.price) ? v.promotionPrice : v.price;
const tituloDe = (v: any) => v.title || `${v.brand} ${v.model} ${v.version || ""}`.trim();

/** Busca por OPCIONAIS (tags canônicas). Ex: ["teto_solar","couro"] ou texto livre. */
async function execBuscarPorCaracteristica(sessionId: string, args: any): Promise<string> {
  const raw: string[] = Array.isArray(args.caracteristicas) ? args.caracteristicas : (args.caracteristicas ? [String(args.caracteristicas)] : []);
  const tags = Array.from(new Set(raw.flatMap((t) => tagsFromRequest(String(t)))));
  if (tags.length === 0) return "Não reconheci a característica pedida. Ex.: teto solar, couro, câmera de ré, 4x4, multimídia, 7 lugares.";
  let all = (await getAllCuratedVehicles()).filter((v: any) => Array.isArray(v.featuresCanon));
  const cfg = await getSearchConfig();
  const hits = all.filter((v: any) => tags.every((t) => (v.featuresCanon as string[]).includes(t)))
    .sort((a: any, b: any) => precoDe(a) - precoDe(b)).slice(0, cfg.limit);
  const nomes = labelsForTags(tags).join(", ");
  if (hits.length === 0) return `Nenhum veículo disponível com: ${nomes}. Diga isso com sinceridade e ofereça alternativas próximas — NÃO invente opcional.`;
  sess(sessionId).lastList = hits.map((v: any) => ({ id: v.id, title: tituloDe(v), year: v.year, color: v.color, price: precoDe(v), auto: norm(v.transmission).includes("auto") }));
  recordShown(sessionId, hits.map(toShown));
  const linhas = hits.map((v: any, i: number) => `${i + 1}) [ID:${v.id}] *${tituloDe(v)} | ${v.year} | ${fmtBRL(precoDe(v))}*`).join("\n");
  return `CARROS COM ${nomes.toUpperCase()} (${hits.length}). Liste em NEGRITO, um por mensagem, sem [ID:X] nem opcionais crus. Você pode dizer que eles têm ${nomes}. Não invente. Depois pergunte qual interessou.\n${linhas}`;
}

/** Veículos PARECIDOS com um id (mesmo segmento/marca, faixa de preço ±25%). */
async function execVeiculosParecidos(sessionId: string, args: any): Promise<string> {
  const base: any = await getVehicleById(Number(args.veiculo_id));
  if (!base) return `[INTERNO] ID ${args.veiculo_id} não existe. Use um [ID:X] real.`;
  const cfg = await getSearchConfig();
  const limite = Math.min(Math.max(Number(args.limite) || 3, 1), cfg.limit);
  const baseBody = norm(`${base.category || ""} ${base.vehicleType || ""}`);
  const basePreco = precoDe(base);
  let all = (await getAllCuratedVehicles()).filter((v: any) => v.id !== base.id);
  const scored = all.map((v: any) => {
    let s = 0;
    if (norm(`${v.category || ""} ${v.vehicleType || ""}`) === baseBody && baseBody) s += 50;
    if (norm(v.brand) === norm(base.brand)) s += 20;
    const p = precoDe(v);
    if (basePreco && p >= basePreco * 0.75 && p <= basePreco * 1.25) s += 30;
    if (norm(v.transmission).includes("auto") === norm(base.transmission).includes("auto")) s += 10;
    return { v, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || Math.abs(precoDe(a.v) - basePreco) - Math.abs(precoDe(b.v) - basePreco)).slice(0, limite);
  if (scored.length === 0) return `Não achei outro parecido com ${tituloDe(base)} no estoque agora. Seja honesto e ofereça ajuda pra refinar.`;
  const sims = scored.map((x) => x.v);
  sess(sessionId).lastList = sims.map((v: any) => ({ id: v.id, title: tituloDe(v), year: v.year, color: v.color, price: precoDe(v), auto: norm(v.transmission).includes("auto") }));
  recordShown(sessionId, sims.map(toShown));
  const linhas = sims.map((v: any, i: number) => `${i + 1}) [ID:${v.id}] *${tituloDe(v)} | ${v.year} | ${fmtBRL(precoDe(v))}*`).join("\n");
  return `PARECIDOS com ${tituloDe(base)} (${sims.length}). Liste em NEGRITO, um por mensagem, sem [ID:X]. Explique que são do mesmo estilo/faixa. Depois pergunte qual interessou.\n${linhas}`;
}

/** Confirma disponibilidade REAL antes de oferecer (available + status interno). */
async function execVerificarDisponibilidade(args: any): Promise<string> {
  const v: any = await getVehicleById(Number(args.veiculo_id));
  if (!v) return `[INTERNO] ID ${args.veiculo_id} não existe. NÃO diga ao cliente que vendeu; peça pra confirmar qual carro.`;
  const ok = v.available !== false && podeOfertar(v);
  if (ok) return `DISPONÍVEL: ${tituloDe(v)} ${v.year} está disponível. Pode seguir (agendar visita/transferir).`;
  return `INDISPONÍVEL: ${tituloDe(v)} ${v.year} NÃO está disponível agora (${v.internalStatus || "reservado/vendido"}). Avise com cuidado e ofereça um PARECIDO (use veiculos_parecidos).`;
}

/** Compara 2+ veículos lado a lado (dados reais). */
async function execCompararVeiculos(args: any): Promise<string> {
  const ids: number[] = Array.isArray(args.ids) ? args.ids.map((n: any) => Number(n)).filter(Boolean) : [];
  if (ids.length < 2) return "Para comparar preciso de pelo menos 2 IDs de veículos já mostrados.";
  const vs = (await Promise.all(ids.slice(0, 4).map((id) => getVehicleById(id)))).filter(Boolean) as any[];
  if (vs.length < 2) return "Não encontrei veículos suficientes para comparar. Confirme os carros com o cliente.";
  const linha = (v: any) => `• ${tituloDe(v)} | ${v.year} | ${fmtBRL(precoDe(v))} | ${v.mileage != null ? v.mileage.toLocaleString("pt-BR") + " km" : "km n/i"} | ${norm(v.transmission).includes("auto") ? "Automático" : "Manual"} | ${v.fuel || "?"}${Array.isArray(v.featuresCanon) && v.featuresCanon.length ? " | " + labelsForTags(v.featuresCanon.slice(0, 4)).join(", ") : ""}`;
  return `COMPARATIVO (dados reais — apresente de forma clara e ajude o cliente a decidir pelo perfil dele; não invente):\n${vs.map(linha).join("\n")}`;
}

async function execApresentar(sessionId: string, args: any, images: AgentImage[]): Promise<string> {
  const id = Number(args.veiculo_id);
  const v: any = await getVehicleById(id);
  if (!v) return `[INTERNO] ID ${id} não existe. Use um [ID:X] real da lista mostrada; NÃO diga ao cliente que vendeu.`;
  if (v.available === false) return `O veículo ${v.brand} ${v.model} ${v.year} não está mais disponível (pode ter sido vendido).`;
  const title = v.title || `${v.brand} ${v.model} ${v.version || ""}`.trim();
  recordShown(sessionId, [toShown(v)]);

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
  // Fotos LIMPAS (sem legenda) — os dados vão no texto, em mensagens separadas.
  for (const u of batch) images.push({ url: u, caption: "" });
  const restam = urls.length - st.photosSent[id];
  return `Fotos de ${title} enviadas SEM legenda (aparecem ANTES do seu texto). Agora mande UMA mensagem curta: um ELOGIO variado ("esse tá lindão!", "ótima escolha!", "esse é show!") e pergunte se GOSTOU. NÃO repita specs nem legenda. Se o cliente gostar, siga o funil (pergunte da troca).${restam > 0 ? ` Há mais ${restam} fotos se ele pedir.` : ""}`;
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
  if (args.recusou_cpf === true) lead.finCpfRecusado = true;
  // Dedução: se veio qualquer dado de financiamento, a forma de pagamento É financiado.
  if ((lead.finCpf || lead.finNascimento || lead.finParcela || lead.finEntrada || lead.finCpfRecusado) && lead.pagamento !== "avista") {
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
  if (lead.pagamento === "financiado" && (!lead.finNascimento || !lead.finParcela)) return "PRÓXIMO PASSO: colete os dados do FINANCIAMENTO (data de nascimento e valor de parcela). Peça o CPF também, mas se o cliente NÃO quiser passar, registre recusou_cpf: true e SIGA — não insista.";
  if (lead.pagamento === "financiado" && !lead.finCpf && !lead.finCpfRecusado) return "PRÓXIMO PASSO: peça o CPF pra simulação. Se o cliente não quiser passar, registre recusou_cpf: true e siga — não insista nem bloqueie.";
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
  if (lead.pagamento === "financiado" && (!lead.finNascimento || !lead.finParcela || (!lead.finCpf && !lead.finCpfRecusado))) return false;
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
  else if (lead?.pagamento === "financiado" && (!lead?.finNascimento || !lead?.finParcela || (!lead?.finCpf && !lead?.finCpfRecusado))) f.push("dados do financiamento (nascimento, parcela e CPF — CPF só se o cliente aceitar)");
  return f;
}

function resumoLead(lead?: LeadData, shown?: ShownVehicle[]): string {
  if (!lead) return "";
  const p: string[] = [];
  if (lead.nome) p.push(`Nome: ${lead.nome}`);
  if (lead.cidade) p.push(`Cidade: ${lead.cidade}`);
  // Veículo de interesse pelo MODELO (não pelo ID): resolve na memória da sessão.
  const veiculoLabel = (id?: number): string | null => {
    if (!id) return null;
    const v = shown?.find((x) => x.id === id);
    if (v) return `${v.title}${v.year ? ` ${v.year}` : ""}`;
    return `[ID:${id}]`;
  };
  const interesse = veiculoLabel(lead.veiculoId);
  if (interesse) p.push(`Veículo: ${interesse}`);
  else if (lead.veiculoInteresse) p.push(`Veículo: ${lead.veiculoInteresse}`);
  // Se o cliente navegou por vários carros, informa quais (fora o de interesse).
  if (shown && shown.length > 1) {
    const outros = shown
      .filter((v) => v.id !== lead.veiculoId)
      .map((v) => `${v.title}${v.year ? ` ${v.year}` : ""}`);
    if (outros.length) p.push(`Também viu: ${outros.slice(0, 6).join("; ")}`);
  }
  if (lead.temTroca === false) p.push("Troca: não");
  else if (lead.temTroca) p.push(`Troca: ${lead.trocaModelo || "?"} ${lead.trocaAno || ""} ${lead.trocaKm || ""}`.trim());
  if (lead.pagamento) p.push(`Pagamento: ${lead.pagamento}`);
  if (lead.pagamento === "financiado") p.push(`Financiamento: CPF ${lead.finCpf || (lead.finCpfRecusado ? "não informado (cliente preferiu não passar)" : "?")}, nasc ${lead.finNascimento || "?"}, parcela ${lead.finParcela || "?"}${lead.finEntrada ? `, entrada ${lead.finEntrada}` : ""}`);
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
- Escreva como WhatsApp: curto, 1-2 emojis no máximo. Sem markdown, EXCETO *negrito* do WhatsApp (um asterisco de cada lado) — use pra destacar o carro.
- LISTA DE CARROS: mostre TODOS os resultados da busca DE UMA VEZ (não um por vez esperando "outras"), cada carro em NEGRITO no estilo *Toyota Corolla | 2020 | R$ 90.000* (dados reais, SEM opcionais, SEM [ID:X], SEM cabeçalho), um por mensagem.
- APRESENTAR: chame apresentar_veiculo SOMENTE quando o cliente ESCOLHE um carro NOVO (que ainda não foi mostrado) ou PEDE fotos. Depois das fotos, elogie (variado) + pergunte se gostou. Se o carro de interesse JÁ foi apresentado e você está no meio da coleta (nome, cidade, troca, pagamento), NÃO reapresente as fotos nem repita "gostou?" — apenas siga o PRÓXIMO PASSO do funil.
- SÓ fale de veículos retornados por buscar_veiculos/apresentar_veiculo. COPIE preço e ano EXATOS. PROIBIDO inventar veículo, preço ou link.
- id de ferramenta = número dentro de [ID:X]. NUNCA use o número da opção (1,2,3) como id.
- RESULTADO ÚNICO: se a busca traz só 1 carro, ele JÁ é o carro de interesse — apresente e siga o funil. NUNCA pergunte "qual desses" nem repita a busca/lista do mesmo carro.
- SINAL DE INTERESSE = CONFIRMAÇÃO: perguntas como "aceita troca?", "posso financiar?", "qual a km?", "tem garantia?", "qual o preço?" sobre um carro já mostrado JÁ confirmam o interesse nele. Registre o interesse e siga o PRÓXIMO PASSO do funil — não volte a perguntar qual carro é.
- Um veículo já mostrado ESTÁ disponível; nunca diga que foi vendido sem a ferramenta confirmar.
- NUNCA escreva links ou imagens no texto (nada de markdown ![]() nem URLs de foto). A foto é enviada SOMENTE pela ferramenta apresentar_veiculo. Só use links que vierem da ferramenta.
- NUNCA invente km, câmbio, cor, ano ou preço: use APENAS os dados de "VEÍCULOS JÁ MOSTRADOS" ou do resultado da busca. Se o cliente perguntar algo que não está ali, diga que confirma o detalhe com o vendedor — NÃO chute número.
- NUNCA invente endereço/telefone/horário: use só "INFORMAÇÕES DA LOJA". Se faltar, diga que confirma com o vendedor.`;

  const shownBlock = s.shown.length
    ? `\n\nVEÍCULOS JÁ MOSTRADOS (dados REAIS — use pra responder km/câmbio/cor SEM inventar; se o dado não estiver aqui, diga que confirma com o vendedor):\n${s.shown.map((x, i) => `${i + 1}) ${x.title} [ID:${x.id}] — ${x.year || "?"} · ${x.km != null ? x.km.toLocaleString("pt-BR") + " km" : "km n/i"} · ${x.cambio || "?"} · ${x.cor || "cor n/i"} · ${x.price != null ? fmtBRL(x.price) : "?"}`).join("\n")}`
    : "";

  // Seleção determinística sobre a última lista ("1", "o azul", "a 2012", "automático"...).
  const selectedId = resolveSelection(input.message, s.lastList);
  // GUARDA ANTI-SEQUESTRO: se o cliente JÁ escolheu um carro e a mensagem fala da
  // TROCA (ex: "um gol 2014 56000km"), um ano solto NÃO deve trocar o veículo de
  // interesse. Só tratamos como (re)seleção se ainda não há interesse, OU se a
  // mensagem é curta e sem contexto de troca.
  const jaTemInteresse = !!(s.lead && s.lead.veiculoId);
  const contextoTroca = /\btroca|dou\s+de\s+entrada|meu\s+carro|tenho\s+um|\bkm\b|\bmil\b|rodad|entrada/i.test(input.message);
  const msgTokens = input.message.trim().split(/\s+/).filter(Boolean).length;
  const tratarComoSelecao = selectedId != null && (!jaTemInteresse || (msgTokens <= 3 && !contextoTroca));

  let selBlock = "";
  if (tratarComoSelecao) {
    const it = (s.lastList || []).find((x) => x.id === selectedId);
    selBlock = `\n\n⚠️ SELEÇÃO DETECTADA: o cliente se refere ao veículo [ID:${selectedId}]${it ? ` (${it.title} ${it.year || ""} ${it.color || ""})`.trim() : ""} da última lista. Para apresentar/confirmar/mandar foto, use veiculo_id: ${selectedId}. NUNCA use outro id.`;
  }

  // Auto-captura: seleção de carro já vira interesse no funil (respeitando a guarda).
  if (tratarComoSelecao) { const lead = s.lead || (s.lead = {}); lead.veiculoId = selectedId!; }

  // Funil guiado: estado + próximo passo obrigatório (a "trilha" que garante a ordem).
  const funnelBlock = `\n\n=== FUNIL DE ATENDIMENTO (dados já coletados) ===\n${resumoLead(s.lead, s.shown) || "(nada ainda)"}\n➡️ ${nextStep(s.lead || {})}\n\nORDEM OBRIGATÓRIA: a SUA próxima pergunta deve ser SOMENTE sobre o PRÓXIMO PASSO acima. É PROIBIDO perguntar sobre etapas seguintes antes de concluir a atual (ex: não peça CPF/pagamento se ainda falta nome ou cidade). Se o cliente trouxer outra informação ou fizer uma pergunta, RESPONDA e registre com coletar_dado, e em seguida volte para o PRÓXIMO PASSO. Uma pergunta por vez, natural, sem parecer formulário. Nunca pule etapas. NUNCA pergunte de novo algo que já aparece em "dados já coletados" acima — se já tem, siga em frente.`;

  // Ordem: persona → regras editáveis (comportamento) → regras fixas → info da loja → memória → funil.
  const system = `${cfg.persona}\n\n${cfg.rules}\n\n${coreRules}\n\n=== INFORMAÇÕES DA LOJA (use somente estas) ===\n${businessInfo}\n\n=== FAQ E CONTORNO DE OBJEÇÕES ===\n${faq}${shownBlock}${selBlock}${funnelBlock}`;

  const messages: LLMMsg[] = [{ role: "system", content: system }];
  for (const h of input.history.slice(-20)) messages.push({ role: h.role, content: h.content });
  messages.push({ role: "user", content: input.message });

  const toolsCfg = await getToolsConfig();
  const effectiveTools = buildEffectiveTools(toolsCfg);

  const images: AgentImage[] = [];
  const toolTrace: ToolTraceItem[] = [];
  let handoffInfo: { motivo: string; resumo: string } | undefined;
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
          const st = sess(input.sessionId);
          const jaEnviou = (st.photosSent || {})[Number(args.veiculo_id)] || 0;
          const pediuFoto = /\bfotos?\b|\bimagens?\b|\bver\b|\bmostra/i.test(input.message);
          if (jaEnviou > 0 && !pediuFoto) {
            // Não reapresenta fotos já enviadas sem o cliente pedir (evita "se perder").
            result = "Esse carro JÁ foi apresentado (fotos enviadas). NÃO reenvie fotos. Apenas siga o PRÓXIMO PASSO do funil (troca/pagamento/nome/cidade/visita).";
          } else {
            result = await execApresentar(input.sessionId, args, images);
            if (args.veiculo_id) (st.lead || (st.lead = {})).veiculoId = Number(args.veiculo_id);
          }
        }
        else if (tc.function.name === "buscar_por_caracteristica") {
          result = await execBuscarPorCaracteristica(input.sessionId, args);
        }
        else if (tc.function.name === "veiculos_parecidos") {
          result = await execVeiculosParecidos(input.sessionId, args);
        }
        else if (tc.function.name === "verificar_disponibilidade") {
          result = await execVerificarDisponibilidade(args);
        }
        else if (tc.function.name === "comparar_veiculos") {
          result = await execCompararVeiculos(args);
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
              const base = resumoLead(st.lead, st.shown) || "(sem dados)";
              const pend = falta.length ? ` | PENDÊNCIAS (cliente pediu humano): ${falta.join(", ")}` : "";
              // Observação do agente (dia/hora/loja da visita, negociação) — não perder.
              const obs = (args.resumo && args.resumo.trim() && args.resumo.trim() !== base) ? ` | Obs: ${args.resumo.trim()}` : "";
              // Marca de VISITA quando o motivo é agendamento (ou a obs menciona visita).
              const visitaTag = (args.motivo === "agendamento" || /\b(agend|visita|test[\s-]?drive)\b/i.test(args.resumo || "")) ? " | 📅 VISITA AGENDADA" : "";
              const resumoFinal = `${base}${visitaTag}${pend}${obs}`;
              handoffInfo = { motivo: args.motivo || "dados_completos", resumo: resumoFinal };
              result = `Handoff registrado: ${args.motivo}. RESUMO PRO VENDEDOR → ${resumoFinal}. Dê UMA mensagem curta de encerramento e NÃO transfira de novo.`;
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
  // Também pega ENCERRAMENTOS que afirmam ter agendado/encaminhado sem chamar a
  // ferramenta (ex: "já agendei a visita, o vendedor vai lhe atender"). Só força
  // se o checklist estiver completo, pra não transferir cedo demais.
  const sinalEncerramento = /agend(ei|ada|ado|amos|arei)|(vendedor|atendente).{0,20}(vai|irá|entrará|entra|te|lhe).{0,15}(atender|contato|falar|chamar)|registrei seu interesse|encaminh(ei|ado|arei)|em breve/i.test(reply);
  const deveForcar = prometeuTransferir || (sinalEncerramento && leadCompleto(sess(input.sessionId).lead));
  if (!sess(input.sessionId).handedOff && deveForcar) {
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
            if (!st.handedOff) {
              st.handedOff = true;
              const base = resumoLead(st.lead, st.shown) || "(sem dados)";
              const obs = (a.resumo && a.resumo.trim() && a.resumo.trim() !== base) ? ` | Obs: ${a.resumo.trim()}` : "";
              const visitaTag = (a.motivo === "agendamento" || /\b(agend|visita|test[\s-]?drive)\b/i.test(a.resumo || "")) ? " | 📅 VISITA AGENDADA" : "";
              handoffInfo = { motivo: a.motivo || "pediu_humano", resumo: `${base}${visitaTag}${obs}` };
              toolTrace.push({ name: "transferir_para_vendedor", args: a, resultSummary: "handoff forçado (rede de segurança)" });
            }
          }
          messages.push({ role: "tool", tool_call_id: tc.id, content: "Handoff registrado. Dê UMA mensagem curta de encerramento; um vendedor assume." } as any);
        }
        const fecho = await chatCompletion({ model: cfg.model, messages, tools: effectiveTools, temperature: cfg.temperature });
        reply = (fecho?.content || reply).trim();
      }
    } catch { /* mantém a resposta original */ }

    // ÚLTIMO RECURSO: o modelo ainda não chamou a ferramenta, mas prometeu/agendou
    // e o lead está completo — registra o handoff mesmo assim pra não perder o lead.
    const st = sess(input.sessionId);
    if (!st.handedOff && leadCompleto(st.lead)) {
      st.handedOff = true;
      const base = resumoLead(st.lead, st.shown) || "(sem dados)";
      const visitaTag = /\b(agend|visita|test[\s-]?drive)\b/i.test(reply) ? " | 📅 VISITA AGENDADA" : "";
      handoffInfo = { motivo: /agend|visita/i.test(reply) ? "agendamento" : "dados_completos", resumo: `${base}${visitaTag}` };
      toolTrace.push({ name: "transferir_para_vendedor", args: {}, resultSummary: "handoff forçado (último recurso — modelo não chamou a ferramenta)" });
    }
  }

  return { reply, messages: splitMessages(reply), images, toolTrace, shownVehicles: sess(input.sessionId).shown, handoff: handoffInfo, lead: sess(input.sessionId).lead };
}
