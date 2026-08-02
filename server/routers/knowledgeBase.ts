// ── Knowledge Base Router (extraído de routers.ts no PR #10 — só move) ──────
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const knowledgeBaseRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { knowledgeBase } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    return db.select().from(knowledgeBase).orderBy(desc(knowledgeBase.updatedAt));
  }),

  create: protectedProcedure
    .input(z.object({
      category: z.string().min(1).max(100),
      title: z.string().min(1).max(255),
      content: z.string().min(1),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { knowledgeBase } = await import("../../drizzle/schema");
      const result = await db.insert(knowledgeBase).values(input).returning();
      return result[0];
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      category: z.string().min(1).max(100).optional(),
      title: z.string().min(1).max(255).optional(),
      content: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { knowledgeBase } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { id, ...data } = input;
      await db.update(knowledgeBase).set({ ...data, updatedAt: new Date() }).where(eq(knowledgeBase.id, id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { knowledgeBase } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, input.id));
      return { success: true };
    }),
});
