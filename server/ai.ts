import { invokeLLM, type Tool, type Message as LLMMessage } from "./_core/llm";
import { searchVehicles, upsertLead, createAiLog, getLeadByConversationId } from "./db";
import type { Message, Conversation } from "../drizzle/schema";

const SYSTEM_PROMPT = `Você é a assistente virtual da Auto Inova, uma concessionária de veículos localizada no Rio Grande do Sul.

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
3. Use a ferramenta de busca para encontrar veículos disponíveis
4. Apresente as opções de forma clara e atrativa
5. Colete informações para qualificação: nome, interesse, se tem veículo para troca, forma de pagamento
6. Se o cliente demonstrar interesse real, sugira agendar uma visita ou test drive

INFORMAÇÕES A COLETAR (quando natural na conversa):
- Veículo de interesse
- Faixa de preço
- Se tem veículo para troca (modelo, ano, km)
- Forma de pagamento preferida (financiamento, à vista, consórcio)
- Valor de entrada (se financiamento)

REGRAS:
- Nunca invente veículos que não estão no estoque
- Se não encontrar o veículo desejado, sugira alternativas similares
- Se o cliente pedir para falar com um humano, informe que vai transferir o atendimento
- Não forneça valores exatos de financiamento, apenas estimativas gerais
- Sempre que apresentar um veículo, mencione: marca, modelo, ano, preço e km

Ao final de CADA resposta, inclua um bloco JSON (que será removido antes de enviar ao cliente) com os dados coletados até o momento:
{"intencao":"compra/troca/informacao","veiculo_interesse":"modelo","tem_troca":true/false,"veiculo_troca":"modelo","ano_troca":"ano","km_troca":"km","forma_pagamento":"tipo","entrada":"valor","status":"qualifying/qualified"}`;

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "buscar_veiculos",
      description: "Busca veículos disponíveis no estoque da concessionária Auto Inova. Use quando o cliente perguntar sobre veículos disponíveis, preços ou modelos específicos.",
      parameters: {
        type: "object",
        properties: {
          marca: { type: "string", description: "Marca do veículo (ex: Toyota, Honda, Volkswagen)" },
          modelo: { type: "string", description: "Modelo do veículo (ex: Corolla, Civic, Gol)" },
          preco_max: { type: "number", description: "Preço máximo em reais" },
          categoria: { type: "string", description: "Categoria: SUV, sedan, hatch, pickup, etc." },
          cambio: { type: "string", description: "Tipo de câmbio: manual ou automatic" },
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

  // Build message history for context
  const llmMessages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Add recent conversation history (last 20 messages)
  const history = recentMessages.slice(-20);
  for (const msg of history) {
    if (msg.senderType === "customer") {
      llmMessages.push({ role: "user", content: msg.content });
    } else if (msg.senderType === "bot") {
      llmMessages.push({ role: "assistant", content: msg.content });
    }
  }

  // Add current message
  llmMessages.push({ role: "user", content: customerMessage });

  try {
    // First call - may include tool calls
    let result = await invokeLLM({
      messages: llmMessages,
      tools: TOOLS,
      toolChoice: "auto",
    });

    let assistantMessage = result.choices[0]?.message;

    // Handle tool calls
    if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Add assistant message with tool calls to history
      llmMessages.push({
        role: "assistant",
        content: assistantMessage.content || "",
      });

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.function.name === "buscar_veiculos") {
          const args = JSON.parse(toolCall.function.arguments);
          const vehicles = await searchVehicles({
            brand: args.marca,
            model: args.modelo,
            maxPrice: args.preco_max,
            category: args.categoria,
            transmission: args.cambio,
          });

          const vehicleList = vehicles.length > 0
            ? vehicles.slice(0, 5).map(v =>
              `${v.brand} ${v.model} ${v.year} - R$ ${v.price.toLocaleString("pt-BR")} - ${v.mileage?.toLocaleString("pt-BR") || "N/A"} km - ${v.transmission === "automatic" ? "Automático" : "Manual"} - ${v.color || ""}`
            ).join("\n")
            : "Nenhum veículo encontrado com esses critérios.";

          llmMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: vehicleList,
          });
        }
      }

      // Second call with tool results
      result = await invokeLLM({
        messages: llmMessages,
        tools: TOOLS,
        toolChoice: "auto",
      });
      assistantMessage = result.choices[0]?.message;
    }

    const fullResponse = typeof assistantMessage?.content === "string"
      ? assistantMessage.content
      : "";

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
      toolUsed: assistantMessage?.tool_calls ? "buscar_veiculos" : null,
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
