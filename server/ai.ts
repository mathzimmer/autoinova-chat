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

REGRAS OBRIGATÓRIAS:
- SEMPRE use a ferramenta buscar_veiculos quando o cliente mencionar QUALQUER veículo, marca, modelo, tipo de carro, faixa de preço ou perguntar o que tem disponível. NUNCA responda sobre veículos sem antes consultar o estoque com a ferramenta.
- NUNCA invente veículos. Responda APENAS com base nos resultados da ferramenta buscar_veiculos.
- Se o cliente perguntar "tem Corolla?", "tem SUV?", "tem carro até 50 mil?", etc., OBRIGATORIAMENTE chame buscar_veiculos ANTES de responder.
- Se não encontrar o veículo desejado, use buscar_veiculos sem filtros para sugerir alternativas.
- Se o cliente pedir para falar com um humano, informe que vai transferir o atendimento.
- Não forneça valores exatos de financiamento, apenas estimativas gerais.
- Sempre que apresentar um veículo, mencione: marca, modelo, ano, preço, km e link.
- Quando houver preço promocional, destaque a economia.
- Nosso WhatsApp: (51) 99478-2062
- Nosso endereço: Av Castro Alves, nº 1655, Sete de Setembro, Ivoti - RS

Ao final de CADA resposta, inclua um bloco JSON (que será removido antes de enviar ao cliente) com os dados coletados até o momento:
{"intencao":"compra/troca/informacao","veiculo_interesse":"modelo","tem_troca":true/false,"veiculo_troca":"modelo","ano_troca":"ano","km_troca":"km","forma_pagamento":"tipo","entrada":"valor","status":"qualifying/qualified"}`;

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
      description: "Busca veículos disponíveis no estoque REAL da concessionária Auto Inova. Use sempre que o cliente perguntar sobre veículos, preços, modelos ou quiser ver opções. Os resultados vêm do estoque atualizado automaticamente.",
      parameters: {
        type: "object",
        properties: {
          marca: { type: "string", description: "Marca do veículo (ex: Toyota, Honda, Volkswagen, Hyundai, Fiat, Chevrolet, BMW, etc)" },
          modelo: { type: "string", description: "Modelo do veículo (ex: Corolla, Civic, Gol, HB20, Onix, etc)" },
          preco_max: { type: "number", description: "Preço máximo em reais" },
          preco_min: { type: "number", description: "Preço mínimo em reais" },
          categoria: { type: "string", description: "Categoria/carroceria: SUV, Sedan, Hatch, Picapes, Conversível, etc" },
          combustivel: { type: "string", description: "Tipo de combustível: flex, gasolina, diesel, elétrico, híbrido" },
          cambio: { type: "string", description: "Tipo de câmbio: manual ou automatico" },
          km_max: { type: "number", description: "Quilometragem máxima" },
          ano_min: { type: "number", description: "Ano mínimo do veículo" },
          ano_max: { type: "number", description: "Ano máximo do veículo" },
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
      description: "Obtém um resumo geral do estoque atual da Auto Inova: quantos veículos, marcas disponíveis, faixa de preço. Use quando o cliente perguntar de forma genérica o que vocês têm.",
      parameters: {
        type: "object",
        properties: {},
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
  try {
    const existingLead = await getLeadByConversationId(conversation.id);
    if (existingLead) {
      contextBlock += `\n\nDADOS JÁ COLETADOS DESTE CLIENTE:`;
      if (existingLead.name) contextBlock += `\n- Nome: ${existingLead.name}`;
      if (existingLead.intention) contextBlock += `\n- Intenção: ${existingLead.intention}`;
      if (existingLead.vehicleInterest) contextBlock += `\n- Veículo de interesse: ${existingLead.vehicleInterest}`;
      if (existingLead.hasTrade) contextBlock += `\n- Tem troca: Sim`;
      if (existingLead.tradeVehicle) contextBlock += `\n- Veículo de troca: ${existingLead.tradeVehicle} ${existingLead.tradeYear || ""} ${existingLead.tradeKm ? existingLead.tradeKm + " km" : ""}`;
      if (existingLead.paymentMethod) contextBlock += `\n- Forma de pagamento: ${existingLead.paymentMethod}`;
      if (existingLead.downPayment) contextBlock += `\n- Entrada: ${existingLead.downPayment}`;
      contextBlock += `\n\nIMPORTANTE: Use essas informações para dar continuidade à conversa. NÃO pergunte novamente o que já foi respondido. Se o cliente já escolheu um veículo, continue a conversa sobre aquele veículo específico.`;
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
      // Include agent messages so AI knows what the human agent said
      llmMessages.push({ role: "assistant", content: `[Atendente humano]: ${msg.content}` });
    }
  }

  // Add current message
  llmMessages.push({ role: "user", content: customerMessage });

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

      // Sanitize tool_call IDs to match pattern ^[a-zA-Z0-9_-]+$
      const sanitizedToolCalls = assistantMessage.tool_calls.map((tc: any) => ({
        ...tc,
        id: tc.id ? tc.id.replace(/[^a-zA-Z0-9_-]/g, '_') : `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }));

      console.log(`[AI] Tool calls detected: ${sanitizedToolCalls.map((tc: any) => tc.function.name).join(", ")} (ids: ${sanitizedToolCalls.map((tc: any) => tc.id).join(", ")})`);

      // Add assistant message with tool calls to history
      const assistantMsg: any = {
        role: "assistant",
        content: assistantMessage.content || "",
        tool_calls: sanitizedToolCalls,
      };
      llmMessages.push(assistantMsg);

      for (const toolCall of sanitizedToolCalls) {
        let toolResult = "";

        try {
          if (toolCall.function.name === "buscar_veiculos") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            console.log(`[AI] Calling buscar_veiculos with args:`, JSON.stringify(args));
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
            console.log(`[AI] buscar_veiculos result length: ${toolResult.length} chars`);
          } else if (toolCall.function.name === "resumo_estoque") {
            console.log(`[AI] Calling resumo_estoque`);
            toolResult = await getStockSummaryForAI();
            console.log(`[AI] resumo_estoque result length: ${toolResult.length} chars`);
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
        console.log(`[AI] Follow-up LLM raw result:`, JSON.stringify(result).substring(0, 500));
        assistantMessage = result.choices?.[0]?.message || null;
        console.log(`[AI] Follow-up LLM response - finish_reason: ${result.choices?.[0]?.finish_reason}, has_tool_calls: ${!!assistantMessage?.tool_calls?.length}`);
      } catch (followUpError) {
        console.error(`[AI] Follow-up LLM call failed:`, followUpError);
        // If follow-up fails, try without tools
        try {
          result = await invokeLLM({
            messages: llmMessages,
          });
          assistantMessage = result.choices?.[0]?.message || null;
          console.log(`[AI] Fallback LLM response (no tools):`, assistantMessage?.content?.toString().substring(0, 200));
        } catch (fallbackError) {
          console.error(`[AI] Fallback LLM also failed:`, fallbackError);
          throw fallbackError;
        }
      }
    }

    // Extract content - handle both string and array content
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

    // Extract lead data JSON from response
    let leadData: Record<string, unknown> | null = null;
    const jsonMatch = fullResponse.match(/\{[\s\S]*\}$/);
    if (jsonMatch) {
      try {
        leadData = JSON.parse(jsonMatch[0]);
      } catch { /* ignore parse errors */ }
    }

    // Clean response (remove JSON block)
    const cleanResponse = fullResponse.replace(/\{[\s\S]*\}$/g, "").trim();

    // Save lead data if extracted
    if (leadData && conversation.id) {
      try {
        await upsertLead({
          conversationId: conversation.id,
          phone: conversation.phone,
          name: conversation.contactName || (leadData.nome as string) || null,
          intention: (leadData.intencao as string) || null,
          vehicleInterest: (leadData.veiculo_interesse as string) || null,
          hasTrade: leadData.tem_troca as boolean ?? null,
          tradeVehicle: (leadData.veiculo_troca as string) || null,
          tradeYear: (leadData.ano_troca as string) || null,
          tradeKm: (leadData.km_troca as string) || null,
          paymentMethod: (leadData.forma_pagamento as string) || null,
          downPayment: (leadData.entrada as string) || null,
          status: (leadData.status as any) || "qualifying",
        });
      } catch (e) {
        console.error("[AI] Failed to upsert lead:", e);
      }
    }

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

    return { response: cleanResponse, leadData };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error("[AI] Error processing message:", error);

    await createAiLog({
      conversationId: conversation.id,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      responseTimeMs: responseTime,
      success: false,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      response: "Desculpe, estou com uma instabilidade no momento. Um atendente humano será notificado para continuar seu atendimento. 🙏",
      leadData: null,
    };
  }
}
