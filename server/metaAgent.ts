/**
 * Integração Meta Business Agent × CRM.
 *
 * Num número marcado como `mode = "meta_agent"`, quem RESPONDE o cliente é o
 * agente da Meta. O CRM apenas:
 *   1) OBSERVA (standby): espelha as mensagens no inbox, marcadas "agente Meta",
 *      SEM acionar a IA/fluxos do CRM;
 *   2) no HANDOFF (o agente passa o controle da thread pro app): cria/garante o
 *      lead, extrai o interesse do histórico (conversationIntelligence), atribui
 *      um vendedor (round-robin) e dispara a automação.
 *
 * ⚠️ PARSER A CONFIRMAR: o formato exato do payload de standby/handoff da Meta
 * ainda não está cravado na doc. Este handler LOGA o payload cru (pra captura no
 * VPS) e faz parse best-effort do que é conhecido. O ponto do handoff está em
 * `detectHandoff()` marcado com TODO_HANDOFF — fecha com um webhook real.
 */
import axios from "axios";
import {
  getConversationByPhone, mirrorOfficialMessage, getOrCreateLeadByPhone,
  updateConversation, assignSellerRoundRobin,
} from "./db";
import { emitNewMessage, emitConversationUpdate } from "./socket";

/**
 * Thread Control do Meta Business Agent — assume/devolve/passa o controle da
 * conversa. `take` = seu app assume (você responde); `release` = devolve pro
 * agente da Meta voltar a responder; `pass` (target ai_agent) = passa pro agente.
 * Usa o token do próprio número.
 */
export async function metaThreadControl(
  phoneNumberId: string,
  action: "take" | "release" | "pass",
  opts?: { to?: string; targetRole?: "ai_agent"; metadata?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { getWhatsappNumberByPhoneNumberId } = await import("./whatsappMultiNumber");
    const rec: any = await getWhatsappNumberByPhoneNumberId(phoneNumberId);
    const token = rec?.accessToken || process.env.WHATSAPP_SYSTEM_USER_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return { ok: false, error: "Sem token para o número" };
    // Thread Control (Cloud API) do Meta Business Agent: graph.facebook.com/v21.0/
    // {phone_number_id}/thread_control, corpo com messaging_product, header 2.0.0.
    const body: any = { messaging_product: "whatsapp", action };
    if (opts?.to) body.to = opts.to;
    if (action === "pass" && opts?.targetRole) body.control_pass = { target_role: opts.targetRole };
    if (opts?.metadata) body.metadata = opts.metadata;
    await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/thread_control`,
      body,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-API-Version": "1.0.0" } }
    );
    console.log(`[MetaAgent] thread_control ${action} OK (num ${phoneNumberId}, to ${opts?.to || "-"})`);
    return { ok: true };
  } catch (e: any) {
    const err = e?.response?.data?.error || {};
    const msg = err.message || e?.message || "erro";
    // Loga o erro COMPLETO da Meta (code/subcode/fbtrace) pra diagnóstico preciso.
    console.error(`[MetaAgent] thread_control ${action} falhou:`, msg,
      `| code=${err.code ?? "-"} subcode=${err.error_subcode ?? "-"} type=${err.type ?? "-"} fbtrace=${err.fbtrace_id ?? "-"} http=${e?.response?.status ?? "-"}`,
      `| full=${JSON.stringify(e?.response?.data || {}).slice(0, 500)}`);
    return { ok: false, error: `${msg} (code ${err.code ?? "-"}/${err.error_subcode ?? "-"})` };
  }
}

/**
 * Reativa o Meta Agent numa conversa: devolve o controle da thread pra Meta
 * (release) e limpa a flag de handoff, pra o agente voltar a responder o cliente.
 * Só age se o número da conversa estiver em modo meta_agent — nos demais é no-op.
 */
export async function reactivateMetaAgentForConversation(conv: any): Promise<{ released: boolean; skipped?: boolean; error?: string }> {
  try {
    const phone = conv?.phone;
    let phoneNumberId = conv?.phoneNumberId;
    console.log(`[MetaAgent] reactivate: conv=${conv?.id} phoneNumberId=${phoneNumberId || "-"} phone=${phone || "-"}`);
    if (!phone) {
      console.log(`[MetaAgent] reactivate SKIP: conversa sem phone`);
      return { released: false, skipped: true };
    }
    const { getWhatsappNumberByPhoneNumberId, listWhatsappNumbers } = await import("./whatsappMultiNumber");

    // Se a conversa não tem o phoneNumberId gravado (conversas antigas), descobre
    // o número do Meta Agent automaticamente.
    let rec: any = phoneNumberId ? await getWhatsappNumberByPhoneNumberId(phoneNumberId) : null;
    if (!rec || rec.mode !== "meta_agent") {
      const all: any[] = (await listWhatsappNumbers().catch(() => [])) || [];
      const metaNums = all.filter((n) => n.mode === "meta_agent");
      if (metaNums.length === 1) {
        rec = metaNums[0];
        phoneNumberId = rec.phoneNumberId;
        console.log(`[MetaAgent] reactivate: phoneNumberId inferido do único número meta_agent = ${phoneNumberId}`);
      } else if (metaNums.length > 1) {
        console.log(`[MetaAgent] reactivate SKIP: ${metaNums.length} números meta_agent — não dá pra inferir qual. Grave o phoneNumberId na conversa.`);
        return { released: false, skipped: true };
      }
    }
    if (!rec || rec.mode !== "meta_agent") {
      console.log(`[MetaAgent] reactivate SKIP: nenhum número em modo meta_agent (mode=${rec?.mode || "-"})`);
      return { released: false, skipped: true };
    }

    // Devolve o controle pra Meta (release → o agente volta a ser o respondedor).
    const r = await metaThreadControl(phoneNumberId, "release", { to: phone });

    // Limpa a flag de handoff pra permitir um novo ciclo de atendimento.
    const meta = ((conv.metadata as Record<string, unknown>) || {});
    if (meta.metaAgentHandoff) {
      delete meta.metaAgentHandoff;
      const { updateConversation } = await import("./db");
      await updateConversation(conv.id, { metadata: meta as any });
    }
    console.log(`[MetaAgent] reactivate: resultado released=${r.ok} error=${r.error || "-"}`);
    return { released: r.ok, error: r.error };
  } catch (e: any) {
    console.error(`[MetaAgent] reactivate erro:`, e?.message || e);
    return { released: false, error: e?.message || "erro" };
  }
}

function extractText(m: any): string {
  if (!m) return "";
  if (m.type === "text") return m.text?.body || "";
  if (m.type === "interactive") {
    return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "[resposta interativa]";
  }
  if (m.type === "image") return m.image?.caption || "[imagem]";
  if (m.type === "audio") return "[áudio]";
  if (m.type === "document") return `[documento: ${m.document?.filename || "arquivo"}]`;
  return m.text?.body || `[${m.type || "mensagem"}]`;
}

/**
 * TODO_HANDOFF — detectar quando o controle da thread passa para o app.
 * Campos prováveis (a confirmar com webhook real): value.messaging_handovers,
 * value.handover, value.control_passed. Retorna o telefone do cliente ou null.
 */
function detectHandoff(value: any): { phone?: string } | null {
  const h = value?.messaging_handovers || value?.handover || value?.control_passed || value?.thread_control;
  if (!h) return null;
  const phone = value?.contacts?.[0]?.wa_id
    || value?.messages?.[0]?.from
    || (Array.isArray(h) ? h[0]?.from : h?.from);
  return { phone };
}

/** Resolve o veículo do estoque a partir do texto de interesse (ex: "Corolla 2019"). */
async function resolveVehicleIdFromText(text: string): Promise<number | null> {
  try {
    const { getAllCuratedVehicles } = await import("./stockSync");
    const all = await getAllCuratedVehicles();
    const norm = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const t = norm(text);
    const ym = t.match(/\b(19|20)\d{2}\b/);
    const anoDito = ym ? Number(ym[0]) : null;
    let best: { id: number; score: number } | null = null;
    for (const v of all as any[]) {
      const words = norm(`${v.brand} ${v.model} ${v.version || ""}`).split(/\s+/).filter((w: string) => w.length >= 3);
      let score = 0;
      for (const w of words) if (t.includes(w)) score += w.length;
      if (anoDito && Number(v.year) === anoDito) score += 4;
      if (score > 0 && (!best || score > best.score)) best = { id: v.id, score };
    }
    return best ? best.id : null;
  } catch { return null; }
}

/** Webhook de um número que roda o Meta Business Agent. */
export async function handleMetaAgentWebhook(body: any, phoneNumberId: string): Promise<boolean> {
  try {
    console.log(`[MetaAgent] RAW webhook (${phoneNumberId}) — capturar p/ fechar parser:`, JSON.stringify(body).slice(0, 4000));
  } catch { /* noop */ }

  const value = body?.entry?.[0]?.changes?.[0]?.value;
  if (!value) return false;

  // FORMATO REAL (Meta Business Agent): `value.standby` é um OBJETO
  //   { contacts:[...], messages:[...], message_echoes:[...], statuses:[...] }
  // — as mensagens NÃO vêm em value.messages, e sim em value.standby.messages.
  // Se não houver standby-objeto, cai pro próprio value (formato oficial normal).
  const standbyObj = (value.standby && typeof value.standby === "object" && !Array.isArray(value.standby)) ? value.standby : null;
  const src: any = standbyObj || value;
  const contact = src.contacts?.[0] || value.contacts?.[0];

  // Espelha o que houver, sem acionar IA. messages = entrada (cliente);
  // message_echoes = saída (respostas do próprio agente da Meta).
  const buckets: Array<{ m: any; direction: "inbound" | "outbound" }> = [];
  if (Array.isArray(src.messages)) src.messages.forEach((m: any) => buckets.push({ m, direction: "inbound" }));
  if (Array.isArray(src.message_echoes)) src.message_echoes.forEach((m: any) => buckets.push({ m, direction: "outbound" }));
  // Compat: caso algum dia o standby venha como ARRAY de mensagens.
  if (Array.isArray(value.standby)) value.standby.forEach((m: any) => buckets.push({ m, direction: "inbound" }));

  let custPhone = "";           // telefone do cliente visto neste webhook
  let agentPediuHandoff = false; // o eco do agente disse que vai transferir?
  for (const { m, direction } of buckets) {
    // Nos ECHOES (resposta do agente), os dados ficam ANINHADOS em `m.message`
    // e o telefone do cliente é `message.to` (não há `from`). Nas mensagens do
    // cliente (standby.messages) os campos são planos e o telefone é `from`.
    const inner = (m.message && typeof m.message === "object") ? m.message : m;
    const phone = direction === "outbound"
      ? (inner.to || m.to || contact?.wa_id || "")
      : (m.from || inner.from || contact?.wa_id || "");
    if (!phone) continue;
    custPhone = phone;
    const type = inner.type;
    const texto = extractText(inner);
    // Sinal de handoff pela FALA do agente ("vamos redirecionar/passar/atendente...").
    if (direction === "outbound" && /redirecion|membro da equip|falar com|transferir|passar (voce|você|a conversa)|equipe|equipa|atendente|humano/i.test(texto.toLowerCase())) {
      agentPediuHandoff = true;
    }
    try {
      const res = await mirrorOfficialMessage({
        phoneNumberId,
        phone,
        contactName: contact?.profile?.name || undefined,
        content: texto,
        messageType: (type === "image" || type === "audio" || type === "document" ? type : "text"),
        direction,
        senderName: direction === "outbound" ? "Agente Meta" : (contact?.profile?.name || phone),
        externalId: m.id || inner.id,
        timestamp: Date.now(),
      });
      // IMPORTANTE: NÃO chamar IA/fluxo aqui — quem responde é o agente da Meta.
      if (res) emitNewMessage(res.conversationId, res.message);
    } catch (e) {
      console.error("[MetaAgent] falha ao espelhar mensagem:", e);
    }
  }

  // Gatilhos de HANDOFF (qualquer um serve; onMetaAgentHandoff é idempotente):
  //  1) evento explícito (messaging_handovers/thread_control), quando vier;
  //  2) o agente disse que vai transferir ("redirecionar/membro da equipa...");
  //  3) mensagem do cliente chegou FORA do standby (controle passou pro app).
  const handoff = detectHandoff(value);
  const controleComApp = !standbyObj && Array.isArray(value.messages) && value.messages.length > 0;
  const phoneParaHandoff = handoff?.phone || custPhone || value?.contacts?.[0]?.wa_id || value?.messages?.[0]?.from;
  if (phoneParaHandoff && (handoff?.phone || agentPediuHandoff || controleComApp)) {
    await onMetaAgentHandoff(phoneParaHandoff).catch((e) => console.error("[MetaAgent] handoff falhou:", e));
  }

  return true;
}

/**
 * Processa o handoff: garante o lead, extrai o interesse do histórico, atribui
 * vendedor e desliga a IA do CRM (o vendedor humano assume). Dispara update.
 */
export async function onMetaAgentHandoff(phone: string): Promise<void> {
  const conv = await getConversationByPhone(phone);
  if (!conv) { console.warn(`[MetaAgent] handoff sem conversa para ${phone}`); return; }

  const meta = ((conv as any).metadata as Record<string, unknown>) || {};
  // IDEMPOTENTE: só processa o handoff UMA vez por conversa.
  if (meta.metaAgentHandoff === true) return;

  await updateConversation(conv.id, {
    status: "open",
    aiActive: false, // vendedor humano assume; IA do CRM não responde
    metadata: { ...meta, metaAgentHandoff: true, metaAgentHandoffAt: Date.now() } as any,
  });

  try { await getOrCreateLeadByPhone({ phone, conversationId: conv.id, name: (conv as any).contactName || undefined }); }
  catch (e) { console.error("[MetaAgent] getOrCreateLead:", e); }

  // Extrai carro de interesse / pagamento / troca / score do histórico recebido.
  try { const { analyzeConversation } = await import("./conversationIntelligence"); await analyzeConversation(conv.id); }
  catch (e) { console.error("[MetaAgent] analyzeConversation:", e); }

  // AMARRA o interesse (texto) a um carro do ESTOQUE → assim a loja/vendedor certos
  // são escolhidos. Sem isso, o roteamento cairia na loja padrão.
  try {
    const { getLeadByConversationId, upsertLead } = await import("./db");
    const lead: any = await getLeadByConversationId(conv.id);
    if (lead && !lead.vehicleId && lead.vehicleInterest && lead.vehicleInterest !== "não definido") {
      const vid = await resolveVehicleIdFromText(lead.vehicleInterest);
      if (vid) await upsertLead({ conversationId: conv.id, phone, vehicleId: vid } as any);
    }
  } catch (e) { console.error("[MetaAgent] amarrar veículo:", e); }

  // Classifica a intenção e atribui ao grupo certo, depois NOTIFICA com o resumo.
  try {
    const { assignAgentByDepartment, getLeadByConversationId } = await import("./db");
    const leadForDept: any = await getLeadByConversationId(conv.id).catch(() => null);
    const dept = classifyHandoffIntent(`${leadForDept?.vehicleInterest || ""} ${leadForDept?.notes || ""}`);
    const assigned = await assignAgentByDepartment(conv.id, dept, { phone, contactName: (conv as any).contactName || undefined });
    if (assigned?.seller?.phone) {
      const { sendSellerNotification } = await import("./whatsapp");
      const lead: any = await getLeadByConversationId(conv.id).catch(() => null);
      const notif = await sendSellerNotification(assigned.seller.phone, {
        sellerName: assigned.seller.name,
        customerName: (conv as any).contactName || lead?.name || "Cliente",
        customerPhone: phone,
        vehicleInterest: lead?.vehicleInterest || "(a confirmar)",
        conversationSummary: lead?.notes || "Atendimento iniciado pelo agente da Meta; cliente pediu atendimento humano.",
        storeLocation: assigned.storeLocation,
        tradeVehicle: lead?.hasTrade ? lead?.tradeVehicle : null,
        paymentMethod: lead?.paymentMethod,
        downPayment: lead?.downPayment,
      });
      // Marca visível na conversa.
      try {
        const { createMessage } = await import("./db");
        const { emitNewMessage } = await import("./socket");
        const hora = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const sysMsg = await createMessage({ conversationId: conv.id, content: `🔁 Lead transferido pelo agente da Meta para ${assigned.seller.name} (${assigned.storeLocation}) em ${hora}.`, senderType: "internal", senderName: "Sistema", messageType: "system" } as any);
        emitNewMessage(conv.id, sysMsg);
        // Registra no chat a MENSAGEM enviada ao vendedor (texto exato).
        if (notif?.message) {
          const notifMsg = await createMessage({ conversationId: conv.id, content: `📤 Mensagem enviada ao vendedor (${assigned.seller.name}):\n\n${notif.message}`, senderType: "internal", senderName: "Sistema", messageType: "system" } as any);
          emitNewMessage(conv.id, notifMsg);
        }
      } catch { /* noop */ }
    } else {
      console.warn(`[MetaAgent] handoff sem vendedor ativo pra loja da conversa ${conv.id}`);
    }
  } catch (e) { console.error("[MetaAgent] assignSeller/notify:", e); }

  emitConversationUpdate(conv.id, {});
  console.log(`[MetaAgent] Handoff OK: conversa ${conv.id} (${phone}) → lead + vendedor + notificação.`);
}

// ─── Handoff em COEXISTÊNCIA (Evolution espelhando o WhatsApp Business) ────────
// O agente da Meta responde dentro do app; a Evolution espelha tudo. Não há sinal
// de transferência, então detectamos pela FRASE que o agente fala ao transferir
// (ex.: "conectei você com nossa equipe"). Ao bater, roteia pro vendedor certo.
// Frases com que o agente da Meta sinaliza transferência (normalizadas: sem
// acento/maiúscula). Cobre as variações observadas. Editável via setting
// coex_handoff_phrases.
const COEX_HANDOFF_PHRASES_DEFAULT = [
  "conectei voce",
  "compartilhei seu interesse",
  "compartilhei com nossa equipe",
  "compartilhei seu interesse com nossa equipe",
  "representante falara com voce",
  "um representante falara",
  "falara com voce em breve",
  "encaminhei voce",
  "direcionei voce",
  "nossa equipe entrara em contato",
  "equipe comercial entrara em contato",
];
const _coexNorm = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Classifica a intenção do atendimento pra rotear ao grupo certo:
 *  - "compras"  → cliente quer VENDER ou CONSIGNAR o carro dele.
 *  - "posvenda" → dúvida geral ou pós-venda (já é cliente).
 *  - "vendas"   → quer comprar um carro (padrão).
 * Usa o texto da transferência do agente + o interesse do lead.
 */
export function classifyHandoffIntent(text: string): "vendas" | "compras" | "posvenda" {
  const t = _coexNorm(text);
  if (/(venda ou consigna|consigna|quero vender|vender (meu|o meu)|avaliar (meu|o meu|seu|sua)|avalia(c|s)ao do (meu|seu)|comprar (o )?meu carro|vender meu carro)/.test(t)) return "compras";
  if (/(pos.?venda|ja comprei|comprei com|ja sou cliente|garantia|revis(a|ao)|documenta|transferenc|segunda via|reclama|defeito|problema no (carro|veiculo))/.test(t)) return "posvenda";
  return "vendas";
}

export async function maybeRouteCoexistenceHandoff(conversationId: number, outboundText: string): Promise<void> {
  try {
    const text = _coexNorm(outboundText);
    if (!text) return;

    // Frases configuráveis (setting coex_handoff_phrases) + padrão.
    let phrases = COEX_HANDOFF_PHRASES_DEFAULT.map(_coexNorm);
    try {
      const { getSetting } = await import("./db");
      const raw = await getSetting("coex_handoff_phrases");
      if (raw && raw.trim()) phrases = raw.split(/[\n;,]+/).map(_coexNorm).filter(Boolean);
    } catch { /* usa padrão */ }
    if (!phrases.some((p) => text.includes(p))) return;

    const { getConversationById, updateConversation } = await import("./db");
    const conv: any = await getConversationById(conversationId);
    if (!conv) return;
    const meta = (conv.metadata as Record<string, unknown>) || {};
    if (meta.coexHandoff === true) return; // idempotente: 1x por conversa
    await updateConversation(conversationId, { metadata: { ...meta, coexHandoff: true, coexHandoffAt: Date.now() } as any });
    console.log(`[Coex] handoff detectado por frase na conv ${conversationId} — roteando pro vendedor.`);

    const phone = conv.phone;
    // Analisa a conversa (extrai carro de interesse, pagamento, troca, score).
    // Captura o resumo pra gravar como notes ATUAL (senão o resumo fica velho).
    let insight: any = null;
    try { const { analyzeConversation } = await import("./conversationIntelligence"); insight = await analyzeConversation(conversationId); }
    catch (e) { console.error("[Coex] analyze:", e); }

    // Amarra o interesse ATUAL a um carro do estoque → escolhe a loja certa.
    // O carro atual é o nomeado na mensagem de transferência do agente (ex.:
    // "Kia Sportage 2017"), que é mais confiável que o lead — que pode carregar
    // um interesse ANTIGO. Por isso SOBRESCREVE o veículo do lead.
    try {
      const { getLeadByConversationId, upsertLead } = await import("./db");
      const lead: any = await getLeadByConversationId(conversationId).catch(() => null);
      const vidAtual = await resolveVehicleIdFromText(outboundText);
      if (vidAtual) {
        const { getVehicleForAgent } = await import("./stockSync");
        const v: any = await getVehicleForAgent(vidAtual).catch(() => null);
        const nome = v?.nome || lead?.vehicleInterest || "";
        const notes = `Veículo: ${nome}${insight?.summary ? " | " + insight.summary : ""}`.slice(0, 800);
        await upsertLead({ conversationId, phone, vehicleId: vidAtual, vehicleInterest: nome, notes } as any);
        console.log(`[Coex] veículo atual da conversa = #${vidAtual} (${v?.nome || "?"})`);
      } else if (lead && !lead.vehicleId && lead.vehicleInterest && lead.vehicleInterest !== "não definido") {
        const vid = await resolveVehicleIdFromText(lead.vehicleInterest);
        if (vid) await upsertLead({ conversationId, phone, vehicleId: vid } as any);
      }
    } catch (e) { console.error("[Coex] amarrar veículo:", e); }

    // Classifica a intenção e atribui ao grupo certo (vendas/compras/posvenda).
    try {
      const { assignAgentByDepartment, getLeadByConversationId, createMessage } = await import("./db");
      const { emitNewMessage } = await import("./socket");
      const lead: any = await getLeadByConversationId(conversationId).catch(() => null);
      const dept = classifyHandoffIntent(`${outboundText} ${lead?.vehicleInterest || ""} ${lead?.notes || ""}`);
      console.log(`[Coex] intenção classificada = ${dept} (conv ${conversationId})`);
      const assigned = await assignAgentByDepartment(conversationId, dept, { phone, contactName: conv.contactName || undefined });
      if (assigned?.seller?.phone) {
        const { sendSellerNotification } = await import("./whatsapp");
        const notif = await sendSellerNotification(assigned.seller.phone, {
          sellerName: assigned.seller.name,
          customerName: conv.contactName || lead?.name || "Cliente",
          customerPhone: phone,
          vehicleInterest: lead?.vehicleInterest || "(a confirmar)",
          conversationSummary: lead?.notes || "Atendimento pelo agente da Meta (WhatsApp Business). Cliente encaminhado.",
          storeLocation: assigned.storeLocation,
          tradeVehicle: lead?.hasTrade ? lead?.tradeVehicle : null,
          paymentMethod: lead?.paymentMethod,
          downPayment: lead?.downPayment,
        });
        const hora = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const sys = await createMessage({ conversationId, content: `🔁 Lead transferido pela IA para ${assigned.seller.name} (${assigned.storeLocation}) em ${hora}.`, senderType: "internal", senderName: "Sistema", messageType: "system" } as any);
        emitNewMessage(conversationId, sys);
        if (notif?.message) {
          const nm = await createMessage({ conversationId, content: `📤 Mensagem enviada ao vendedor (${assigned.seller.name}):\n\n${notif.message}`, senderType: "internal", senderName: "Sistema", messageType: "system" } as any);
          emitNewMessage(conversationId, nm);
        }
        // Encaminha as FOTOS que o cliente mandou (troca/carro) pro vendedor.
        try {
          const { listMessages } = await import("./db");
          const { sendSellerMedia } = await import("./whatsapp");
          const msgs: any[] = await listMessages(conversationId, 80).catch(() => []);
          const fotos = msgs
            .filter((m) => m.senderType === "customer" && m.messageType === "image" && (m.metadata as any)?.mediaUrl)
            .map((m) => (m.metadata as any).mediaUrl as string);
          const ultimas = Array.from(new Set(fotos)).slice(-8);
          if (ultimas.length) {
            await sendSellerMedia(assigned.seller.phone, ultimas, `📷 Fotos enviadas pelo cliente ${conv.contactName || ""}`.trim());
            const fm = await createMessage({ conversationId, content: `📷 ${ultimas.length} foto(s) do cliente encaminhada(s) ao vendedor.`, senderType: "internal", senderName: "Sistema", messageType: "system" } as any);
            emitNewMessage(conversationId, fm);
          }
        } catch (e) { console.error("[Coex] encaminhar fotos:", e); }
        emitConversationUpdate(conversationId, {});
        console.log(`[Coex] handoff OK conv ${conversationId} → ${assigned.seller.name} (${assigned.storeLocation}).`);
      } else {
        console.warn(`[Coex] handoff sem vendedor ativo pra conv ${conversationId}`);
      }
    } catch (e) { console.error("[Coex] assign/notify:", e); }
  } catch (e) { console.error("[Coex] maybeRouteCoexistenceHandoff erro:", e); }
}
