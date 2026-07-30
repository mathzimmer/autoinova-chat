/**
 * Resolução de "qual AGENTE responde uma conversa" — FONTE ÚNICA (PR A5).
 *
 * Hierarquia (mais específico → mais geral):
 *   ① fixado na conversa  ② instância (número)  ③ canal  ④ padrão da loja
 *
 * NÃO decide sessão de fluxo (nó/prompt do fluxo) — isso é resolvido antes, no
 * debounce. Esta função é usada tanto pelo atendimento quanto pelo preview
 * "quem responde esta conversa?" (A4), garantindo que o preview nunca minta.
 */
import type { AiAgent } from "../drizzle/schema";
import { getAiAgentById, getAiAgentForInstance, getAiAgentForChannel, getDefaultAiAgent } from "./db";

export type AgentSource = "fixado" | "instancia" | "canal" | "padrao" | "nenhum";

export interface AgentResolution {
  agentId: number | null;
  agent: AiAgent | null;
  source: AgentSource;
}

export interface ResolvableConversation {
  agentId?: number | null;
  instanceName?: string | null;
  channel?: string | null;
}

export async function resolveAgentForConversation(conv: ResolvableConversation): Promise<AgentResolution> {
  // ① Agente fixado manualmente na conversa (exceção)
  if (conv.agentId) {
    const agent = await getAiAgentById(conv.agentId);
    if (agent && agent.active) return { agentId: agent.id, agent, source: "fixado" };
  }
  // ② Agente da instância (número) — vínculo principal
  if (conv.instanceName) {
    const agent = await getAiAgentForInstance(conv.instanceName);
    if (agent) return { agentId: agent.id, agent, source: "instancia" };
  }
  // ③ Agente do canal
  const byChannel = await getAiAgentForChannel(conv.channel || "whatsapp");
  if (byChannel) return { agentId: byChannel.id, agent: byChannel, source: "canal" };
  // ④ Agente padrão da loja (isDefault)
  const def = await getDefaultAiAgent();
  if (def) return { agentId: def.id, agent: def, source: "padrao" };

  return { agentId: null, agent: null, source: "nenhum" };
}
