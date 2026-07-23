/**
 * Meta Conversions API (CAPI) — tracking avançado de anúncios.
 *
 * Envia eventos de progresso do funil de volta para a Meta, permitindo que os
 * anúncios Click-to-WhatsApp (CTWA) otimizem para leads QUALIFICADOS e VENDAS,
 * não apenas para cliques.
 *
 * Mapeamento funil → evento Meta:
 *   interesse_definido            → Lead
 *   pagamento_definido            → SubmitApplication (lead qualificado)
 *   dados_pessoais / dados_troca  → SubmitApplication
 *   encaminhado_vendedor          → InitiateCheckout  (oportunidade real)
 *   negociando                    → InitiateCheckout
 *   fechado                       → Purchase (com valor do veículo em BRL)
 *
 * Origem do evento:
 *   - Lead veio de anúncio CTWA (tem ctwaId)   → action_source "business_messaging"
 *   - Lead veio do site (tem fbc/fbp/telefone) → action_source "website" com PII hasheada
 *
 * Dedupe: cada (leadId, eventName) é enviado no máximo 1 vez (tabela capiEvents).
 * LGPD: se lead.consent === false, nenhum dado é enviado.
 *
 * Config (tabela settings, editável na UI):
 *   capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code
 */
import { createHash, createHmac } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { capiEvents, leads, vehicles, type Lead } from "../drizzle/schema";
import { getDb, getSetting } from "./db";

const META_API_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── Mapeamento funil → evento ───────────────────────────────────────────────

type CapiEventDef = { eventName: string; stage: number };

const FUNNEL_EVENT_MAP: Record<string, CapiEventDef> = {
  interesse_definido:   { eventName: "Lead",              stage: 1 },
  pagamento_definido:   { eventName: "SubmitApplication", stage: 2 },
  dados_pessoais:       { eventName: "SubmitApplication", stage: 2 },
  dados_troca:          { eventName: "SubmitApplication", stage: 2 },
  encaminhado_vendedor: { eventName: "InitiateCheckout",  stage: 3 },
  negociando:           { eventName: "InitiateCheckout",  stage: 3 },
  fechado:              { eventName: "Purchase",          stage: 4 },
};

const LEAD_STATUS_EVENT_MAP: Record<string, CapiEventDef> = {
  qualified: { eventName: "SubmitApplication", stage: 2 },
  converted: { eventName: "Purchase",          stage: 4 },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/** Normaliza telefone BR para E.164 sem "+" antes do hash (padrão Meta). */
function normalizePhoneForHash(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length <= 11 && !digits.startsWith("55")) digits = `55${digits}`;
  return digits;
}

/** Adiciona primeiro/último nome hasheados (fn/ln) ao user_data, se houver nome.
 *  Meta exige minúsculas, sem acentos/pontuação antes do hash. */
function addHashedName(userData: Record<string, unknown>, name?: string | null): void {
  if (!name) return;
  const clean = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase().replace(/[^a-z\s]/g, "").trim().replace(/\s+/g, " ");
  if (!clean) return;
  const parts = clean.split(" ");
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  if (first) userData.fn = [sha256(first)];
  if (last) userData.ln = [sha256(last)];
}

/** Sinais estáveis presentes em (quase) todo lead: país BR + external_id do CRM.
 *  external_id é um identificador estável — reforça o matching sem expor PII. */
function addCommonSignals(userData: Record<string, unknown>, lead: Lead): void {
  if (!userData.country) userData.country = [sha256("br")];
  if (!userData.external_id && lead.id) userData.external_id = [sha256(String(lead.id))];
}

export type CapiConfig = {
  enabled: boolean;
  datasetId: string | null;
  accessToken: string | null;
  testEventCode: string | null;
  /** "settings" = token colado na UI; "env" = fallback do token WhatsApp do .env */
  tokenSource: "settings" | "env";
};

export async function getCapiConfig(): Promise<CapiConfig> {
  const [enabled, datasetId, accessToken, testEventCode] = await Promise.all([
    getSetting("capi_enabled"),
    getSetting("capi_dataset_id"),
    getSetting("capi_access_token"),
    getSetting("capi_test_event_code"),
  ]);
  const settingsToken = (accessToken || "").replace(/\s/g, ""); // remove espaços/quebras de linha do paste
  const envToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || null;
  return {
    enabled: enabled === "true",
    datasetId: (datasetId || "").trim() || null,
    accessToken: settingsToken || envToken,
    testEventCode: testEventCode || null,
    tokenSource: settingsToken ? "settings" : "env",
  };
}

/**
 * Parâmetros de autenticação para a Graph API.
 * Apps com "Require App Secret" (comum em Tech Providers verificados) exigem
 * appsecret_proof = HMAC-SHA256(token, app_secret). Só podemos calcular o proof
 * quando o token pertence ao nosso app (token do .env + META_APP_SECRET).
 */
function buildAuthParams(config: CapiConfig): Record<string, string> {
  const params: Record<string, string> = { access_token: config.accessToken! };
  const appSecret = process.env.META_APP_SECRET;
  if (config.tokenSource === "env" && appSecret) {
    params.appsecret_proof = createHmac("sha256", appSecret).update(config.accessToken!).digest("hex");
  }
  return params;
}

function isCapiConfigured(config: CapiConfig): boolean {
  return config.enabled && !!config.datasetId && !!config.accessToken;
}

// ─── Payload builder ─────────────────────────────────────────────────────────

function buildUserData(lead: Lead): { userData: Record<string, unknown>; actionSource: string } | null {
  // Lead Ads (Instant Forms): Meta Lead ID é o matching mais forte para
  // a otimização Conversion Leads — action_source "system_generated"
  if (lead.metaLeadId) {
    const userData: Record<string, unknown> = { lead_id: Number(lead.metaLeadId) };
    // Enriquecer com PII hasheada melhora o match rate
    if (lead.phone) userData.ph = [sha256(normalizePhoneForHash(lead.phone))];
    if (lead.email) userData.em = [sha256(lead.email)];
    addHashedName(userData, lead.name);
    addCommonSignals(userData, lead);
    return { userData, actionSource: "system_generated" };
  }

  // CTWA: click id do anúncio (matching forte) + PII hasheada para elevar a
  // Qualidade da Correspondência (EMQ). Combinar ctwa_clid com telefone/nome é
  // permitido e recomendado pela Meta.
  if (lead.ctwaId) {
    const userData: Record<string, unknown> = { ctwa_clid: lead.ctwaId };
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (wabaId) userData.whatsapp_business_account_id = wabaId;
    if (lead.phone) userData.ph = [sha256(normalizePhoneForHash(lead.phone))];
    if (lead.email) userData.em = [sha256(lead.email)];
    addHashedName(userData, lead.name);
    addCommonSignals(userData, lead);
    return { userData, actionSource: "business_messaging" };
  }

  // Website / matching por PII hasheada + cookies do Pixel
  const userData: Record<string, unknown> = {};
  if (lead.phone) userData.ph = [sha256(normalizePhoneForHash(lead.phone))];
  if (lead.email) userData.em = [sha256(lead.email)];
  if (lead.fbc) userData.fbc = lead.fbc;
  if (lead.fbp) userData.fbp = lead.fbp;

  // Só envia se houver ao menos UM identificador que casa com uma pessoa
  // (telefone, e-mail ou cookie do Pixel). Nome/país/external_id sozinhos não
  // identificam ninguém — sem isso, não vale a pena enviar (evita lixo no dataset).
  const hasMatchKey = !!(userData.ph || userData.em || userData.fbc || userData.fbp);
  if (!hasMatchKey) return null;

  addHashedName(userData, lead.name);
  if (lead.externalId) userData.external_id = [sha256(lead.externalId)];
  if (lead.clientIp) userData.client_ip_address = lead.clientIp;
  if (lead.clientUserAgent) userData.client_user_agent = lead.clientUserAgent;
  addCommonSignals(userData, lead);

  return { userData, actionSource: "website" };
}

/** Valor de conversão: preço do veículo de interesse (BRL). */
async function resolveConversionValue(lead: Lead): Promise<number | null> {
  if (!lead.vehicleId) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(vehicles).where(eq(vehicles.id, lead.vehicleId)).limit(1);
  return rows[0]?.price ?? null;
}

// ─── Envio ───────────────────────────────────────────────────────────────────

async function alreadySent(leadId: number, eventName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const rows = await db.select({ id: capiEvents.id }).from(capiEvents)
    .where(and(eq(capiEvents.leadId, leadId), eq(capiEvents.eventName, eventName), eq(capiEvents.status, "sent")))
    .limit(1);
  return rows.length > 0;
}

async function logEvent(entry: {
  leadId: number;
  conversationId?: number | null;
  eventName: string;
  funnelStatus?: string | null;
  actionSource?: string | null;
  value?: number | null;
  currency?: string | null;
  status: "sent" | "failed" | "skipped";
  error?: string | null;
  fbtraceId?: string | null;
  payload?: unknown;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(capiEvents).values({
    leadId: entry.leadId,
    conversationId: entry.conversationId ?? null,
    eventName: entry.eventName,
    funnelStatus: entry.funnelStatus ?? null,
    actionSource: entry.actionSource ?? null,
    value: entry.value != null ? String(entry.value) : null,
    currency: entry.currency ?? null,
    status: entry.status,
    error: entry.error ?? null,
    fbtraceId: entry.fbtraceId ?? null,
    payload: entry.payload ?? null,
  });
}

export async function sendCapiEvent(
  lead: Lead,
  eventDef: CapiEventDef,
  funnelStatus?: string | null
): Promise<{ success: boolean; error?: string }> {
  const config = await getCapiConfig();
  if (!isCapiConfigured(config)) {
    return { success: false, error: "CAPI não configurado" };
  }

  // LGPD: sem consentimento não enviamos nada
  if (lead.consent === false) {
    await logEvent({ leadId: lead.id, conversationId: lead.conversationId, eventName: eventDef.eventName, funnelStatus, status: "skipped", error: "Sem consentimento LGPD" });
    return { success: false, error: "Sem consentimento" };
  }

  if (await alreadySent(lead.id, eventDef.eventName)) {
    return { success: true }; // já enviado, dedupe silencioso
  }

  const identity = buildUserData(lead);
  if (!identity) {
    await logEvent({ leadId: lead.id, conversationId: lead.conversationId, eventName: eventDef.eventName, funnelStatus, status: "skipped", error: "Lead sem identificadores (ctwaId/fbc/fbp/telefone)" });
    return { success: false, error: "Lead sem identificadores para matching" };
  }

  const customData: Record<string, unknown> = {
    lead_event_source: "AutoInova CRM",
    event_source: "crm",
  };
  if (funnelStatus) customData.funnel_status = funnelStatus;
  if (lead.vehicleInterest) customData.content_name = lead.vehicleInterest;

  let value: number | null = null;
  if (eventDef.eventName === "Purchase") {
    value = await resolveConversionValue(lead);
    customData.currency = "BRL";
    customData.value = value ?? 0;
  }

  const event: Record<string, unknown> = {
    event_name: eventDef.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: `lead_${lead.id}_${eventDef.eventName}`, // dedupe também no lado da Meta
    action_source: identity.actionSource,
    user_data: identity.userData,
    custom_data: customData,
  };
  if (identity.actionSource === "business_messaging") {
    event.messaging_channel = "whatsapp";
  }

  const body: Record<string, unknown> = {
    data: [event],
    partner_agent: "autoinova_crm",
    ...buildAuthParams(config),
  };
  if (config.testEventCode) body.test_event_code = config.testEventCode;

  try {
    const res = await fetch(`${GRAPH_BASE}/${config.datasetId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok && (json as any).events_received >= 1) {
      await logEvent({
        leadId: lead.id, conversationId: lead.conversationId, eventName: eventDef.eventName,
        funnelStatus, actionSource: identity.actionSource, value, currency: value != null ? "BRL" : null,
        status: "sent", fbtraceId: (json as any).fbtrace_id ?? null, payload: event,
      });
      console.log(`[CAPI] ${eventDef.eventName} enviado para lead ${lead.id} (${identity.actionSource})${value != null ? ` valor R$${value}` : ""}`);
      return { success: true };
    }

    const errMsg = (json as any)?.error?.message || `HTTP ${res.status}`;
    await logEvent({
      leadId: lead.id, conversationId: lead.conversationId, eventName: eventDef.eventName,
      funnelStatus, actionSource: identity.actionSource, value, status: "failed", error: errMsg, payload: event,
    });
    console.error(`[CAPI] Falha ao enviar ${eventDef.eventName} para lead ${lead.id}: ${errMsg}`);
    return { success: false, error: errMsg };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logEvent({
      leadId: lead.id, conversationId: lead.conversationId, eventName: eventDef.eventName,
      funnelStatus, actionSource: identity.actionSource, value, status: "failed", error: errMsg,
    });
    return { success: false, error: errMsg };
  }
}

/**
 * Conversão vinda do SITE (autoinovars.com.br) — enviada direto pela CAPI,
 * sem Stape. O navegador dispara o Pixel; o servidor envia o mesmo evento
 * (mesmo event_id → deduplicado pela Meta). PII é hasheada aqui no servidor.
 */
export type SiteConversionInput = {
  eventName: string;              // "Contact" (clique WhatsApp) | "Lead" (formulário) | outro
  eventId?: string;               // p/ dedupe com o Pixel do navegador
  eventSourceUrl?: string;        // URL onde ocorreu
  fbp?: string;                   // cookie _fbp
  fbc?: string;                   // fbclid → fbc
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  clientIp?: string;              // preenchido pelo servidor
  clientUserAgent?: string;       // preenchido pelo servidor
  value?: number;
  currency?: string;
  customData?: Record<string, unknown>;
};

export async function sendWebsiteConversion(input: SiteConversionInput): Promise<{ success: boolean; error?: string }> {
  const config = await getCapiConfig();
  if (!isCapiConfigured(config)) return { success: false, error: "CAPI não configurado" };

  const userData: Record<string, unknown> = {};
  if (input.email) userData.em = [sha256(input.email)];
  if (input.phone) userData.ph = [sha256(normalizePhoneForHash(input.phone))];
  if (input.firstName) userData.fn = [sha256(input.firstName.toLowerCase().trim())];
  if (input.lastName) userData.ln = [sha256(input.lastName.toLowerCase().trim())];
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;
  userData.country = [sha256("br")];
  // external_id estável: e-mail ou telefone quando houver
  const ext = input.email || input.phone;
  if (ext) userData.external_id = [sha256(ext.toLowerCase().trim())];

  // Sem nenhum identificador não vale a pena enviar (não casa com ninguém)
  if (Object.keys(userData).length <= 1) return { success: false, error: "Sem identificadores (fbp/fbc/email/telefone)" };

  const customData: Record<string, unknown> = {
    lead_event_source: "AutoInova Site",
    event_source: "site",
    ...(input.customData || {}),
  };
  if (input.value != null) { customData.value = input.value; customData.currency = input.currency || "BRL"; }

  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: input.eventId || `site_${input.eventName}_${Date.now()}`,
    action_source: "website",
    event_source_url: input.eventSourceUrl,
    user_data: userData,
    custom_data: customData,
  };

  const body: Record<string, unknown> = {
    data: [event],
    partner_agent: "autoinova_crm",
    ...buildAuthParams(config),
  };
  if (config.testEventCode) body.test_event_code = config.testEventCode;

  try {
    const res = await fetch(`${GRAPH_BASE}/${config.datasetId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && (json as any).events_received >= 1) {
      await logEvent({ leadId: null as any, eventName: input.eventName, actionSource: "website", value: input.value ?? null, currency: input.value != null ? (input.currency || "BRL") : null, status: "sent", fbtraceId: (json as any).fbtrace_id ?? null, payload: event });
      console.log(`[CAPI-Site] ${input.eventName} enviado (${input.eventSourceUrl || "?"})`);
      return { success: true };
    }
    const errMsg = (json as any)?.error?.message || `HTTP ${res.status}`;
    await logEvent({ leadId: null as any, eventName: input.eventName, actionSource: "website", status: "failed", error: errMsg, payload: event });
    console.error(`[CAPI-Site] Falha ${input.eventName}: ${errMsg}`);
    return { success: false, error: errMsg };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logEvent({ leadId: null as any, eventName: input.eventName, actionSource: "website", status: "failed", error: errMsg });
    return { success: false, error: errMsg };
  }
}

/**
 * Hook principal — chamado sempre que o funil/status de um lead muda.
 * Fire-and-forget: nunca deve quebrar o fluxo principal do CRM.
 */
export async function trackLeadProgress(
  leadId: number,
  changes: { funnelStatus?: string | null; leadStatus?: string | null }
): Promise<void> {
  try {
    const config = await getCapiConfig();
    if (!isCapiConfigured(config)) return;

    const db = await getDb();
    if (!db) return;
    const rows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    const lead = rows[0];
    if (!lead) return;

    // ── QUALIDADE DO LEAD decide o que a Meta aprende ──────────────────────────
    // A Meta só aprende com o que reportamos. Prioridade do julgamento:
    //   1) VENDEDOR (botão "cliente bom / ruim") — manda mais que tudo
    //   2) CRÉDITO (aprovado = bom, negado = ruim)
    //   3) IA (sinais da conversa: visita, troca real, condição de compra)
    // "bom" libera o sinal forte mesmo sem crédito (ex.: visitou a loja, tem troca).
    // "ruim" bloqueia os eventos profundos — não ensinamos a buscar esse perfil.
    const q = (lead as any).quality as string | null;          // vendedor ou IA
    const qSource = (lead as any).qualitySource as string | null;
    const credito = (lead as any).creditApproved as string | null;

    let bomLead = false, ruimLead = false;
    if (q === "alta") bomLead = true;
    else if (q === "baixa") ruimLead = true;
    // Crédito só decide se o VENDEDOR não tiver julgado manualmente
    if (qSource !== "vendedor") {
      if (credito === "sim") bomLead = true;
      else if (credito === "nao" && q !== "alta") ruimLead = true;
    }

    const semCredito = ruimLead; // mantém o nome usado abaixo
    const onlyQualified = (await getSetting("capi_only_credit_approved")) === "true" && !bomLead;

    const events = new Map<string, { def: CapiEventDef; funnel: string | null }>();
    if (changes.funnelStatus && FUNNEL_EVENT_MAP[changes.funnelStatus]) {
      const def = FUNNEL_EVENT_MAP[changes.funnelStatus];
      const isDeepEvent = def.eventName !== "Lead";
      // Bloqueia eventos profundos de quem está sem crédito
      const blockedNoCredit = semCredito && isDeepEvent;
      // Modo estrito (opcional): só reporta evento profundo com crédito APROVADO
      const blockedStrict = onlyQualified && isDeepEvent && (lead as any).creditApproved !== "sim";
      if (blockedNoCredit || blockedStrict) {
        console.log(`[CAPI] lead ${lead.id}: ${def.eventName} BLOQUEADO (crédito=${(lead as any).creditApproved ?? "não avaliado"}) — não vamos ensinar a Meta a buscar esse perfil`);
      } else {
        events.set(def.eventName, { def, funnel: changes.funnelStatus });
      }
    }
    if (changes.leadStatus && LEAD_STATUS_EVENT_MAP[changes.leadStatus]) {
      const def = LEAD_STATUS_EVENT_MAP[changes.leadStatus];
      // "converted" (venda) SEMPRE vale — venda é venda, mesmo à vista sem financiamento.
      const isPurchase = def.eventName === "Purchase";
      const blocked = !isPurchase && (semCredito || (onlyQualified && (lead as any).creditApproved !== "sim"));
      if (blocked) {
        console.log(`[CAPI] lead ${lead.id}: ${def.eventName} BLOQUEADO (crédito=${(lead as any).creditApproved ?? "não avaliado"})`);
      } else if (!events.has(def.eventName)) {
        events.set(def.eventName, { def, funnel: changes.funnelStatus ?? null });
      }
    }

    // Atribuição CTWA: os eventos do funil devem ser reportados na conversa
    // ORIGINAL do Zernio (onde o anúncio caiu — a recepção/bianca), mesmo que o
    // lead já tenha sido passado para o vendedor em outra instância. É essa
    // conversa que o Zernio consegue atribuir ao anúncio.
    let zConv: { zConvId?: string; accountId?: string } | null = null;
    try {
      const { conversations } = await import("../drizzle/schema");
      // Todas as conversas Zernio DESTE lead (pessoa), da mais antiga p/ a nova
      const zerConvs = (await db.select().from(conversations)
        .where(and(eq(conversations.leadId, lead.id), eq(conversations.channel, "zernio" as any))))
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      // Fallback: a conversa registrada no lead (se não achou por leadId)
      let primary: any = zerConvs[0];
      if (!primary) {
        const c = (await db.select().from(conversations).where(eq(conversations.id, lead.conversationId)).limit(1))[0];
        if (c?.channel === "zernio") primary = c;
      }
      if (primary) {
        zConv = {
          zConvId: (primary.metadata as any)?.zernioConversationId,
          accountId: (primary.metadata as any)?.zernioAccountId || primary.instanceName,
        };
      }
    } catch { /* opcional */ }

    // Mapa evento Meta → nome aceito pelo Zernio
    const zEventMap: Record<string, "LeadSubmitted" | "Purchase" | "AddToCart" | "InitiateCheckout" | "ViewContent"> = {
      Lead: "LeadSubmitted", SubmitApplication: "AddToCart", InitiateCheckout: "InitiateCheckout", Purchase: "Purchase",
    };

    // A conversa é do Zernio (tem a origem do anúncio CTWA)?
    const isZernio = !!(zConv?.zConvId && zConv.accountId);

    for (const { def, funnel } of Array.from(events.values())) {
      const zName = zEventMap[def.eventName];

      // Conversa do Zernio: envia SÓ pelo Zernio (dataset da instância, já
      // atribuído ao anúncio). Evita contagem dupla com o pixel principal.
      // A atribuição fica ancorada na conversa ORIGINAL da bianca, então mesmo
      // que o vendedor feche em outro número Zernio, a venda credita o anúncio dela.
      if (isZernio && zName) {
        // dedupe: cada (leadId, eventName) enviado no máx. 1 vez
        if (await alreadySent(lead.id, def.eventName)) continue;
        try {
          // Otimização por valor: manda o valor do veículo também nos eventos
          // fundos (negociação/qualificado), não só na venda. Assim a Meta busca
          // quem fecha carro CARO, não qualquer lead. O endpoint do Zernio só
          // aceita value+currency (não há custom_data/content).
          let value: number | undefined;
          if (["Purchase", "InitiateCheckout", "SubmitApplication"].includes(def.eventName)) {
            value = (await resolveConversionValue(lead)) ?? undefined;
          }
          const { zernioSendConversion } = await import("./zernioService");
          const r = await zernioSendConversion({
            accountId: zConv!.accountId!, conversationId: zConv!.zConvId!,
            eventName: zName, eventId: `lead_${lead.id}_${def.eventName}`,
            value, currency: value != null ? "BRL" : undefined,
          });
          if (r.success) {
            // registra no MESMO log do painel, marcado como "zernio"
            await logEvent({
              leadId: lead.id, conversationId: lead.conversationId, eventName: def.eventName,
              funnelStatus: funnel, actionSource: "zernio", value: value ?? null,
              currency: value != null ? "BRL" : null, status: "sent",
              payload: { via: "zernio", zEvent: zName, accountId: zConv!.accountId, conversationId: zConv!.zConvId },
            });
            console.log(`[CAPI/Zernio] ${def.eventName} → ${zName} enviado (lead ${lead.id}, conv Zernio ${zConv!.zConvId})`);
          } else {
            console.error("[Zernio][Conv] falhou — fallback p/ CAPI direto:", r.error);
            await sendCapiEvent(lead, def, funnel); // não perde o evento se o Zernio falhar
          }
        } catch (e) {
          console.error("[Zernio][Conv] erro — fallback p/ CAPI direto:", e);
          await sendCapiEvent(lead, def, funnel); // não perde o evento se o Zernio falhar
        }
        continue;
      }

      // Demais conversas (site / Evolution / API oficial) OU evento sem mapa no
      // Zernio: CAPI direto no dataset principal, matching por PII hasheada.
      await sendCapiEvent(lead, def, funnel);
    }
  } catch (err) {
    console.error("[CAPI] trackLeadProgress erro (ignorado):", err);
  }
}

/** Envia evento de teste para validar a configuração no Events Manager. */
export async function sendTestEvent(): Promise<{ success: boolean; error?: string; response?: unknown }> {
  const config = await getCapiConfig();
  if (!config.datasetId || !config.accessToken) {
    return { success: false, error: "Configure o Dataset ID e o Access Token primeiro." };
  }
  const body: Record<string, unknown> = {
    data: [{
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `test_${Date.now()}`,
      action_source: "website",
      user_data: { ph: [sha256("5551999999999")] },
      custom_data: { lead_event_source: "AutoInova CRM", event_source: "crm", test: true },
    }],
    partner_agent: "autoinova_crm",
    ...buildAuthParams(config),
  };
  if (config.testEventCode) body.test_event_code = config.testEventCode;
  try {
    const res = await fetch(`${GRAPH_BASE}/${config.datasetId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && (json as any).events_received >= 1) return { success: true, response: json };
    return { success: false, error: (json as any)?.error?.message || `HTTP ${res.status}`, response: json };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Lista os últimos eventos CAPI enviados (para a UI de auditoria). */
export async function listCapiEvents(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(capiEvents).orderBy(desc(capiEvents.createdAt)).limit(limit);
}
