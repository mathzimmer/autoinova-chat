/**
 * Router do AGENTE v2 (isolado) — usado pelo simulador de chat.
 * Não toca em conversas/webhook/fluxo. Estoque do CRM (só leitura), LLM OpenRouter.
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { runAgentV2Turn, getAgentV2Config, resetSession } from "../agentV2";
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

  setConfig: adminProcedure
    .input(z.object({
      model: z.string().min(2).max(120),
      persona: z.string().min(5).max(6000),
      temperature: z.number().min(0).max(1),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("agentv2_model", input.model, ctx.user.id);
      await upsertSetting("agentv2_persona", input.persona, ctx.user.id);
      await upsertSetting("agentv2_temperature", String(input.temperature), ctx.user.id);
      return { success: true };
    }),
});
