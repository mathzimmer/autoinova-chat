import { invokeLLM, type Tool, type Message as LLMMessage } from "./_core/llm";
import { upsertLead, createAiLog, getSetting, getLeadByConversationId } from "./db";
import { getStockSummaryForAI, searchVehiclesForAI } from "./stockSync";
import type { Message, Conversation } from "../drizzle/schema";

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
- A mensagem mais recente do cliente é o que importa. Responda a ELA.
- Se o cliente disse algo nas últimas mensagens que contradiz dados antigos, CONFIE na mensagem recente
- Exemplo: se o lead diz "Fusca" como troca mas o cliente acabou de dizer "vendi o Fusca, agora tenho um Gol", o correto é Gol
- Exemplo: se o lead diz "Sprinter" como interesse mas o cliente acabou de pedir "Hilux", o correto é Hilux
- SEMPRE atualize o lead (via atualizar_lead) quando o cliente corrigir ou mudar qualquer informação

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
- Se a busca retornar 4+ resultados: mostre os mais relevantes
- NUNCA invente veículos. Só apresente o que a busca retornou.
- Ao apresentar veículos, use este formato (sem markdown):
  Opção 1: [Marca Modelo Versão] - [Ano]
  Cor: [cor] | KM: [km] | Câmbio: [câmbio]
  Preço: R$ [preço]
  Veja mais: [link]

REGRA NÚMERO 5 - ATUALIZAÇÃO DO LEAD:
- Chame atualizar_lead SEMPRE que coletar informação nova
- Se o cliente MUDAR de veículo de interesse, atualize imediatamente
- Se o cliente MUDAR dados da troca (vendeu o carro antigo, tem outro), atualize imediatamente
- Se o cliente escolher um veículo da lista, passe o veiculo_id correspondente

REGRA NÚMERO 6 - IMAGENS:
- Quando o cliente enviar uma imagem, confirme o recebimento de forma natural
- Use o contexto da conversa para entender (ex: se falou de troca, provavelmente é foto do carro de troca)
- NUNCA diga "não consigo visualizar", "não posso ver a imagem" ou similar
- Diga algo como "Recebi a foto! Vou encaminhar para nossa equipe avaliar."

REGRA NÚMERO 7 - ÁUDIO:
- Áudios são transcritos automaticamente. Trate como texto normal.
- NUNCA mencione que é áudio ou transcrição.

INFORMAÇÕES DA LOJA:
- WhatsApp: (51) 99478-2062
- Endereço: Av Castro Alves, nº 1655, Sete de Setembro, Ivoti - RS
- Se o cliente pedir para falar com humano, diga que vai transferir`;

/**
 * Get the current system prompt - from database if customized, otherwise default.
 */
export async function getSystemPrompt(): Promise<string> {
  try {
    const customPrompt = await getSetting("ai_prompt");
    if (customPrompt && customPrompt.trim().length > 0) {
      return customPrompt;
    }
  } catch (e) {
    console.error("[AI] Failed to load custom prompt, using default:", e);
  }
  return DEFAULT_SYSTEM_PROMPT;
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
  "fusca", "kombi", "brasilia", "variant", "passat",
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
];

/**
 * Detect if the message is about a specific vehicle and should trigger a search.
 * Does NOT trigger for generic messages, trade-in info, or numeric selections.
 */
function shouldForceVehicleSearch(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Don't force search for very short messages (likely selections like "1", "2", "sim", "ok")
  if (lower.trim().length <= 3) return false;
  
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
      description: "Busca veículos disponíveis no estoque REAL da Auto Inova. Use quando o cliente perguntar sobre um veículo específico ou quiser ver opções. Cada resultado inclui [ID:X] para vincular ao lead.",
      parameters: {
        type: "object",
        properties: {
          marca: { type: "string", description: "Marca do veículo (ex: Toyota, Honda, Volkswagen)" },
          modelo: { type: "string", description: "Modelo do veículo (ex: Corolla, Civic, Gol)" },
          preco_max: { type: "number", description: "Preço máximo em reais" },
          preco_min: { type: "number", description: "Preço mínimo em reais" },
          categoria: { type: "string", description: "Categoria: SUV, Sedan, Hatch, Picapes, etc" },
          combustivel: { type: "string", description: "Combustível: flex, gasolina, diesel, elétrico, híbrido" },
          cambio: { type: "string", description: "Câmbio: manual ou automatico" },
          km_max: { type: "number", description: "Quilometragem máxima" },
          ano_min: { type: "number", description: "Ano mínimo" },
          ano_max: { type: "number", description: "Ano máximo" },
          cor: { type: "string", description: "Cor do veículo" },
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
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Process a customer message through the AI agent and return the response.
 */
export async function processAIMessage(
  conversation: Conversation,
  recentMessages: Message[],
  customerMessage: string
): Promise<{ response: string; leadData: Record<string, unknown> | null }> {
  const startTime = Date.now();

  // Load the current system prompt (custom from DB or default)
  const systemPrompt = await getSystemPrompt();

  // Build contextual memory: customer info, lead data, conversation state
  let contextBlock = "";

  // Customer identity
  const customerName = conversation.contactName || null;
  if (customerName) {
    contextBlock += `\nNOME DO CLIENTE: ${customerName}`;
  }
  contextBlock += `\nTELEFONE: ${conversation.phone}`;

  // Contact notes from CRM
  if ((conversation as any).contactNotes) {
    contextBlock += `\nOBSERVAÇÕES: ${(conversation as any).contactNotes}`;
  }

  // Lead data - present as reference only, with clear warning about recency
  let existingLead: any = null;
  try {
    existingLead = await getLeadByConversationId(conversation.id);
    if (existingLead) {
      contextBlock += `\n\nDADOS DO LEAD (podem estar desatualizados - CONFIE nas mensagens recentes do cliente):`;
      if (existingLead.name) contextBlock += `\n- Nome: ${existingLead.name}`;
      if (existingLead.intention) contextBlock += `\n- Intenção: ${existingLead.intention}`;
      if (existingLead.vehicleInterest) contextBlock += `\n- Veículo de interesse: ${existingLead.vehicleInterest} (ATENÇÃO: pode ter mudado, verifique as mensagens recentes)`;
      if (existingLead.hasTrade) contextBlock += `\n- Tem troca: Sim`;
      if (existingLead.tradeVehicle) contextBlock += `\n- Veículo de troca: ${existingLead.tradeVehicle} ${existingLead.tradeYear || ""} ${existingLead.tradeKm || ""} (ATENÇÃO: pode ter mudado)`;
      if (existingLead.paymentMethod) contextBlock += `\n- Pagamento: ${existingLead.paymentMethod}`;
      if (existingLead.downPayment) contextBlock += `\n- Entrada: ${existingLead.downPayment}`;
      contextBlock += `\n\nSe o cliente disser algo diferente dos dados acima, ATUALIZE o lead com atualizar_lead.`;
    }
  } catch (e) {
    console.error("[AI] Failed to load lead context:", e);
  }

  // Build full system prompt with context
  const fullSystemPrompt = contextBlock
    ? `${systemPrompt}\n\n--- CONTEXTO ---${contextBlock}`
    : systemPrompt;

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

  // Add current message
  const imageMatch = customerMessage.match(/\[IMAGEM: https?:\/\/[^\]]+\]\s*(.*)/);
  if (imageMatch) {
    const caption = imageMatch[1]?.trim() || "";
    llmMessages.push({ role: "user", content: `[Cliente enviou uma imagem]${caption ? " " + caption : ""}` });
  } else {
    llmMessages.push({ role: "user", content: customerMessage });
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
      retryMessages.push({
        role: "user",
        content: "[SISTEMA: O cliente mencionou um veículo. Chame buscar_veiculos AGORA antes de responder.]",
      });
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

        try {
          if (toolCall.function.name === "buscar_veiculos") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
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
            });
            console.log(`[AI] buscar_veiculos: ${toolResult.length} chars`);

          } else if (toolCall.function.name === "resumo_estoque") {
            toolResult = await getStockSummaryForAI();
            console.log(`[AI] resumo_estoque: ${toolResult.length} chars`);

          } else if (toolCall.function.name === "atualizar_lead") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            console.log(`[AI] atualizar_lead args:`, JSON.stringify(args));

            const leadUpdate: any = {
              conversationId: conversation.id,
              phone: conversation.phone,
            };

            if (args.nome) leadUpdate.name = args.nome;
            if (args.intencao) leadUpdate.intention = args.intencao;
            if (args.veiculo_interesse) leadUpdate.vehicleInterest = args.veiculo_interesse;
            if (args.veiculo_id) leadUpdate.vehicleId = args.veiculo_id;
            if (args.tem_troca !== undefined) leadUpdate.hasTrade = args.tem_troca;
            if (args.veiculo_troca) leadUpdate.tradeVehicle = args.veiculo_troca;
            if (args.ano_troca) leadUpdate.tradeYear = args.ano_troca;
            if (args.km_troca) leadUpdate.tradeKm = args.km_troca;
            if (args.forma_pagamento) leadUpdate.paymentMethod = args.forma_pagamento;
            if (args.entrada) leadUpdate.downPayment = args.entrada;
            if (args.status) leadUpdate.status = args.status;

            try {
              await upsertLead(leadUpdate);
              collectedLeadData = args;
              toolResult = "Lead atualizado com sucesso.";
              console.log(`[AI] Lead updated for conversation ${conversation.id}`);
            } catch (leadErr) {
              console.error("[AI] Failed to update lead:", leadErr);
              toolResult = "Erro ao atualizar lead.";
            }
          }
        } catch (toolError) {
          console.error(`[AI] Tool ${toolCall.function.name} error:`, toolError);
          toolResult = `Erro: ${toolError instanceof Error ? toolError.message : "erro desconhecido"}`;
        }

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

    // Clean up markdown formatting that the model might still use
    fullResponse = fullResponse
      .replace(/```json[\s\S]*?```/g, "")
      .replace(/\{[\s\S]*?"lead_data"[\s\S]*?\}/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")  // Remove bold **text**
      .replace(/\*(.*?)\*/g, "$1")       // Remove italic *text*
      .replace(/^[\s]*[-•]\s/gm, "")     // Remove bullet points
      .replace(/^[\s]*\d+\.\s\s/gm, (match) => match.replace(/\s\s$/, " ")) // Clean double spaces after numbers
      .trim();

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
