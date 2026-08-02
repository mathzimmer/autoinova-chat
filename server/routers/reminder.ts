// ── Reminder Router (extraído de routers.ts no PR #10 — só move) ────────────
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const reminderRouter = router({
  create: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      remindAt: z.number(), // epoch ms
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.remindAt <= Date.now()) throw new Error("O lembrete precisa ser no futuro");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversationReminders } = await import("../../drizzle/schema");
      const result = await db.insert(conversationReminders).values({
        conversationId: input.conversationId,
        teamMemberId: ctx.user.id,
        remindAt: input.remindAt,
        note: input.note || null,
      }).returning();
      return result[0];
    }),

  /** Lembretes pendentes do usuário logado (opcionalmente de uma conversa) */
  listMine: protectedProcedure
    .input(z.object({ conversationId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversationReminders } = await import("../../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      const conditions = [
        eq(conversationReminders.teamMemberId, ctx.user.id),
        eq(conversationReminders.status, "pending"),
      ];
      if (input?.conversationId) conditions.push(eq(conversationReminders.conversationId, input.conversationId));
      return db.select().from(conversationReminders).where(andOp(...conditions)).orderBy(conversationReminders.remindAt);
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversationReminders } = await import("../../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      await db.update(conversationReminders)
        .set({ status: "dismissed" })
        .where(andOp(eq(conversationReminders.id, input.id), eq(conversationReminders.teamMemberId, ctx.user.id)));
      return { success: true };
    }),
});
