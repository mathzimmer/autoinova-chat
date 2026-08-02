// ── Quick Reply Router (extraído de routers.ts no PR #10 — só move) ─────────
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const quickReplyRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { quickReplies } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    return db.select().from(quickReplies).orderBy(desc(quickReplies.usageCount));
  }),

  create: protectedProcedure
    .input(z.object({
      shortcut: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, hífen"),
      title: z.string().min(1).max(100),
      content: z.string().min(1),
      category: z.string().max(50).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { quickReplies } = await import("../../drizzle/schema");
      const result = await db.insert(quickReplies).values({ ...input, createdBy: ctx.user.id }).returning();
      return result[0];
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      shortcut: z.string().min(1).max(50).optional(),
      title: z.string().min(1).max(100).optional(),
      content: z.string().min(1).optional(),
      category: z.string().max(50).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { quickReplies } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { id, ...data } = input;
      await db.update(quickReplies).set({ ...data, updatedAt: new Date() }).where(eq(quickReplies.id, id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { quickReplies } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(quickReplies).where(eq(quickReplies.id, input.id));
      return { success: true };
    }),

  /** Incrementa contador de uso (para ordenar por mais usadas) */
  trackUsage: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const { quickReplies } = await import("../../drizzle/schema");
      const { eq, sql: sqlOp } = await import("drizzle-orm");
      await db.update(quickReplies).set({ usageCount: sqlOp`${quickReplies.usageCount} + 1` }).where(eq(quickReplies.id, input.id));
      return { success: true };
    }),
});
