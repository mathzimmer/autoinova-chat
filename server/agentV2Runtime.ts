/**
 * Runtime GENÉRICO do AgentV2 — roda o agente em QUALQUER canal, recebendo um
 * `sender` (text/image). Assim o mesmo agente atende número oficial, Evolution e
 * Zernio (coexistência), sem duplicar a lógica de debounce/handoff.
 *
 * O canal chama respondAgentV2Generic(conversationId, sender). O debounce fica a
 * cargo de cada canal (evolutionAI/zernioAI já agrupam mensagens antes de chamar).
 */
import {
  getConversationById, listMessages, createMessage, upsertLead,
  assignSellerRoundRobin, updateConversation, getSetting,
} from "./db";
import { runAgentV2Turn, type ChatTurn } from "./agentV2";
import { sendSellerNotification } from "./whatsapp";
import { emitNewMessage } from "./socket";

export type AgentV2Sender = {
  text: (body: string) => Promise<any>;
  image: (url: string, caption?: string) => Promise<any>;
};

const BOT_NAME = "IA (v2)";

// ─── Config de canais onde o agentV2 está ligado (fora dos números oficiais) ──
// Guardado num setting JSON: { evolution: string[], zernio: string[] }.
type AgentV2Channels = { evolution: string[]; zernio: string[] };
export async function getAgentV2Channels(): Promise<AgentV2Channels> {
  try {
    const raw = await getSetting("agentv2_channels");
    if (raw) {
      const p = JSON.parse(raw);
      return { evolution: Array.isArray(p.evolution) ? p.evolution : [], zernio: Array.isArray(p.zernio) ? p.zernio : [] };
    }
  } catch { /* padrão */ }
  return { evolution: [], zernio: [] };
}
export async function isAgentV2On(kind: "evolution" | "zernio", id?: string | null): Promise<boolean> {
  if (!id) return false;
  const c = await getAgentV2Channels();
  return (c[kind] || []).includes(String(id));
}
export async function setAgentV2Channel(kind: "evolution" | "zernio", id: string, on: boolean, userId?: number): Promise<AgentV2Channels> {
  const { upsertSetting } = await import("./db");
  const c = await getAgentV2Channels();
  const set = new Set(c[kind] || []);
  if (on) set.add(String(id)); else set.delete(String(id));
  c[kind] = Array.from(set);
  await upsertSetting("agentv2_channels", JSON.stringify(c), userId);
  return c;
}

/** Roda um turno do agentV2 numa conversa e envia pelo `sender` do canal. */
export async function respondAgentV2Generic(conversationId: number, sender: AgentV2Sender): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv) return;

  const recent = await listMessages(conversationId, 40);
  const ordered = [...recent].sort((a: any, b: any) => (a.id || 0) - (b.id || 0));

  // Batch = mensagens do cliente após a última resposta do bot/atendente.
  let lastBotIdx = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].senderType === "bot" || ordered[i].senderType === "agent") { lastBotIdx = i; break; }
  }
  const batch = ordered.slice(lastBotIdx + 1).filter((m: any) => m.senderType === "customer");
  if (batch.length === 0) return;

  const imgs = batch.filter((m: any) => m.messageType === "image").length;
  const textos = batch.filter((m: any) => m.messageType !== "image").map((m: any) => m.content).filter(Boolean);
  let messageText = textos.join("\n").trim();
  if (imgs > 0) messageText = `${messageText ? messageText + "\n" : ""}[o cliente enviou ${imgs} ${imgs === 1 ? "foto" : "fotos"}]`.trim();
  if (!messageText) messageText = batch[batch.length - 1].content || "";

  const history: ChatTurn[] = ordered
    .slice(0, lastBotIdx + 1)
    .filter((m: any) => m.senderType === "customer" || m.senderType === "bot")
    .map((m: any) => ({ role: m.senderType === "customer" ? "user" : "assistant", content: m.content || "" }));

  let out;
  try {
    out = await runAgentV2Turn({ sessionId: String(conversationId), history: history.slice(-20), message: messageText });
  } catch (e) {
    console.error("[AgentV2Runtime] runAgentV2Turn falhou:", e);
    return;
  }

  // FOTOS primeiro (sem legenda), depois o TEXTO em bolhas.
  for (const img of out.images || []) {
    try { await sender.image(img.url, undefined); } catch (e) { console.error("[AgentV2Runtime] envio foto falhou:", e); }
    const im = await createMessage({ conversationId, content: "[Imagem do veículo]", senderType: "bot", senderName: BOT_NAME, messageType: "image", metadata: { mediaUrl: img.url } });
    emitNewMessage(conversationId, im);
    await new Promise((r) => setTimeout(r, 300));
  }
  if ((out.images || []).length) await new Promise((r) => setTimeout(r, 1200));

  const parts = (out.messages && out.messages.length ? out.messages : (out.reply ? [out.reply] : []));
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    try { await sender.text(part); } catch (e) { console.error("[AgentV2Runtime] envio texto falhou:", e); }
    const bm = await createMessage({ conversationId, content: part, senderType: "bot", senderName: BOT_NAME, messageType: "text" });
    emitNewMessage(conversationId, bm);
    if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 250));
  }

  // HANDOFF real (mesma lógica do canal oficial).
  if (out.handoff) {
    try {
      const L: any = out.lead || {};
      const vehShown = out.shownVehicles?.find((x) => x.id === L.veiculoId);
      const vehTitle = vehShown ? `${vehShown.title}${vehShown.year ? ` ${vehShown.year}` : ""}` : undefined;
      await upsertLead({
        conversationId, phone: conv.phone || "",
        name: L.nome, city: L.cidade,
        vehicleId: L.veiculoId, vehicleInterest: vehTitle || L.veiculoInteresse,
        hasTrade: L.temTroca, tradeVehicle: L.trocaModelo, tradeYear: L.trocaAno, tradeKm: L.trocaKm,
        paymentMethod: L.pagamento, downPayment: L.finEntrada,
        notes: out.handoff.resumo, funnelStatus: "encaminhado_vendedor",
      } as any);
      const assigned = await assignSellerRoundRobin(conversationId, { phone: conv.phone || undefined, contactName: conv.contactName || undefined });
      if (assigned?.seller?.phone) {
        const notif = await sendSellerNotification(assigned.seller.phone, {
          sellerName: assigned.seller.name,
          customerName: conv.contactName || L.nome || "Cliente",
          customerPhone: conv.phone || "",
          vehicleInterest: vehTitle || L.veiculoInteresse || "",
          conversationSummary: out.handoff.resumo,
          storeLocation: assigned.storeLocation,
          tradeVehicle: L.temTroca ? [L.trocaModelo, L.trocaAno, L.trocaKm ? `${L.trocaKm} km` : ""].filter(Boolean).join(" ") : null,
          paymentMethod: L.pagamento,
          downPayment: L.finEntrada,
        });
        const hora = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const nota = `🔁 Lead transferido para ${assigned.seller.name} (${assigned.storeLocation}) em ${hora}.`;
        const sysMsg = await createMessage({ conversationId, content: nota, senderType: "internal", senderName: "Sistema", messageType: "system" } as any);
        emitNewMessage(conversationId, sysMsg);
        // Registra no chat a MENSAGEM enviada ao vendedor (texto exato).
        if (notif?.message) {
          const notifMsg = await createMessage({ conversationId, content: `📤 Mensagem enviada ao vendedor (${assigned.seller.name}):\n\n${notif.message}`, senderType: "internal", senderName: "Sistema", messageType: "system" } as any);
          emitNewMessage(conversationId, notifMsg);
        }
        const meta = ((conv as any).metadata as Record<string, unknown>) || {};
        await updateConversation(conversationId, { metadata: { ...meta, handedOffAt: new Date().toISOString(), assignedSellerId: assigned.seller.id, assignedSellerName: assigned.seller.name, assignedStore: assigned.storeLocation } } as any);
      }
    } catch (e) {
      console.error("[AgentV2Runtime] handoff falhou:", e);
    }
  }
}
