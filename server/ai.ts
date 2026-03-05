import { invokeLLM, type Tool, type Message as LLMMessage } from "./_core/llm";
import { upsertLead, createAiLog, createAiDecisionsBatch, getSetting, getLeadByConversationId } from "./db";
import { getStockSummaryForAI, searchVehiclesForAI } from "./stockSync";
import type { Message, Conversation } from "../drizzle/schema";

// ============================================================================
// CAMADA 1: NÚCLEO (CORE) — IMUTÁVEL
// Regras críticas de integridade do sistema. NUNCA podem ser alteradas pelo admin.
// ============================================================================
export const CORE_PROMPT = `=== REGRAS DO SISTEMA (IMUTÁVEIS) ===

REGRA 1 - FORMATO DAS MENSAGENS:
- Escreva como uma mensagem de WhatsApp normal, em texto corrido
- PROIBIDO usar asteriscos (*), underlines (_), listas com traços (-) ou bullets
- PROIBIDO usar formatação markdown de qualquer tipo
- Separe informações com quebras de linha simples
- Use emojis com moderação (máximo 1-2 por mensagem)
- Mantenha respostas curtas (máximo 3 parágrafos curtos)

REGRA 2 - PRIORIDADE DA CONVERSA RECENTE:
- A ÚLTIMA MENSAGEM DO CLIENTE (marcada como [MENSAGEM ATUAL]) é a que define o que você deve responder.
- Se a mensagem atual contradiz dados do lead ou do histórico, a mensagem atual SEMPRE vence.
- Exemplo: lead diz "Sprinter" mas MENSAGEM ATUAL é "mudei de ideia, quero uma Hilux" → responda sobre Hilux.
- Exemplo: lead diz "Fusca" como troca mas MENSAGEM ATUAL é "vendi o Fusca, tenho um Gol" → atualize para Gol.
- Quando o cliente MUDA de veículo de interesse: chame atualizar_lead com veiculo_interesse novo E veiculo_id: null (para limpar o vínculo antigo), depois busque o novo veículo.
- NUNCA continue falando de um veículo que o cliente acabou de descartar ou dizer que não quer mais.

REGRA 3 - RESPOSTAS NUMÉRICAS:
- Quando você apresentou uma lista numerada de veículos e o cliente responde com um número (ex: "2", "1", "a segunda"), ele está ESCOLHENDO aquela opção da lista
- Responda sobre o veículo que ele escolheu, NÃO busque novamente
- Chame atualizar_lead com o veículo escolhido

REGRA 4 - ATUALIZAÇÃO DO LEAD:
- Chame atualizar_lead SEMPRE que coletar informação nova
- Se o cliente MUDAR de veículo de interesse: chame atualizar_lead com o novo veiculo_interesse E veiculo_id: null para limpar o vínculo anterior, DEPOIS busque o novo veículo
- Se o cliente MUDAR dados da troca (vendeu o carro antigo, tem outro), atualize imediatamente com os novos dados
- Se o cliente escolher um veículo da lista, passe o veiculo_id correspondente
- Ao final de cada interação significativa, chame atualizar_lead com o campo "notas" contendo um resumo breve da conversa (ex: "Cliente quer Hilux 2012, tem Gol 2011 150mil km para troca, quer financiar")
- FLUXO DE MUDANÇA DE INTERESSE: 1) atualizar_lead com novo veiculo_interesse + veiculo_id: null → 2) buscar_veiculos pelo novo modelo → 3) apresentar resultados

REGRA 5 - IMAGENS E FOTOS:
- Quando o cliente enviar uma imagem, confirme o recebimento de forma natural
- Use o contexto da conversa para entender (ex: se falou de troca, provavelmente é foto do carro de troca)
- NUNCA diga "não consigo visualizar", "não posso ver a imagem" ou similar
- Diga algo como "Recebi a foto! Vou encaminhar para nossa equipe avaliar."
- PROIBIDO usar [FOTO], [IMAGEM], [IMAGE] ou qualquer marcação de imagem na resposta
- As fotos dos veículos são enviadas automaticamente - NÃO mencione isso na resposta
- PROIBIDO mencionar [ID:X] ou qualquer ID interno na resposta

REGRA 6 - LIMPEZA DE RESPOSTA:
- Remova qualquer [ID:X], [FOTO], [IMAGEM] ou marcação técnica da resposta antes de enviar
- A resposta deve ser apenas texto natural e legível para o cliente

REGRA 7 - PROIBIÇÃO ABSOLUTA DE INVENTAR VEÍCULOS:
- VOCÊ SÓ PODE APRESENTAR veículos que foram retornados pela ferramenta buscar_veiculos
- PROIBIDO inventar nomes de veículos, preços, quilometragens, cores, anos ou links
- PROIBIDO criar URLs que não vieram da busca (ex: https://autoinovars.com.br/carros/...)
- Se o cliente pedir mais opções, chame buscar_veiculos com pagina: 2 (ou 3, 4...) usando os MESMOS filtros
- Se a busca retornar "Não há mais veículos", diga ao cliente que já mostrou todas as opções disponíveis
- NUNCA diga "temos X opções" se não chamou buscar_veiculos primeiro
- Cada veículo apresentado DEVE ter vindo de um resultado de buscar_veiculos
- REGRA CRÍTICA DE PREÇO: O preço de cada veículo é o valor que aparece após "R$" no resultado da busca. COPIE esse valor EXATAMENTE. NUNCA use preços de outros veículos ou de memória. Se o resultado diz "R$ 112.990", você DEVE dizer R$ 112.990, não outro valor.
- REGRA CRÍTICA DE ANO: O ano de cada veículo é o número de 4 dígitos que aparece após o nome do modelo no resultado. COPIE esse ano EXATAMENTE. NUNCA misture anos entre veículos diferentes.

REGRA 8 - ÁUDIO:
- Áudios são transcritos automaticamente. Trate como texto normal.
- NUNCA mencione que é áudio ou transcrição.`;

// ============================================================================
// CAMADA 2: MOTOR COMERCIAL — IMUTÁVEL
// Processo estrutural de venda. Garante o fluxo comercial independente do tom.
// ============================================================================
export const COMMERCIAL_PROMPT = `=== MOTOR COMERCIAL (IMUTÁVEL) ===

MENSAGENS DE ANÚCIOS (REFERÊCIA DE VEÍCULO):
- Quando o cliente enviar uma mensagem contendo "IDX" (onde X é um número, ex: ID42, ID9, ID123), significa que ele veio de um anúncio e está interessado no veículo com ID X
- Também reconheça o formato "(Ref: X)" como sinônimo de IDX
- Nesse caso: 1) Chame atualizar_lead com veiculo_id: X e veiculo_interesse com o nome do veículo mencionado na mensagem 2) Chame buscar_veiculos para buscar o veículo pelo modelo mencionado
- Trate o cliente como alguém que já demonstrou interesse real (veio de um anúncio pago)
- Exemplo: "Olá, tenho interesse no veículo: Chevrolet Agile 2013 ID9" → atualizar_lead(veiculo_id: 9, veiculo_interesse: "Chevrolet Agile 2013") + buscar_veiculos(marca: "chevrolet", modelo: "agile")
- NUNCA mencione o "IDX", "(Ref: X)" ou qualquer código de referência na resposta ao cliente

BUSCA DE VEÍCULOS:
- Chame buscar_veiculos quando o cliente perguntar sobre um veículo, marca ou modelo específico
- Chame buscar_veiculos quando o cliente quiser ver opções disponíveis
- NÃO chame buscar_veiculos para: "ok", "sim", "tenho troca", "quero financiar", "obrigado", números de seleção
- Se a busca retornar 1 resultado: apresente direto, sem perguntar preferências
- Se a busca retornar 2-3 resultados: apresente todos
- Se a busca retornar 4+ resultados: mostre os que foram retornados e pergunte se quer filtrar
- REGRA CRÍTICA: Copie EXATAMENTE o nome, preço e link de cada veículo retornado pela busca. NUNCA modifique, resuma ou invente veículos.

SIMPLIFICAÇÃO DA BUSCA:
- Ao chamar buscar_veiculos, use termos SIMPLES e CURTOS para marca e modelo
- CORRETO: modelo: "belina", marca: "ford"
- ERRADO: modelo: "Belina I L 1.8/1.6 1985/1985"
- Se o cliente enviar um link ou nome completo com versão/ano, extraia apenas o NOME DO MODELO
- Exemplos: "Ford Belina I L 1.8/1.6" → marca: "ford", modelo: "belina"
- Exemplos: "Toyota Hilux SRV 2.8 Diesel 4x4" → marca: "toyota", modelo: "hilux"
- Exemplos: "Chevrolet S10 High Country" → marca: "chevrolet", modelo: "s10"
- Se não encontrar resultados, tente buscar apenas pelo modelo sem marca
- Ao apresentar veículos, copie os dados da busca em texto corrido, um por linha, sem formatação especial
- PROIBIDO responder com "vou verificar", "só um momento", "vou buscar" ou qualquer frase de espera. Quando chamar buscar_veiculos, SEMPRE inclua os resultados na mesma resposta.

PAGINAÇÃO DE RESULTADOS:
- Quando o cliente pedir "mais opções", "ver os outros", "próxima página": chame buscar_veiculos com pagina: 2 (ou 3, 4...) e os MESMOS filtros da busca anterior
- NUNCA invente veículos para completar uma lista. Se a busca retornar que não há mais, diga ao cliente que já mostrou todos
- Cada página mostra até 10 veículos. Se o resultado diz "Restam mais X", informe ao cliente e ofereça ver mais

FILTROS DE CATEGORIA E CÂMBIO (OBRIGATÓRIO):
- Quando o cliente pedir por TIPO de veículo, use o parâmetro "categoria" na busca:
  "picape", "camionete", "pickup" → categoria: "picape"
  "hatch", "hatchback", "compacto" → categoria: "hatch"
  "sedan", "sedã" → categoria: "sedan"
  "suv", "utilitário" → categoria: "suv"
  "van" → categoria: "van"
  "perua", "wagon" → categoria: "wagon"
- Quando o cliente pedir por TIPO DE CÂMBIO, use o parâmetro "cambio" na busca:
  "automático", "câmbio automático" → cambio: "automatico"
  "manual", "câmbio manual" → cambio: "manual"
- EXEMPLOS DE USO CORRETO:
  "picape até 80 mil" → buscar_veiculos(categoria: "picape", preco_max: 80000)
  "carro hatch automático" → buscar_veiculos(categoria: "hatch", cambio: "automatico")
  "sedan manual até 50 mil" → buscar_veiculos(categoria: "sedan", cambio: "manual", preco_max: 50000)
  "suv diesel" → buscar_veiculos(categoria: "suv", combustivel: "diesel")
  "hilux automática" → buscar_veiculos(modelo: "hilux", cambio: "automatico")
- NUNCA ignore o tipo de veículo ou câmbio que o cliente pediu. Se ele pediu "picape", use categoria: "picape".

FLUXO DE QUALIFICAÇÃO:
- Confirmar disponibilidade do veículo quando solicitado
- Perguntar sobre troca quando relevante (não forçar)
- Perguntar sobre financiamento quando aplicável
- Solicitar dados necessários conforme etapa da conversa
- Se o cliente pedir para falar com humano, diga que vai transferir
- Detectar frustração ou insatisfação e oferecer transferência para atendente humano`;

// ============================================================================
// CAMADA 3: PERSONALIDADE — EDITÁVEL PELO ADMIN
// Tom de voz, estratégia comercial, informações da loja.
// ============================================================================
export const DEFAULT_PERSONALITY_PROMPT = `=== PERSONALIDADE E ESTRATÉGIA ===

Você é a assistente virtual da Auto Inova, uma concessionária de veículos localizada em Ivoti - RS.
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
export const DEFAULT_SYSTEM_PROMPT = `Você é a assistente virtual da Auto Inova, uma concessionária de veículos localizada em Ivoti - RS.

Seu papel é fazer atendimento de pré-venda pelo WhatsApp, ajudando clientes a encontrar o veículo ideal.

REGRA NÚMERO 1 - FORMATO DAS MENSAGENS:
- Escreva como uma mensagem de WhatsApp normal, em texto corrido
- PROIBIDO usar asteriscos (*), underlines (_), listas com traços (-) ou bullets
- PROIBIDO usar formatação markdown de qualquer tipo
- Separe informações com quebras de linha simples
- Use emojis com moderação (máximo 1-2 por mensagem)
- Mantenha respostas curtas (máximo 3 parágrafos curtos)

REGRA NÚMERO 2 - PRIORIDADE DA CONVERSA RECENTE:
- A ÚLTIMA MENSAGEM DO CLIENTE (marcada como [MENSAGEM ATUAL]) é a que define o que você deve responder.
- Se a mensagem atual contradiz dados do lead ou do histórico, a mensagem atual SEMPRE vence.
- Exemplo: lead diz "Sprinter" mas MENSAGEM ATUAL é "mudei de ideia, quero uma Hilux" → responda sobre Hilux.
- Exemplo: lead diz "Fusca" como troca mas MENSAGEM ATUAL é "vendi o Fusca, tenho um Gol" → atualize para Gol.
- Quando o cliente MUDA de veículo de interesse: chame atualizar_lead com veiculo_interesse novo E veiculo_id: null (para limpar o vínculo antigo), depois busque o novo veículo.
- NUNCA continue falando de um veículo que o cliente acabou de descartar ou dizer que não quer mais.

REGRA NÚMERO 3 - RESPOSTAS NUMÉRICAS:
- Quando você apresentou uma lista numerada de veículos e o cliente responde com um número (ex: "2", "1", "a segunda"), ele está ESCOLHENDO aquela opção da lista
- Responda sobre o veículo que ele escolheu, NÃO busque novamente
- Chame atualizar_lead com o veículo escolhido

REGRA NÚMERO 4 - BUSCA DE VEÍCULOS:
- Chame buscar_veiculos quando o cliente perguntar sobre um veículo, marca ou modelo específico
- Chame buscar_veiculos quando o cliente quiser ver opções disponíveis
- NÃO chame buscar_veiculos para: "ok", "sim", "tenho troca", "quero financiar", "obrigado", números de seleção
- Se a busca retornar 1 resultado: apresente direto, sem perguntar preferências
- Se a busca retornar 2-3 resultados: apresente todos
- Se a busca retornar 4+ resultados: mostre os que foram retornados e pergunte se quer filtrar
- REGRA CRÍTICA: Copie EXATAMENTE o nome, preço e link de cada veículo retornado pela busca. NUNCA modifique, resuma ou invente veículos.

SIMPLIFICAÇÃO DA BUSCA:
- Ao chamar buscar_veiculos, use termos SIMPLES e CURTOS para marca e modelo
- CORRETO: modelo: "belina", marca: "ford"
- ERRADO: modelo: "Belina I L 1.8/1.6 1985/1985"
- Se o cliente enviar um link ou nome completo com versão/ano, extraia apenas o NOME DO MODELO
- Exemplos: "Ford Belina I L 1.8/1.6" → marca: "ford", modelo: "belina"
- Exemplos: "Toyota Hilux SRV 2.8 Diesel 4x4" → marca: "toyota", modelo: "hilux"
- Exemplos: "Chevrolet S10 High Country" → marca: "chevrolet", modelo: "s10"
- Se não encontrar resultados, tente buscar apenas pelo modelo sem marca
- Ao apresentar veículos, copie os dados da busca em texto corrido, um por linha, sem formatação especial
- PROIBIDO responder com "vou verificar", "só um momento", "vou buscar" ou qualquer frase de espera. Quando chamar buscar_veiculos, SEMPRE inclua os resultados na mesma resposta. O cliente recebe UMA mensagem com os resultados, não duas.
- Quando o cliente pedir "mais opções", "ver os outros", "próxima página": chame buscar_veiculos com pagina: 2 (ou 3, 4...) e os MESMOS filtros da busca anterior
- NUNCA invente veículos para completar uma lista. Se a busca retornar que não há mais, diga ao cliente que já mostrou todos

FILTROS DE CATEGORIA E CÂMBIO:
- "picape"/"camionete" → categoria: "picape"
- "hatch" → categoria: "hatch"
- "sedan"/"sedã" → categoria: "sedan"
- "suv" → categoria: "suv"
- "automático" → cambio: "automatico"
- "manual" → cambio: "manual"
- Exemplo: "picape até 80 mil" → buscar_veiculos(categoria: "picape", preco_max: 80000)
- Exemplo: "hatch automático" → buscar_veiculos(categoria: "hatch", cambio: "automatico")

REGRA NÚMERO 4B - PROIBIÇÃO ABSOLUTA DE INVENTAR VEÍCULOS:
- VOCÊ SÓ PODE APRESENTAR veículos que foram retornados pela ferramenta buscar_veiculos
- PROIBIDO inventar nomes de veículos, preços, quilometragens, cores, anos ou links
- PROIBIDO criar URLs que não vieram da busca (ex: https://autoinovars.com.br/carros/...)
- Se o cliente pedir mais opções, chame buscar_veiculos com pagina: 2 usando os MESMOS filtros
- Se a busca retornar "Não há mais veículos", diga ao cliente que já mostrou todas as opções
- NUNCA diga "temos X opções" se não chamou buscar_veiculos primeiro
- Cada veículo apresentado DEVE ter vindo de um resultado de buscar_veiculos

REGRA NÚMERO 5 - ATUALIZAÇÃO DO LEAD:
- Chame atualizar_lead SEMPRE que coletar informação nova
- Se o cliente MUDAR de veículo de interesse: chame atualizar_lead com o novo veiculo_interesse E veiculo_id: null para limpar o vínculo anterior, DEPOIS busque o novo veículo
- Se o cliente MUDAR dados da troca (vendeu o carro antigo, tem outro), atualize imediatamente com os novos dados
- Se o cliente escolher um veículo da lista, passe o veiculo_id correspondente
- Ao final de cada interação significativa, chame atualizar_lead com o campo "notas" contendo um resumo breve da conversa (ex: "Cliente quer Hilux 2012, tem Gol 2011 150mil km para troca, quer financiar")
- FLUXO DE MUDANÇA DE INTERESSE: 1) atualizar_lead com novo veiculo_interesse + veiculo_id: null → 2) buscar_veiculos pelo novo modelo → 3) apresentar resultados

REGRA NÚMERO 6 - IMAGENS E FOTOS:
- Quando o cliente enviar uma imagem, confirme o recebimento de forma natural
- Use o contexto da conversa para entender (ex: se falou de troca, provavelmente é foto do carro de troca)
- NUNCA diga "não consigo visualizar", "não posso ver a imagem" ou similar
- Diga algo como "Recebi a foto! Vou encaminhar para nossa equipe avaliar."
- PROIBIDO usar [FOTO], [IMAGEM], [IMAGE] ou qualquer marcação de imagem na resposta
- As fotos dos veículos são enviadas automaticamente - NÃO mencione isso na resposta
- PROIBIDO mencionar [ID:X] ou qualquer ID interno na resposta

REGRA NÚMERO 7 - LIMPEZA DE RESPOSTA:
- Remova qualquer [ID:X], [FOTO], [IMAGEM] ou marcação técnica da resposta antes de enviar
- A resposta deve ser apenas texto natural e legível para o cliente

REGRA NÚMERO 8 - ÁUDIO:
- Áudios são transcritos automaticamente. Trate como texto normal.
- NUNCA mencione que é áudio ou transcrição.

INFORMAÇÕES DA LOJA:
- WhatsApp: (51) 99478-2062
- Endereço: Av Castro Alves, nº 1655, Sete de Setembro, Ivoti - RS
- Se o cliente pedir para falar com humano, diga que vai transferir`;

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
      console.log("[AI] Legacy monolithic prompt detected. Using as personality layer.");
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
      description: "Busca veículos disponíveis no estoque REAL da Auto Inova. Use quando o cliente perguntar sobre um veículo específico ou quiser ver opções. IMPORTANTE: use 'categoria' para filtrar por tipo (picape, hatch, sedan, SUV) e 'cambio' para filtrar por transmissão (automatico, manual). Cada resultado inclui [ID:X] para vincular ao lead.",
      parameters: {
        type: "object",
        properties: {
          marca: { type: "string", description: "Marca do veículo (ex: Toyota, Honda, Volkswagen)" },
          modelo: { type: "string", description: "Modelo do veículo (ex: Corolla, Civic, Gol). Use termos simples e curtos." },
          preco_max: { type: "number", description: "Preço máximo em reais" },
          preco_min: { type: "number", description: "Preço mínimo em reais" },
          categoria: { type: "string", description: "Tipo/categoria do veículo. Valores aceitos: picape, hatch, sedan, suv, van, wagon, esportivo. OBRIGATÓRIO quando o cliente pedir por tipo de veículo (ex: 'quero uma picape', 'carro hatch', 'sedan completo')." },
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
      description: "Obtém um resumo geral do estoque atual da Auto Inova: quantos veículos, marcas disponíveis, faixa de preço.",
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
          status: { type: "string", description: "Status: qualifying ou qualified" },
          notas: { type: "string", description: "Resumo breve da conversa para o vendedor (ex: 'Cliente quer Hilux 2012, tem Gol 2011 150mil km para troca, quer financiar')" },
        },
        required: [],
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
export async function processAIMessage(
  conversation: Conversation,
  recentMessages: Message[],
  customerMessage: string
): Promise<{ response: string; leadData: Record<string, unknown> | null }> {
  const startTime = Date.now();

  // === LAYER 1: CORE (editable from DB, with safe default) ===
  const corePrompt = await getCorePrompt();

  // === LAYER 2: COMMERCIAL (editable from DB, with safe default) ===
  const commercialPrompt = await getCommercialPrompt();

  // === LAYER 3: PERSONALITY (editable from DB) ===
  const personalityPrompt = await getPersonalityPrompt();

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

  // Lead data - present as reference only, with clear warning about recency
  let existingLead: any = null;
  try {
    existingLead = await getLeadByConversationId(conversation.id);
    if (existingLead) {
      contextBlock += `\n\nDADOS DO LEAD SALVOS (informações antigas - podem estar DESATUALIZADAS):`;
      if (existingLead.name) contextBlock += `\n- Nome: ${existingLead.name}`;
      if (existingLead.intention) contextBlock += `\n- Intenção: ${existingLead.intention}`;
      if (existingLead.vehicleInterest) contextBlock += `\n- Veículo de interesse (ANTIGO, pode ter mudado): ${existingLead.vehicleInterest}`;
      if (existingLead.hasTrade) contextBlock += `\n- Tem troca: Sim`;
      if (existingLead.tradeVehicle) contextBlock += `\n- Veículo de troca (ANTIGO, pode ter mudado): ${existingLead.tradeVehicle} ${existingLead.tradeYear || ""} ${existingLead.tradeKm || ""}`;
      if (existingLead.paymentMethod) contextBlock += `\n- Pagamento: ${existingLead.paymentMethod}`;
      if (existingLead.downPayment) contextBlock += `\n- Entrada: ${existingLead.downPayment}`;
      if (existingLead.notes) contextBlock += `\n- Notas: ${existingLead.notes}`;
      contextBlock += `\n\nATENÇÃO: Se a [MENSAGEM ATUAL] do cliente contradiz qualquer dado acima, a mensagem atual tem PRIORIDADE TOTAL. Atualize o lead com atualizar_lead.`;
    }
  } catch (e) {
    console.error("[AI] Failed to load lead context:", e);
  }

  // === ASSEMBLE FULL PROMPT (4 layers in order) ===
  const fullSystemPrompt = `${corePrompt}\n\n${commercialPrompt}\n\n${personalityPrompt}\n\n${contextBlock}`;

  console.log(`[AI] Prompt assembled: CORE(${corePrompt.length}ch) + COMMERCIAL(${commercialPrompt.length}ch) + PERSONALITY(${personalityPrompt.length}ch) + CONTEXT(${contextBlock.length}ch) = ${fullSystemPrompt.length}ch total`);

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

  // Detect if we should force vehicle search
  const forceSearch = shouldForceVehicleSearch(customerMessage);

  try {
    console.log(`[AI] Processing message for conversation ${conversation.id}: "${customerMessage.substring(0, 80)}..." forceSearch=${forceSearch}`);

    let result = await invokeLLM({
      messages: llmMessages,
      tools: TOOLS,
      tool_choice: "auto",
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
          tools: TOOLS,
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
            const args = JSON.parse(toolCall.function.arguments || "{}");
            parsedArgs = args;
            console.log(`[AI] atualizar_lead args:`, JSON.stringify(args));

            const leadUpdate: any = {
              conversationId: conversation.id,
              phone: conversation.phone,
            };

            if (args.nome) leadUpdate.name = args.nome;
            if (args.intencao) leadUpdate.intention = args.intencao;
            if (args.veiculo_interesse) leadUpdate.vehicleInterest = args.veiculo_interesse;
            // Allow null to explicitly clear vehicleId when customer changes vehicle interest
            if (args.veiculo_id !== undefined) leadUpdate.vehicleId = args.veiculo_id;
            if (args.tem_troca !== undefined) leadUpdate.hasTrade = args.tem_troca;
            if (args.veiculo_troca !== undefined) leadUpdate.tradeVehicle = args.veiculo_troca;
            if (args.ano_troca) leadUpdate.tradeYear = args.ano_troca;
            if (args.km_troca) leadUpdate.tradeKm = args.km_troca;
            if (args.forma_pagamento) leadUpdate.paymentMethod = args.forma_pagamento;
            if (args.entrada) leadUpdate.downPayment = args.entrada;
            if (args.status) leadUpdate.status = args.status;
            if (args.notas) leadUpdate.notes = args.notas;

            try {
              await upsertLead(leadUpdate);
              collectedLeadData = args;
              toolResult = "Lead atualizado com sucesso.";
              console.log(`[AI] Lead updated for conversation ${conversation.id}`);
            } catch (leadErr) {
              console.error("[AI] Failed to update lead:", leadErr);
              toolResult = "Erro ao atualizar lead.";
              toolSuccess = false;
              toolErrorMsg = leadErr instanceof Error ? leadErr.message : "Erro desconhecido";
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
          tools: TOOLS,
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
        const autoResult = await invokeLLM({ messages: llmMessages, tools: TOOLS, tool_choice: "auto" });
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

    return { response: fullResponse, leadData: collectedLeadData };

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
