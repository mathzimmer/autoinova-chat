// ── CAPI Router (extraído de routers.ts no PR #10 — só move) ────────────────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getSetting, upsertSetting } from "../db";

export const capiRouter = router({
  getConfig: adminProcedure.query(async () => {
    const { getCapiConfig } = await import("../metaConversions");
    const config = await getCapiConfig();
    return {
      enabled: config.enabled,
      datasetId: config.datasetId,
      hasToken: !!(await getSetting("capi_access_token")),
      testEventCode: config.testEventCode,
    };
  }),

  saveConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean(),
      datasetId: z.string().max(255),
      accessToken: z.string().max(1000).optional(), // vazio = mantém o atual
      testEventCode: z.string().max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("capi_enabled", input.enabled ? "true" : "false", ctx.user.id);
      await upsertSetting("capi_dataset_id", input.datasetId.trim(), ctx.user.id);
      if (input.accessToken && input.accessToken.trim()) {
        await upsertSetting("capi_access_token", input.accessToken.trim(), ctx.user.id);
      }
      await upsertSetting("capi_test_event_code", (input.testEventCode || "").trim(), ctx.user.id);
      return { success: true };
    }),

  sendTest: adminProcedure.mutation(async () => {
    const { sendTestEvent } = await import("../metaConversions");
    return sendTestEvent();
  }),

  listEvents: protectedProcedure
    .input(z.object({ limit: z.number().max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const { listCapiEvents } = await import("../metaConversions");
      return listCapiEvents(input?.limit ?? 50);
    }),
});
