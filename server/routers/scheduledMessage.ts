// ── Scheduled Message Router (extraído de routers.ts no PR #10 — só move) ───
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const scheduledMessageRouter = router({
  create: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      content: z.string().min(1),
      scheduledAt: z.number(), // epoch ms
      fallbackTemplateName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.scheduledAt <= Date.now()) throw new Error("O horário precisa ser no futuro");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { scheduledMessages } = await import("../../drizzle/schema");
      const result = await db.insert(scheduledMessages).values({
        conversationId: input.conversationId,
        content: input.content,
        scheduledAt: input.scheduledAt,
        fallbackTemplateName: input.fallbackTemplateName || null,
        createdBy: ctx.user.id,
        createdByName: ctx.user.name || "Atendente",
      }).returning();
      return result[0];
    }),

  listByConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { scheduledMessages } = await import("../../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      return db.select().from(scheduledMessages)
        .where(andOp(eq(scheduledMessages.conversationId, input.conversationId), eq(scheduledMessages.status, "pending")))
        .orderBy(scheduledMessages.scheduledAt);
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { scheduledMessages } = await import("../../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      await db.update(scheduledMessages)
        .set({ status: "cancelled" })
        .where(andOp(eq(scheduledMessages.id, input.id), eq(scheduledMessages.status, "pending")));
      return { success: true };
    }),
});
