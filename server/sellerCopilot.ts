/**
 * Copiloto do Vendedor — sugere respostas ao VENDEDOR humano em tempo real.
 *
 * NÃO envia nada ao cliente: apenas gera sugestões de mensagens + próximo passo,
 * lendo o contexto da conversa e um "playbook" parametrizável (tom, fluxo de
 * condução, sinais de interesse, objeções, objetivo) montado num único prompt.
 *
 * Ligado/desligado POR CONVERSA (conversation.metadata.copilot), padrão desligado.
 */
import { listMessages, getLeadByConversationId, getSetting } from "./db";

export interface CopilotPlaybook {
  tom: string;
  fluxo: string;
  sinais: string;
  objecoes: string;
  objetivo: string;
}

export const DEFAULT_COPILOT_PLAYBOOK: CopilotPlaybook = {
  tom: "Cordial, direto e informal (tom de WhatsApp), português do Brasil. Sem formalidade excessiva e sem markdown.",
  fluxo: "1) Entender a necessidade do cliente. 2) Apresentar o veículo certo do estoque. 3) Contornar objeções. 4) Puxar para uma visita/test-drive na loja. 5) Combinar um próximo passo concreto.",
  sinais: "Pergunta preço, pede fotos, pergunta sobre financiamento/entrada, pergunta endereço/horário, fala em troca, demonstra urgência (ex.: 'preciso essa semana').",
  objecoes: "Preço alto -> mostrar custo-benefício e condições. Troca -> coletar dados do usado e propor avaliação. Distância -> reforçar que vale a visita e oferecer horário. 'Vou pensar' -> criar um próximo passo leve (agendar visita sem compromisso).",
  objetivo: "Trazer o cliente até a loja (visita/test-drive) e avançar para o fechamento.",
};

export async function getCopilotPlaybook(): Promise<CopilotPlaybook> {
  const raw = await getSetting("copilot_playbook");
  if (raw) {
    try { return { ...DEFAULT_COPILOT_PLAYBOOK, ...JSON.parse(raw) }; } catch { /* usa default */ }
  }
  return DEFAULT_COPILOT_PLAYBOOK;
}

export interface CopilotResult {
  suggestions: string[];
  proximoPasso: string;
}

/** Gera sugestões para o vendedor com base no contexto + playbook. */
export async function suggestForConversation(conversationId: number, count = 3): Promise<CopilotResult> {
  const msgs = await listMessages(conversationId, 15);
  if (!msgs || msgs.length === 0) return { suggestions: [], proximoPasso: "" };

  const lead = await getLeadByConversationId(conversationId).catch(() => null);
  const pb = await getCopilotPlaybook();

  const ordered = [...msgs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const transcript = ordered
    .filter((m: any) => m.senderType !== "internal")
    .map((m: any) => {
      const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Atendente";
      return `${role}: ${m.content}`;
    })
    .join("\n");

  const leadContext = lead
    ? `\nLead: interesse em ${(lead as any).vehicleInterest || "não definido"}; etapa do funil: ${(lead as any).funnelStatus || "?"}; pagamento: ${(lead as any).paymentMethod || "não informado"}; troca: ${(lead as any).hasTrade ? ((lead as any).tradeVehicle || "sim") : "não"}.`
    : "";

  const system = [
    "Você é um COPILOTO de vendas de uma concessionária de veículos (Auto Inova).",
    "Você NÃO fala com o cliente — você sugere ao VENDEDOR humano as próximas mensagens.",
    `TOM desejado: ${pb.tom}`,
    `FLUXO de condução: ${pb.fluxo}`,
    `SINAIS de interesse a observar: ${pb.sinais}`,
    `OBJEÇÕES comuns e como contornar: ${pb.objecoes}`,
    `OBJETIVO de toda sugestão: ${pb.objetivo}`,
    "Regras: nunca invente veículo ou preço; não ofereça desconto por conta própria; uma pergunta por mensagem; sem markdown; frases curtas de WhatsApp.",
    `Responda APENAS em JSON válido no formato: {"sugestoes": ["texto 1", "texto 2", "texto 3"], "proximo_passo": "ação recomendada curta"}. Gere exatamente ${count} sugestões de mensagens prontas para o vendedor enviar.${leadContext}`,
  ].join("\n");

  const user = `Conversa (últimas ${ordered.length} mensagens):\n\n${transcript}\n\nGere o JSON.`;

  try {
    const { invokeAgentLLM } = await import("./openaiLLM");
    const resp: any = await invokeAgentLLM({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 700,
    } as any);

    const raw = resp?.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw : "";
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { parsed = {}; }

    let suggestions: string[] = Array.isArray(parsed.sugestoes)
      ? parsed.sugestoes
      : Array.isArray(parsed.suggestions)
        ? parsed.suggestions
        : [];
    // fallback: se não veio JSON, quebra por linhas
    if (suggestions.length === 0 && text.trim()) {
      suggestions = text.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean);
    }
    suggestions = suggestions.filter((s) => typeof s === "string" && s.trim()).slice(0, count);

    const proximoPasso =
      typeof parsed.proximo_passo === "string" ? parsed.proximo_passo
        : typeof parsed.proximoPasso === "string" ? parsed.proximoPasso
          : "";

    return { suggestions, proximoPasso };
  } catch (e) {
    console.error("[Copilot] Falha ao gerar sugestões:", e);
    return { suggestions: [], proximoPasso: "" };
  }
}
