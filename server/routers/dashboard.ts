// ── Dashboard Router (extraído de routers.ts no PR #10 — só move) ───────────
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getDashboardStats, getAiStats } from "../db";

export const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    const [stats, aiStats] = await Promise.all([
      getDashboardStats(),
      getAiStats(),
    ]);
    return { ...stats, ...aiStats };
  }),

  /** Métricas operacionais avançadas (últimos 30 dias) */
  advancedStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;
    const { sql: sqlOp } = await import("drizzle-orm");

    // Tempo médio até a 1ª resposta (atendente ou IA) — em segundos
    const firstResponse = await db.execute(sqlOp`
      SELECT COALESCE(AVG(diff), 0)::float AS avg_seconds, COUNT(*)::int AS sample
      FROM (
        SELECT c.id,
          EXTRACT(EPOCH FROM (MIN(m2."createdAt") - MIN(m1."createdAt"))) AS diff
        FROM conversations c
        JOIN messages m1 ON m1."conversationId" = c.id AND m1."senderType" = 'customer'
        JOIN messages m2 ON m2."conversationId" = c.id AND m2."senderType" IN ('agent','bot')
        WHERE c."createdAt" > now() - interval '30 days'
        GROUP BY c.id
        HAVING MIN(m2."createdAt") > MIN(m1."createdAt")
      ) t
    `);

    // TMA — tempo médio até resolver (conversas resolvidas/fechadas nos últimos 30d)
    const tma = await db.execute(sqlOp`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))), 0)::float AS avg_seconds,
             COUNT(*)::int AS resolved_count
      FROM conversations
      WHERE "status" IN ('resolved','closed')
        AND "updatedAt" > now() - interval '30 days'
    `);

    // Funil: contagem de leads por etapa (últimos 30d por atualização)
    const funnel = await db.execute(sqlOp`
      SELECT "funnelStatus" AS stage, COUNT(*)::int AS count
      FROM leads
      WHERE "updatedAt" > now() - interval '30 days'
      GROUP BY "funnelStatus"
    `);

    // Vendas reportadas à Meta (CAPI Purchase, 30d)
    const capiSales = await db.execute(sqlOp`
      SELECT COUNT(*)::int AS purchases, COALESCE(SUM(value), 0)::float AS total_value
      FROM "capiEvents"
      WHERE "eventName" = 'Purchase' AND "capiEventStatus" = 'sent'
        AND "createdAt" > now() - interval '30 days'
    `);

    // Origem dos leads (30d)
    const origins = await db.execute(sqlOp`
      SELECT
        COUNT(*) FILTER (WHERE "ctwaId" IS NOT NULL)::int AS ctwa,
        COUNT(*) FILTER (WHERE "metaLeadId" IS NOT NULL)::int AS lead_ads,
        COUNT(*) FILTER (WHERE "ctwaId" IS NULL AND "metaLeadId" IS NULL AND ("gclid" IS NOT NULL OR "utmSource" IS NOT NULL))::int AS outros_pagos,
        COUNT(*) FILTER (WHERE "ctwaId" IS NULL AND "metaLeadId" IS NULL AND "gclid" IS NULL AND "utmSource" IS NULL)::int AS organico
      FROM leads
      WHERE "createdAt" > now() - interval '30 days'
    `);

    // CSAT médio (30d)
    const csat = await db.execute(sqlOp`
      SELECT COALESCE(AVG(rating), 0)::float AS avg_rating, COUNT(*)::int AS rated
      FROM "csatRatings"
      WHERE "csatStatus" = 'rated' AND "ratedAt" > now() - interval '30 days'
    `);

    const fr = (firstResponse as any)[0] || (firstResponse as any).rows?.[0] || {};
    const tm = (tma as any)[0] || (tma as any).rows?.[0] || {};
    const cs = (capiSales as any)[0] || (capiSales as any).rows?.[0] || {};
    const og = (origins as any)[0] || (origins as any).rows?.[0] || {};
    const ct = (csat as any)[0] || (csat as any).rows?.[0] || {};
    const funnelRows = ((funnel as any).rows ?? (funnel as any)) || [];

    return {
      csatAvg: Number(ct.avg_rating) || 0,
      csatCount: Number(ct.rated) || 0,
      firstResponseAvgSeconds: Number(fr.avg_seconds) || 0,
      firstResponseSample: Number(fr.sample) || 0,
      tmaAvgSeconds: Number(tm.avg_seconds) || 0,
      resolvedCount: Number(tm.resolved_count) || 0,
      funnel: (funnelRows as any[]).map(r => ({ stage: r.stage, count: Number(r.count) })),
      capiPurchases: Number(cs.purchases) || 0,
      capiTotalValue: Number(cs.total_value) || 0,
      origins: {
        ctwa: Number(og.ctwa) || 0,
        leadAds: Number(og.lead_ads) || 0,
        outrosPagos: Number(og.outros_pagos) || 0,
        organico: Number(og.organico) || 0,
      },
    };
  }),
});
