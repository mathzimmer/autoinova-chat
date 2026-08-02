// ── Vehicle Router (extraído de routers.ts no PR #10 — só move) ─────────────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { searchVehicles, listVehicles, createVehicle, upsertSetting } from "../db";
import { syncStock } from "../stockSync";

export const vehicleRouter = router({
  list: protectedProcedure.query(async () => {
    return listVehicles();
  }),

  search: protectedProcedure
    .input(z.object({
      brand: z.string().optional(),
      model: z.string().optional(),
      maxPrice: z.number().optional(),
      category: z.string().optional(),
      transmission: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return searchVehicles(input);
    }),

  create: adminProcedure
    .input(z.object({
      brand: z.string(),
      model: z.string(),
      year: z.number(),
      price: z.number(),
      mileage: z.number().optional(),
      color: z.string().optional(),
      transmission: z.enum(["manual", "automatic"]).optional(),
      fuel: z.string().optional(),
      category: z.string().optional(),
      description: z.string().optional(),
      imageUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await createVehicle({ ...input, available: true });
      return { id };
    }),

  syncStock: adminProcedure
    .mutation(async () => {
      const result = await syncStock();
      return result;
    }),

  /** Config "Estoque para IA": quais campos a IA vê + curadoria (limpa lixo). */
  getAiConfig: protectedProcedure.query(async () => {
    const { getStockAiConfig, STOCK_AI_FIELDS } = await import("../stockSync");
    return { config: await getStockAiConfig(), campos: STOCK_AI_FIELDS };
  }),

  setAiConfig: adminProcedure
    .input(z.object({
      fields: z.array(z.string()).min(1),
      labels: z.record(z.string(), z.string()).default({}),
      onlyKnownVehicles: z.boolean(),
      hideNoPrice: z.boolean(),
      hideNoPhoto: z.boolean(),
      hideCategories: z.array(z.string()).default([]),
    }))
    .mutation(async ({ input }) => {
      await upsertSetting("ai_stock_config", JSON.stringify(input));
      return { success: true };
    }),
});
