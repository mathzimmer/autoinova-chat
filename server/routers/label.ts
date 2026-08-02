// ── Label Router (extraído de routers.ts no PR #10 — só move) ───────────────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { emitConversationUpdate } from "../socket";

export const labelRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { labels } = await import("../../drizzle/schema");
    return db.select().from(labels).orderBy(labels.name);
  }),

  /** Todas as atribuições conversa<->etiqueta (client monta o mapa) */
  assignments: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { conversationLabels } = await import("../../drizzle/schema");
    return db.select().from(conversationLabels);
  }),

  byConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversationLabels, labels } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      return db.select({ id: labels.id, name: labels.name, color: labels.color })
        .from(conversationLabels)
        .innerJoin(labels, eq(conversationLabels.labelId, labels.id))
        .where(eq(conversationLabels.conversationId, input.conversationId));
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(50), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { labels } = await import("../../drizzle/schema");
      const result = await db.insert(labels).values(input).returning();
      return result[0];
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1).max(50).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { labels } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { id, ...data } = input;
      await db.update(labels).set(data).where(eq(labels.id, id));
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { labels, conversationLabels } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(conversationLabels).where(eq(conversationLabels.labelId, input.id));
      await db.delete(labels).where(eq(labels.id, input.id));
      return { success: true };
    }),

  /** Define o conjunto completo de etiquetas de uma conversa */
  setForConversation: protectedProcedure
    .input(z.object({ conversationId: z.number(), labelIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversationLabels, labels } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      // Etiquetas antes (para detectar adicionadas/removidas → gatilhos de CRM)
      const beforeRows = await db.select({ labelId: conversationLabels.labelId })
        .from(conversationLabels)
        .where(eq(conversationLabels.conversationId, input.conversationId));
      const beforeArr = beforeRows.map(r => r.labelId);
      const afterArr = input.labelIds;

      await db.delete(conversationLabels).where(eq(conversationLabels.conversationId, input.conversationId));
      if (input.labelIds.length > 0) {
        await db.insert(conversationLabels).values(
          input.labelIds.map(labelId => ({ conversationId: input.conversationId, labelId }))
        );
      }
      emitConversationUpdate(input.conversationId, { labelIds: input.labelIds });

      // Gatilhos de CRM: etiqueta adicionada / removida
      const addedIds = afterArr.filter(id => !beforeArr.includes(id));
      const removedIds = beforeArr.filter(id => !afterArr.includes(id));
      if (addedIds.length > 0 || removedIds.length > 0) {
        (async () => {
          try {
            const allLabels = await db.select({ id: labels.id, name: labels.name }).from(labels);
            const nameById = new Map(allLabels.map(l => [l.id, l.name]));
            const { triggerEventFlow } = await import("../flowEngine");
            for (const id of addedIds) {
              await triggerEventFlow({ conversationId: input.conversationId, triggerType: "tag_added", matchValue: nameById.get(id) || undefined });
            }
            for (const id of removedIds) {
              await triggerEventFlow({ conversationId: input.conversationId, triggerType: "tag_removed", matchValue: nameById.get(id) || undefined });
            }
          } catch (e) { console.error("[CRM trigger] etiqueta:", e); }
        })();
      }
      return { success: true };
    }),
});
