import { invokeLLM, type Tool, type Message as LLMMessage } from "./_core/llm";
import { upsertLead, createAiLog, getSetting, getLeadByConversationId } from "./db";
import { getStockSummaryForAI, searchVehiclesForAI } from "./stockSync";
import type { Message, Conversation } from "../drizzle/schema";

export const DEFAULT_SYSTEM_PROMPT = `Você é a assistente virtual da Auto Inova, uma concessionária de veículos localizada em Ivoti - RS.

Seu papel é fazer atendimento de pré-venda, ajudando clientes a encontrar o veículo ideal e qualificando-os como leads.

DIRETRIZES DE COMUNICAÇÃO:
- Seja cordial, profissional e objetivo
- Use linguagem natural e amigável, como se estivesse conversando pelo WhatsApp
- Responda sempre em português brasileiro
- Não use formatação markdown (sem asteriscos, sem listas com bullet points)
- Use emojis com moderação (1-2 por mensagem no máximo)
- Mantenha respostas curtas e diretas (máximo 3 parágrafos)
- NUNCA repita informações que já foram ditas na conversa

FLUXO DE ATENDIMENTO:
1. Cumprimente o cliente e pergunte como pode ajudar
2. Entenda o que o cliente procura (tipo de veículo, faixa de preço, preferências)
3. Use a ferramenta buscar_veiculos para encontrar veículos disponíveis no estoque REAL
4. Apresente as opções de forma clara e atrativa, incluindo o link do veículo quando disponível
5. Colete informações para qualificação: nome, interesse, se tem veículo para troca, forma de pagamento
6. Se o cliente demonstrar interesse real, sugira agendar uma visita ou test drive

INFORMAÇÕES A COLETAR (quando natural na conversa):
- Veículo de interesse
- Faixa de preço
- Se tem veículo para troca (modelo, ano, km)
- Forma de pagamento preferida (financiamento, à vista, consórcio)
- Valor de entrada (se financiamento)

REGRAS DE BUSCA DE VEÍCULOS:
- Chame buscar_veiculos quando o cliente perguntar sobre um veículo, marca ou modelo ESPECÍFICO
- Chame buscar_veiculos quando o cliente quiser ver opções ou perguntar o que tem disponível
- NÃO chame buscar_veiculos para mensagens genéricas como "tenho troca", "quero financiar", "ok", "sim"
- Se a busca retornar APENAS 1 resultado, apresente esse veículo diretamente SEM pedir mais preferências
- Se a busca retornar poucos resultados (2-3), apresente todos diretamente
- Se a busca retornar muitos resultados (4+), mostre os mais relevantes e pergunte se quer filtrar
- NUNCA invente veículos que não estão no estoque
- Cada resultado tem um [ID:X] - use esse ID ao chamar atualizar_lead para vincular o veículo

REGRAS DE FOCO NA CONVERSA:
- Preste atenção no que o cliente está pedindo AGORA, não no que foi discutido antes
- Se o cliente mudar de veículo de interesse (ex: estava falando de Sprinter e agora pergunta sobre Vectra), FOQUE no novo veículo
- Quando o cliente mudar de interesse, chame atualizar_lead com o NOVO veículo e busque no estoque
- NÃO misture informações de veículos diferentes na mesma resposta
- Se o cliente confirmar interesse em um veículo específico, siga a conversa sobre AQUELE veículo

REGRAS DE ATUALIZAÇÃO DO LEAD:
- SEMPRE chame atualizar_lead quando coletar QUALQUER informação nova do cliente
- Quando o cliente ESCOLHER ou demonstrar interesse em um veículo, chame atualizar_lead com veiculo_interesse E veiculo_id
- Quando o cliente MUDAR de veículo de interesse, atualize o lead com o NOVO veículo
- Quando o cliente informar que tem carro para troca, chame atualizar_lead com os dados da troca
- Quando o cliente informar forma de pagamento, chame atualizar_lead

IMAGENS DO CLIENTE:
- Quando o cliente enviar uma imagem, CONFIRME o recebimento de forma natural e positiva
- Use o CONTEXTO DA CONVERSA para entender o que é a imagem:
  - Se o cliente mencionou que tem carro para troca e enviou foto: "Recebi as fotos do seu [veículo]! Vou encaminhar para nossa equipe avaliar."
  - Se estavam falando de um veículo e o cliente envia foto: "Recebi a imagem! É uma referência do que você procura?"
  - Se não houver contexto claro: "Recebi sua foto! Pode me dizer do que se trata?"
- Você NÃO vê o conteúdo da imagem, mas NUNCA diga "não consigo visualizar" ou "não posso ver"
- Simplesmente confirme o recebimento e continue o atendimento baseado no contexto

ÁUDIO DO CLIENTE:
- Quando o cliente enviar um áudio, o sistema transcreve automaticamente o conteúdo
- Trate a transcrição EXATAMENTE como se fosse uma mensagem de texto normal
- Responda ao conteúdo normalmente, seguindo o fluxo de atendimento
- NÃO mencione que recebeu um áudio ou que está lendo uma transcrição

OUTRAS REGRAS:
- Se o cliente pedir para falar com um humano, informe que vai transferir o atendimento
- Não forneça valores exatos de financiamento, apenas estimativas gerais
- Sempre que apresentar um veículo, mencione: marca, modelo, ano, preço, km e link
- Quando houver preço promocional, destaque a economia
- Nosso WhatsApp: (51) 99478-2062
- Nosso endereço: Av Castro Alves, nº 1655, Sete de Setembro, Ivoti - RS`;

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
// These should only trigger when the customer is clearly asking about a vehicle model/brand
const VEHICLE_MODEL_KEYWORDS = [
  // Specific models and brands
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
  // Categories
  "suv", "sedan", "hatch", "picape", "pickup", "van", "caminhonete",
];

// Keywords that indicate the customer wants to see what's available (broader search)
const VEHICLE_SEARCH_KEYWORDS = [
  "disponível", "disponivel", "estoque", "opção", "opcao", "opções",
  "o que tem", "o que voces tem", "o que vocês têm",
  "quero ver", "quero conhecer", "mostrar", "me mostra",
  "carro até", "veículo até", "veiculo até",
];

/**
 * Detect if the message is about a specific vehicle and should trigger a search
 */
function shouldForceVehicleSearch(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
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
      description: "Busca veículos disponíveis no estoque REAL da concessionária Auto Inova. Use quando o cliente perguntar sobre um veículo, marca ou modelo específico, ou quiser ver opções disponíveis. Cada resultado inclui um [ID:X] que deve ser usado ao vincular o veículo ao lead.",
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
      description: "Atualiza os dados do lead/cliente no CRM. OBRIGATÓRIO chamar sempre que coletar qualquer informação nova do cliente, incluindo quando o cliente MUDAR de veículo de interesse. Quando o cliente escolher um veículo específico do estoque, inclua o veiculo_id (número [ID:X] do resultado da busca) para vincular o veículo ao lead.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente" },
          intencao: { type: "string", description: "Intenção do cliente: compra, troca, informacao, test_drive, financiamento" },
          veiculo_interesse: { type: "string", description: "Veículo que o cliente demonstrou interesse AGORA (marca modelo ano). Atualize sempre que o cliente mudar de interesse." },
          veiculo_id: { type: "number", description: "ID do veículo no estoque (número [ID:X] retornado por buscar_veiculos). Use para vincular o lead ao veículo específico." },
          tem_troca: { type: "boolean", description: "Se o cliente tem veículo para dar como troca" },
          veiculo_troca: { type: "string", description: "Modelo do veículo de troca do cliente" },
          ano_troca: { type: "string", description: "Ano do veículo de troca" },
          km_troca: { type: "string", description: "Quilometragem do veículo de troca" },
          forma_pagamento: { type: "string", description: "Forma de pagamento: financiamento, a_vista, consorcio, troca" },
          entrada: { type: "string", description: "Valor de entrada para financiamento" },
          status: { type: "string", description: "Status do lead: qualifying (coletando dados), qualified (dados completos, pronto para contato)" },
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
    contextBlock += `\nNOME DO CLIENTE: ${customerName}. Use o nome dele(a) na conversa para personalizar o atendimento.`;
  }
  contextBlock += `\nTELEFONE: ${conversation.phone}`;
  contextBlock += `\nCANAL: ${conversation.channel}`;

  // Contact notes from CRM
  if ((conversation as any).contactNotes) {
    contextBlock += `\nOBSERVAÇÕES DO CRM: ${(conversation as any).contactNotes}`;
  }

  // Lead data (accumulated from previous interactions)
  let existingLead: any = null;
  try {
    existingLead = await getLeadByConversationId(conversation.id);
    if (existingLead) {
      contextBlock += `\n\nDADOS JÁ COLETADOS DESTE CLIENTE (via atualizar_lead):`;
      if (existingLead.name) contextBlock += `\n- Nome: ${existingLead.name}`;
      if (existingLead.intention) contextBlock += `\n- Intenção: ${existingLead.intention}`;
      if (existingLead.vehicleInterest) contextBlock += `\n- Último veículo de interesse registrado: ${existingLead.vehicleInterest}`;
      if (existingLead.vehicleId) contextBlock += `\n- ID do veículo vinculado: ${existingLead.vehicleId}`;
      if (existingLead.hasTrade) contextBlock += `\n- Tem troca: Sim`;
      if (existingLead.tradeVehicle) contextBlock += `\n- Veículo de troca: ${existingLead.tradeVehicle} ${existingLead.tradeYear || ""} ${existingLead.tradeKm ? existingLead.tradeKm + " km" : ""}`;
      if (existingLead.paymentMethod) contextBlock += `\n- Forma de pagamento: ${existingLead.paymentMethod}`;
      if (existingLead.downPayment) contextBlock += `\n- Entrada: ${existingLead.downPayment}`;
      contextBlock += `\n\nIMPORTANTE: Esses são dados já coletados. Se o cliente mudar de veículo de interesse, atualize o lead com o NOVO veículo usando atualizar_lead. Foque na mensagem ATUAL do cliente, não no histórico antigo.`;
    }
  } catch (e) {
    console.error("[AI] Failed to load lead context:", e);
  }

  // Build full system prompt with context
  const fullSystemPrompt = contextBlock
    ? `${systemPrompt}\n\n--- CONTEXTO DA CONVERSA ATUAL ---${contextBlock}`
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
        // For images: send as text with context indicator (no vision needed)
        const caption = msg.content && msg.content !== "[Imagem enviada pelo cliente]" && msg.content !== "[Imagem recebida]"
          ? msg.content
          : "";
        llmMessages.push({ role: "user", content: `[Cliente enviou uma imagem]${caption ? " " + caption : ""}` });
      } else if (msg.messageType === "audio") {
        // For audio: send transcription as plain text (treat as normal message)
        const transcribed = (meta?.transcribedText as string) || msg.content;
        // Send as plain text so the AI treats it like a normal message
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
  // Strip image URL markers if present — just pass the text content
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

    // First call - always use auto, but the prompt strongly instructs to use tools
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
        content: "[SISTEMA: O cliente mencionou um veículo ou quer ver opções. Você DEVE chamar buscar_veiculos AGORA antes de responder. Não responda sem buscar no estoque primeiro.]",
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
            console.log(`[AI] buscar_veiculos: ${toolResult.length} chars, results found`);

          } else if (toolCall.function.name === "resumo_estoque") {
            toolResult = await getStockSummaryForAI();
            console.log(`[AI] resumo_estoque: ${toolResult.length} chars`);

          } else if (toolCall.function.name === "atualizar_lead") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            console.log(`[AI] atualizar_lead args:`, JSON.stringify(args));

            // Build lead data from tool call arguments
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
              toolResult = "Lead atualizado com sucesso no CRM. Continue o atendimento normalmente.";
              console.log(`[AI] Lead updated successfully for conversation ${conversation.id}`);
            } catch (leadErr) {
              console.error("[AI] Failed to update lead:", leadErr);
              toolResult = "Erro ao atualizar lead, mas continue o atendimento normalmente.";
            }
          }
        } catch (toolError) {
          console.error(`[AI] Tool ${toolCall.function.name} error:`, toolError);
          toolResult = `Erro ao executar ferramenta: ${toolError instanceof Error ? toolError.message : "erro desconhecido"}`;
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

    // Clean up any JSON artifacts from the response
    fullResponse = fullResponse
      .replace(/```json[\s\S]*?```/g, "")
      .replace(/\{[\s\S]*?"lead_data"[\s\S]*?\}/g, "")
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

    // Log failed interaction
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
      response: "Desculpe, estou com uma instabilidade no momento. Um atendente humano será notificado para continuar seu atendimento. 🙏",
      leadData: null,
    };
  }
}
