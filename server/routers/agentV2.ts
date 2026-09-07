/**
 * Router do AGENTE v2 (isolado) — usado pelo simulador de chat.
 * Não toca em conversas/webhook/fluxo. Estoque do CRM (só leitura), LLM OpenRouter.
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { runAgentV2Turn, getAgentV2Config, getAgentV2Tools, resetSession } from "../agentV2";
import { upsertSetting } from "../db";

export const agentV2Router = router({
  chat: protectedProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      message: z.string().min(1).max(2000),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).max(60).default([]),
    }))
    .mutation(async ({ input }) => {
      return runAgentV2Turn({ sessionId: input.sessionId, history: input.history, message: input.message });
    }),

  reset: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      resetSession(input.sessionId);
      return { success: true };
    }),

  getConfig: protectedProcedure.query(async () => {
    return getAgentV2Config();
  }),

  getTools: protectedProcedure.query(async () => {
    return getAgentV2Tools();
  }),

  setTools: adminProcedure
    .input(z.object({
      tools: z.array(z.object({
        name: z.string(),
        enabled: z.boolean(),
        description: z.string().min(3).max(1200),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const obj: Record<string, { enabled: boolean; description: string }> = {};
      for (const t of input.tools) obj[t.name] = { enabled: t.enabled, description: t.description.trim() };
      await upsertSetting("agentv2_tools", JSON.stringify(obj), ctx.user.id);
      return { success: true };
    }),

  setConfig: adminProcedure
    .input(z.object({
      model: z.string().min(2).max(120),
      persona: z.string().min(5).max(6000),
      rules: z.string().min(5).max(6000),
      faq: z.string().min(0).max(8000).optional(),
      temperature: z.number().min(0).max(1),
      search: z.object({
        limit: z.number().min(1).max(12),
        ordem: z.enum(["barato", "caro", "novo", "km"]),
        fotoPrimeiro: z.boolean(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("agentv2_model", input.model, ctx.user.id);
      await upsertSetting("agentv2_persona", input.persona, ctx.user.id);
      await upsertSetting("agentv2_rules", input.rules, ctx.user.id);
      if (input.faq !== undefined) await upsertSetting("agentv2_faq", input.faq, ctx.user.id);
      if (input.search) await upsertSetting("agentv2_search", JSON.stringify(input.search), ctx.user.id);
      await upsertSetting("agentv2_temperature", String(input.temperature), ctx.user.id);
      return { success: true };
    }),
});
