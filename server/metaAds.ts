// ═══════════════════════════════════════════════════════════════════════════════
// ARQUIVO: server/metaAds.ts
// ═══════════════════════════════════════════════════════════════════════════════

import { getDb } from "./db";
import { vehicles, metaAds } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const META_API_VERSION = "v21.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// Número fixo da Auto Inova (WhatsApp Business)
const AUTOINOVA_WHATSAPP = "555131919081";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type MetaAdsConfig = {
  accessToken: string;
  adAccountId: string;
  pageId: string;
  instagramActorId?: string;
  defaultBudgetCents: number;
  defaultTargeting: MetaTargeting;
  /** Número WhatsApp de destino (exibição/wa.me). O CTWA real usa o WhatsApp vinculado à Página. */
  whatsappNumber?: string;
  /**
   * Template da mensagem de boas-vindas que o cliente envia ao clicar no anúncio.
   * Suporta {{marca}} {{modelo}} {{ano}} {{id}} {{preco}}. O ID é SEMPRE garantido
   * no final (o fluxo depende dele para identificar o veículo).
   */
  welcomeMessageTemplate?: string;
};

export type MetaTargeting = {
  geo_locations: {
    cities?: Array<{ key: string; radius: number; distance_unit: "kilometer" }>;
    countries?: string[];
  };
  age_min: number;
  age_max: number;
  flexible_spec?: Array<{ interests?: Array<{ id: string; name: string }> }>;
};

export type CreateAdResult = {
  success: boolean;
  campaignId?: string;
  adSetId?: string;
  adCreativeId?: string;
  adId?: string;
  imageHash?: string;
  error?: string;
  vehicleId: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function metaPost(
  endpoint: string,
  params: Record<string, unknown>,
  accessToken: string
): Promise<Record<string, unknown>> {
  const url = endpoint.startsWith("http") ? endpoint : `${META_BASE}/${endpoint}`;
  const body = { ...params, access_token: accessToken };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json() as any;
  if (!res.ok || data.error) {
    console.error(`[MetaAds] POST ${endpoint} falhou:`, data.error ? JSON.stringify(data.error, null, 2) : `HTTP ${res.status}`);
    throw new Error(formatMetaError(data.error, res.status));
  }
  return data;
}

/**
 * A Meta quase sempre devolve "Invalid parameter" no campo `message`. O motivo
 * REAL vem em error_user_title/error_user_msg e o campo problemático em
 * error_data.blame_field_specs. Junta tudo para o erro ser útil na tela.
 */
export function formatMetaError(err: any, httpStatus?: number): string {
  if (!err) return `HTTP ${httpStatus ?? "?"}`;
  const humano = [err.error_user_title, err.error_user_msg].filter(Boolean).join(" — ");
  const base = humano || err.message || `HTTP ${httpStatus ?? "?"}`;
  const partes: string[] = [base];
  if (err.error_subcode) partes.push(`(subcode ${err.error_subcode})`);
  let blame = err.error_data?.blame_field_specs ?? err.error_data;
  if (blame) {
    if (typeof blame === "string") { try { blame = JSON.parse(blame); } catch { /* texto puro */ } }
    const campos = Array.isArray(blame) ? blame.flat().filter(Boolean).join(", ") : (blame?.blame_field_specs ? String(blame.blame_field_specs) : "");
    if (campos) partes.push(`— campo: ${campos}`);
  }
  return partes.join(" ");
}

export async function metaGet(
  endpoint: string,
  params: Record<string, string>,
  accessToken: string
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: accessToken }).toString();
  const res = await fetch(`${META_BASE}/${endpoint}?${qs}`);
  const data = await res.json() as any;
  if (!res.ok || data.error) {
    console.error(`[MetaAds] GET ${endpoint} falhou:`, data.error ? JSON.stringify(data.error, null, 2) : `HTTP ${res.status}`);
    throw new Error(formatMetaError(data.error, res.status));
  }
  return data;
}

// ─── Passo 1: Campanha ────────────────────────────────────────────────────────

export async function createOrGetCampaign(
  config: MetaAdsConfig,
  campaignName: string = "AutoInova — Geração de Leads"
): Promise<string> {
  console.log(`[MetaAds] Criando campanha: "${campaignName}"`);
  const result = await metaPost(
    `act_${config.adAccountId}/campaigns`,
    {
      name: campaignName,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: [],
      buying_type: "AUCTION",
    },
    config.accessToken
  );
  console.log(`[MetaAds] Campanha criada: ${result.id}`);
  return result.id as string;
}

// ─── Passo 2: AdSet ───────────────────────────────────────────────────────────

export async function createAdSet(
  config: MetaAdsConfig,
  campaignId: string,
  vehicle: { brand: string; model: string; year: number; id: number },
  budgetCents?: number
): Promise<string> {
  const name = `${vehicle.brand} ${vehicle.model} ${vehicle.year} — #${vehicle.id}`;
  console.log(`[MetaAds] Criando AdSet: "${name}"`);

  const endTime = new Date();
  endTime.setDate(endTime.getDate() + 30);

  const result = await metaPost(
    `act_${config.adAccountId}/adsets`,
    {
      name,
      campaign_id: campaignId,
      daily_budget: budgetCents ?? config.defaultBudgetCents,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION",
      targeting: config.defaultTargeting,
      status: "PAUSED",
      end_time: Math.floor(endTime.getTime() / 1000),
      promoted_object: { page_id: config.pageId },
    },
    config.accessToken
  );

  console.log(`[MetaAds] AdSet criado: ${result.id}`);
  return result.id as string;
}

// ─── Passo 3: Upload de Imagem ────────────────────────────────────────────────

export async function uploadAdImage(
  config: MetaAdsConfig,
  imageUrl: string
): Promise<string> {
  console.log(`[MetaAds] Upload de imagem: ${imageUrl}`);

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Falha ao baixar imagem: ${imgRes.status}`);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

  const formData = new FormData();
  formData.append("access_token", config.accessToken);
  formData.append("filename", new Blob([imgBuffer], { type: "image/jpeg" }), "veiculo.jpg");

  const res = await fetch(`${META_BASE}/act_${config.adAccountId}/adimages`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json() as any;
  if (!res.ok || data.error) throw new Error(data.error?.message || "Falha no upload de imagem");

  const imageHash = data.images?.["veiculo.jpg"]?.hash;
  if (!imageHash) throw new Error("image_hash não encontrado na resposta da Meta");

  console.log(`[MetaAds] Imagem enviada, hash: ${imageHash}`);
  return imageHash;
}

// ─── Passo 4: Criativo ────────────────────────────────────────────────────────

export async function createAdCreative(
  config: MetaAdsConfig,
  imageHash: string,
  vehicle: {
    brand: string; model: string; year: number;
    price: number; mileage: number; transmission: string;
    fuel: string; color: string; id: number;
  },
  whatsappLink: string
): Promise<string> {
  const fmtPrice = vehicle.price.toLocaleString("pt-BR", {
    style: "currency", currency: "BRL", maximumFractionDigits: 0,
  });
  const fmtKm = vehicle.mileage.toLocaleString("pt-BR");

  const headline = `${vehicle.brand} ${vehicle.model} ${vehicle.year} — ${fmtPrice}`;
  const description = `${fmtKm} km · ${vehicle.transmission} · ${vehicle.color}`;

  // FIX 1: retorna objeto (não string) para evitar double-encode no JSON.stringify do metaPost
  function buildWelcomeMessageObject() {
    const makeObj = (content: string, text: string) => ({
      type: "VISUAL_EDITOR",
      version: 2,
      landing_screen_type: "welcome_message",
      media_type: "text",
      text_format: {
        customer_action_type: "autofill_message",
        message: {
          autofill_message: { content },
          text,
        },
      },
    });

    // Garante o ID do veículo no fim do texto (o fluxo depende de "ID<n>")
    const withId = (s: string) => (s.includes(`ID${vehicle.id}`) ? s : `${s} ID${vehicle.id}`.trim());
    const fmtPrice2 = vehicle.price?.toLocaleString?.("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) || "";
    const fillVars = (tpl: string) => tpl
      .replace(/\{\{\s*marca\s*\}\}/gi, vehicle.brand || "")
      .replace(/\{\{\s*modelo\s*\}\}/gi, vehicle.model || "")
      .replace(/\{\{\s*ano\s*\}\}/gi, String(vehicle.year || ""))
      .replace(/\{\{\s*preco\s*\}\}/gi, fmtPrice2)
      .replace(/\{\{\s*id\s*\}\}/gi, `ID${vehicle.id}`)
      .trim();

    // Template personalizado (ou o padrão), sempre com o ID garantido
    const tpl = config.welcomeMessageTemplate?.trim()
      || "Olá, tenho interesse no veículo: {{marca}} {{modelo}} {{ano}} {{id}}";
    const customContent = withId(fillVars(tpl));

    const attempts = [
      { content: customContent, text: `Olá! Bem-vindo à Auto Inova! 👋` },
      { content: withId(fillVars("Interesse no veículo: {{marca}} {{modelo}} {{id}}")), text: `Olá!` },
      { content: withId("Olá, tenho interesse neste veículo!"), text: vehicle.brand },
      { content: withId("Olá!"), text: "" },
    ];

    for (const a of attempts) {
      if (JSON.stringify(makeObj(a.content, a.text)).length <= 300) {
        return makeObj(a.content, a.text);
      }
    }
    return makeObj(`ID${vehicle.id}`, "");
  }

  console.log(`[MetaAds] Criando criativo Click to WhatsApp para ${vehicle.brand} ${vehicle.model}`);

  const result = await metaPost(
    `act_${config.adAccountId}/adcreatives`,
    {
      name: `Criativo — ${vehicle.brand} ${vehicle.model} #${vehicle.id}`,
      object_story_spec: {
        page_id: config.pageId,
        ...(config.instagramActorId ? { instagram_user_id: config.instagramActorId } : {}),
        link_data: {
          image_hash: imageHash,
          link: `https://api.whatsapp.com/send`,
          message: description,
          name: headline,
          description,
          call_to_action: {
            type: "WHATSAPP_MESSAGE",
            value: { app_destination: "WHATSAPP" },
          },
          page_welcome_message: buildWelcomeMessageObject(),
        },
      },
    },
    config.accessToken
  );

  console.log(`[MetaAds] Criativo criado (Click to WhatsApp): ${result.id}`);
  return result.id as string;
}

// ─── Passo 5: Anúncio Final ───────────────────────────────────────────────────

export async function createAd(
  config: MetaAdsConfig,
  adSetId: string,
  adCreativeId: string,
  vehicle: { brand: string; model: string; year: number; id: number }
): Promise<string> {
  const name = `Anúncio — ${vehicle.brand} ${vehicle.model} ${vehicle.year} #${vehicle.id}`;
  console.log(`[MetaAds] Criando anúncio: "${name}"`);

  const result = await metaPost(
    `act_${config.adAccountId}/ads`,
    {
      name,
      adset_id: adSetId,
      creative: { creative_id: adCreativeId },
      status: "PAUSED",
    },
    config.accessToken
  );

  console.log(`[MetaAds] Anúncio criado: ${result.id}`);
  return result.id as string;
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function createAdForVehicle(
  vehicleId: number,
  campaignId: string | null,
  config: MetaAdsConfig,
  budgetCents?: number
): Promise<CreateAdResult> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database indisponível", vehicleId };

  try {
    const vehicleRows = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicleRows.length) return { success: false, error: "Veículo não encontrado", vehicleId };
    const v = vehicleRows[0];

    if (!v.imageUrl) return { success: false, error: "Veículo sem imagem — obrigatório para anúncio", vehicleId };

    const waMsg = encodeURIComponent(
      `Olá, tenho interesse no veículo: ${v.brand} ${v.model} ${v.year} ID${v.id}`
    );
    const whatsappLink = `https://wa.me/${config.whatsappNumber || AUTOINOVA_WHATSAPP}?text=${waMsg}`;

    const finalCampaignId = campaignId ?? (await createOrGetCampaign(config));
    const adSetId       = await createAdSet(config, finalCampaignId, v, budgetCents);
    const imageHash     = await uploadAdImage(config, v.imageUrl);
    const adCreativeId  = await createAdCreative(config, imageHash, {
      brand: v.brand, model: v.model, year: v.year,
      price: v.price, mileage: v.mileage ?? 0,
      transmission: v.transmission ?? "manual",
      fuel: v.fuel ?? "flex",
      color: v.color ?? "",
      id: v.id,
    }, whatsappLink);
    const adId = await createAd(config, adSetId, adCreativeId, v);

    await db.insert(metaAds).values({
      vehicleId,
      campaignId: finalCampaignId,
      adSetId,
      adCreativeId,
      adId,
      imageHash,
      status: "paused",
      dailyBudgetCents: budgetCents ?? config.defaultBudgetCents,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`[MetaAds] ✅ Anúncio criado para veículo #${vehicleId}: adId=${adId}`);
    return { success: true, campaignId: finalCampaignId, adSetId, adCreativeId, adId, imageHash, vehicleId };

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error(`[MetaAds] ❌ Falha ao criar anúncio para veículo #${vehicleId}:`, msg);
    return { success: false, error: msg, vehicleId };
  }
}

// ─── Testar conexão ───────────────────────────────────────────────────────────
export async function testMetaConnection(config: MetaAdsConfig): Promise<{ ok: boolean; account?: string; currency?: string; page?: string; error?: string }> {
  try {
    if (!config.accessToken) return { ok: false, error: "Token de acesso não configurado (META_ADS_ACCESS_TOKEN)" };
    if (!config.adAccountId) return { ok: false, error: "ID da conta de anúncios não configurado (META_ADS_ACCOUNT_ID)" };
    const acc = await metaGet(`act_${config.adAccountId}`, { fields: "name,account_status,currency" }, config.accessToken) as any;
    let page: string | undefined;
    if (config.pageId) {
      try { const p = await metaGet(config.pageId, { fields: "name" }, config.accessToken) as any; page = p?.name; } catch { /* página inválida */ }
    }
    return { ok: true, account: acc?.name, currency: acc?.currency, page };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na conexão" };
  }
}

// ─── Ativar / Pausar ──────────────────────────────────────────────────────────

export async function setAdStatus(
  adId: string,
  status: "ACTIVE" | "PAUSED",
  accessToken: string
): Promise<boolean> {
  try {
    await metaPost(adId, { status }, accessToken);
    return true;
  } catch {
    return false;
  }
}

// ─── Métricas ─────────────────────────────────────────────────────────────────

export type AdInsights = {
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  cpl: number;
};

export async function getAdInsights(
  adId: string,
  accessToken: string
): Promise<AdInsights | null> {
  try {
    const data = await metaGet(
      `${adId}/insights`,
      { fields: "impressions,clicks,actions,spend", date_preset: "last_30d" },
      accessToken
    ) as any;

    const d = (data.data as any[])?.[0];
    if (!d) return null;

    const leads = parseInt((d.actions as any[])?.find((a: any) => a.action_type === "lead")?.value ?? "0");
    return {
      impressions: parseInt(d.impressions ?? "0"),
      clicks:      parseInt(d.clicks ?? "0"),
      leads,
      spend:       parseFloat(d.spend ?? "0"),
      cpl:         leads > 0 ? parseFloat(d.spend ?? "0") / leads : 0,
    };
  } catch {
    return null;
  }
}

// ─── Importar anúncios existentes da conta Meta ────────────────────────────

export async function importAdsFromMeta(
  accessToken: string,
  adAccountId: string
): Promise<{ imported: number; updated: number; errors: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  let imported = 0, updated = 0, errors = 0;

  try {
    const adsRes = await fetch(
      `${META_BASE}/${actId}/ads?fields=id,name,status,adset_id,campaign_id,creative{id,name,thumbnail_url}&limit=100&access_token=${accessToken}`
    );
    const adsData = await adsRes.json() as any;
    if (adsData.error) throw new Error(adsData.error.message);

    const remoteAds = adsData.data || [];
    console.log(`[MetaAds] Importando ${remoteAds.length} anúncios da conta Meta...`);

    const insightsRes = await fetch(
      `${META_BASE}/${actId}/insights?fields=ad_id,impressions,clicks,spend,actions&level=ad&date_preset=last_30d&limit=100&access_token=${accessToken}`
    );
    const insightsData = await insightsRes.json() as any;
    const insightsMap = new Map<string, { impressions: number; clicks: number; leads: number; spend: number }>();
    for (const d of (insightsData.data || [])) {
      const leads = parseInt((d.actions || []).find((a: any) => a.action_type === "lead")?.value || "0");
      insightsMap.set(d.ad_id, {
        impressions: parseInt(d.impressions || "0"),
        clicks: parseInt(d.clicks || "0"),
        leads,
        spend: parseFloat(d.spend || "0"),
      });
    }

    for (const ad of remoteAds) {
      try {
        const adId = ad.id;
        const statusMap: Record<string, "active" | "paused" | "archived"> = {
          ACTIVE: "active",
          PAUSED: "paused",
          ARCHIVED: "archived",
          DELETED: "archived",
        };
        const status = statusMap[ad.status] || "paused";
        const metrics = insightsMap.get(adId);
        const thumbnailUrl = ad.creative?.thumbnail_url || null;

        const existing = await db.select({ id: metaAds.id }).from(metaAds).where(eq(metaAds.adId, adId)).limit(1);

        if (existing.length > 0) {
          await db.update(metaAds).set({
            status,
            adName: ad.name || null,
            thumbnailUrl,
            ...(metrics ? {
              impressions: metrics.impressions,
              clicks: metrics.clicks,
              leads: metrics.leads,
              spendCents: Math.round(metrics.spend * 100),
              lastInsightSync: new Date(),
            } : {}),
            updatedAt: new Date(),
          }).where(eq(metaAds.adId, adId));
          updated++;
        } else {
          await db.insert(metaAds).values({
            vehicleId: null as any,
            campaignId: ad.campaign_id || "unknown",
            adSetId: ad.adset_id || null,
            adCreativeId: ad.creative?.id || null,
            adId,
            adName: ad.name || null,
            thumbnailUrl,
            status,
            source: "imported",
            dailyBudgetCents: 0,
            impressions: metrics?.impressions || 0,
            clicks: metrics?.clicks || 0,
            leads: metrics?.leads || 0,
            spendCents: metrics ? Math.round(metrics.spend * 100) : 0,
            lastInsightSync: metrics ? new Date() : null,
            createdAt: new Date(),
          });
          imported++;
        }
      } catch (e) {
        console.error(`[MetaAds] Erro ao importar anúncio ${ad.id}:`, e);
        errors++;
      }
    }

    console.log(`[MetaAds] Importação concluída: ${imported} novos, ${updated} atualizados, ${errors} erros`);
    return { imported, updated, errors };
  } catch (e) {
    console.error("[MetaAds] Erro na importação:", e);
    throw e;
  }
}

// ─── Listar campanhas existentes ──────────────────────────────────────────────

export async function listCampaigns(
  accessToken: string,
  adAccountId: string
): Promise<Array<{ id: string; name: string; status: string; objective: string }>> {
  const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const data = await metaGet(
    `${actId}/campaigns`,
    { fields: "id,name,status,objective", limit: "100" },
    accessToken
  ) as any;
  return (data.data || []).map((c: any) => ({
    id: c.id,
    name: c.name || "Sem nome",
    status: c.status || "UNKNOWN",
    objective: c.objective || "UNKNOWN",
  }));
}

// ─── Listar adsets de uma campanha ───────────────────────────────────────────

export async function listAdSets(
  accessToken: string,
  campaignId: string
): Promise<Array<{ id: string; name: string; status: string; dailyBudget: string; effectiveStatus?: string; destinationType?: string }>> {
  // Por padrão a Meta esconde conjuntos ARQUIVADOS/EXCLUÍDOS. Pedimos todos os
  // status explicitamente para o conjunto aparecer mesmo pausado/arquivado.
  const data = await metaGet(
    `${campaignId}/adsets`,
    {
      fields: "id,name,status,effective_status,daily_budget,destination_type",
      limit: "200",
      date_preset: "maximum",
      filtering: JSON.stringify([{
        field: "effective_status",
        operator: "IN",
        value: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PENDING_REVIEW", "IN_PROCESS", "WITH_ISSUES", "ARCHIVED"],
      }]),
    },
    accessToken
  ) as any;
  const list = (data.data || []).map((a: any) => ({
    id: a.id,
    name: a.name || "Sem nome",
    status: a.status || "UNKNOWN",
    effectiveStatus: a.effective_status || undefined,
    destinationType: a.destination_type || undefined,
    dailyBudget: a.daily_budget || "0",
  }));
  console.log(`[MetaAds] campanha ${campaignId}: ${list.length} conjunto(s) encontrado(s)`);
  return list;
}

// ─── Criar anúncio em adset existente ────────────────────────────────────────

export async function createAdInExistingAdSet(
  config: MetaAdsConfig,
  adSetId: string,
  campaignId: string,
  vehicle: {
    brand: string; model: string; year: number;
    price: number; mileage: number; transmission: string;
    fuel: string; color: string; id: number; imageUrl: string;
  },
  texts: {
    headline: string;
    description: string;
    primaryText: string;
  },
  selectedImageUrl?: string,
  campaignObjective?: string,
  carouselImageUrls?: string[],
  carouselCaptions?: string[],
  pixelId?: string
): Promise<{ adId: string; adCreativeId: string; imageHash: string }> {
  const imgUrl = selectedImageUrl || vehicle.imageUrl;
  if (!imgUrl) throw new Error("Veículo sem imagem");

  const waMsg = encodeURIComponent(
    `Olá, tenho interesse no veículo: ${vehicle.brand} ${vehicle.model} ${vehicle.year} ID${vehicle.id}`
  );
  // FIX 2: sempre usar o número fixo da Auto Inova
  const whatsappLink = `https://wa.me/${AUTOINOVA_WHATSAPP}?text=${waMsg}`;

  const isCarousel = carouselImageUrls && carouselImageUrls.length >= 2;

  let imageHash: string;
  let carouselHashes: string[] = [];
  if (isCarousel) {
    console.log(`[MetaAds] Uploading ${carouselImageUrls.length} images for carousel...`);
    for (const url of carouselImageUrls.slice(0, 10)) {
      carouselHashes.push(await uploadAdImage(config, url));
    }
    imageHash = carouselHashes[0];
  } else {
    imageHash = await uploadAdImage(config, imgUrl);
  }

  const isEngagementOrMessaging = campaignObjective === "OUTCOME_ENGAGEMENT" ||
    campaignObjective === "OUTCOME_SALES" ||
    campaignObjective === "OUTCOME_LEADS";

  // FIX 1: retorna objeto, não string — evita double-encode
  function buildWelcomeMessageObject() {
    const makeObj = (content: string, text: string) => ({
      type: "VISUAL_EDITOR",
      version: 2,
      landing_screen_type: "welcome_message",
      media_type: "text",
      text_format: {
        customer_action_type: "autofill_message",
        message: {
          autofill_message: { content },
          text,
        },
      },
    });

    // Garante o ID no fim (o fluxo depende de "ID<n>")
    const withId = (s: string) => (s.includes(`ID${vehicle.id}`) ? s : `${s} ID${vehicle.id}`.trim());
    const fmtP = vehicle.price?.toLocaleString?.("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) || "";
    const fillVars = (tpl: string) => tpl
      .replace(/\{\{\s*marca\s*\}\}/gi, vehicle.brand || "")
      .replace(/\{\{\s*modelo\s*\}\}/gi, vehicle.model || "")
      .replace(/\{\{\s*ano\s*\}\}/gi, String(vehicle.year || ""))
      .replace(/\{\{\s*preco\s*\}\}/gi, fmtP)
      .replace(/\{\{\s*id\s*\}\}/gi, `ID${vehicle.id}`)
      .trim();

    const tpl = config.welcomeMessageTemplate?.trim()
      || "Olá, tenho interesse no veículo: {{marca}} {{modelo}} {{ano}} {{id}}";
    const customContent = withId(fillVars(tpl));

    const attempts = [
      { content: customContent, text: `Olá! Bem-vindo à Auto Inova! 👋` },
      { content: withId(fillVars("Interesse no veículo: {{marca}} {{modelo}} {{id}}")), text: `Olá!` },
      { content: withId("Olá, tenho interesse neste veículo!"), text: vehicle.brand },
      { content: withId("Olá!"), text: "" },
    ];

    for (const a of attempts) {
      if (JSON.stringify(makeObj(a.content, a.text)).length <= 300) {
        return makeObj(a.content, a.text);
      }
    }
    return makeObj(`ID${vehicle.id}`, "");
  }

  let objectStorySpec: any;

  if (isCarousel && carouselHashes.length >= 2) {
    const childAttachments = carouselHashes.map((hash, i) => {
      const caption = carouselCaptions?.[i] ?? "";
      return {
        image_hash: hash,
        name: caption || (i === 0 ? texts.headline : `${vehicle.brand} ${vehicle.model} - Foto ${i + 1}`),
        description: i === 0 ? texts.description : caption,
        // Cada child_attachment precisa de link e call_to_action para Click to WhatsApp funcionar
        ...(isEngagementOrMessaging ? {
          link: `https://api.whatsapp.com/send`,
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
        } : {
          link: whatsappLink,
        }),
      };
    });

    objectStorySpec = {
      page_id: config.pageId,
      ...(config.instagramActorId ? { instagram_user_id: config.instagramActorId } : {}),
      link_data: {
        message: texts.primaryText,
        child_attachments: childAttachments,
        multi_share_optimized: false,
        ...(isEngagementOrMessaging ? {
          link: `https://api.whatsapp.com/send`,
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
          page_welcome_message: buildWelcomeMessageObject(),
        } : {
          link: whatsappLink,
        }),
      },
    };
    console.log(`[MetaAds] Formato CARROSSEL com ${carouselHashes.length} imagens (objetivo: ${campaignObjective})`);

  } else if (isEngagementOrMessaging) {
    objectStorySpec = {
      page_id: config.pageId,
      ...(config.instagramActorId ? { instagram_user_id: config.instagramActorId } : {}),
      link_data: {
        image_hash: imageHash,
        link: `https://api.whatsapp.com/send`,
        message: texts.primaryText,
        name: texts.headline,
        description: texts.description,
        call_to_action: {
          type: "WHATSAPP_MESSAGE",
          value: { app_destination: "WHATSAPP" },
        },
        page_welcome_message: buildWelcomeMessageObject(),
      },
    };
    console.log(`[MetaAds] Formato Click to WhatsApp (objetivo: ${campaignObjective})`);

  } else {
    objectStorySpec = {
      page_id: config.pageId,
      ...(config.instagramActorId ? { instagram_user_id: config.instagramActorId } : {}),
      link_data: {
        image_hash: imageHash,
        link: whatsappLink,
        message: texts.primaryText,
        name: texts.headline,
        description: texts.description,
        call_to_action: {
          type: "LEARN_MORE",
          value: { link: whatsappLink },
        },
      },
    };
    console.log(`[MetaAds] Formato link direto (objetivo: ${campaignObjective || "desconhecido"})`);
  }

  const creativePayload: any = {
    name: `Criativo — ${vehicle.brand} ${vehicle.model} #${vehicle.id}${isCarousel ? " (Carrossel)" : ""}`,
    object_story_spec: objectStorySpec,
    degrees_of_freedom_spec: {
      creative_features_spec: {
        image_enhancement: { enroll_status: "OPT_IN" },
        text_optimizations: { enroll_status: "OPT_IN" },
      },
    },
  };

  console.log(`[MetaAds] Payload criativo:`, JSON.stringify(creativePayload, null, 2));
  const creativeResult = await metaPost(
    `act_${config.adAccountId}/adcreatives`,
    creativePayload,
    config.accessToken
  );
  const adCreativeId = creativeResult.id as string;
  console.log(`[MetaAds] Criativo criado: ${adCreativeId}`);

  const adPayload: any = {
    name: `Anúncio — ${vehicle.brand} ${vehicle.model} ${vehicle.year} #${vehicle.id}`,
    adset_id: adSetId,
    creative: { creative_id: adCreativeId },
    status: "PAUSED",
  };

  // Rastreamento do dataset/pixel — ANTES só era anexado em anúncio que NÃO era de
  // mensagem, por isso os CTWA ficavam "sem pixel". Agora anexa em qualquer tipo:
  // a Meta usa o dataset para atribuir as conversões da conversa ao anúncio.
  // Rastreamento no nível do anúncio.
  // - Se pixelId vier vazio ("automático"): NÃO forçamos nada — a Meta usa o
  //   dataset PADRÃO da conta (ex.: a bianca/offline nos anúncios de mensagem).
  //   Forçar um pixel aqui SUBSTITUÍA esse padrão (era o bug que desmarcava a bianca).
  // - Se pixelId vier preenchido: anexa aquele dataset (chave "action.type" com ponto).
  const trackingPixelId = (pixelId && pixelId.trim()) ? pixelId.trim() : "";
  if (trackingPixelId) {
    adPayload.tracking_specs = [
      { "action.type": ["offsite_conversion"], "fb_pixel": [trackingPixelId] },
    ];
    console.log(`[MetaAds] Rastreamento forçado: ${trackingPixelId} (msg=${isEngagementOrMessaging})`);
  } else {
    console.log(`[MetaAds] Rastreamento automático (dataset padrão da conta)`);
  }

  console.log(`[MetaAds] Payload anúncio:`, JSON.stringify(adPayload, null, 2));
  const adResult = await metaPost(
    `act_${config.adAccountId}/ads`,
    adPayload,
    config.accessToken
  );
  const adId = adResult.id as string;

  console.log(`[MetaAds] ✅ Anúncio criado no adset existente: adId=${adId}`);
  return { adId, adCreativeId, imageHash };
}

/**
 * Cria anúncio CTWA com IMAGEM POR POSICIONAMENTO (asset_feed_spec):
 *  - feed (FB/IG feed): imagem 4:5
 *  - stories/reels: imagem 9:16
 * Assim cada lugar recebe o tamanho certo (em vez de uma imagem só pra tudo).
 * É a parte mais sensível da API — ajustamos iterando com o log de erro real.
 */
export async function createAdWithPlacementCreatives(
  config: MetaAdsConfig,
  adSetId: string,
  vehicle: { brand: string; model: string; year: number; id: number },
  texts: { headline: string; description: string; primaryText: string },
  creatives: { feedUrl: string; storyUrl: string },
  pixelId?: string,
): Promise<{ adId: string; adCreativeId: string }> {
  const feedHash = await uploadAdImage(config, creatives.feedUrl);
  const storyHash = await uploadAdImage(config, creatives.storyUrl);
  const wa = "https://api.whatsapp.com/send";

  const creativePayload: any = {
    name: `Criativo multi-formato — ${vehicle.brand} ${vehicle.model} #${vehicle.id}`,
    object_story_spec: {
      page_id: config.pageId,
      ...(config.instagramActorId ? { instagram_user_id: config.instagramActorId } : {}),
    },
    asset_feed_spec: {
      images: [
        { hash: feedHash, adlabels: [{ name: "feed" }] },
        { hash: storyHash, adlabels: [{ name: "story" }] },
      ],
      bodies: [{ text: texts.primaryText }],
      titles: [{ text: texts.headline }],
      descriptions: [{ text: texts.description }],
      ad_formats: ["SINGLE_IMAGE"],
      call_to_action_types: ["WHATSAPP_MESSAGE"],
      link_urls: [{ website_url: wa }],
      // CTWA via asset_feed_spec: botão de WhatsApp
      message_extensions: [{ type: "whatsapp" }],
      asset_customization_rules: [
        {
          customization_spec: {
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["feed", "marketplace", "video_feeds", "search"],
            instagram_positions: ["stream", "explore", "explore_home"],
          },
          image_label: { name: "feed" },
          priority: 1,
        },
        {
          customization_spec: {
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["story", "facebook_reels"],
            instagram_positions: ["story", "reels"],
          },
          image_label: { name: "story" },
          priority: 2,
        },
      ],
    },
    degrees_of_freedom_spec: {
      creative_features_spec: {
        image_enhancement: { enroll_status: "OPT_IN" },
        text_optimizations: { enroll_status: "OPT_IN" },
      },
    },
  };

  console.log(`[MetaAds][AssetFeed] Payload criativo:`, JSON.stringify(creativePayload).slice(0, 1500));
  const creativeResult = await metaPost(`act_${config.adAccountId}/adcreatives`, creativePayload, config.accessToken);
  const adCreativeId = creativeResult.id as string;

  const adPayload: any = {
    name: `Anúncio (multi-formato) — ${vehicle.brand} ${vehicle.model} ${vehicle.year} #${vehicle.id}`,
    adset_id: adSetId,
    creative: { creative_id: adCreativeId },
    status: "PAUSED",
  };
  if (pixelId && pixelId.trim()) {
    adPayload.tracking_specs = [{ "action.type": ["offsite_conversion"], "fb_pixel": [pixelId.trim()] }];
  }

  const adResult = await metaPost(`act_${config.adAccountId}/ads`, adPayload, config.accessToken);
  console.log(`[MetaAds][AssetFeed] ✅ Anúncio multi-formato criado: adId=${adResult.id}`);
  return { adId: adResult.id as string, adCreativeId };
}

// ─── Config padrão — Serra Gaúcha ─────────────────────────────────────────────

export function buildMetaConfig(overrides?: Partial<MetaAdsConfig>): MetaAdsConfig {
  return {
    accessToken:      process.env.META_ADS_ACCESS_TOKEN  || "",
    adAccountId:      process.env.META_ADS_ACCOUNT_ID    || "",
    pageId:           process.env.META_ADS_PAGE_ID       || "",
    instagramActorId: process.env.META_ADS_INSTAGRAM_ID,
    defaultBudgetCents: 3000,
    defaultTargeting: {
      geo_locations: {
        cities: [
          { key: "229180", radius: 80, distance_unit: "kilometer" },
        ],
      },
      age_min: 25,
      age_max: 65,
      flexible_spec: [
        {
          interests: [
            { id: "6003397425735", name: "Automóveis" },
            { id: "6003391339459", name: "Carros usados" },
            { id: "6003180352498", name: "Compras de automóveis" },
          ],
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Config efetiva: env (token/conta) + ajustes salvos pelo usuário (settings JSON):
 * página, número WhatsApp, orçamento, segmentação e mensagem de boas-vindas.
 */
export async function getMetaConfig(overrides?: Partial<MetaAdsConfig>): Promise<MetaAdsConfig> {
  const base = buildMetaConfig();
  try {
    const { getSetting } = await import("./db");
    const raw = await getSetting("meta_ads_config");
    if (raw) {
      const s = JSON.parse(raw);
      if (s.whatsappNumber) base.whatsappNumber = String(s.whatsappNumber).replace(/\D/g, "");
      if (s.welcomeMessageTemplate) base.welcomeMessageTemplate = String(s.welcomeMessageTemplate);
      if (s.pageId) base.pageId = String(s.pageId);
      if (s.instagramActorId) base.instagramActorId = String(s.instagramActorId);
      if (typeof s.dailyBudgetCents === "number" && s.dailyBudgetCents >= 100) base.defaultBudgetCents = s.dailyBudgetCents;
      const t = base.defaultTargeting;
      if (s.targetCityKey) t.geo_locations = { cities: [{ key: String(s.targetCityKey), radius: Number(s.targetRadiusKm) || 80, distance_unit: "kilometer" }] };
      if (typeof s.ageMin === "number") t.age_min = s.ageMin;
      if (typeof s.ageMax === "number") t.age_max = s.ageMax;
      if (Array.isArray(s.interests) && s.interests.length) t.flexible_spec = [{ interests: s.interests.map((i: any) => ({ id: String(i.id), name: String(i.name || "") })) }];
    }
  } catch (e) {
    console.error("[MetaAds] getMetaConfig settings falhou:", e);
  }
  return { ...base, ...overrides };
}
