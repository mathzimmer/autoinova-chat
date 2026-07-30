import { type Tool, type Message as LLMMessage } from "./_core/llm";
import { invokeAgentLLM as invokeLLM } from "./openaiLLM";
import { getDb, upsertLead, createAiLog, createAiDecisionsBatch, getSetting, upsertSetting, getLeadByConversationId, upsertLeadSummary, getAiAgentById, getVehicleById } from "./db";
import { getStockSummaryForAI, getVehicleByIdForAI, searchVehiclesForAI } from "./stockSync";
import type { Message, Conversation, AiAgent } from "../drizzle/schema";
import { validateLeadArgs, formatValidationErrors } from "./leadValidation";

// ============================================================================
// CAMADA 1: NÚCLEO (CORE) — IMUTÁVEL
// Regras críticas de integridade do sistema. NUNCA podem ser alteradas pelo admin.
// ============================================================================
export const CORE_PROMPT = `=== REGRAS DO SISTEMA ===

FORMATO: Escreva como WhatsApp normal, texto corrido. PROIBIDO markdown (*, _, -, #, bullets). Separe com quebras de linha. Máximo 1-2 emojis. Máximo 3 parágrafos curtos.

PRIORIDADE: [MENSAGEM ATUAL] sempre vence sobre dados do lead ou histórico. Se o cliente mudar de ideia, siga a mensagem atual.

SELEÇÃO NUMÉRICA: Se você listou veículos e o cliente responde "2" ou "o segundo", ele está ESCOLHENDO. Responda sobre o escolhido, não busque novamente. Chame atualizar_lead.

ATUALIZAR LEAD: Chame atualizar_lead SEMPRE que coletar dado novo. Ao mudar de veículo: atualizar_lead(veiculo_interesse: novo, veiculo_id: null) → buscar_veiculos → apresentar. Inclua "notas" com resumo breve a cada interação.

IMPORTANTE - VEÍCULOS:
- SÓ apresente veículos retornados por buscar_veiculos ou buscar_veiculo_por_id
- COPIE preço e ano EXATAMENTE como retornados. Nunca invente ou misture dados
- Para mais opções: buscar_veiculos com pagina: 2+ e MESMOS filtros
- PROIBIDO inventar veículos, preços, links ou URLs

MÍDIA: Imagens → confirme naturalmente ("Recebi a foto!"). Áudios → trate como texto. NUNCA diga "não consigo ver" ou mencione transcrição.

LIMPEZA: Remova [ID:X], [FOTO], [IMAGEM] da resposta. Texto natural apenas.`;

// ============================================================================
// CAMADA 2: MOTOR COMERCIAL — IMUTÁVEL
// Processo estrutural de venda. Garante o fluxo comercial independente do tom.
// ============================================================================
export const COMMERCIAL_PROMPT = `=== MOTOR COMERCIAL ===

== PRIORIDADE DE AÇÕES (execute na ordem) ==
1. Mensagem com IDX ou (Ref: X): veículo já pré-carregado no contexto. Apresente direto (preço, ano, km, link). NÃO chame buscar_veiculos. Vá para ETAPA 3.
2. Mensagem pede veículo específico: chame buscar_veiculos com termos simples. Vá para ETAPA 2.
3. Mensagem traz dados novos: chame atualizar_lead. Continue na etapa atual.
4. Mensagem de qualificação (troca, pagamento): siga a etapa correspondente.

== ETAPAS DA CONVERSA ==

ETAPA 1 - PRIMEIRO CONTATO:
Cenário: Cliente manda "oi", "bom dia", ou mensagem genérica sem mencionar veículo.
Ação: Cumprimente pelo nome (se disponível). Pergunte qual veículo procura ou que tipo de carro tem interesse.
Exemplo: "Oi [nome]! Tudo bem? Que tipo de veículo você está procurando?"
NÃO faça: Não busque veículos ainda. Não ofereça opções sem saber o interesse.

Cenário: Cliente manda "oi" + menciona veículo ("oi, tem Hilux?").
Ação: Cumprimente brevemente e vá direto para ETAPA 2.

ETAPA 2 - APRESENTAÇÃO DO VEÍCULO:
Cenário: Cliente pede veículo específico ("quero uma Hilux", "tem Corolla?").
Ação: Chame buscar_veiculos(marca, modelo). Apresente resultados em texto corrido. Chame atualizar_lead(veiculo_interesse, intencao: "compra").
1 resultado → apresente direto com detalhes
2-3 resultados → apresente todos numerados
4+ resultados → mostre os retornados, pergunte se quer filtrar (ano, preço, câmbio)
Após apresentar → pergunte: "Algum desses te interessou? Tem veículo pra dar na troca?"

Cenário: Cliente pede por categoria ("quero uma picape", "SUV automático").
Ação: Chame buscar_veiculos com categoria e/ou cambio. Mesma lógica acima.

Cenário: Cliente pede por faixa de preço ("carro até 80 mil").
Ação: Chame buscar_veiculos(preco_max: 80000). Mesma lógica acima.

Cenário: Cliente veio de anúncio (IDX pré-carregado no contexto).
Ação: Apresente o veículo do anúncio direto. Destaque preço, ano, km, link. Pergunte se quer agendar visita ou tem troca. Trate como lead quente.

Cenário: Cliente escolhe um número da lista ("quero o 2", "a segunda opção").
Ação: Responda sobre o veículo escolhido. Chame atualizar_lead(veiculo_id). Vá para ETAPA 3.

Cenário: Cliente pede mais opções.
Ação: Chame buscar_veiculos com pagina: 2+ e MESMOS filtros.

Cenário: Busca não encontrou nada.
Ação: Informe com empatia. Sugira buscar modelo similar ou ampliar filtros. "Não encontrei [modelo] no momento, mas posso buscar algo parecido. Que tal [sugestão]?"

ETAPA 3 - QUALIFICAÇÃO (TROCA E PAGAMENTO):
Cenário: Cliente demonstrou interesse em um veículo (escolheu da lista ou veio de anúncio).
Ação: Pergunte sobre troca de forma natural. "Você tem algum veículo pra dar na troca?"

Cenário: Cliente diz que TEM troca.
Ação: Pergunte: modelo, ano e km do veículo de troca. Chame atualizar_lead(tem_troca: true, veiculo_troca, ano_troca, km_troca).
Exemplo: "Legal! Qual o modelo, ano e quilometragem do seu carro?"

Cenário: Cliente diz que NÃO tem troca.
Ação: Pergunte sobre forma de pagamento. "Sem problema! Você pretende financiar ou pagar à vista?"

Cenário: Cliente informa dados da troca.
Ação: Confirme os dados. Pergunte forma de pagamento. Chame atualizar_lead com todos os dados.

Cenário: Cliente quer financiamento.
Ação: Pergunte valor de entrada. Chame atualizar_lead(forma_pagamento: "financiamento").
Exemplo: "Ótimo! Você tem um valor de entrada em mente?"

Cenário: Cliente quer pagar à vista.
Ação: Chame atualizar_lead(forma_pagamento: "a_vista"). Vá para ETAPA 4.

Cenário: Cliente informa entrada.
Ação: Chame atualizar_lead(entrada). Vá para ETAPA 4.

Cenário: Cliente pergunta se aceita troca (sem dizer qual carro).
Ação: Diga que sim, aceita troca. Pergunte qual o veículo.

ETAPA 4 - FECHAMENTO:
Cenário: Cliente já informou interesse + troca/pagamento.
Ação: Pergunte a cidade do cliente. Convide para visita presencial ou test drive. Chame atualizar_lead(status: "qualified", cidade).
Exemplo: "Você é de qual cidade? Posso te convidar pra conhecer o veículo pessoalmente aqui na loja em Ivoti!"

Cenário: Cliente quer agendar visita.
Ação: Informe endereço e horário. Pergunte melhor dia/horário. Ofereça transferir para vendedor.

Cenário: Cliente pede para falar com humano/vendedor.
Ação: Diga que vai transferir. Chame atualizar_lead com resumo completo nas notas.

Cenário: Cliente demonstra frustração ou insatisfação.
Ação: Peça desculpas. Ofereça transferência para atendente humano.

=== MENSAGENS INTERATIVAS (WhatsApp) ===
Você tem 2 ferramentas de mensagens interativas. Use-as nos momentos certos:

1. enviar_botoes (máx 3 botões): Use DEPOIS de apresentar um veículo ou proposta.
   - Após apresentar veículo: botões "Tenho interesse" / "Ver mais opções" / "Agendar visita"
   - Após perguntar sobre troca: botões "Sim, tenho troca" / "Não tenho" / "Quero financiar"
   - Após qualificar lead: botões "Agendar visita" / "Falar com vendedor" / "Ver mais"
   - Confirmações: botões "Confirmar" / "Alterar dados"

2. enviar_lista (máx 10 itens): Use quando há múltiplas opções.
   - Resultados de busca: lista com veículos encontrados (título: "Corolla 2022", descrição: "R$ 139.900 | 28mil km")
   - Categorias: lista com tipos de veículo (SUV, Sedan, Picape, Hatch)
   - Formas de pagamento: lista com opções (Financiamento, À vista, Consórcio)

REGRAS:
- SEMPRE envie uma mensagem de texto ANTES ou JUNTO com a mensagem interativa
- NÃO use botões para perguntas abertas (nome, cidade, km) - use texto normal
- Se o canal NÃO for WhatsApp, não use essas ferramentas (use texto normal)
- Botões: ideal para 2-3 opções de decisão rápida
- Lista: ideal para 3-10 itens com detalhes (veículos, categorias)

=== CENÁRIOS ESPECIAIS ===
MUDANÇA DE INTERESSE: Cliente muda de veículo ("mudei de ideia", "prefiro outro").
Ação: 1) atualizar_lead(veiculo_interesse: novo, veiculo_id: null) 2) buscar_veiculos(novo modelo) 3) apresentar. Volte para ETAPA 2.

MUDANÇA DE TROCA: Cliente vendeu o carro de troca ou tem outro.
Ação: Atualize imediatamente com atualizar_lead(veiculo_troca: novo).

CLIENTE RETORNOU: Conversa reativada após encerramento.
Ação: Cumprimente pelo retorno. Pergunte como pode ajudar. Use dados do lead como referência.

IMAGEM RECEBIDA: Cliente enviou foto.
Ação: Se contexto é troca → "Recebi a foto! Vou encaminhar para avaliação." Senão → confirme naturalmente.

== REGRAS DE BUSCA ==

SIMPLIFICAÇÃO: Use termos curtos. "Ford Belina I L 1.8" → marca: "ford", modelo: "belina". "Toyota Hilux SRV 4x4" → marca: "toyota", modelo: "hilux".
Sem resultados? Tente só pelo modelo sem marca.

FILTROS:
- Categoria: carros → categoria: "carros" | motos → categoria: "motos" (se não especificado, busca só carros)
- Tipo de carro: picape → tipo: "picape" | hatch → tipo: "hatch" | sedan → tipo: "sedan" | suv → tipo: "suv" | van → tipo: "van"
- Tipo de moto: naked → tipo: "naked" | esportiva → tipo: "esportiva" | street → tipo: "street" | trail → tipo: "trail" | custom → tipo: "custom"
- Câmbio: automático → cambio: "automatico" | manual → cambio: "manual"
- Exemplos: "picape até 80 mil" → buscar_veiculos(tipo: "picape", preco_max: 80000) | "moto naked" → buscar_veiculos(categoria: "motos", tipo: "naked")

NÃO busque para: "ok", "sim", "obrigado", números de seleção, dados de troca.
NUNCA diga "vou verificar" ou "só um momento". Apresente resultados na mesma resposta.`;

// ============================================================================
// CAMADA 3: PERSONALIDADE — EDITÁVEL PELO ADMIN
// Tom de voz, estratégia comercial, informações da loja.
// ============================================================================
export const DEFAULT_PERSONALITY_PROMPT = `=== PERSONALIDADE E ESTRATÉGIA ===

Você é a assistente virtual da Auto Inova - Matriz, uma concessionária de veículos localizada em Ivoti - RS.
Seu papel é fazer atendimento de pré-venda pelo WhatsApp, ajudando clientes a encontrar o veículo ideal.

TOM DE VOZ:
- Consultivo e amigável, como um vendedor experiente
- Direto ao ponto, sem enrolação
- Profissional mas acessível

INFORMAÇÕES DA LOJA:
- WhatsApp: (51) 99478-2062
- Endereço: Av Castro Alves, nº 1655, Sete de Setembro, Ivoti - RS`;

// ============================================================================
// O DEFAULT_SYSTEM_PROMPT legado é mantido para compatibilidade com prompts
// já salvos no banco de dados (que são monolíticos).
// ============================================================================
// Legacy prompt kept for backward compatibility with old DB entries
export const DEFAULT_SYSTEM_PROMPT = `Você é a assistente virtual da Auto Inova - Matriz, uma concessionária de veículos localizada em Ivoti - RS.
Seu papel é fazer atendimento de pré-venda pelo WhatsApp, ajudando clientes a encontrar o veículo ideal.

FORMATO: Escreva como WhatsApp normal, texto corrido. PROIBIDO markdown (*, _, -, #, bullets). Máximo 3 parágrafos curtos. Máximo 1-2 emojis.

PRIORIDADE: [MENSAGEM ATUAL] sempre vence sobre dados do lead. Se o cliente mudar de ideia, siga a mensagem atual.

SELEÇÃO NUMÉRICA: Se você listou veículos e o cliente responde com número, ele está ESCOLHENDO. Responda sobre o escolhido.

BUSCA: Chame buscar_veiculos para veículos específicos ou opções. NÃO busque para "ok", "sim", "tenho troca", "obrigado". Use termos simples (marca: "ford", modelo: "belina"). Copie EXATAMENTE preço e ano dos resultados.

FILTROS: carros → categoria: "carros" | motos → categoria: "motos" | picape → tipo: "picape" | hatch → tipo: "hatch" | sedan → tipo: "sedan" | suv → tipo: "suv" | naked → tipo: "naked" | esportiva → tipo: "esportiva" | automático → cambio: "automatico" | manual → "manual"

VEÍCULOS: SÓ apresente veículos retornados por buscar_veiculos. PROIBIDO inventar. Para mais opções: pagina: 2+.

LEAD: Chame atualizar_lead SEMPRE que coletar dado novo. Ao mudar veículo: atualizar_lead(veiculo_interesse: novo, veiculo_id: null) → buscar_veiculos → apresentar.

ETAPA DO FUNIL: Atualize etapa_funil em cada atualizar_lead conforme o progresso:
- Primeiro contato → etapa_funil: "novo"
- Demonstrou interesse em veículo → etapa_funil: "interesse_definido"
- Informou forma de pagamento → etapa_funil: "pagamento_definido"
- Informou cidade/dados pessoais → etapa_funil: "dados_pessoais"
- Informou dados do veículo de troca → etapa_funil: "dados_troca"
- Transferido para vendedor → etapa_funil: "encaminhado_vendedor"
- Desistiu/não respondeu → etapa_funil: "perdido"

MÍDIA: Imagens → confirme naturalmente. Áudios → trate como texto. NUNCA diga "não consigo ver" ou mencione transcrição.

LIMPEZA: Remova [ID:X], [FOTO], [IMAGEM] da resposta.

INFORMAÇÕES: WhatsApp (51) 99478-2062 | Av Castro Alves 1655, Ivoti - RS | Para falar com humano: transfira.`;

/**
 * Load a prompt layer from the DB with fallback to the default constant.
 * DB keys: "ai_core_prompt", "ai_commercial_prompt", "ai_personality_prompt"
 */
async function loadPromptLayer(dbKey: string, defaultValue: string): Promise<string> {
  try {
    const saved = await getSetting(dbKey);
    if (saved && saved.trim().length > 0) {
      return saved;
    }
  } catch (e) {
    console.error(`[AI] Failed to load prompt layer ${dbKey}, using default:`, e);
  }
  return defaultValue;
}

/**
 * Get the Core prompt (Layer 1). Loads from DB if admin customized, otherwise returns default.
 */
export async function getCorePrompt(): Promise<string> {
  return loadPromptLayer("ai_core_prompt", CORE_PROMPT);
}

/**
 * Get the Commercial prompt (Layer 2). Loads from DB if admin customized, otherwise returns default.
 */
export async function getCommercialPrompt(): Promise<string> {
  return loadPromptLayer("ai_commercial_prompt", COMMERCIAL_PROMPT);
}

/**
 * Get the Personality prompt (Layer 3). Loads from DB if admin customized, otherwise returns default.
 * Also handles migration from legacy monolithic prompt.
 */
export async function getPersonalityPrompt(): Promise<string> {
  try {
    // First check for the new personality-only prompt
    const personalityPrompt = await getSetting("ai_personality_prompt");
    if (personalityPrompt && personalityPrompt.trim().length > 0) {
      return personalityPrompt;
    }

    // Fallback: check for legacy monolithic prompt (old "ai_prompt" key)
    const legacyPrompt = await getSetting("ai_prompt");
    if (legacyPrompt && legacyPrompt.trim().length > 0) {
      console.log("[AI] Legacy monolithic prompt detected. Auto-migrating to personality layer...");
      // Auto-migrate: save the legacy prompt as the personality layer
      try {
        await upsertSetting("ai_personality_prompt", legacyPrompt);
        // Clear the legacy key so migration only happens once
        await upsertSetting("ai_prompt", "");
        console.log("[AI] Legacy prompt migrated successfully to ai_personality_prompt.");
      } catch (migrateErr) {
        console.error("[AI] Failed to auto-migrate legacy prompt:", migrateErr);
      }
      return legacyPrompt;
    }
  } catch (e) {
    console.error("[AI] Failed to load personality prompt, using default:", e);
  }
  return DEFAULT_PERSONALITY_PROMPT;
}

/**
 * Get the current system prompt - for backward compatibility.
 * Returns the full assembled prompt (all 4 layers minus context).
 */
export async function getSystemPrompt(): Promise<string> {
  const core = await getCorePrompt();
  const commercial = await getCommercialPrompt();
  const personality = await getPersonalityPrompt();
  return `${core}\n\n${commercial}\n\n${personality}`;
}

// Keywords that indicate the customer is asking about a SPECIFIC vehicle
const VEHICLE_MODEL_KEYWORDS = [
  "sprinter", "corolla", "civic", "gol", "onix", "hb20", "polo", "t-cross",
  "tracker", "creta", "compass", "renegade", "kicks", "nivus", "taos",
  "hilux", "ranger", "s10", "toro", "saveiro", "strada", "montana",
  "palio", "uno", "argo", "mobi", "kwid", "sandero", "logan",
  "cruze", "cobalt", "spin", "prisma", "joy", "virtus", "jetta",
  "amarok", "tiguan", "voyage", "fox", "up", "golf",
  "toyota", "honda", "volkswagen", "vw", "chevrolet", "gm", "fiat",
  "hyundai", "jeep", "nissan", "renault", "ford", "mitsubishi",
  "mercedes", "bmw", "audi", "volvo", "peugeot", "citroen", "kia",
  "caoa", "chery", "jac", "lifan", "byd", "gwm", "ram",
  "vectra", "astra", "celta", "classic", "meriva", "zafira", "blazer",
  "fusca", "kombi", "brasilia", "variant", "passat", "belina", "corcel", "del rey", "pampa", "maverick", "opala", "chevette", "monza", "kadett", "ipanema", "veraneio", "bonanza", "d-20", "d20",
  "fiesta", "focus", "ka", "ecosport", "territory",
  "fit", "city", "hrv", "wrv", "crv",
  "etios", "yaris", "camry", "sw4", "rav4",
  "tucson", "ix35", "santa fe", "azera",
  "suv", "sedan", "hatch", "picape", "pickup", "van", "caminhonete",
];

// Keywords that indicate the customer wants to see what's available
const VEHICLE_SEARCH_KEYWORDS = [
  "disponível", "disponivel", "estoque", "opção", "opcao", "opções",
  "o que tem", "o que voces tem", "o que vocês têm",
  "quero ver", "quero conhecer", "mostrar", "me mostra",
  "carro até", "veículo até", "veiculo até",
  "até 100", "até 50", "até 80", "até 200", "até 150",
  "mil reais", "mil real",
];

/**
 * Detect if the message is about a specific vehicle and should trigger a search.
 * Does NOT trigger for generic messages, trade-in info, or numeric selections.
 */
function shouldForceVehicleSearch(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Don't force search for very short messages (likely selections like "1", "2", "sim", "ok")
  if (lower.trim().length <= 3) return false;
  
  // Detect explicit vehicle interest change: "mudei de ideia", "prefiro", "na verdade quero", etc.
  const interestChangeKeywords = ["mudei de ideia", "mudei de interesse", "na verdade quero", "prefiro", "quero outro", "nao quero mais", "não quero mais", "desisti", "esquece o", "esquece a"];
  const hasInterestChange = interestChangeKeywords.some(kw => lower.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  if (hasInterestChange) return true;
  
  // Don't force search for trade-in related messages
  const tradeKeywords = ["troca", "trocar", "vendi", "tenho um", "meu carro", "meu gol", "meu fusca"];
  const isTradeMessage = tradeKeywords.some(kw => lower.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  
  // If it's a trade message that also mentions a model, it's about the trade-in car, not a search
  // Exception: if they say something like "quero trocar por uma Hilux" - that mentions a new vehicle
  if (isTradeMessage && !lower.includes("por um") && !lower.includes("por uma") && !lower.includes("interesse")) {
    return false;
  }
  
  // Check for specific vehicle model/brand mentions
  const hasModel = VEHICLE_MODEL_KEYWORDS.some(kw => {
    const normalizedKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return lower.includes(normalizedKw);
  });
  
  if (hasModel) return true;
  
  // Check for general search intent
  const hasSearchIntent = VEHICLE_SEARCH_KEYWORDS.some(kw => {
    const normalizedKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return lower.includes(normalizedKw);
  });
  
  return hasSearchIntent;
}

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "buscar_veiculos",
      description: "Busca veículos disponíveis no estoque REAL da Auto Inova - Matriz. Use quando o cliente perguntar sobre um veículo específico ou quiser ver opções. IMPORTANTE: use 'categoria' para filtrar carros ou motos, 'tipo' para filtrar por carroceria (picape, hatch, sedan, SUV, naked, esportiva, etc.), e 'cambio' para filtrar por transmissão (automatico, manual). Cada resultado inclui [ID:X] para vincular ao lead.",
      parameters: {
        type: "object",
        properties: {
          marca: { type: "string", description: "Marca do veículo (ex: Toyota, Honda, Volkswagen)" },
          modelo: { type: "string", description: "Modelo do veículo (ex: Corolla, Civic, Gol). Use termos simples e curtos." },
          preco_max: { type: "number", description: "Preço máximo em reais" },
          preco_min: { type: "number", description: "Preço mínimo em reais" },
          categoria: { type: "string", description: "Categoria principal: 'carros' ou 'motos'. Use 'motos' quando o cliente perguntar por motos/motocicletas. Se não especificado, busca apenas carros por padrão." },
          tipo: { type: "string", description: "Tipo/carroceria do veículo. Para CARROS: picape, hatch, sedan, suv, van, wagon, minivan, esportivo. Para MOTOS: naked, esportiva, street, touring, trail, custom. OBRIGATÓRIO quando o cliente pedir por tipo (ex: 'quero uma picape', 'moto naked', 'sedan completo')." },
          combustivel: { type: "string", description: "Combustível: flex, gasolina, diesel, elétrico, híbrido" },
          cambio: { type: "string", description: "Câmbio/transmissão. Valores aceitos: automatico, manual. OBRIGATÓRIO quando o cliente mencionar tipo de câmbio (ex: 'automático', 'manual', 'câmbio automático')." },
          km_max: { type: "number", description: "Quilometragem máxima" },
          ano_min: { type: "number", description: "Ano mínimo" },
          ano_max: { type: "number", description: "Ano máximo" },
          cor: { type: "string", description: "Cor do veículo" },
          pagina: { type: "number", description: "Número da página (começa em 1). Use para ver mais resultados quando o cliente pedir 'mais opções'. OBRIGATÓRIO manter os mesmos filtros da busca anterior." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resumo_estoque",
      description: "Obtém um resumo geral do estoque atual da Auto Inova - Matriz: quantos veículos, marcas disponíveis, faixa de preço.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "atualizar_lead",
      description: "Atualiza os dados do lead/cliente no CRM. OBRIGATÓRIO chamar sempre que coletar informação nova, especialmente quando o cliente MUDAR de veículo de interesse ou dados de troca.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente" },
          intencao: { type: "string", description: "Intenção: compra, troca, informacao, test_drive, financiamento" },
          veiculo_interesse: { type: "string", description: "Veículo de interesse ATUAL (atualize sempre que mudar)" },
          veiculo_id: { type: "number", description: "ID do veículo no estoque [ID:X] da busca" },
          tem_troca: { type: "boolean", description: "Se tem veículo para troca" },
          veiculo_troca: { type: "string", description: "Veículo de troca ATUAL do cliente (atualize se mudar)" },
          ano_troca: { type: "string", description: "Ano do veículo de troca" },
          km_troca: { type: "string", description: "KM do veículo de troca" },
          forma_pagamento: { type: "string", description: "Forma de pagamento: financiamento, a_vista, consorcio, troca" },
          entrada: { type: "string", description: "Valor de entrada para financiamento" },
          cidade: { type: "string", description: "Cidade do cliente" },
          status: { type: "string", description: "Status: qualifying ou qualified" },
          etapa_funil: { type: "string", enum: ["novo", "interesse_definido", "pagamento_definido", "dados_pessoais", "dados_troca", "encaminhado_vendedor", "negociando", "fechado", "perdido"], description: "Etapa do funil de vendas. Atualize conforme o progresso: novo (primeiro contato), interesse_definido (demonstrou interesse em veículo), pagamento_definido (informou forma de pagamento), dados_pessoais (informou cidade/nome), dados_troca (informou dados do veículo de troca), encaminhado_vendedor (transferido para vendedor), negociando (em negociação ativa), fechado (venda concluída), perdido (desistiu)" },
          notas: { type: "string", description: "Resumo breve da conversa para o vendedor (ex: 'Cliente quer Hilux 2012, tem Gol 2011 150mil km para troca, quer financiar')" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_veiculo_por_id",
      description: "Busca um veículo específico pelo ID no estoque. Use quando o cliente mencionar um ID específico (ex: ID9, ID42) ou quando quiser detalhes de um veículo já identificado.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "ID do veículo no estoque (o número após 'ID' na mensagem do cliente)" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enviar_botoes",
      description: "Envia botões interativos no WhatsApp (máx 3 botões). Use para decisões rápidas: sim/não, financiar/troca/visita, etc. REGRAS: Use APÓS apresentar informações (veículo, proposta). NÃO use para perguntas abertas. Cada botão máx 20 caracteres.",
      parameters: {
        type: "object",
        properties: {
          texto: { type: "string", description: "Texto principal da mensagem (máx 1024 chars). Inclua a pergunta ou informação antes dos botões." },
          botoes: {
            type: "array",
            description: "Lista de botões (1-3). Cada botão tem id e titulo.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "ID único do botão (ex: btn_financiar, btn_troca, btn_visita)" },
                titulo: { type: "string", description: "Texto do botão (máx 20 chars, ex: 'Quero financiar')" },
              },
              required: ["id", "titulo"],
            },
          },
          cabecalho: { type: "string", description: "Cabeçalho opcional (máx 60 chars)" },
          rodape: { type: "string", description: "Rodapé opcional (máx 60 chars, ex: 'Auto Inova - Matriz - Ivoti/RS')" },
        },
        required: ["texto", "botoes"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apresentar_veiculo",
      description: "Apresenta um veículo do estoque com FOTO e informações formatadas. Busca o veículo pelo ID e envia a imagem do anúncio com os dados. Use APÓS buscar_veiculos ou buscar_veiculo_por_id quando quiser mostrar o veículo visualmente ao cliente. A foto é enviada automaticamente junto com as informações.",
      parameters: {
        type: "object",
        properties: {
          veiculo_id: { type: "number", description: "ID do veículo no estoque (ex: 42). Obrigatório." },
          mensagem_adicional: { type: "string", description: "Mensagem opcional para enviar junto (ex: 'Olha que beleza esse aqui!'). Se não informado, envia apenas os dados do veículo." },
          campos: { type: "array", items: { type: "string", enum: ["titulo", "preco", "ano", "km", "cambio", "combustivel", "cor", "link"] }, description: "Opcional. Quais campos exibir na legenda da foto. Se vazio/omitido, exibe todos. Use APENAS quando o sistema instruir quais campos mostrar." },
        },
        required: ["veiculo_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enviar_lista",
      description: "Envia um menu de lista interativo no WhatsApp (máx 10 itens). Use para: listar veículos encontrados, formas de pagamento, categorias de veículos. REGRAS: Use quando há 3+ opções. Cada item tem título (máx 24 chars) e descrição opcional (máx 72 chars).",
      parameters: {
        type: "object",
        properties: {
          texto: { type: "string", description: "Texto principal da mensagem (máx 1024 chars). Descreva o contexto antes da lista." },
          texto_botao: { type: "string", description: "Texto do botão que abre a lista (máx 20 chars, ex: 'Ver opções')" },
          secoes: {
            type: "array",
            description: "Seções da lista. Cada seção tem título e itens.",
            items: {
              type: "object",
              properties: {
                titulo: { type: "string", description: "Título da seção (máx 24 chars)" },
                itens: {
                  type: "array",
                  description: "Itens da seção (total de todos itens em todas seções: máx 10)",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", description: "ID único do item (ex: veiculo_123, pagamento_financiamento)" },
                      titulo: { type: "string", description: "Título do item (máx 24 chars)" },
                      descricao: { type: "string", description: "Descrição do item (máx 72 chars, ex: 'R$ 139.900 | 28.000 km | Automático')" },
                    },
                    required: ["id", "titulo"],
                  },
                },
              },
              required: ["titulo", "itens"],
            },
          },
          cabecalho: { type: "string", description: "Cabeçalho opcional (máx 60 chars)" },
          rodape: { type: "string", description: "Rodapé opcional (máx 60 chars)" },
        },
        required: ["texto", "texto_botao", "secoes"],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Process a customer message through the AI agent and return the response.
 * Uses the 4-layer prompt architecture:
 * 1. CORE (immutable) - system rules
 * 2. COMMERCIAL (immutable) - sales process
 * 3. PERSONALITY (editable) - tone and strategy
 * 4. CONTEXT (dynamic) - customer data and conversation state
 */
// Types for interactive WhatsApp messages
export interface InteractiveButton {
  id: string;
  title: string;
}
export interface InteractiveListSection {
  title: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}
export interface InteractiveMessage {
  type: "buttons" | "list" | "image";
  body: string;
  buttons?: InteractiveButton[];
  sections?: InteractiveListSection[];
  buttonText?: string; // for list type
  header?: string;
  footer?: string;
  imageUrl?: string; // for image type
  caption?: string; // for image type
}

export async function interpolateSystemVariables(prompt: string, conversation: Conversation): Promise<string> {
  if (!prompt) return prompt;

  const clientName = conversation.contactName || "Cliente";
  const clientPhone = conversation.phone || "";

  let sellerName = "Atendente";
  if (conversation.assignedTo) {
    try {
      const { getUserById } = await import("./db");
      const user = await getUserById(conversation.assignedTo);
      if (user && user.name) sellerName = user.name;
    } catch { /* ignore */ }
  }

  // Configurações da concessionária
  const storeName = (await getSetting("store_name")) || "Auto Inova";
  const storeAddress = (await getSetting("store_address")) || "";
  const businessHours = (await getSetting("business_hours")) || "Segunda a Sexta, das 8h às 18h";

  return prompt
    // Nome do cliente
    .replace(/\{\{cliente_nome\}\}/gi, clientName)
    .replace(/\{\{cliente\}\}/gi, clientName)
    .replace(/\{\{nome\}\}/gi, clientName)
    // Telefone
    .replace(/\{\{cliente_telefone\}\}/gi, clientPhone)
    .replace(/\{\{telefone\}\}/gi, clientPhone)
    // Vendedor / Atendente
    .replace(/\{\{vendedor_nome\}\}/gi, sellerName)
    .replace(/\{\{vendedor\}\}/gi, sellerName)
    .replace(/\{\{atendente_nome\}\}/gi, sellerName)
    .replace(/\{\{atendente\}\}/gi, sellerName)
    // Loja e horários
    .replace(/\{\{loja_nome\}\}/gi, storeName)
    .replace(/\{\{loja\}\}/gi, storeName)
    .replace(/\{\{loja_endereco\}\}/gi, storeAddress)
    .replace(/\{\{horario_funcionamento\}\}/gi, businessHours)
    .replace(/\{\{horario\}\}/gi, businessHours);
}

export async function getKnowledgeBaseContext(customerMessage: string): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return "";

    const { eq } = await import("drizzle-orm");
    const { knowledgeBase } = await import("../drizzle/schema");
    const faqList = await db.select().from(knowledgeBase).where(eq(knowledgeBase.isActive, true));
    if (faqList.length === 0) return "";

    const lowerMsg = customerMessage.toLowerCase();
    const matchedFaqs = faqList.filter(faq => {
      const titleMatch = faq.title.toLowerCase().split(" ").some(word => word.length > 3 && lowerMsg.includes(word));
      const contentMatch = faq.content.toLowerCase().split(" ").some(word => word.length > 4 && lowerMsg.includes(word));
      return titleMatch || contentMatch;
    });

    if (matchedFaqs.length === 0) return "";

    return `\n\n=== INFORMAÇÕES ADICIONAIS (BASE DE CONHECIMENTO) ===\n${matchedFaqs.map(faq => `Pergunta/Tópico: ${faq.title}\nResposta: ${faq.content}`).join("\n\n")}`;
  } catch (err) {
    console.error("[AI-KB] Erro ao buscar base de conhecimento:", err);
    return "";
  }
}

export async function applyAutoTagging(conversationId: number, text: string) {
  try {
    const raw = await getSetting("ai_crm_config");
    if (!raw) return;
    const config = JSON.parse(raw);
    const autoTags: Array<{ keyword: string; tag: string }> = config.autoTags || [];
    if (autoTags.length === 0 || !text) return;

    const lower = text.toLowerCase();
    const matchedTags = autoTags.filter(item => item.keyword && lower.includes(item.keyword.toLowerCase())).map(item => item.tag.trim());
    if (matchedTags.length === 0) return;

    const db = await getDb();
    if (!db) return;
    const { labels, conversationLabels } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const existingLabels = await db.select().from(labels);
    const labelMap = new Map(existingLabels.map(l => [l.name.toLowerCase(), l]));

    const targetLabelIds: number[] = [];
    for (const tagName of matchedTags) {
      let label = labelMap.get(tagName.toLowerCase());
      if (!label) {
        const [inserted] = await db.insert(labels).values({
          name: tagName,
          color: "#3b82f6",
        }).returning();
        label = inserted;
        labelMap.set(tagName.toLowerCase(), label);
      }
      if (label) targetLabelIds.push(label.id);
    }

    if (targetLabelIds.length === 0) return;

    const currentConvLabels = await db.select()
      .from(conversationLabels)
      .where(eq(conversationLabels.conversationId, conversationId));
    const currentIds = new Set(currentConvLabels.map(cl => cl.labelId));

    const toInsert = targetLabelIds.filter(id => !currentIds.has(id));
    if (toInsert.length > 0) {
      await db.insert(conversationLabels).values(
        toInsert.map(labelId => ({ conversationId, labelId }))
      );
      const updatedIds = Array.from(new Set(currentConvLabels.map(cl => cl.labelId).concat(toInsert)));
      const { emitConversationUpdate } = await import("./socket");
      emitConversationUpdate(conversationId, { labelIds: updatedIds });

      const { triggerEventFlow } = await import("./flowEngine");
      for (const id of toInsert) {
        const labelObj = existingLabels.find(l => l.id === id);
        if (labelObj) {
          await triggerEventFlow({ conversationId, triggerType: "tag_added", matchValue: labelObj.name });
        }
      }
      console.log(`[AI-AutoTag] Adicionadas etiqueta(s) [${matchedTags.join(", ")}] na conversa ${conversationId}`);
    }
  } catch (err) {
    console.error("[AI-AutoTag] Erro ao aplicar auto-etiquetagem:", err);
  }
}

export async function processAIMessage(
  conversation: Conversation,
  recentMessages: Message[],
  customerMessage: string,
  options?: { flowPrompt?: string; flowInstruction?: string; agentId?: number | null; onlyTools?: string[] }
): Promise<{ response: string; leadData: Record<string, unknown> | null; interactiveMessages?: InteractiveMessage[] }> {
  const startTime = Date.now();
  const isFlowMode = !!(options?.flowPrompt);
  console.log(`[AI] processAIMessage called for conv ${conversation.id}, options: ${JSON.stringify({ flowPrompt: options?.flowPrompt ? `${options.flowPrompt.substring(0, 50)}...` : undefined, flowInstruction: options?.flowInstruction, agentId: options?.agentId })}`);

  // Executa auto-etiquetagem por palavras-chave
  if (customerMessage) {
    applyAutoTagging(conversation.id, customerMessage).catch(err => console.error("[AI] Auto-tagging error:", err));
  }

  // Load agent config if agentId is provided
  let agent: AiAgent | null = null;
  if (options?.agentId) {
    agent = await getAiAgentById(options.agentId);
    if (agent && !agent.active) {
      console.log(`[AI] Agent ${agent.id} (${agent.name}) is inactive, skipping`);
      agent = null;
    }
    if (agent) {
      console.log(`[AI] Using agent: ${agent.name} (ID: ${agent.id}, model: ${agent.model}, tools: ${JSON.stringify(agent.enabledTools)})`);
    }
  }

  // Determine prompt layers based on mode
  let corePrompt: string;
  let commercialPrompt: string;
  let personalityPrompt: string;

  if (agent) {
    // AGENT MODE: Use agent-specific prompt
    if (agent.includeCoreLayers) {
      corePrompt = await getCorePrompt();
      commercialPrompt = await getCommercialPrompt();
    } else {
      corePrompt = `=== REGRAS DO SISTEMA ===\nFORMATO: Escreva como WhatsApp normal, texto corrido. PROIBIDO markdown (*, _, -, #, bullets). Separe com quebras de linha. Máximo 1-2 emojis. Máximo 3 parágrafos curtos.\nIMPORTANTE: SÓ apresente veículos retornados por buscar_veiculos ou buscar_veiculo_por_id. COPIE preço e ano EXATAMENTE. PROIBIDO inventar dados.\nMÍDIA: Imagens → confirme naturalmente. Áudios → trate como texto.\nLIMPEZA: Remova [ID:X], [FOTO] da resposta.\nFERRAMENTAS: Você DEVE usar as ferramentas disponíveis para executar ações. Se tem a ferramenta apresentar_veiculo, USE-A para mostrar veículos com foto. Se tem buscar_veiculos, USE-A para buscar. NUNCA escreva informações de veículos em texto se pode usar uma ferramenta para isso.`;
      commercialPrompt = "";
    }
    personalityPrompt = agent.systemPrompt;
    if (options?.flowInstruction) {
      personalityPrompt += `\n\n=== INSTRUÇÃO DO NÓ ATUAL ===\n${options.flowInstruction}`;
    }
    console.log(`[AI] AGENT MODE: usando agente "${agent.name}" (ID: ${agent.id}, includeCoreLayers: ${agent.includeCoreLayers}, tools: ${JSON.stringify(agent.enabledTools)}, prompt: ${personalityPrompt.substring(0, 100)}...)`);
  } else if (isFlowMode) {
    // FLOW MODE (legacy): Use minimal core rules + flow-specific prompt only
    corePrompt = `=== REGRAS DO SISTEMA ===\nFORMATO: Escreva como WhatsApp normal, texto corrido. PROIBIDO markdown (*, _, -, #, bullets). Separe com quebras de linha. Máximo 1-2 emojis. Máximo 3 parágrafos curtos.\nIMPORTANTE: SÓ apresente veículos retornados por buscar_veiculos ou buscar_veiculo_por_id. COPIE preço e ano EXATAMENTE. PROIBIDO inventar dados.\nMÍDIA: Imagens → confirme naturalmente. Áudios → trate como texto.\nLIMPEZA: Remova [ID:X], [FOTO] da resposta.`;
    commercialPrompt = "";
    personalityPrompt = options.flowPrompt!;
    if (options.flowInstruction) {
      personalityPrompt += `\n\n=== INSTRUÇÃO DO NÓ ATUAL ===\n${options.flowInstruction}`;
    }
    console.log(`[AI] FLOW MODE (legacy): usando prompt do fluxo (${personalityPrompt.length}ch)`);
  } else {
    // FREE AI MODE: Use all 3 global layers
    corePrompt = await getCorePrompt();
    commercialPrompt = await getCommercialPrompt();
    personalityPrompt = await getPersonalityPrompt();
  }

  // Ferramentas do modo livre (Agente Geral) — configuráveis em Agentes
  let freeTools: string[] | null = null;
  if (!agent && !isFlowMode) {
    try {
      const raw = await getSetting("ai_free_tools");
      if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed) && parsed.length > 0) freeTools = parsed; }
    } catch { /* usa todas */ }
  }

  // Filter tools based on agent config OR free-mode config.
  // onlyTools (ex.: nó "Coletar com IA") tem precedência: restringe ao mínimo
  // e desliga busca/apresentação de veículo para a IA só coletar dados.
  const toolFilter = options?.onlyTools && options.onlyTools.length > 0
    ? options.onlyTools
    : (agent?.enabledTools && agent.enabledTools.length > 0
      ? (agent.enabledTools as string[])
      : freeTools);
  const activeTools: Tool[] = toolFilter && toolFilter.length > 0
    ? TOOLS.filter(t => toolFilter.includes(t.function.name))
    : TOOLS;
  console.log(`[AI] Conv ${conversation.id}: activeTools=[${activeTools.map(t => t.function.name).join(', ')}] (${activeTools.length}/${TOOLS.length})`);
  console.log(`[AI] Conv ${conversation.id}: mode=${agent ? 'AGENT' : isFlowMode ? 'FLOW_LEGACY' : 'FREE'}, corePrompt=${corePrompt.length}ch, commercialPrompt=${commercialPrompt.length}ch, personalityPrompt=${personalityPrompt.length}ch`);

  // === LAYER 4: CONTEXT (dynamic) ===
  let contextBlock = "\n=== CONTEXTO DINÂMICO ===";

  // Customer identity
  const customerName = conversation.contactName || null;
  if (customerName) {
    contextBlock += `\nNOME DO CLIENTE: ${customerName}`;
  }
  contextBlock += `\nTELEFONE: ${conversation.phone}`;

  // Conversation state
  if (conversation.status === "resolved" || conversation.status === "closed") {
    contextBlock += `\n\nESTADO DA CONVERSA: REATIVADA (cliente retornou após conversa encerrada)`;
    contextBlock += `\nCumprimente o cliente pelo retorno e pergunte como pode ajudar novamente.`;
  }

  // Contact notes from CRM
  if ((conversation as any).contactNotes) {
    contextBlock += `\nOBSERVAÇÕES: ${(conversation as any).contactNotes}`;
  }

  // Lead data - present as reference, with smart recency handling
  let existingLead: any = null;
  try {
    existingLead = await getLeadByConversationId(conversation.id);
    if (existingLead) {
      // Calculate how old the lead data is
      const leadAge = existingLead.updatedAt ? Date.now() - new Date(existingLead.updatedAt).getTime() : Infinity;
      const isRecent = leadAge < 24 * 60 * 60 * 1000; // less than 24h
      const ageLabel = isRecent ? "dados recentes" : "dados anteriores";
      contextBlock += `\n\nDADOS DO LEAD (${ageLabel}):`;
      if (existingLead.name) contextBlock += `\n- Nome: ${existingLead.name}`;
      if (existingLead.intention) contextBlock += `\n- Intenção: ${existingLead.intention}`;
      if (existingLead.vehicleInterest) contextBlock += `\n- Veículo de interesse: ${existingLead.vehicleInterest}`;
      if (existingLead.vehicleId) contextBlock += `\n- Veículo vinculado ID: ${existingLead.vehicleId}`;
      if (existingLead.hasTrade) contextBlock += `\n- Tem troca: Sim`;
      if (existingLead.tradeVehicle) contextBlock += `\n- Veículo de troca: ${existingLead.tradeVehicle} ${existingLead.tradeYear || ""} ${existingLead.tradeKm || ""}`;
      if (existingLead.paymentMethod) contextBlock += `\n- Pagamento: ${existingLead.paymentMethod}`;
      if (existingLead.downPayment) contextBlock += `\n- Entrada: ${existingLead.downPayment}`;
      if (existingLead.city) contextBlock += `\n- Cidade: ${existingLead.city}`;
      if (existingLead.notes) contextBlock += `\n- Notas: ${existingLead.notes}`;
      if (existingLead.funnelStatus) contextBlock += `\n- Etapa do Funil: ${existingLead.funnelStatus}`;
      if (existingLead.temperature) contextBlock += `\n- Temperatura: ${existingLead.temperature}`;
      contextBlock += `\nSe a [MENSAGEM ATUAL] contradiz algum dado acima, a mensagem atual tem prioridade. Atualize com atualizar_lead.`;
    }
  } catch (e) {
    console.error("[AI] Failed to load lead context:", e);
  }

  // === PRE-PROCESSING: Detect vehicle ID in message and fetch directly ===
  let adVehicleContext = "";
  let adVehicleId: number | null = null;
  const idMatch = customerMessage.match(/(?:ID|id)(\d+)|\(Ref:\s*(\d+)\)/i);
  if (idMatch) {
    adVehicleId = parseInt(idMatch[1] || idMatch[2]);
    console.log(`[AI] Detected vehicle ID ${adVehicleId} in message. Pre-fetching from database...`);
    try {
      const vehicleResult = await getVehicleByIdForAI(adVehicleId);
      if (vehicleResult.found) {
        adVehicleContext = `\n\n=== VEÍCULO DO ANÚCIO (PRÉ-CARREGADO) ===\n${vehicleResult.text}\n\nINSTRUÇÃO: O cliente veio de um anúncio e já demonstrou interesse neste veículo. Apresente-o diretamente na resposta (preço, ano, cor, km, câmbio, link). NÃO chame buscar_veiculos para este veículo pois os dados já estão acima. Pergunte se deseja agendar uma visita, saber mais detalhes ou se tem veículo de troca.`;
        // Auto-update lead with vehicle ID
        try {
          const v = vehicleResult.vehicle;
          await upsertLead({
            conversationId: conversation.id,
            phone: conversation.phone,
            vehicleId: adVehicleId,
            vehicleInterest: v ? `${v.brand} ${v.model} ${v.year}` : undefined,
            intention: "compra",
            status: "qualifying",
          });
          console.log(`[AI] Auto-updated lead with vehicle ID ${adVehicleId}`);
        } catch (leadErr) {
          console.error(`[AI] Failed to auto-update lead with vehicle ID:`, leadErr);
        }
      } else {
        adVehicleContext = `\n\n=== VEÍCULO DO ANÚCIO ===\n${vehicleResult.text}\nINSTRUÇÃO: O veículo do anúncio não está mais disponível. Informe ao cliente com empatia e ofereça buscar veículos similares usando buscar_veiculos.`;
      }
    } catch (err) {
      console.error(`[AI] Failed to pre-fetch vehicle ID ${adVehicleId}:`, err);
    }
  }

  // === ASSEMBLE FULL PROMPT (4 layers in order + ad vehicle context) ===
  const finalCore = await interpolateSystemVariables(corePrompt, conversation);
  const finalCommercial = await interpolateSystemVariables(commercialPrompt, conversation);
  const finalPersonality = await interpolateSystemVariables(personalityPrompt, conversation);
  const kbContext = await getKnowledgeBaseContext(customerMessage);

  const fullSystemPrompt = `${finalCore}\n\n${finalCommercial}\n\n${finalPersonality}\n\n${contextBlock}${adVehicleContext}${kbContext}`;

  console.log(`[AI] Prompt assembled: CORE(${finalCore.length}ch) + COMMERCIAL(${finalCommercial.length}ch) + PERSONALITY(${finalPersonality.length}ch) + CONTEXT(${contextBlock.length}ch) + AD_VEHICLE(${adVehicleContext.length}ch) + KB(${kbContext.length}ch) = ${fullSystemPrompt.length}ch total`);

  // Build message history for context
  const llmMessages: LLMMessage[] = [
    { role: "system", content: fullSystemPrompt },
  ];

  // Add recent conversation history (last 30 messages for better context)
  const history = recentMessages.slice(-30);
  for (const msg of history) {
    if (msg.senderType === "customer") {
      const meta = msg.metadata as Record<string, unknown> | null;
      
      if (msg.messageType === "image") {
        const caption = msg.content && msg.content !== "[Imagem enviada pelo cliente]" && msg.content !== "[Imagem recebida]"
          ? msg.content
          : "";
        llmMessages.push({ role: "user", content: `[Cliente enviou uma imagem]${caption ? " " + caption : ""}` });
      } else if (msg.messageType === "audio") {
        const transcribed = (meta?.transcribedText as string) || msg.content;
        llmMessages.push({ role: "user", content: transcribed });
      } else {
        llmMessages.push({ role: "user", content: msg.content });
      }
    } else if (msg.senderType === "bot") {
      llmMessages.push({ role: "assistant", content: msg.content });
    } else if (msg.senderType === "agent") {
      llmMessages.push({ role: "assistant", content: `[Atendente humano]: ${msg.content}` });
    }
  }

  // Add current message - marked clearly as the message to respond to
  const imageMatch = customerMessage.match(/\[IMAGEM: https?:\/\/[^\]]+\]\s*(.*)/);
  if (imageMatch) {
    const caption = imageMatch[1]?.trim() || "";
    llmMessages.push({ role: "user", content: `[MENSAGEM ATUAL] [Cliente enviou uma imagem]${caption ? " " + caption : ""}` });
  } else {
    llmMessages.push({ role: "user", content: `[MENSAGEM ATUAL] ${customerMessage}` });
  }

  // Track lead data collected during this interaction
  let collectedLeadData: Record<string, unknown> | null = null;

  // Track interactive messages to send
  const interactiveMessages: InteractiveMessage[] = [];

  // Detect if we should force vehicle search (skip if ad vehicle already pre-loaded)
  const forceSearch = adVehicleId ? false : shouldForceVehicleSearch(customerMessage);

  try {
    console.log(`[AI] Processing message for conversation ${conversation.id}: "${customerMessage.substring(0, 80)}..." forceSearch=${forceSearch}`);

    // If agent has specific tools enabled, force tool use on first call
    const agentToolChoice = agent?.enabledTools && agent.enabledTools.length > 0 && agent.enabledTools.length <= 3
      ? "required" as const
      : "auto" as const;
    console.log(`[AI] Conv ${conversation.id}: tool_choice=${agentToolChoice} (agent tools: ${agent?.enabledTools?.length || 'all'})`);

    let result = await invokeLLM({
      messages: llmMessages,
      tools: activeTools,
      tool_choice: agentToolChoice,
    });

    console.log(`[AI] First LLM response - finish_reason: ${result.choices[0]?.finish_reason}, has_tool_calls: ${!!result.choices[0]?.message?.tool_calls?.length}, forceSearch: ${forceSearch}`);

    // If forceSearch is true but the model didn't use tools, retry with explicit instruction
    if (forceSearch && !result.choices[0]?.message?.tool_calls?.length) {
      console.log(`[AI] Force search active but no tool call detected. Retrying with explicit instruction.`);
      const retryMessages = [...llmMessages];
      
      // Check if lead has an existing vehicle interest (possible change of interest)
      const hasExistingInterest = existingLead?.vehicleInterest;
      const retryInstruction = hasExistingInterest
        ? `[SISTEMA: O cliente mencionou um veículo. Se for um veículo DIFERENTE de "${existingLead.vehicleInterest}", chame atualizar_lead com o novo veiculo_interesse e veiculo_id: null PRIMEIRO. Depois chame buscar_veiculos para o novo modelo.]`
        : `[SISTEMA: O cliente mencionou um veículo. Chame buscar_veiculos AGORA antes de responder.]`;
      
      retryMessages.push({ role: "user", content: retryInstruction });
      try {
        result = await invokeLLM({
          messages: retryMessages,
          tools: activeTools,
          tool_choice: "auto",
        });
        console.log(`[AI] Retry response - finish_reason: ${result.choices[0]?.finish_reason}, has_tool_calls: ${!!result.choices[0]?.message?.tool_calls?.length}`);
      } catch (retryErr) {
        console.error(`[AI] Retry failed, using original response:`, retryErr);
      }
    }

    let assistantMessage = result.choices[0]?.message;

    // Track all tool call decisions for audit
    const toolDecisions: Array<{
      toolName: string;
      toolArgs: any;
      toolResultSummary: string;
      resultCount: number | null;
      success: boolean;
      errorMessage: string | null;
      startTime: number;
      endTime: number;
    }> = [];

    // Handle tool calls (may need multiple rounds)
    let maxToolRounds = 5;
    while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && maxToolRounds > 0) {
      maxToolRounds--;

      // Sanitize tool_call IDs
      const sanitizedToolCalls = assistantMessage.tool_calls.map((tc: any) => ({
        ...tc,
        id: tc.id ? tc.id.replace(/[^a-zA-Z0-9_-]/g, '_') : `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }));

      console.log(`[AI] Tool calls: ${sanitizedToolCalls.map((tc: any) => tc.function.name).join(", ")}`);

      // Add assistant message with tool calls to history
      llmMessages.push({
        role: "assistant",
        content: assistantMessage.content || "",
        tool_calls: sanitizedToolCalls,
      } as any);

      for (const toolCall of sanitizedToolCalls) {
        let toolResult = "";
        const toolStartTime = Date.now();
        let toolSuccess = true;
        let toolErrorMsg: string | null = null;
        let toolResultCount: number | null = null;
        let parsedArgs: any = {};

        try {
          if (toolCall.function.name === "buscar_veiculos") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            parsedArgs = args;
            console.log(`[AI] buscar_veiculos args:`, JSON.stringify(args));
            toolResult = await searchVehiclesForAI({
              brand: args.marca,
              model: args.modelo,
              maxPrice: args.preco_max,
              minPrice: args.preco_min,
              category: args.categoria,
              vehicleType: args.tipo,
              fuel: args.combustivel,
              transmission: args.cambio,
              maxMileage: args.km_max,
              yearMin: args.ano_min,
              yearMax: args.ano_max,
              color: args.cor,
              pagina: args.pagina,
            });
            // Extract result count from the response
            const countMatch = toolResult.match(/(\d+)\s*(ve\u00edculos?|resultados?|encontrados?)/i);
            toolResultCount = countMatch ? parseInt(countMatch[1]) : (toolResult.includes("Nenhum") ? 0 : null);
            console.log(`[AI] buscar_veiculos: ${toolResult.length} chars, ~${toolResultCount} results`);

          } else if (toolCall.function.name === "resumo_estoque") {
            parsedArgs = {};
            toolResult = await getStockSummaryForAI();
            console.log(`[AI] resumo_estoque: ${toolResult.length} chars`);

          } else if (toolCall.function.name === "atualizar_lead") {
            const rawArgs = JSON.parse(toolCall.function.arguments || "{}");
            parsedArgs = rawArgs;
            console.log(`[AI] atualizar_lead args (raw):`, JSON.stringify(rawArgs));

            // Validação server-side: só grava o que passa; inválidos voltam pro modelo
            const { cleaned: args, errors: validationErrors } = validateLeadArgs(rawArgs);
            if (validationErrors.length) {
              console.warn(`[AI] atualizar_lead rejeitou campos:`, JSON.stringify(validationErrors));
            }

            const leadUpdate: any = {
              conversationId: conversation.id,
              phone: conversation.phone,
            };

            if (args.nome) leadUpdate.name = args.nome;
            if (args.intencao) leadUpdate.intention = args.intencao;
            if (args.veiculo_interesse) leadUpdate.vehicleInterest = args.veiculo_interesse;
            // Allow null to explicitly clear vehicleId when customer changes vehicle interest
            if (args.veiculo_id !== undefined) {
              leadUpdate.vehicleId = args.veiculo_id;
              // Auto-sync vehicleInterest when vehicleId is set to a valid ID
              if (args.veiculo_id && !args.veiculo_interesse) {
                try {
                  const linkedVehicle = await getVehicleById(args.veiculo_id);
                  if (linkedVehicle) {
                    const title = linkedVehicle.title || `${linkedVehicle.brand || ""} ${linkedVehicle.model || ""}`.trim();
                    leadUpdate.vehicleInterest = title;
                    console.log(`[AI] Auto-synced vehicleInterest to "${title}" from vehicleId=${args.veiculo_id}`);
                  }
                } catch (err) {
                  console.error(`[AI] Failed to auto-sync vehicleInterest:`, err);
                }
              }
            }
            if (args.tem_troca !== undefined) leadUpdate.hasTrade = args.tem_troca;
            if (args.veiculo_troca !== undefined) leadUpdate.tradeVehicle = args.veiculo_troca;
            if (args.ano_troca) leadUpdate.tradeYear = args.ano_troca;
            if (args.km_troca) leadUpdate.tradeKm = args.km_troca;
            if (args.forma_pagamento) leadUpdate.paymentMethod = args.forma_pagamento;
            if (args.entrada) leadUpdate.downPayment = args.entrada;
            if (args.status) leadUpdate.status = args.status;
            if (args.notas) leadUpdate.notes = args.notas;
            if (args.cidade) leadUpdate.city = args.cidade;
            if (args.etapa_funil) {
              leadUpdate.funnelStatus = args.etapa_funil;
              // Carrega o mapeamento dinâmico de temperaturas configurado pelo usuário
              let tempMap: Record<string, string> = {
                novo: "frio", perdido: "frio",
                interesse_definido: "morno",
                pagamento_definido: "quente", dados_pessoais: "quente", dados_troca: "quente",
                encaminhado_vendedor: "muito_quente", negociando: "muito_quente", fechado: "muito_quente",
              };
              try {
                const rawCrmConfig = await getSetting("ai_crm_config");
                if (rawCrmConfig) {
                  const parsedConfig = JSON.parse(rawCrmConfig);
                  if (parsedConfig.temperatureMap) {
                    tempMap = { ...tempMap, ...parsedConfig.temperatureMap };
                  }
                }
              } catch { /* fallback padrao */ }
              leadUpdate.temperature = tempMap[args.etapa_funil] || "frio";
            }

            try {
              await upsertLead(leadUpdate);
              collectedLeadData = args;
              const errNote = formatValidationErrors(validationErrors);
              toolResult = errNote ? `Lead atualizado (parcial). ${errNote}` : "Lead atualizado com sucesso.";
              console.log(`[AI] Lead updated for conversation ${conversation.id}`);
            } catch (leadErr) {
              console.error("[AI] Failed to update lead:", leadErr);
              toolResult = "Erro ao atualizar lead.";
              toolSuccess = false;
              toolErrorMsg = leadErr instanceof Error ? leadErr.message : "Erro desconhecido";
            }
          } else if (toolCall.function.name === "buscar_veiculo_por_id") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            parsedArgs = args;
            console.log(`[AI] buscar_veiculo_por_id args:`, JSON.stringify(args));
            if (args.id) {
              const vehicleResult = await getVehicleByIdForAI(args.id);
              toolResult = vehicleResult.text;
              toolResultCount = vehicleResult.found ? 1 : 0;
              console.log(`[AI] buscar_veiculo_por_id: found=${vehicleResult.found}`);
            } else {
              toolResult = "ID do veículo não fornecido.";
              toolResultCount = 0;
            }

          } else if (toolCall.function.name === "apresentar_veiculo") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            parsedArgs = args;
            console.log(`[AI] apresentar_veiculo args:`, JSON.stringify(args));
            if (args.veiculo_id) {
              const vehicleResult = await getVehicleByIdForAI(args.veiculo_id);
              if (vehicleResult.found && vehicleResult.vehicle) {
                const v = vehicleResult.vehicle;
                // Get the first image URL
                let photoUrl = v.imageUrl || "";
                if (!photoUrl && v.images && Array.isArray(v.images) && v.images.length > 0) {
                  photoUrl = v.images[0]?.IMAGE_URL || v.images[0]?.url || v.images[0] || "";
                }
                
                // Build caption with vehicle info
                const priceStr = v.promotionPrice && v.promotionPrice < v.price
                  ? `R$ ${v.price.toLocaleString("pt-BR")} (promoção: R$ ${v.promotionPrice.toLocaleString("pt-BR")})`
                  : `R$ ${v.price.toLocaleString("pt-BR")}`;
                const mileageStr = v.mileage ? `${v.mileage.toLocaleString("pt-BR")} km` : "N/I";
                const transStr = v.transmission === "automatic" ? "Automático" : v.transmission === "manual" ? "Manual" : v.transmission || "";
                
                // Campos a exibir (config do nó "Apresentar com IA"). Vazio = todos.
                const wanted: string[] = Array.isArray(args.campos) && args.campos.length > 0 ? args.campos : ["titulo", "ano", "km", "cambio", "combustivel", "cor", "preco", "link"];
                const show = (k: string) => wanted.includes(k);
                let caption = "";
                if (args.mensagem_adicional) {
                  caption += args.mensagem_adicional + "\n\n";
                }
                if (show("titulo")) caption += `${v.title || `${v.brand} ${v.model}`}\n`;
                if (show("ano")) caption += `Ano: ${v.year}\n`;
                if (show("km")) caption += `Km: ${mileageStr}\n`;
                if (show("cambio")) caption += `Câmbio: ${transStr}\n`;
                if (show("combustivel")) caption += `Combustível: ${v.fuel || "N/I"}\n`;
                if (show("cor")) caption += `Cor: ${v.color || "N/I"}\n`;
                if (show("preco")) caption += `Preço: ${priceStr}\n`;
                caption = caption.replace(/\n$/, "");
                if (show("link") && v.url) {
                  caption += `\n\nVeja mais: ${v.url}`;
                }
                
                if (photoUrl) {
                  // Queue image message for sending
                  interactiveMessages.push({
                    type: "image",
                    body: caption,
                    imageUrl: photoUrl,
                    caption: caption,
                  });
                  toolResult = `Veículo ${v.title || v.brand + " " + v.model} apresentado com foto e informações. A imagem será enviada ao cliente. NÃO repita as informações do veículo na sua resposta de texto, pois já estão na foto.`;
                  toolResultCount = 1;
                  console.log(`[AI] Vehicle image queued: ${photoUrl.substring(0, 80)}...`);
                } else {
                  // No photo available, return text only
                  toolResult = `Veículo encontrado mas sem foto disponível. Dados: ${vehicleResult.text}`;
                  toolResultCount = 1;
                  console.log(`[AI] Vehicle found but no photo available`);
                }
              } else {
                toolResult = vehicleResult.text;
                toolResultCount = 0;
              }
            } else {
              toolResult = "ID do veículo não fornecido.";
              toolResultCount = 0;
              toolSuccess = false;
            }

          } else if (toolCall.function.name === "enviar_botoes") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            parsedArgs = args;
            console.log(`[AI] enviar_botoes args:`, JSON.stringify(args));
            if (args.texto && args.botoes && Array.isArray(args.botoes) && args.botoes.length > 0) {
              const buttons = args.botoes.slice(0, 3).map((b: any) => ({
                id: b.id || `btn_${Math.random().toString(36).slice(2, 8)}`,
                title: (b.titulo || b.title || "").substring(0, 20),
              }));
              interactiveMessages.push({
                type: "buttons",
                body: args.texto,
                buttons,
                header: args.cabecalho,
                footer: args.rodape,
              });
              toolResult = `Botões interativos preparados: ${buttons.map((b: any) => b.title).join(", ")}. Serão enviados após sua resposta de texto.`;
              console.log(`[AI] Interactive buttons queued: ${buttons.length} buttons`);
            } else {
              toolResult = "Erro: texto e botoes são obrigatórios.";
              toolSuccess = false;
            }

          } else if (toolCall.function.name === "enviar_lista") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            parsedArgs = args;
            console.log(`[AI] enviar_lista args:`, JSON.stringify(args));
            if (args.texto && args.texto_botao && args.secoes && Array.isArray(args.secoes)) {
              const sections = args.secoes.map((s: any) => ({
                title: (s.titulo || "").substring(0, 24),
                rows: (s.itens || []).map((item: any) => ({
                  id: item.id || `item_${Math.random().toString(36).slice(2, 8)}`,
                  title: (item.titulo || "").substring(0, 24),
                  description: item.descricao ? item.descricao.substring(0, 72) : undefined,
                })),
              }));
              interactiveMessages.push({
                type: "list",
                body: args.texto,
                buttonText: args.texto_botao,
                sections,
                header: args.cabecalho,
                footer: args.rodape,
              });
              const totalItems = sections.reduce((sum: number, s: any) => sum + s.rows.length, 0);
              toolResult = `Lista interativa preparada com ${totalItems} itens. Será enviada após sua resposta de texto.`;
              console.log(`[AI] Interactive list queued: ${totalItems} items in ${sections.length} sections`);
            } else {
              toolResult = "Erro: texto, texto_botao e secoes são obrigatórios.";
              toolSuccess = false;
            }

          } else if (toolCall.function.name === "rotear_para_vendedor") {
            parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
            toolResult = "Conversa encaminhada para vendedor.";
          }
        } catch (toolError) {
          console.error(`[AI] Tool ${toolCall.function.name} error:`, toolError);
          toolResult = `Erro: ${toolError instanceof Error ? toolError.message : "erro desconhecido"}`;
          toolSuccess = false;
          toolErrorMsg = toolError instanceof Error ? toolError.message : "erro desconhecido";
        }

        // Track this decision
        toolDecisions.push({
          toolName: toolCall.function.name,
          toolArgs: parsedArgs,
          toolResultSummary: toolResult.substring(0, 500),
          resultCount: toolResultCount,
          success: toolSuccess,
          errorMessage: toolErrorMsg,
          startTime: toolStartTime,
          endTime: Date.now(),
        });

        llmMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        } as any);
      }

      // Next call with tool results
      try {
        result = await invokeLLM({
          messages: llmMessages,
          tools: activeTools,
          tool_choice: "auto",
        });
        assistantMessage = result.choices?.[0]?.message || null;
        console.log(`[AI] Follow-up - finish_reason: ${result.choices?.[0]?.finish_reason}, has_tool_calls: ${!!assistantMessage?.tool_calls?.length}`);
      } catch (followUpError) {
        console.error(`[AI] Follow-up LLM call failed:`, followUpError);
        try {
          result = await invokeLLM({ messages: llmMessages });
          assistantMessage = result.choices?.[0]?.message || null;
        } catch (fallbackError) {
          console.error(`[AI] Fallback LLM also failed:`, fallbackError);
          throw fallbackError;
        }
      }
    }

    // === AUTO-SEARCH FIX ===
    // If atualizar_lead was called with a new vehicle interest but buscar_veiculos was never called,
    // force a vehicle search so the customer gets results instead of "vou buscar"
    const toolCallHistory = llmMessages.filter((m: any) => m.role === 'assistant' && m.tool_calls);
    const allToolCalls = toolCallHistory.flatMap((m: any) => m.tool_calls || []);
    const calledAtualizar = allToolCalls.some((tc: any) => tc.function?.name === 'atualizar_lead');
    const calledBuscar = allToolCalls.some((tc: any) => tc.function?.name === 'buscar_veiculos');
    
    // Find the new vehicle interest from atualizar_lead calls
    let newVehicleInterest: string | null = null;
    if (calledAtualizar && !calledBuscar) {
      for (const tc of allToolCalls) {
        if (tc.function?.name === 'atualizar_lead') {
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            if (args.veiculo_interesse) {
              newVehicleInterest = args.veiculo_interesse;
            }
          } catch {}
        }
      }
    }
    
    if (newVehicleInterest && !calledBuscar) {
      console.log(`[AI] AUTO-SEARCH: atualizar_lead set vehicle interest to "${newVehicleInterest}" but buscar_veiculos was never called. Forcing search.`);
      
      // Force a vehicle search for the new interest
      const autoSearchResult = await searchVehiclesForAI({ model: newVehicleInterest });
      console.log(`[AI] AUTO-SEARCH result: ${autoSearchResult.length} chars`);
      
      // Ask the LLM to present the results
      llmMessages.push({
        role: "user",
        content: `[SISTEMA: Você atualizou o lead mas esqueceu de buscar o veículo. Aqui estão os resultados da busca automática para "${newVehicleInterest}". Apresente-os ao cliente AGORA em texto corrido, sem dizer "vou buscar":\n${autoSearchResult}]`,
      } as any);
      
      try {
        const autoResult = await invokeLLM({ messages: llmMessages, tools: activeTools, tool_choice: "auto" });
        assistantMessage = autoResult.choices?.[0]?.message || assistantMessage;
        console.log(`[AI] AUTO-SEARCH: LLM presented results successfully.`);
      } catch (autoErr) {
        console.error(`[AI] AUTO-SEARCH: Failed to present results:`, autoErr);
      }
    }

    // Extract content
    let fullResponse = "";
    if (assistantMessage?.content) {
      if (typeof assistantMessage.content === "string") {
        fullResponse = assistantMessage.content;
      } else if (Array.isArray(assistantMessage.content)) {
        fullResponse = assistantMessage.content
          .map((part: any) => {
            if (typeof part === "string") return part;
            if (part?.type === "text") return part.text;
            return "";
          })
          .join("");
      }
    }

    // Aggressively clean up markdown formatting
    fullResponse = fullResponse
      .replace(/```json[\s\S]*?```/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\{[\s\S]*?"lead_data"[\s\S]*?\}/g, "")
      .replace(/\*\*\*(.*?)\*\*\*/g, "$1")  // Remove bold+italic ***text***
      .replace(/\*\*(.*?)\*\*/g, "$1")  // Remove bold **text**
      .replace(/\*(.*?)\*/g, "$1")       // Remove italic *text*
      .replace(/__(.*?)__/g, "$1")       // Remove bold __text__
      .replace(/_(.*?)_/g, "$1")         // Remove italic _text_
      .replace(/^#{1,6}\s+/gm, "")       // Remove headers # ## ###
      .replace(/^[\s]*[-•\*]\s+/gm, "") // Remove bullet points (-, •, *)
      .replace(/^[\s]*\d+\.\s{2,}/gm, (match) => match.replace(/\s{2,}$/, " ")) // Clean double spaces after numbers
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2") // Convert [text](url) to text url
      .replace(/\[FOTO\]/gi, "")        // Remove [FOTO] markers
      .replace(/\[IMAGEM\]/gi, "")      // Remove [IMAGEM] markers
      .replace(/\[IMAGE\]/gi, "")       // Remove [IMAGE] markers
      .replace(/\[ID:\d+\]/g, "")       // Remove [ID:X] markers
      .replace(/\n{3,}/g, "\n\n")       // Max 2 consecutive newlines
      .trim();

    // Detect if response is just a "wait" message without actual vehicle data
    const waitPatterns = ["vou verificar", "só um momento", "vou buscar", "vou checar", "um momento", "aguarde", "deixa eu ver", "deixa eu buscar", "vou procurar", "vou pesquisar", "vou conferir"];
    const isWaitResponse = waitPatterns.some(p => fullResponse.toLowerCase().includes(p)) && fullResponse.length < 300;
    if (isWaitResponse) {
      console.log(`[AI] Detected wait-only response: "${fullResponse.substring(0, 80)}...". Checking if tool results are available.`);
      // Check if we have vehicle search results in the message history to re-inject
      const toolResults = llmMessages.filter((m: any) => m.role === "tool" && m.content && m.content.includes("RESULTADOS DA BUSCA"));
      if (toolResults.length > 0) {
        const lastToolResult = toolResults[toolResults.length - 1] as any;
        console.log(`[AI] Re-injecting vehicle search results into response.`);
        llmMessages.push({ role: "user", content: `[SISTEMA: Você recebeu os resultados da busca mas não os incluiu na resposta. Aqui estão os resultados novamente. Apresente-os ao cliente AGORA em texto corrido:\n${lastToolResult.content}]` });
        try {
          const retryResult = await invokeLLM({ messages: llmMessages });
          const retryContent = retryResult.choices?.[0]?.message?.content;
          if (retryContent && typeof retryContent === "string" && retryContent.length > fullResponse.length) {
            fullResponse = retryContent
              .replace(/\*\*\*(.*?)\*\*\*/g, "$1")
              .replace(/\*\*(.*?)\*\*/g, "$1")
              .replace(/\*(.*?)\*/g, "$1")
              .replace(/__(.*?)__/g, "$1")
              .replace(/_(.*?)_/g, "$1")
              .replace(/^#{1,6}\s+/gm, "")
              .replace(/^[\s]*[-•\*]\s+/gm, "")
              .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
            console.log(`[AI] Successfully re-generated response with vehicle data.`);
          }
        } catch (retryErr) {
          console.error(`[AI] Failed to re-generate response:`, retryErr);
        }
      }
    }

    if (!fullResponse) {
      fullResponse = "Desculpe, não consegui processar sua mensagem. Pode repetir?";
    }

    // Log AI interaction
    const responseTime = Date.now() - startTime;
    const usage = result.usage;
    try {
      await createAiLog({
        conversationId: conversation.id,
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        totalTokens: usage?.total_tokens || 0,
        responseTimeMs: responseTime,
        toolUsed: assistantMessage?.tool_calls?.length ? "tool_calls" : "none",
        success: true,
      });
    } catch (logErr) {
      console.error("[AI] Failed to log AI interaction:", logErr);
    }

    // Log AI decisions (tool calls) for audit
    if (toolDecisions.length > 0) {
      try {
        const decisionRecords = toolDecisions.map(d => ({
          conversationId: conversation.id,
          toolName: d.toolName,
          toolArgs: d.toolArgs,
          toolResultSummary: d.toolResultSummary,
          resultCount: d.resultCount,
          success: d.success,
          errorMessage: d.errorMessage,
          responseTimeMs: d.endTime - d.startTime,
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0,
          totalTokens: usage?.total_tokens || 0,
          model: result.model || null,
          customerMessage: customerMessage.substring(0, 500),
          aiResponse: fullResponse.substring(0, 500),
        }));
        await createAiDecisionsBatch(decisionRecords);
        console.log(`[AI] Logged ${decisionRecords.length} AI decision(s) for conversation ${conversation.id}`);
      } catch (decisionLogErr) {
        console.error("[AI] Failed to log AI decisions:", decisionLogErr);
      }
    }

    console.log(`[AI] Response generated in ${responseTime}ms (${usage?.total_tokens || 0} tokens)`);

    // === AUTO-GENERATE DAILY SUMMARY ===
    try {
      const lead = await getLeadByConversationId(conversation.id);
      if (lead) {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];
        // Build a quick summary from the current exchange
        const summaryParts: string[] = [];
        if (customerMessage) summaryParts.push(`Cliente: ${customerMessage.substring(0, 200)}`);
        if (fullResponse) summaryParts.push(`Resposta: ${fullResponse.substring(0, 200)}`);
        if (collectedLeadData) {
          const ld = collectedLeadData as any;
          if (ld.veiculo_interesse) summaryParts.push(`Interesse: ${ld.veiculo_interesse}`);
          if (ld.forma_pagamento) summaryParts.push(`Pagamento: ${ld.forma_pagamento}`);
          if (ld.veiculo_troca) summaryParts.push(`Troca: ${ld.veiculo_troca}`);
          if (ld.cidade) summaryParts.push(`Cidade: ${ld.cidade}`);
        }
        const quickSummary = summaryParts.join(" | ");
        // Upsert: append to existing day summary or create new
        const { leadSummaries: summariesTable } = await import("../drizzle/schema");
        const { getDb } = await import("./db");
        const db = await getDb();
        if (db) {
          const { eq, and: andOp } = await import("drizzle-orm");
          const existing = await db.select().from(summariesTable)
            .where(andOp(eq(summariesTable.leadId, lead.id), eq(summariesTable.summaryDate, todayStr)))
            .limit(1);
          if (existing[0]) {
            // Append to existing summary
            const updatedSummary = existing[0].summary + "\n" + quickSummary;
            const newCount = (existing[0].messageCount || 0) + 1;
            await db.update(summariesTable).set({ summary: updatedSummary, messageCount: newCount }).where(eq(summariesTable.id, existing[0].id));
          } else {
            await upsertLeadSummary({
              leadId: lead.id,
              conversationId: conversation.id,
              summaryDate: todayStr,
              summary: quickSummary,
              messageCount: 1,
            });
          }
        }
      }
    } catch (summaryErr) {
      console.error("[AI] Failed to generate daily summary:", summaryErr);
    }

    return { response: fullResponse, leadData: collectedLeadData, interactiveMessages: interactiveMessages.length > 0 ? interactiveMessages : undefined };

  } catch (error) {
    console.error("[AI] Error processing message:", error);

    const responseTime = Date.now() - startTime;
    try {
      await createAiLog({
        conversationId: conversation.id,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        responseTimeMs: responseTime,
        toolUsed: "none",
        success: false,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    } catch (logErr) {
      console.error("[AI] Failed to log error:", logErr);
    }

    return {
      response: "Desculpe, estou com uma instabilidade no momento. Um atendente humano será notificado para continuar seu atendimento.",
      leadData: null,
    };
  }
}
