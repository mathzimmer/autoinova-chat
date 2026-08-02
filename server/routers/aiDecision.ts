// ── AI Decision Router (extraído de routers.ts no PR #10 — só move) ─────────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  listAiDecisions, getAiDecisionsByConversation, getAiDecisionStats,
} from "../db";

export const aiDecisionRouter = router({
  list: adminProcedure
    .input(z.object({
      conversationId: z.number().optional(),
      toolName: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listAiDecisions({
        conversationId: input?.conversationId,
        toolName: input?.toolName,
        limit: input?.limit || 50,
        offset: input?.offset || 0,
      });
    }),

  byConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      return getAiDecisionsByConversation(input.conversationId);
    }),

  stats: adminProcedure
    .query(async () => {
      return getAiDecisionStats();
    }),
});
