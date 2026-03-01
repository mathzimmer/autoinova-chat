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
    const msg = data.error?.message || `HTTP ${res.status}`;
    console.error(`[MetaAds] POST ${endpoint} falhou:`, msg);
    throw new Error(msg);
  }
  return data;
}

export async function metaGet(
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
    // 1. Buscar todos os anúncios da conta com dados básicos
    const adsRes = await fetch(
      `${META_BASE}/${actId}/ads?fields=id,name,status,adset_id,campaign_id,creative{id,name,thumbnail_url}&limit=100&access_token=${accessToken}`
    );
    const adsData = await adsRes.json() as any;
    if (adsData.error) throw new Error(adsData.error.message);

    const remoteAds = adsData.data || [];
    console.log(`[MetaAds] Importando ${remoteAds.length} anúncios da conta Meta...`);

    // 2. Buscar métricas de todos os anúncios (last_30d)
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

    // 3. Para cada anúncio remoto, inserir ou atualizar no banco
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

        // Verificar se já existe no banco
        const existing = await db.select({ id: metaAds.id }).from(metaAds).where(eq(metaAds.adId, adId)).limit(1);

        if (existing.length > 0) {
          // Atualizar status e métricas
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
          // Inserir novo anúncio importado
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
): Promise<Array<{ id: string; name: string; status: string; dailyBudget: string }>> {
  const data = await metaGet(
    `${campaignId}/adsets`,
    { fields: "id,name,status,daily_budget", limit: "100" },
    accessToken
  ) as any;
  return (data.data || []).map((a: any) => ({
    id: a.id,
    name: a.name || "Sem nome",
    status: a.status || "UNKNOWN",
    dailyBudget: a.daily_budget || "0",
  }));
}

// ─── Criar anúncio em adset existente (simplificado) ─────────────────────────

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

  const phone = process.env.WHATSAPP_PHONE_NUMBER || "5551994782062";
  const waMsg = encodeURIComponent(
    `Olá! Vi o anúncio do ${vehicle.brand} ${vehicle.model} ${vehicle.year} e tenho interesse!`
  );
  const whatsappLink = `https://wa.me/${phone}?text=${waMsg}`;

  const isCarousel = carouselImageUrls && carouselImageUrls.length >= 2;

  // 1. Upload imagem(ns)
  let imageHash: string;
  let carouselHashes: string[] = [];
  if (isCarousel) {
    console.log(`[MetaAds] Uploading ${carouselImageUrls.length} images for carousel...`);
    carouselHashes = [];
    for (const url of carouselImageUrls.slice(0, 10)) {
      const hash = await uploadAdImage(config, url);
      carouselHashes.push(hash);
    }
    imageHash = carouselHashes[0];
  } else {
    imageHash = await uploadAdImage(config, imgUrl);
  }

  // 2. Montar object_story_spec conforme objetivo da campanha
  const isEngagementOrMessaging = campaignObjective === "OUTCOME_ENGAGEMENT" ||
    campaignObjective === "OUTCOME_SALES" ||
    campaignObjective === "OUTCOME_LEADS";

  let objectStorySpec: any;
  // Welcome message JSON total must not exceed 300 chars
  function buildWelcomeMessage(): string {
    // The JSON structure overhead is ~200 chars, leaving ~100 for content+text combined
    const makeObj = (content: string, text: string) => ({
      type: "VISUAL_EDITOR",
      version: 2,
      landing_screen_type: "welcome_message",
      media_type: "text",
      text_format: {
        customer_action_type: "autofill_message",
        message: {
          autofill_message: { content },
          text
        }
      }
    });

    // Try progressively shorter versions
    const attempts = [
      { content: `Olá! Tenho interesse no ${vehicle.brand} ${vehicle.model} ${vehicle.year}!`, text: `${vehicle.brand} ${vehicle.model}` },
      { content: `Interesse no ${vehicle.brand} ${vehicle.model} ${vehicle.year}`, text: `${vehicle.brand}` },
      { content: "Olá! Tenho interesse neste veículo!", text: vehicle.brand },
      { content: "Olá! Tenho interesse!", text: "" },
    ];

    for (const a of attempts) {
      const json = JSON.stringify(makeObj(a.content, a.text));
      if (json.length <= 300) {
        console.log(`[MetaAds] Welcome message length: ${json.length} chars`);
        return json;
      }
    }

    // Fallback mínimo absoluto
    const fallback = JSON.stringify(makeObj("Olá!", ""));
    console.log(`[MetaAds] Welcome message fallback length: ${fallback.length} chars`);
    return fallback;
  }
  const welcomeMessage = buildWelcomeMessage();

  if (isCarousel && carouselHashes.length >= 2) {
    // Carrossel com legendas individuais
    // NOTA: child_attachments NÃO devem ter call_to_action nem link individuais
    // para campanhas Click to WhatsApp — o CTA fica apenas no link_data pai
    const childAttachments = carouselHashes.map((hash, i) => {
      const caption = carouselCaptions && carouselCaptions[i] ? carouselCaptions[i] : "";
      const child: any = {
        image_hash: hash,
        name: caption || (i === 0 ? texts.headline : `${vehicle.brand} ${vehicle.model} - Foto ${i + 1}`),
        description: i === 0 ? texts.description : caption,
      };
      return child;
    });

    objectStorySpec = {
      page_id: config.pageId,
      link_data: {
        message: texts.primaryText,
        child_attachments: childAttachments,
        multi_share_optimized: false,
        ...(isEngagementOrMessaging ? {
          link: "https://api.whatsapp.com/send",
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
          page_welcome_message: welcomeMessage,
        } : {
          link: whatsappLink,
        }),
      },
    };
    console.log(`[MetaAds] Usando formato CARROSSEL com ${carouselHashes.length} imagens (objetivo: ${campaignObjective})`);
  } else if (isEngagementOrMessaging) {
    // Imagem única - Click to WhatsApp
    objectStorySpec = {
      page_id: config.pageId,
      link_data: {
        image_hash: imageHash,
        link: "https://api.whatsapp.com/send",
        name: texts.headline,
        call_to_action: {
          type: "WHATSAPP_MESSAGE",
          value: { app_destination: "WHATSAPP" }
        },
        page_welcome_message: welcomeMessage,
      },
    };
    console.log(`[MetaAds] Usando formato Click to WhatsApp (objetivo: ${campaignObjective})`);
  } else {
    // Imagem única - Link direto
    objectStorySpec = {
      page_id: config.pageId,
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
    console.log(`[MetaAds] Usando formato link direto (objetivo: ${campaignObjective || "desconhecido"})`);
  }

  // Adicionar instagram_user_id ao object_story_spec se disponível (instagram_actor_id deprecated na v22.0)
  if (config.instagramActorId) {
    objectStorySpec.instagram_user_id = config.instagramActorId;
    console.log(`[MetaAds] Instagram User ID configurado: ${config.instagramActorId}`);
  }

  // 3. Criar criativo (standard_enhancements foi descontinuado pelo Meta)
  // Usar recursos individuais do Advantage+ em vez de standard_enhancements
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
  console.log(`[MetaAds] Criativo criado com Advantage+: ${adCreativeId}`);

  // 4. Criar anúncio no adset existente (PAUSADO) com rastreamento Pixel
  const adPayload: any = {
    name: `Anúncio — ${vehicle.brand} ${vehicle.model} ${vehicle.year} #${vehicle.id}`,
    adset_id: adSetId,
    creative: { creative_id: adCreativeId },
    status: "PAUSED",
  };

  // Adicionar rastreamento com Pixel do Facebook
  const trackingPixelId = pixelId || process.env.META_ADS_PIXEL_ID;
  if (trackingPixelId) {
    adPayload.tracking_specs = [
      { action_type: ["offsite_conversion"], fb_pixel: [trackingPixelId] },
    ];
    console.log(`[MetaAds] Rastreamento Pixel configurado: ${trackingPixelId}`);
  }

  console.log(`[MetaAds] Payload anúncio:`, JSON.stringify(adPayload, null, 2));
  const adResult = await metaPost(
    `act_${config.adAccountId}/ads`,
    adPayload,
    config.accessToken
  );
  const adId = adResult.id as string;

  console.log(`[MetaAds] ✅ Anúncio criado no adset existente: adId=${adId}, adSetId=${adSetId}`);
  return { adId, adCreativeId, imageHash };
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
