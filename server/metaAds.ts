// ═══════════════════════════════════════════════════════════════════════════════
// ARQUIVO: server/metaAds.ts  (ARQUIVO NOVO — criar do zero)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Meta Ads Automation — AutoInova Chat
 * Cria automaticamente anúncios no Facebook/Instagram a partir do estoque.
 *
 * Fluxo de 5 passos via Marketing API v21.0:
 *   1. Criar Campanha (OUTCOME_LEADS)
 *   2. Criar AdSet (segmentação, orçamento, duração)
 *   3. Upload da imagem do veículo
 *   4. Criar Criativo (texto gerado automaticamente)
 *   5. Criar Anúncio (sempre começa PAUSADO para revisão)
 */

import { getDb } from "./db";
import { vehicles, metaAds } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const META_API_VERSION = "v21.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type MetaAdsConfig = {
  accessToken: string;
  adAccountId: string;       // Só números, sem "act_"
  pageId: string;
  instagramActorId?: string;
  defaultBudgetCents: number;
  defaultTargeting: MetaTargeting;
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

async function metaPost(
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
    const msg = data.error?.message || `HTTP ${res.status}`;
    console.error(`[MetaAds] POST ${endpoint} falhou:`, msg);
    throw new Error(msg);
  }
  return data;
}

async function metaGet(
  endpoint: string,
  params: Record<string, string>,
  accessToken: string
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: accessToken }).toString();
  const res = await fetch(`${META_BASE}/${endpoint}?${qs}`);
  const data = await res.json() as any;
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
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

  const adMessage =
    `🚗 ${vehicle.brand} ${vehicle.model} ${vehicle.year}\n` +
    `💰 ${fmtPrice}\n` +
    `📍 ${fmtKm} km · ${vehicle.transmission} · ${vehicle.fuel} · ${vehicle.color}\n\n` +
    `Clique em "Saiba Mais" e fale com a gente agora pelo WhatsApp!`;

  const headline = `${vehicle.brand} ${vehicle.model} ${vehicle.year} — ${fmtPrice}`;
  const description = `${fmtKm} km · ${vehicle.transmission} · ${vehicle.color}`;

  console.log(`[MetaAds] Criando criativo para ${vehicle.brand} ${vehicle.model}`);

  const result = await metaPost(
    `act_${config.adAccountId}/adcreatives`,
    {
      name: `Criativo — ${vehicle.brand} ${vehicle.model} #${vehicle.id}`,
      object_story_spec: {
        page_id: config.pageId,
        ...(config.instagramActorId ? { instagram_actor_id: config.instagramActorId } : {}),
        link_data: {
          image_hash: imageHash,
          link: whatsappLink,
          message: adMessage,
          name: headline,
          description: description,
          call_to_action: {
            type: "LEARN_MORE",
            value: { link: whatsappLink },
          },
        },
      },
      degrees_of_freedom_spec: {
        creative_features_spec: {
          standard_enhancements: { enroll_status: "OPT_IN" },
        },
      },
    },
    config.accessToken
  );

  console.log(`[MetaAds] Criativo criado: ${result.id}`);
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
      status: "PAUSED", // SEMPRE pausado ao criar — revisar antes de ativar
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

    const phone = process.env.WHATSAPP_PHONE_NUMBER || "5551994782062";
    const waMsg = encodeURIComponent(
      `Olá! Vi o anúncio do ${v.brand} ${v.model} ${v.year} e tenho interesse. Pode me dar mais informações?`
    );
    const whatsappLink = `https://wa.me/${phone}?text=${waMsg}`;

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

// ─── Config padrão — Serra Gaúcha ─────────────────────────────────────────────

export function buildMetaConfig(overrides?: Partial<MetaAdsConfig>): MetaAdsConfig {
  return {
    accessToken:    process.env.META_ADS_ACCESS_TOKEN  || "",
    adAccountId:    process.env.META_ADS_ACCOUNT_ID    || "",
    pageId:         process.env.META_ADS_PAGE_ID       || "",
    instagramActorId: process.env.META_ADS_INSTAGRAM_ID,
    defaultBudgetCents: 3000,
    defaultTargeting: {
      geo_locations: {
        // Raio 80km a partir de Novo Hamburgo — cobre toda Serra Gaúcha
        // Para outra cidade: GET /search?type=adcity&q=NOME&access_token=TOKEN
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
