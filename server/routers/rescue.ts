// ── Rescue Router (extraído de routers.ts no PR #10 — só move) ──────────────
import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  getRescueConfig, saveRescueConfig, getRescueHistory, getRescueStats,
  runRescueJob, restartRescueJob,
} from "../rescueJob";

export const rescueRouter = router({
  // Get current config
  getConfig: adminProcedure.query(async () => {
    return getRescueConfig();
  }),

  // Save config
  saveConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      inactivityMinutes: z.number().min(5).max(10080).optional(),
      maxAttempts: z.number().min(1).max(10).optional(),
      intervalMinutes: z.number().min(5).max(10080).optional(),
      rescueFlowId: z.number().nullable().optional(),
      maxPerRun: z.number().min(1).max(100).optional(),
      checkIntervalMinutes: z.number().min(1).max(60).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const config = await saveRescueConfig(input, ctx.user.id);
      restartRescueJob();
      return config;
    }),

  // Get history
  history: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return getRescueHistory(input?.limit ?? 50, input?.offset ?? 0);
    }),

  // Get stats
  stats: adminProcedure.query(async () => {
    return getRescueStats();
  }),

  // Run job manually
  runNow: adminProcedure.mutation(async () => {
    const result = await runRescueJob();
    return result;
  }),

  // List rescue flows (trigger = 'rescue')
  listRescueFlows: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { chatFlows } = await import("../../drizzle/schema");
    const flows = await db.select({
      id: chatFlows.id,
      name: chatFlows.name,
      description: chatFlows.description,
      active: chatFlows.active,
    }).from(chatFlows).where(eq(chatFlows.trigger, "rescue"));
    return flows;
  }),
});
