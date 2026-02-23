import { invokeLLM, type Tool, type Message as LLMMessage } from "./_core/llm";
import { upsertLead, createAiLog, getSetting, getLeadByConversationId } from "./db";
import { getStockSummaryForAI, searchVehiclesForAI } from "./stockSync";
import type { Message, Conversation } from "../drizzle/schema";

export const DEFAULT_SYSTEM_PROMPT = `Você é a assistente virtual da Auto Inova, uma concessionária de veículos localizada em Ivoti - RS.

Seu papel é fazer atendimento de pré-venda, ajudando clientes a encontrar o veículo ideal e qualificando-os como leads.

DIRETRIZES:
- Seja cordial, profissional e objetivo
- Use linguagem natural e amigável, como se estivesse conversando pelo WhatsApp
- Responda sempre em português brasileiro
- Não use formatação markdown (sem asteriscos, sem listas com bullet points)
- Use emojis com moderação (1-2 por mensagem no máximo)
- Mantenha respostas curtas e diretas (máximo 3 parágrafos)

FLUXO DE ATENDIMENTO:
1. Cumprimente o cliente e pergunte como pode ajudar
2. Entenda o que o cliente procura (tipo de veículo, faixa de preço, preferências)
3. Use a ferramenta de busca para encontrar veículos disponíveis no estoque REAL
4. Apresente as opções de forma clara e atrativa, incluindo o link do veículo quando disponível
5. Colete informações para qualificação: nome, interesse, se tem veículo para troca, forma de pagamento
6. Se o cliente demonstrar interesse real, sugira agendar uma visita ou test drive

INFORMAÇÕES A COLETAR (quando natural na conversa):
- Veículo de interesse
- Faixa de preço
- Se tem veículo para troca (modelo, ano, km)
- Forma de pagamento preferida (financiamento, à vista, consórcio)
- Valor de entrada (se financiamento)

REGRAS OBRIGATÓRIAS SOBRE FERRAMENTAS:
- SEMPRE use buscar_veiculos quando o cliente mencionar QUALQUER veículo, marca, modelo, tipo de carro, faixa de preço ou perguntar o que tem disponível
- NUNCA invente veículos. Responda APENAS com base nos resultados de buscar_veiculos
- Se o cliente perguntar "tem Corolla?", "tem SUV?", "tem carro até 50 mil?", etc., OBRIGATORIAMENTE chame buscar_veiculos ANTES de responder
- Se não encontrar o veículo desejado, use buscar_veiculos sem filtros para sugerir alternativas
- SEMPRE use atualizar_lead quando coletar QUALQUER informação nova do cliente: nome, veículo de interesse, se tem troca, forma de pagamento, etc.
- Quando o cliente ESCOLHER um veículo entre as opções apresentadas, IMEDIATAMENTE chame atualizar_lead com o veículo escolhido
- Quando o cliente informar que tem carro para troca, chame atualizar_lead com os dados da troca
- Quando o cliente informar forma de pagamento, chame atualizar_lead
- Use atualizar_lead SEMPRE que houver informação nova, mesmo que parcial

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

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "buscar_veiculos",
      description: "Busca veículos disponíveis no estoque REAL da concessionária Auto Inova. Use sempre que o cliente perguntar sobre veículos, preços, modelos ou quiser ver opções.",
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
      description: "Atualiza os dados do lead/cliente no CRM. OBRIGATÓRIO chamar sempre que coletar qualquer informação nova do cliente durante a conversa: nome, veículo de interesse, se tem troca, veículo de troca, forma de pagamento, valor de entrada, intenção. Chame mesmo com dados parciais - cada campo é opcional. Quando o cliente escolher um veículo específico, atualize veiculo_interesse com o veículo escolhido.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente" },
          intencao: { type: "string", description: "Intenção do cliente: compra, troca, informacao, test_drive, financiamento" },
          veiculo_interesse: { type: "string", description: "Veículo que o cliente demonstrou interesse (marca modelo ano). Atualize quando o cliente escolher um veículo específico." },
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
      if (existingLead.vehicleInterest) contextBlock += `\n- Veículo de interesse: ${existingLead.vehicleInterest}`;
      if (existingLead.hasTrade) contextBlock += `\n- Tem troca: Sim`;
      if (existingLead.tradeVehicle) contextBlock += `\n- Veículo de troca: ${existingLead.tradeVehicle} ${existingLead.tradeYear || ""} ${existingLead.tradeKm ? existingLead.tradeKm + " km" : ""}`;
      if (existingLead.paymentMethod) contextBlock += `\n- Forma de pagamento: ${existingLead.paymentMethod}`;
      if (existingLead.downPayment) contextBlock += `\n- Entrada: ${existingLead.downPayment}`;
      contextBlock += `\n\nIMPORTANTE: Use essas informações para dar continuidade à conversa. NÃO pergunte novamente o que já foi respondido. Se o cliente já escolheu um veículo, continue a conversa sobre aquele veículo específico. Se coletar QUALQUER informação nova, chame atualizar_lead imediatamente.`;
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
      llmMessages.push({ role: "user", content: msg.content });
    } else if (msg.senderType === "bot") {
      llmMessages.push({ role: "assistant", content: msg.content });
    } else if (msg.senderType === "agent") {
      llmMessages.push({ role: "assistant", content: `[Atendente humano]: ${msg.content}` });
    }
  }

  // Add current message
  llmMessages.push({ role: "user", content: customerMessage });

  // Track lead data collected during this interaction
  let collectedLeadData: Record<string, unknown> | null = null;

  try {
    console.log(`[AI] Processing message for conversation ${conversation.id}: "${customerMessage.substring(0, 50)}..."`);

    // First call - may include tool calls
    let result = await invokeLLM({
      messages: llmMessages,
      tools: TOOLS,
      tool_choice: "auto",
    });

    console.log(`[AI] First LLM response - finish_reason: ${result.choices[0]?.finish_reason}, has_tool_calls: ${!!result.choices[0]?.message?.tool_calls?.length}`);

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

            // Build lead data from tool call arguments
            const leadUpdate: any = {
              conversationId: conversation.id,
              phone: conversation.phone,
            };

            if (args.nome) leadUpdate.name = args.nome;
            if (args.intencao) leadUpdate.intention = args.intencao;
            if (args.veiculo_interesse) leadUpdate.vehicleInterest = args.veiculo_interesse;
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
    console.log(`[AI] Final response length: ${fullResponse.length} chars`);

    // Clean response - remove any stray JSON blocks that might still appear
    const cleanResponse = fullResponse.replace(/\{[\s]*"intencao"[\s\S]*?\}$/g, "").trim();

    // Log AI usage
    const responseTime = Date.now() - startTime;
    await createAiLog({
      conversationId: conversation.id,
      promptTokens: result.usage?.prompt_tokens || 0,
      completionTokens: result.usage?.completion_tokens || 0,
      totalTokens: result.usage?.total_tokens || 0,
      responseTimeMs: responseTime,
      toolUsed: assistantMessage?.tool_calls ? assistantMessage.tool_calls.map((tc: any) => tc.function.name).join(",") : null,
      success: true,
    });

    return { response: cleanResponse, leadData: collectedLeadData };
  } catch (error) {
    console.error("[AI] Error processing message:", error);

    // Log failed attempt
    const responseTime = Date.now() - startTime;
    await createAiLog({
      conversationId: conversation.id,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      responseTimeMs: responseTime,
      toolUsed: null,
      success: false,
    });

    return {
      response: "Desculpe, estou com uma instabilidade no momento. Um atendente humano será notificado para continuar seu atendimento. 🙏",
      leadData: null,
    };
  }
}
