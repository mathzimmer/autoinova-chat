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
import { createHash } from "crypto";
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

export type CapiConfig = {
  enabled: boolean;
  datasetId: string | null;
  accessToken: string | null;
  testEventCode: string | null;
};

export async function getCapiConfig(): Promise<CapiConfig> {
  const [enabled, datasetId, accessToken, testEventCode] = await Promise.all([
    getSetting("capi_enabled"),
    getSetting("capi_dataset_id"),
    getSetting("capi_access_token"),
    getSetting("capi_test_event_code"),
  ]);
  return {
    enabled: enabled === "true",
    datasetId: datasetId || null,
    accessToken: accessToken || process.env.WHATSAPP_SYSTEM_USER_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || null,
    testEventCode: testEventCode || null,
  };
}

function isCapiConfigured(config: CapiConfig): boolean {
  return config.enabled && !!config.datasetId && !!config.accessToken;
}

// ─── Payload builder ─────────────────────────────────────────────────────────

function buildUserData(lead: Lead): { userData: Record<string, unknown>; actionSource: string } | null {
  // CTWA: identificação direta pelo click id do anúncio (mais forte, sem PII)
  if (lead.ctwaId) {
    const userData: Record<string, unknown> = { ctwa_clid: lead.ctwaId };
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (wabaId) userData.whatsapp_business_account_id = wabaId;
    return { userData, actionSource: "business_messaging" };
  }

  // Website / matching por PII hasheada + cookies do Pixel
  const userData: Record<string, unknown> = {};
  if (lead.phone) userData.ph = [sha256(normalizePhoneForHash(lead.phone))];
  if (lead.email) userData.em = [sha256(lead.email)];
  if (lead.fbc) userData.fbc = lead.fbc;
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.externalId) userData.external_id = [sha256(lead.externalId)];
  if (lead.clientIp) userData.client_ip_address = lead.clientIp;
  if (lead.clientUserAgent) userData.client_user_agent = lead.clientUserAgent;

  if (Object.keys(userData).length === 0) return null;
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
  };
  if (config.testEventCode) body.test_event_code = config.testEventCode;

  try {
    const res = await fetch(`${GRAPH_BASE}/${config.datasetId}/events?access_token=${encodeURIComponent(config.accessToken!)}`, {
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

    const events = new Map<string, { def: CapiEventDef; funnel: string | null }>();
    if (changes.funnelStatus && FUNNEL_EVENT_MAP[changes.funnelStatus]) {
      const def = FUNNEL_EVENT_MAP[changes.funnelStatus];
      events.set(def.eventName, { def, funnel: changes.funnelStatus });
    }
    if (changes.leadStatus && LEAD_STATUS_EVENT_MAP[changes.leadStatus]) {
      const def = LEAD_STATUS_EVENT_MAP[changes.leadStatus];
      if (!events.has(def.eventName)) events.set(def.eventName, { def, funnel: changes.funnelStatus ?? null });
    }

    for (const { def, funnel } of Array.from(events.values())) {
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
  };
  if (config.testEventCode) body.test_event_code = config.testEventCode;
  try {
    const res = await fetch(`${GRAPH_BASE}/${config.datasetId}/events?access_token=${encodeURIComponent(config.accessToken)}`, {
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
