// ── Performance Router (extraído de routers.ts no PR #10 — só move) ─────────
import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const performanceRouter = router({
  /** Lista de atendentes ativos (para o filtro). */
  attendants: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { teamMembers } = await import("../../drizzle/schema");
    const rows = await db.select({ id: teamMembers.id, name: teamMembers.name, cargo: teamMembers.cargo })
      .from(teamMembers).where(eq(teamMembers.status, "ativo" as any));
    return rows;
  }),

  /** Instâncias/números disponíveis (para o filtro). */
  instances: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [] as string[];
    const { conversations } = await import("../../drizzle/schema");
    const { isNotNull } = await import("drizzle-orm");
    const rows = await db.selectDistinct({ instanceName: conversations.instanceName })
      .from(conversations).where(isNotNull(conversations.instanceName));
    return rows.map(r => r.instanceName).filter((x): x is string => !!x);
  }),

  /** Ranking da equipe com nota + pilares + métricas no período. */
  overview: protectedProcedure
    .input(z.object({
      sinceDays: z.number().min(1).max(365).default(30),
      instanceName: z.string().optional(),
      memberId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const { computeTeamPerformance } = await import("../sellerPerformance");
      return computeTeamPerformance(input);
    }),

  /** Ranking POR INSTÂNCIA/número (em vez de por atendente). */
  overviewByInstance: protectedProcedure
    .input(z.object({ sinceDays: z.number().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const { computeInstancePerformance } = await import("../sellerPerformance");
      return computeInstancePerformance(input);
    }),

  /** Roda a avaliação qualitativa por IA de um vendedor e salva. */
  evaluate: protectedProcedure
    .input(z.object({
      memberId: z.number(),
      sinceDays: z.number().min(1).max(365).default(30),
      instanceName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { evaluateSeller } = await import("../sellerPerformance");
      const r = await evaluateSeller(input);
      if (!r) throw new Error("Não foi possível avaliar este vendedor.");
      return r;
    }),

  /** Avaliação por IA de uma instância/número. */
  evaluateInstance: protectedProcedure
    .input(z.object({ instanceName: z.string(), sinceDays: z.number().min(1).max(365).default(30) }))
    .mutation(async ({ input }) => {
      const { evaluateInstance } = await import("../sellerPerformance");
      const r = await evaluateInstance(input);
      if (!r) throw new Error("Não foi possível avaliar esta instância.");
      return r;
    }),

  /** Última avaliação de IA salva de uma instância. */
  lastInstanceEvaluation: protectedProcedure
    .input(z.object({ instanceName: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const { sellerEvaluations } = await import("../../drizzle/schema");
      const { desc, and } = await import("drizzle-orm");
      const row = (await db.select().from(sellerEvaluations)
        .where(and(eq(sellerEvaluations.memberId, 0), eq(sellerEvaluations.instanceName, input.instanceName)))
        .orderBy(desc(sellerEvaluations.createdAt)).limit(1))[0];
      return row || null;
    }),

  /** Última avaliação salva de um vendedor (parecer da IA). */
  lastEvaluation: protectedProcedure
    .input(z.object({ memberId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const { sellerEvaluations } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const row = (await db.select().from(sellerEvaluations)
        .where(eq(sellerEvaluations.memberId, input.memberId))
        .orderBy(desc(sellerEvaluations.createdAt)).limit(1))[0];
      return row || null;
    }),

  /** Chat interno: o gestor conversa com a IA sobre a performance da equipe. */
  chat: protectedProcedure
    .input(z.object({
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(30),
      sinceDays: z.number().min(1).max(365).default(30),
      instanceName: z.string().optional(),
      groupBy: z.enum(["member", "instance"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { performanceChat } = await import("../sellerPerformance");
      const reply = await performanceChat(input);
      return { reply };
    }),
});
