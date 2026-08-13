// ── Copiloto do Vendedor Router ────────────────────────────────────────────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getConversationById, updateConversation, upsertSetting } from "../db";
import { getCopilotPlaybook, suggestForConversation } from "../sellerCopilot";

export const copilotRouter = router({
  // Playbook parametrizável (tom, fluxo, sinais, objeções, objetivo)
  getConfig: protectedProcedure.query(async () => getCopilotPlaybook()),

  setConfig: adminProcedure
    .input(z.object({
      tom: z.string().default(""),
      fluxo: z.string().default(""),
      sinais: z.string().default(""),
      objecoes: z.string().default(""),
      objetivo: z.string().default(""),
    }))
    .mutation(async ({ ctx, input }) => {
      await upsertSetting("copilot_playbook", JSON.stringify(input), ctx.user.id);
      return { success: true };
    }),

  // Liga/desliga o copiloto NAQUELA conversa (padrão desligado)
  setEnabled: protectedProcedure
    .input(z.object({ conversationId: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new Error("Conversa não encontrada");
      const meta = ((conv as any).metadata as Record<string, unknown>) || {};
      await updateConversation(input.conversationId, { metadata: { ...meta, copilot: input.enabled } as any });
      return { success: true, enabled: input.enabled };
    }),

  // Sugestões para o vendedor (chamado pelo painel quando ligado + chega msg nova).
  // `lastMessageId` serve só para cache por mensagem no cliente.
  suggest: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      lastMessageId: z.number().optional(),
      count: z.number().min(1).max(3).default(3),
    }))
    .query(async ({ input }) => suggestForConversation(input.conversationId, input.count)),
});
