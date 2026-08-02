// ── Meta Ads Router (extraído de routers.ts no PR #10 — só move) ────────────
import { z } from "zod";
import crypto from "crypto";
import { eq, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getSetting, upsertSetting } from "../db";
import { metaAds as metaAdsTable } from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import {
  createOrGetCampaign, createAdSet, uploadAdImage, createAd, metaPost,
  setAdStatus, importAdsFromMeta, listCampaigns, listAdSets, createAdInExistingAdSet,
  getMetaConfig, testMetaConnection, getAdInsights,
} from "../metaAds";

export const metaAdsRouter = router({
  // Verificar se Meta Ads está configurado
  isConfigured: protectedProcedure.query(() => {
    const missingVars = [
      !process.env.META_ADS_ACCESS_TOKEN && "META_ADS_ACCESS_TOKEN",
      !process.env.META_ADS_ACCOUNT_ID   && "META_ADS_ACCOUNT_ID",
      !process.env.META_ADS_PAGE_ID      && "META_ADS_PAGE_ID",
    ].filter(Boolean) as string[];
    return { configured: missingVars.length === 0, missingVars };
  }),

  // Ler a config de anúncios (env + ajustes salvos) para a tela de configurações
  getAdsConfig: protectedProcedure.query(async () => {
    const raw = await getSetting("meta_ads_config");
    const saved = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    const cfg = await getMetaConfig();
    return {
      saved,
      effective: {
        pageId: cfg.pageId,
        instagramActorId: cfg.instagramActorId || "",
        whatsappNumber: cfg.whatsappNumber || "",
        dailyBudgetCents: cfg.defaultBudgetCents,
        welcomeMessageTemplate: cfg.welcomeMessageTemplate || "Olá, tenho interesse no veículo: {{marca}} {{modelo}} {{ano}} {{id}}",
        targetCityKey: cfg.defaultTargeting.geo_locations.cities?.[0]?.key || "",
        targetRadiusKm: cfg.defaultTargeting.geo_locations.cities?.[0]?.radius || 80,
        ageMin: cfg.defaultTargeting.age_min,
        ageMax: cfg.defaultTargeting.age_max,
        interests: cfg.defaultTargeting.flexible_spec?.[0]?.interests || [],
      },
      envReady: !!(cfg.accessToken && cfg.adAccountId),
    };
  }),

  // Salvar ajustes da config de anúncios
  saveAdsConfig: protectedProcedure
    .input(z.object({
      pageId: z.string().optional(),
      instagramActorId: z.string().optional(),
      whatsappNumber: z.string().optional(),
      dailyBudgetCents: z.number().min(100).optional(),
      welcomeMessageTemplate: z.string().optional(),
      targetCityKey: z.string().optional(),
      targetRadiusKm: z.number().min(1).max(500).optional(),
      ageMin: z.number().min(13).max(65).optional(),
      ageMax: z.number().min(13).max(65).optional(),
      interests: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    }))
    .mutation(async ({ input }) => {
      const raw = await getSetting("meta_ads_config");
      const cur = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
      const merged = { ...cur, ...input };
      await upsertSetting("meta_ads_config", JSON.stringify(merged));
      return { success: true };
    }),

  // Testar a conexão com a Meta (valida token/conta/página)
  testConnection: protectedProcedure.mutation(async () => {
    const cfg = await getMetaConfig();
    return testMetaConnection(cfg);
  }),

  // Listar anúncios com dados do veículo
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { vehicles: vehiclesTable } = await import("../../drizzle/schema");
    const ads = await db
      .select({ ad: metaAdsTable, vehicle: vehiclesTable })
      .from(metaAdsTable)
      .leftJoin(vehiclesTable, eq(metaAdsTable.vehicleId, vehiclesTable.id))
      .orderBy(desc(metaAdsTable.createdAt))
      .limit(100);
    return ads;
  }),

  // Listar campanhas existentes da conta Meta
  listCampaigns: protectedProcedure.query(async () => {
    const config = await getMetaConfig();
    if (!config.accessToken || !config.adAccountId) {
      throw new Error("Meta Ads não configurado.");
    }
    return listCampaigns(config.accessToken, config.adAccountId);
  }),

  // Listar adsets de uma campanha
  listAdSets: protectedProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      const config = await getMetaConfig();
      if (!config.accessToken) throw new Error("Meta Ads não configurado.");
      return listAdSets(config.accessToken, input.campaignId);
    }),

  // Criar anúncio em adset existente (fluxo simplificado)
  /** Upload de uma imagem própria (ex: arte de stories) para usar no anúncio */
  uploadCreativeImage: protectedProcedure
    .input(z.object({ base64Data: z.string(), mimeType: z.string() }))
    .mutation(async ({ input }) => {
      const { storagePut } = await import("../storage");
      const buffer = Buffer.from(input.base64Data, "base64");
      const ext = input.mimeType.split("/")[1]?.split(";")[0] || "jpg";
      const key = `meta-ads/creative-${crypto.randomBytes(8).toString("hex")}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url };
    }),

  // Gera os 3 criativos (1:1, 4:5, 9:16) do veículo com os selos posicionados e
  // devolve as URLs (S3) para o preview "ver antes de aplicar".
  generateCreativesPreview: protectedProcedure
    .input(z.object({
      vehicleId: z.number(),
      selos: z.array(z.object({ text: z.string(), x: z.number(), y: z.number() })).default([]),
      style: z.object({
        bandColor: z.string().optional(),
        accentColor: z.string().optional(),
        checkColor: z.string().optional(),
      }).optional(),
      priceOverride: z.string().optional(),
      specsOverride: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const { vehicles: vehiclesTable } = await import("../../drizzle/schema");
      const v = (await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).limit(1))[0];
      if (!v) throw new Error("Veículo não encontrado");

      // Fotos na ordem do estoque (foto 1 = externa). Aceita images como array de
      // strings ou de objetos {url}. Cai para imageUrl se não houver array.
      const rawImgs = (v as any).images;
      let photoUrls: string[] = [];
      if (Array.isArray(rawImgs)) {
        photoUrls = rawImgs.map((it: any) => (typeof it === "string" ? it : it?.url)).filter(Boolean);
      }
      if (photoUrls.length === 0 && v.imageUrl) photoUrls = [v.imageUrl];
      if (photoUrls.length === 0) throw new Error("Veículo sem fotos");

      const price = input.priceOverride
        || `R$ ${Number(v.price || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
      const versionTxt = (v as any).version ? ` ${(v as any).version}` : "";
      const kmTxt = v.mileage ? ` · ${Number(v.mileage).toLocaleString("pt-BR")} km` : "";
      const specs = input.specsOverride || `${v.brand} ${v.model}${versionTxt} · ${v.year}${kmTxt}`;

      const { generateAllCreatives } = await import("../creativeGenerator");
      const { uploadMediaToS3 } = await import("../media");
      const gen = await generateAllCreatives({ photoUrls, price, specs, selos: input.selos, style: input.style });

      const out: Record<string, string> = {};
      for (const { aspect, buffer } of gen) {
        const up = await uploadMediaToS3(buffer, "image", "image/jpeg");
        if (up) out[aspect] = up.url;
      }
      return { creatives: out, photoCount: photoUrls.length };
    }),

  createAdInAdSet: protectedProcedure
    .input(z.object({
      vehicleId:    z.number(),
      campaignId:   z.string(),
      adSetId:      z.string(),
      headline:     z.string(),
      description:  z.string(),
      primaryText:  z.string(),
      selectedImageUrl: z.string().optional(),
      campaignObjective: z.string().optional(),
      carouselImageUrls: z.array(z.string()).optional(),
      carouselCaptions: z.array(z.string()).optional(),
      pixelId: z.string().optional(),
      // Criativos por posicionamento (asset_feed_spec): 4:5 no feed, 9:16 no story
      placementCreatives: z.object({ feedUrl: z.string(), storyUrl: z.string() }).optional(),
    }))
    .mutation(async ({ input }) => {
      const config = await getMetaConfig();
      if (!config.accessToken || !config.adAccountId || !config.pageId) {
        throw new Error("Meta Ads não configurado.");
      }
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const { vehicles: vehiclesTable } = await import("../../drizzle/schema");
      const vehicleRows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).limit(1);
      if (!vehicleRows.length) throw new Error("Veículo não encontrado");
      const v = vehicleRows[0];
      if (!v.imageUrl) throw new Error("Veículo sem imagem");

      // Caminho NOVO: imagem por posicionamento (asset_feed_spec)
      if (input.placementCreatives?.feedUrl && input.placementCreatives?.storyUrl) {
        const { createAdWithPlacementCreatives } = await import("../metaAds");
        const r = await createAdWithPlacementCreatives(
          config, input.adSetId,
          { brand: v.brand, model: v.model, year: v.year, id: v.id },
          { headline: input.headline, description: input.description, primaryText: input.primaryText },
          input.placementCreatives,
          input.pixelId,
        );
        await db.insert(metaAdsTable).values({
          vehicleId: input.vehicleId, campaignId: input.campaignId, adSetId: input.adSetId,
          adCreativeId: r.adCreativeId, adId: r.adId, imageHash: "",
          status: "paused", dailyBudgetCents: 0, createdAt: new Date(), updatedAt: new Date(),
        });
        return { success: true, adId: r.adId, campaignId: input.campaignId, adSetId: input.adSetId };
      }

      const result = await createAdInExistingAdSet(
        config,
        input.adSetId,
        input.campaignId,
        {
          brand: v.brand, model: v.model, year: v.year,
          price: v.price, mileage: v.mileage ?? 0,
          transmission: v.transmission ?? "manual",
          fuel: v.fuel ?? "flex",
          color: v.color ?? "",
          id: v.id, imageUrl: v.imageUrl,
        },
        {
          headline: input.headline,
          description: input.description,
          primaryText: input.primaryText,
        },
        input.selectedImageUrl,
        input.campaignObjective,
        input.carouselImageUrls,
        input.carouselCaptions,
        input.pixelId
      );

      // Salvar no banco
      await db.insert(metaAdsTable).values({
        vehicleId: input.vehicleId,
        campaignId: input.campaignId,
        adSetId: input.adSetId,
        adCreativeId: result.adCreativeId,
        adId: result.adId,
        imageHash: result.imageHash,
        status: "paused",
        dailyBudgetCents: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return { success: true, adId: result.adId, campaignId: input.campaignId, adSetId: input.adSetId };
    }),

  // Ativar anúncio
  activate: protectedProcedure
    .input(z.object({ adId: z.string() }))
    .mutation(async ({ input }) => {
      const config = await getMetaConfig();
      const ok = await setAdStatus(input.adId, "ACTIVE", config.accessToken);
      if (!ok) throw new Error("Falha ao ativar anúncio");
      const db = await getDb();
      if (db) {
        await db.update(metaAdsTable)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(metaAdsTable.adId, input.adId));
      }
      return { success: true };
    }),

  // Pausar anúncio
  pause: protectedProcedure
    .input(z.object({ adId: z.string() }))
    .mutation(async ({ input }) => {
      const config = await getMetaConfig();
      const ok = await setAdStatus(input.adId, "PAUSED", config.accessToken);
      if (!ok) throw new Error("Falha ao pausar anúncio");
      const db = await getDb();
      if (db) {
        await db.update(metaAdsTable)
          .set({ status: "paused", updatedAt: new Date() })
          .where(eq(metaAdsTable.adId, input.adId));
      }
      return { success: true };
    }),

  // Sincronizar métricas de um anúncio
  syncInsights: protectedProcedure
    .input(z.object({ adId: z.string() }))
    .mutation(async ({ input }) => {
      const config = await getMetaConfig();
      const insights = await getAdInsights(input.adId, config.accessToken);
      if (!insights) throw new Error("Não foi possível obter métricas");
      const db = await getDb();
      if (db) {
        await db.update(metaAdsTable)
          .set({
            impressions:     insights.impressions,
            clicks:          insights.clicks,
            leads:           insights.leads,
            spendCents:      Math.round(insights.spend * 100),
            lastInsightSync: new Date(),
            updatedAt:       new Date(),
          })
          .where(eq(metaAdsTable.adId, input.adId));
      }
      return insights;
    }),

  // Sincronizar métricas de todos os anúncios ativos
  syncAllInsights: protectedProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database indisponível");
    const config = await getMetaConfig();
    const activeAds = await db
      .select({ adId: metaAdsTable.adId })
      .from(metaAdsTable)
      .where(eq(metaAdsTable.status, "active"));
    let synced = 0;
    for (const { adId } of activeAds) {
      const insights = await getAdInsights(adId, config.accessToken);
      if (insights) {
        await db.update(metaAdsTable)
          .set({
            impressions:     insights.impressions,
            clicks:          insights.clicks,
            leads:           insights.leads,
            spendCents:      Math.round(insights.spend * 100),
            lastInsightSync: new Date(),
            updatedAt:       new Date(),
          })
          .where(eq(metaAdsTable.adId, adId));
        synced++;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return { synced };
  }),

  // Importar anúncios existentes da conta Meta
  importFromMeta: protectedProcedure.mutation(async () => {
    const config = await getMetaConfig();
    if (!config.accessToken || !config.adAccountId) {
      throw new Error("Meta Ads não configurado. Adicione ACCESS_TOKEN e ACCOUNT_ID.");
    }
    const result = await importAdsFromMeta(config.accessToken, config.adAccountId);
    return result;
  }),

  // Sincronizar tudo: importar + atualizar métricas
  syncAll: protectedProcedure.mutation(async () => {
    const config = await getMetaConfig();
    if (!config.accessToken || !config.adAccountId) {
      throw new Error("Meta Ads não configurado.");
    }
    // 1. Importar/atualizar anúncios da conta
    const importResult = await importAdsFromMeta(config.accessToken, config.adAccountId);
    return {
      imported: importResult.imported,
      updated: importResult.updated,
      errors: importResult.errors,
    };
  }),

  // Gerar texto do anúncio com IA
  generateAdText: protectedProcedure
    .input(z.object({
      vehicleId: z.number(),
      style: z.enum(["persuasivo", "informativo", "urgente", "premium", "jovem"]).optional().default("persuasivo"),
      targetAudience: z.string().optional(),
      highlights: z.string().optional(),
      extraInstructions: z.string().optional(),
      numCarouselImages: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const { vehicles: vehiclesTable } = await import("../../drizzle/schema");
      const vehicleRows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).limit(1);
      if (!vehicleRows.length) throw new Error("Veículo não encontrado");
      const v = vehicleRows[0];

      const fmtPrice = v.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
      const fmtKm = (v.mileage ?? 0).toLocaleString("pt-BR");

      const styleGuides: Record<string, string> = {
        persuasivo: "Tom persuasivo e envolvente, foque nos benefícios e no desejo de compra. Use gatilhos emocionais.",
        informativo: "Tom informativo e direto, destaque especificações técnicas e dados concretos do veículo.",
        urgente: "Tom de urgência e escassez, use frases como 'Última unidade', 'Oportunidade única', 'Não perca'.",
        premium: "Tom sofisticado e elegante, foque na exclusividade, conforto e status do veículo.",
        jovem: "Tom descontraído e moderno, use linguagem jovem e dinâmica, emojis com moderação.",
      };

      const styleInstruction = styleGuides[input.style] || styleGuides.persuasivo;
      const audienceInstruction = input.targetAudience ? `\nPúblico-alvo: ${input.targetAudience}` : "";
      const highlightsInstruction = input.highlights ? `\nDestaques a enfatizar: ${input.highlights}` : "";
      const extraInstruction = input.extraInstructions ? `\nInstruções adicionais: ${input.extraInstructions}` : "";

      // Get features if available
      const featuresStr = v.features && Array.isArray(v.features) ? (v.features as string[]).slice(0, 10).join(", ") : "";

      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Você é um copywriter especializado em anúncios de veículos para Facebook e Instagram.
${styleInstruction}
Crie textos otimizados para conversão.
Sempre retorne JSON válido.`
          },
          {
            role: "user",
            content: `Crie um anúncio para este veículo:

Marca: ${v.brand}
Modelo: ${v.model}
Versão: ${v.version || "N/I"}
Ano: ${v.year}
Preço: ${fmtPrice}
Quilometragem: ${fmtKm} km
Câmbio: ${v.transmission || "N/I"}
Combustível: ${v.fuel || "N/I"}
Cor: ${v.color || "N/I"}
Categoria: ${v.category || "N/I"}
${featuresStr ? `Opcionais: ${featuresStr}` : ""}
${v.description ? `Descrição: ${v.description.slice(0, 200)}` : ""}${audienceInstruction}${highlightsInstruction}${extraInstruction}

Retorne um JSON com:
{
  "headline": "Título curto e impactante (máx 40 caracteres)",
  "description": "Descrição curta para o card (máx 90 caracteres)",
  "primaryText": "Texto principal do anúncio (3-5 linhas, use emojis com moderação)",
  "callToAction": "Frase de chamada para ação (1 linha)"${input.numCarouselImages && input.numCarouselImages >= 2 ? `,
  "carouselCaptions": ["Legenda curta para foto 1 (máx 40 chars)", "Legenda curta para foto 2", ... até ${input.numCarouselImages} legendas]` : ""}
}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ad_text",
            strict: true,
            schema: {
              type: "object",
              properties: {
                headline: { type: "string", description: "Título curto" },
                description: { type: "string", description: "Descrição curta" },
                primaryText: { type: "string", description: "Texto principal" },
                callToAction: { type: "string", description: "Call to action" },
                carouselCaptions: { type: "array", items: { type: "string" }, description: "Legendas para cada foto do carrossel" },
              },
              required: ["headline", "description", "primaryText", "callToAction", "carouselCaptions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = result.choices[0]?.message?.content;
      if (!content) throw new Error("IA não retornou conteúdo");
      const contentStr = typeof content === "string" ? content : JSON.stringify(content);

      try {
        const parsed = JSON.parse(contentStr);
        return {
          ...parsed,
          vehicle: {
            id: v.id,
            brand: v.brand,
            model: v.model,
            year: v.year,
            price: v.price,
            imageUrl: v.imageUrl,
          },
        };
      } catch {
        throw new Error("IA retornou formato inválido");
      }
    }),

  // Criar anúncio com texto personalizado (gerado pela IA)
  createAdWithText: protectedProcedure
    .input(z.object({
      vehicleId: z.number(),
      headline: z.string(),
      description: z.string(),
      primaryText: z.string(),
      dailyBudgetBRL: z.number().min(5).max(1000).default(30),
      campaignId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const config = await getMetaConfig();
      if (!config.accessToken || !config.adAccountId || !config.pageId) {
        throw new Error("Meta Ads não configurado.");
      }

      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const { vehicles: vehiclesTable } = await import("../../drizzle/schema");
      const vehicleRows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).limit(1);
      if (!vehicleRows.length) throw new Error("Veículo não encontrado");
      const v = vehicleRows[0];
      if (!v.imageUrl) throw new Error("Veículo sem imagem");

      const finalCampaignId = input.campaignId ?? (await createOrGetCampaign(config));
      const budgetCents = Math.round(input.dailyBudgetBRL * 100);
      const adSetId = await createAdSet(config, finalCampaignId, v, budgetCents);
      const imageHash = await uploadAdImage(config, v.imageUrl);

      // Build welcome message for Click to WhatsApp
      function buildWelcomeMsg(): string {
        const makeObj = (content: string, text: string) => ({
          type: "VISUAL_EDITOR", version: 2,
          landing_screen_type: "welcome_message", media_type: "text",
          text_format: { customer_action_type: "autofill_message",
            message: { autofill_message: { content }, text } }
        });
        const attempts = [
          { content: `Olá! Vi o anúncio do ${v.brand} ${v.model} ${v.year} e tenho interesse!`, text: `Olá! Bem-vindo à Auto Inova - Matriz! 👋` },
          { content: `Interesse no ${v.brand} ${v.model} ${v.year}`, text: `Olá!` },
          { content: "Olá, tenho interesse!", text: "" },
        ];
        for (const a of attempts) {
          const json = JSON.stringify(makeObj(a.content, a.text));
          if (json.length <= 300) return json;
        }
        return JSON.stringify(makeObj("Olá!", ""));
      }

      // Create creative with Click to WhatsApp (instead of LEARN_MORE)
      const adCreativeId = await (async () => {
        const result = await metaPost(
          `act_${config.adAccountId}/adcreatives`,
          {
            name: `Criativo IA — ${v.brand} ${v.model} #${v.id}`,
            object_story_spec: {
              page_id: config.pageId,
              ...(config.instagramActorId ? { instagram_user_id: config.instagramActorId } : {}),
              link_data: {
                image_hash: imageHash,
                link: "https://api.whatsapp.com/send",
                message: input.primaryText,
                name: input.headline,
                description: input.description,
                call_to_action: {
                  type: "WHATSAPP_MESSAGE",
                  value: { app_destination: "WHATSAPP" },
                },
                page_welcome_message: buildWelcomeMsg(),
              },
            },
          },
          config.accessToken
        );
        return result.id as string;
      })();

      const adId = await createAd(config, adSetId, adCreativeId, v);

      await db.insert(metaAdsTable).values({
        vehicleId: input.vehicleId,
        campaignId: finalCampaignId,
        adSetId,
        adCreativeId,
        adId,
        imageHash,
        status: "paused",
        dailyBudgetCents: budgetCents,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return { success: true, adId, campaignId: finalCampaignId };
    }),
});
