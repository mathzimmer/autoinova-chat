// ── Coach de Vendas Router ─────────────────────────────────────────────────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { upsertSetting } from "../db";
import {
  getCoachConfig, evaluateConversation, getLastEvaluation,
  getRecentLessons, getTeamEvalOverview, getSellerCoaching, getCoachAlerts,
} from "../salesCoach";

export const coachRouter = router({
  getConfig: protectedProcedure.query(async () => getCoachConfig()),

  setConfig: adminProcedure
    .input(z.object({
      padraoInicio: z.string().default(""),
      padraoMeio: z.string().default(""),
      padraoFim: z.string().default(""),
      criterios: z.array(z.object({
        id: z.string(),
        label: z.string(),
        etapa: z.enum(["inicio", "meio", "fim"]),
        enabled: z.boolean(),
        peso: z.number().min(0).max(10),
      })).default([]),
      slaMin: z.number().min(0).max(240).default(5),
      gapMin: z.number().min(0).max(1440).default(30),
      bancosEsperado: z.number().min(0).max(10).default(2),
      tom: z.string().default(""),
      dicasAtivas: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      await upsertSetting("coach_config", JSON.stringify(input), ctx.user.id);
      return { success: true };
    }),

  // Última avaliação gravada da conversa (nota + etapas + porquê)
  lastEvaluation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => getLastEvaluation(input.conversationId)),

  // Avaliar sob demanda (botão "Avaliar atendimento")
  evaluate: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      outcome: z.enum(["ganho", "perdido", "encerrado"]).default("encerrado"),
    }))
    .mutation(async ({ input }) => {
      const res = await evaluateConversation(input.conversationId, input.outcome);
      if (!res) throw new Error("Não foi possível avaliar (sem histórico ou avaliação recente).");
      return res;
    }),

  // ── Painel (Fase B/C) ──
  lessons: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), kind: z.enum(["ganhou", "perdeu"]).optional() }).optional())
    .query(async ({ input }) => getRecentLessons(input?.limit ?? 20, input?.kind)),

  teamOverview: protectedProcedure.query(async () => getTeamEvalOverview()),

  sellerCoaching: protectedProcedure
    .input(z.object({ sellerId: z.number() }))
    .query(async ({ input }) => getSellerCoaching(input.sellerId)),

  alerts: protectedProcedure.query(async () => getCoachAlerts()),
});
