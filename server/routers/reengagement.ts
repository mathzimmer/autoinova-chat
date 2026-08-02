// ── Reengagement Router (extraído de routers.ts no PR #10 — só move) ────────
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";

export const reengagementRouter = router({
  getConfig: adminProcedure.query(async () => {
    const { getReengagementConfig } = await import("../reengagement");
    return getReengagementConfig();
  }),

  saveConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      maxAttempts: z.number().min(1).max(10).optional(),
      maxPerRun: z.number().min(1).max(100).optional(),
      checkIntervalMinutes: z.number().min(1).max(60).optional(),
      steps: z.array(z.object({
        afterMinutes: z.number().min(5).max(43200),
        strategy: z.enum(["flow", "ai_message", "template"]),
        flowId: z.number().nullable().optional(),
        templateName: z.string().nullable().optional(),
      })).min(1).max(10).optional(),
      aiMessages: z.array(z.string()).max(10).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { saveReengagementConfig, restartReengagementJob } = await import("../reengagement");
      const config = await saveReengagementConfig(input, ctx.user.id);
      restartReengagementJob();
      return config;
    }),

  history: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const { getReengagementHistory } = await import("../reengagement");
      return getReengagementHistory(input?.limit ?? 50, input?.offset ?? 0);
    }),

  stats: adminProcedure.query(async () => {
    const { getReengagementStats } = await import("../reengagement");
    return getReengagementStats();
  }),

  runNow: adminProcedure.mutation(async () => {
    const { runReengagementJob } = await import("../reengagement");
    return runReengagementJob();
  }),
});
