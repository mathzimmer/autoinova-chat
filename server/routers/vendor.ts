// ── Vendor Router (extraído de routers.ts no PR #10 — só move) ──────────────
import { z } from "zod";
import crypto from "crypto";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, createActivityLog } from "../db";
import { emitConversationUpdate } from "../socket";
import { vendorKeyProcedure } from "./_helpers";

export const vendorRouter = router({

  me: vendorKeyProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.vendor.id,
      name: ctx.vendor.name,
      email: ctx.vendor.email,
      cargo: ctx.vendor.cargo,
    };
  }),

  myLeads: vendorKeyProcedure
    .input(z.object({
      status: z.enum(["all", "new", "qualifying", "qualified", "contacted", "converted", "lost"]).default("all"),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversations, leads } = await import("../../drizzle/schema");
      const { eq, desc, inArray } = await import("drizzle-orm");

      const convs = await db
        .select()
        .from(conversations)
        .where(eq(conversations.assignedTo, ctx.vendor.id))
        .orderBy(desc(conversations.lastMessageAt));

      if (convs.length === 0) return [];

      const convIds = convs.map((c) => c.id);
      const allLeads = await db.select().from(leads).where(inArray(leads.conversationId, convIds));
      const leadsByConv = new Map(allLeads.map((l) => [l.conversationId, l]));

      const statusFilter = input?.status ?? "all";

      return convs
        .map((conv) => {
          const lead = leadsByConv.get(conv.id);
          return {
            conversationId: conv.id,
            phone: conv.phone,
            contactName: conv.contactName,
            status: conv.status,
            lastMessageAt: conv.lastMessageAt,
            lastMessagePreview: conv.lastMessagePreview,
            aiActive: conv.aiActive,
            lead: lead ? {
              id: lead.id,
              name: lead.name,
              vehicleInterest: lead.vehicleInterest,
              paymentMethod: lead.paymentMethod,
              downPayment: lead.downPayment,
              hasTrade: lead.hasTrade,
              tradeVehicle: lead.tradeVehicle,
              status: lead.status,
              notes: lead.notes,
              score: lead.score,
              vehicleId: lead.vehicleId,
            } : null,
          };
        })
        .filter((item) => statusFilter === "all" || item.lead?.status === statusFilter);
    }),

  updateLeadStatus: vendorKeyProcedure
    .input(z.object({
      conversationId: z.number(),
      status: z.enum(["new", "qualifying", "qualified", "contacted", "converted", "lost"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations, leads } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const conv = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv[0] || conv[0].assignedTo !== ctx.vendor.id) throw new Error("Conversa não encontrada ou não atribuída a você");

      await db.update(leads).set({ status: input.status as any, updatedAt: new Date() }).where(eq(leads.conversationId, input.conversationId));
      await createActivityLog({ userId: ctx.vendor.id, action: "vendor_update_lead_status", conversationId: input.conversationId, details: { status: input.status, via: "chrome_extension" } });
      emitConversationUpdate(input.conversationId, { leadStatus: input.status });
      return { success: true };
    }),

  addNote: vendorKeyProcedure
    .input(z.object({
      conversationId: z.number(),
      note: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations, leads } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const conv = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv[0] || conv[0].assignedTo !== ctx.vendor.id) throw new Error("Conversa não encontrada ou não atribuída a você");

      const existing = await db.select({ notes: leads.notes }).from(leads).where(eq(leads.conversationId, input.conversationId)).limit(1);
      const timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const newEntry = `[${timestamp} - ${ctx.vendor.name}]\n${input.note}`;
      const updatedNotes = existing[0]?.notes ? `${existing[0].notes}\n\n${newEntry}` : newEntry;

      await db.update(leads).set({ notes: updatedNotes, updatedAt: new Date() }).where(eq(leads.conversationId, input.conversationId));
      await createActivityLog({ userId: ctx.vendor.id, action: "vendor_add_note", conversationId: input.conversationId, details: { via: "chrome_extension" } });
      return { success: true, notes: updatedNotes };
    }),

  updateLeadData: vendorKeyProcedure
    .input(z.object({
      conversationId: z.number(),
      vehicleInterest: z.string().optional(),
      paymentMethod: z.string().optional(),
      downPayment: z.string().optional(),
      hasTrade: z.boolean().optional(),
      tradeVehicle: z.string().optional(),
      name: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations, leads } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const conv = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv[0] || conv[0].assignedTo !== ctx.vendor.id) throw new Error("Conversa não encontrada ou não atribuída a você");

      const { conversationId: _, ...updateFields } = input;
      const cleanUpdate: Record<string, unknown> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(updateFields)) {
        if (value !== undefined) cleanUpdate[key] = value;
      }

      await db.update(leads).set(cleanUpdate).where(eq(leads.conversationId, input.conversationId));
      await createActivityLog({ userId: ctx.vendor.id, action: "vendor_update_lead_data", conversationId: input.conversationId, details: { fields: Object.keys(cleanUpdate), via: "chrome_extension" } });
      emitConversationUpdate(input.conversationId, { leadUpdated: true });
      return { success: true };
    }),

  getWhatsappLink: vendorKeyProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations, leads } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const conv = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv[0] || conv[0].assignedTo !== ctx.vendor.id) throw new Error("Conversa não encontrada ou não atribuída a você");

      const lead = await db.select().from(leads).where(eq(leads.conversationId, input.conversationId)).limit(1);
      const l = lead[0];
      const c = conv[0];
      const nome = l?.name || c.contactName || "cliente";

      let texto = `Olá ${nome}! 👋\n\nSou ${ctx.vendor.name} da AutoInova.`;
      if (l?.vehicleInterest) texto += `\n\nVi que você se interessou por: *${l.vehicleInterest}*.`;
      if (l?.paymentMethod) texto += `\nForma de pagamento: ${l.paymentMethod}.`;
      if (l?.downPayment) texto += `\nEntrada disponível: ${l.downPayment}.`;
      if (l?.hasTrade && l?.tradeVehicle) texto += `\nTroca: ${l.tradeVehicle}.`;
      texto += `\n\nPosso te ajudar com mais detalhes? 🚗`;

      const phone = c.phone.replace(/\D/g, "");
      const link = `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`;
      return { link, phone, text: texto };
    }),

  createApiKey: protectedProcedure
    .input(z.object({
      teamMemberId: z.number(),
      name: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { vendorApiKeys } = await import("../../drizzle/schema");

      const apiKey = crypto.randomBytes(32).toString("hex");
      await db.insert(vendorApiKeys).values({ teamMemberId: input.teamMemberId, apiKey, name: input.name ?? "Extensão Chrome", active: true });
      await createActivityLog({ userId: ctx.user.id, action: "create_vendor_api_key", details: { teamMemberId: input.teamMemberId } });
      return { apiKey };
    }),

  listApiKeys: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { vendorApiKeys } = await import("../../drizzle/schema");
    const keys = await db.select().from(vendorApiKeys);
    return keys.map((k) => ({
      id: k.id,
      teamMemberId: k.teamMemberId,
      name: k.name,
      keyPreview: k.apiKey.slice(0, 8) + "••••••••••••••••••••••••••••••••••••••••",
      active: k.active,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
  }),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { vendorApiKeys } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(vendorApiKeys).set({ active: false }).where(eq(vendorApiKeys.id, input.id));
      await createActivityLog({ userId: ctx.user.id, action: "revoke_vendor_api_key", details: { keyId: input.id } });
      return { success: true };
    }),
});
