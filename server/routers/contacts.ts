// ── Contacts Router (extraído de routers.ts no PR #10 — só move) ────────────
import { z } from "zod";
import { and, desc, eq, ilike, inArray, isNull, like, ne, or } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  getDb, listContacts, getContactById, getContactByPhone, createContact, updateContact,
  deleteContact, bulkCreateContacts, getAllContactTags,
  createTemplateSend, listTemplateSends, getSetting, upsertSetting,
} from "../db";
import { normalizePhone, phoneVariations } from "../phoneNormalize";
import { sendWhatsAppTemplate } from "../whatsappTemplates";

export const contactsRouter = router({
  /** Busca leve para o picker de nova conversa — nome OU número, case-insensitive */
  search: protectedProcedure
    .input(z.object({ q: z.string().min(1).max(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { contacts } = await import("../../drizzle/schema");
      const { ilike, like: likeOp, or: orOp, and: andOp, eq, desc } = await import("drizzle-orm");
      const term = `%${input.q.trim()}%`;
      const digits = input.q.replace(/\D/g, "");
      const nameCond = ilike(contacts.name, term);
      const cond = digits.length >= 3
        ? orOp(nameCond, likeOp(contacts.phone, `%${digits}%`))!
        : nameCond;
      const rows = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
        .from(contacts)
        .where(andOp(eq(contacts.isActive, true), cond))
        .orderBy(desc(contacts.createdAt))
        .limit(10);
      return rows;
    }),

  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      tag: z.string().optional(),
      source: z.string().optional(),
      kind: z.string().optional(), // lead | cliente | custom
      createdByInstance: z.string().optional(), // "matriz" ou nome da instância
      limit: z.number().optional(),
      offset: z.number().optional(),
      campaignParticipant: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const result = await listContacts(input || {});
      const rows = (result as any).contacts || [];
      if (rows.length === 0) return result;

      // Enriquece com a última conversa (por conversationId ou telefone)
      try {
        const db = await getDb();
        if (db) {
          const { conversations: convTable } = await import("../../drizzle/schema");
          const { inArray, ne: neOp, and: andOp } = await import("drizzle-orm");
          const phones = Array.from(new Set(rows.map((c: any) => c.phone).filter(Boolean)));
          const convs = phones.length > 0
            ? await db.select({
                id: convTable.id, phone: convTable.phone,
                lastMessageAt: convTable.lastMessageAt,
                lastMessagePreview: convTable.lastMessagePreview,
                status: convTable.status,
              }).from(convTable)
              .where(andOp(inArray(convTable.phone, phones as string[]), neOp(convTable.channel, "evolution" as any)))
            : [];
          const byPhone = new Map<string, any>();
          for (const cv of convs) {
            const prev = byPhone.get(cv.phone);
            if (!prev || (cv.lastMessageAt || 0) > (prev.lastMessageAt || 0)) byPhone.set(cv.phone, cv);
          }
          for (const c of rows) {
            const cv = byPhone.get(c.phone);
            c.lastConversation = cv ? {
              conversationId: cv.id,
              lastMessageAt: cv.lastMessageAt,
              preview: cv.lastMessagePreview,
              status: cv.status,
            } : null;
          }
        }
      } catch { /* enriquecimento é opcional */ }
      return result;
    }),

  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getContactById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
      kind: z.string().max(40).default("lead"),
      createdByInstance: z.string().max(100).nullable().optional(),
      cpf: z.string().max(14).optional(),
      birthDate: z.string().max(10).optional(),
      address: z.string().max(500).optional(),
      city: z.string().max(100).optional(),
      purchasedVehicle: z.string().max(300).optional(),
      source: z.enum(["manual", "excel", "whatsapp", "lead"]).default("manual"),
    }))
    .mutation(async ({ input }) => {
      const existing = await getContactByPhone(input.phone);
      if (existing) throw new Error("Contato com este telefone já existe");
      return createContact(input);
    }),

  // Accessible by all authenticated users (vendors can save contacts from inbox)
  createFromInbox: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const cleanPhone = input.phone.replace(/\D/g, "");
      const existing = await getContactByPhone(cleanPhone);
      if (existing) {
        // Update name if it's better
        if (input.name && input.name !== existing.name) {
          await updateContact(existing.id, { name: input.name });
        }
        return { ...existing, updated: true };
      }
      const contact = await createContact({
        name: input.name,
        phone: cleanPhone,
        email: input.email,
        notes: input.notes,
        source: "whatsapp" as const,
      });
      return { ...contact, updated: false };
    }),

  // Accessible by all authenticated users (vendors can list contacts for lookup)
  listForInbox: protectedProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return listContacts({ search: input?.search, limit: 50 });
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
      kind: z.string().max(40).optional(),
      cpf: z.string().max(14).nullable().optional(),
      birthDate: z.string().max(10).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      city: z.string().max(100).nullable().optional(),
      purchasedVehicle: z.string().max(300).nullable().optional(),
      lastDealValue: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateContact(id, data);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteContact(input.id);
      return { success: true };
    }),

  bulkImport: adminProcedure
    .input(z.object({
      contacts: z.array(z.object({
        name: z.string().min(1),
        phone: z.string().min(1),
        email: z.string().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        kind: z.enum(["lead", "cliente"]).optional(),
        cpf: z.string().max(14).optional(),
        birthDate: z.string().max(10).optional(),
        address: z.string().max(500).optional(),
        city: z.string().max(100).optional(),
        purchasedVehicle: z.string().max(300).optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const rows = input.contacts.map(c => ({ ...c, source: "excel" as const }));
      return bulkCreateContacts(rows);
    }),

  tags: adminProcedure.query(async () => {
    return getAllContactTags();
  }),

  /**
   * Backfill: preenche a origem (instância) de contatos antigos que foram
   * salvos antes do campo existir, cruzando telefone → conversa Evolution.
   */
  backfillInstances: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const { contacts: contactsTable, conversations: convTable } = await import("../../drizzle/schema");
    const { eq, and, isNull, inArray } = await import("drizzle-orm");

    // Contatos sem origem definida
    const orphans = await db.select().from(contactsTable).where(isNull(contactsTable.createdByInstance));
    let matched = 0;

    for (const c of orphans) {
      // Procura conversa Evolution com esse telefone (variações de 9º dígito)
      const variations = Array.from(new Set([c.phone, ...phoneVariations(c.phone)]));
      const evoConv = (await db.select({ instanceName: convTable.instanceName }).from(convTable)
        .where(and(
          eq(convTable.channel, "evolution" as any),
          inArray(convTable.phone, variations),
        )).limit(1))[0];

      if (evoConv?.instanceName) {
        await db.update(contactsTable).set({ createdByInstance: evoConv.instanceName }).where(eq(contactsTable.id, c.id));
        matched++;
      }
      // Contatos que só têm conversa na matriz ficam NULL de propósito (origem = matriz)
    }
    return { total: orphans.length, matched, matriz: orphans.length - matched };
  }),

  /** Tipos de contato customizados (além de lead/cliente) */
  kinds: protectedProcedure.query(async () => {
    const raw = await getSetting("contact_custom_kinds");
    let custom: string[] = [];
    try { custom = raw ? JSON.parse(raw) : []; } catch { custom = []; }
    return { builtin: ["lead", "cliente"], custom };
  }),

  addKind: adminProcedure
    .input(z.object({ name: z.string().min(1).max(40) }))
    .mutation(async ({ input }) => {
      const raw = await getSetting("contact_custom_kinds");
      let custom: string[] = [];
      try { custom = raw ? JSON.parse(raw) : []; } catch { custom = []; }
      const clean = input.name.trim().toLowerCase();
      if (["lead", "cliente"].includes(clean)) throw new Error("Esse tipo já existe");
      if (!custom.includes(clean)) custom.push(clean);
      await upsertSetting("contact_custom_kinds", JSON.stringify(custom));
      return { custom };
    }),

  removeKind: adminProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const raw = await getSetting("contact_custom_kinds");
      let custom: string[] = [];
      try { custom = raw ? JSON.parse(raw) : []; } catch { custom = []; }
      custom = custom.filter(k => k !== input.name.toLowerCase());
      await upsertSetting("contact_custom_kinds", JSON.stringify(custom));
      return { custom };
    }),

  // Send template to a single contact
  sendTemplate: adminProcedure
    .input(z.object({
      contactId: z.number(),
      phone: z.string(),
      templateName: z.string(),
      bodyParams: z.array(z.string()).default([]),
      language: z.string().default("pt_BR"),
    }))
    .mutation(async ({ input }) => {
      const result = await sendWhatsAppTemplate(
        input.phone,
        input.templateName,
        input.bodyParams,
        input.language
      );
      const sendId = await createTemplateSend({
        contactId: input.contactId,
        templateName: input.templateName,
        phone: input.phone,
        status: result.success ? "sent" : "failed",
        errorMessage: result.error || undefined,
      });
      if (!result.success) throw new Error(result.error ?? "Falha ao enviar template");
      return { success: true, sendId };
    }),

  // Send template to multiple contacts (bulk)
  sendTemplateBulk: adminProcedure
    .input(z.object({
      contactIds: z.array(z.number()),
      templateName: z.string(),
      bodyParams: z.array(z.string()).default([]),
      language: z.string().default("pt_BR"),
    }))
    .mutation(async ({ input }) => {
      let sent = 0;
      let failed = 0;
      for (const contactId of input.contactIds) {
        const contact = await getContactById(contactId);
        if (!contact) { failed++; continue; }
        try {
          const result = await sendWhatsAppTemplate(
            contact.phone,
            input.templateName,
            input.bodyParams,
            input.language
          );
          await createTemplateSend({
            contactId,
            templateName: input.templateName,
            phone: contact.phone,
            status: result.success ? "sent" : "failed",
            errorMessage: result.error || undefined,
          });
          if (result.success) sent++; else failed++;
          // Small delay between sends to avoid rate limiting
          await new Promise(r => setTimeout(r, 500));
        } catch {
          failed++;
        }
      }
      return { sent, failed, total: input.contactIds.length };
    }),

  // List template send history
  sendHistory: adminProcedure
    .input(z.object({
      contactId: z.number().optional(),
      templateName: z.string().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listTemplateSends(input || {});
    }),

  // Detect duplicate contacts by normalized phone
  findDuplicates: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      const { contacts: contactsTable } = await import("../../drizzle/schema");
      const allContacts = await db.select().from(contactsTable).where(eq(contactsTable.isActive, true));

      // Group by normalized phone
      const groups = new Map<string, typeof allContacts>();
      for (const c of allContacts) {
        const norm = normalizePhone(c.phone);
        if (!norm) continue;
        const existing = groups.get(norm) || [];
        existing.push(c);
        groups.set(norm, existing);
      }

      // Return only groups with duplicates
      const duplicates: Array<{ normalizedPhone: string; contacts: typeof allContacts }> = [];
      for (const [norm, group] of Array.from(groups.entries())) {
        if (group.length > 1) {
          duplicates.push({ normalizedPhone: norm, contacts: group });
        }
      }
      return duplicates;
    }),

  // Merge two contacts: keep primary, merge data from secondary, deactivate secondary
  merge: adminProcedure
    .input(z.object({
      primaryId: z.number(),
      secondaryId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const primary = await getContactById(input.primaryId);
      const secondary = await getContactById(input.secondaryId);
      if (!primary || !secondary) throw new Error("Contato não encontrado");

      const updates: Record<string, any> = {};

      // Merge name: prefer non-generic
      if ((!primary.name || primary.name === "Cliente") && secondary.name && secondary.name !== "Cliente") {
        updates.name = secondary.name;
      }
      // Merge email
      if (!primary.email && secondary.email) updates.email = secondary.email;
      // Merge notes
      if (secondary.notes) {
        updates.notes = primary.notes ? `${primary.notes}\n---\n${secondary.notes}` : secondary.notes;
      }
      // Merge tags
      const primaryTags = primary.tags || [];
      const secondaryTags = secondary.tags || [];
      const mergedTags = Array.from(new Set([...primaryTags, ...secondaryTags]));
      if (mergedTags.length > primaryTags.length) updates.tags = mergedTags;
      // Merge conversationId
      if (!primary.conversationId && secondary.conversationId) updates.conversationId = secondary.conversationId;
      // Merge leadId
      if (!primary.leadId && secondary.leadId) updates.leadId = secondary.leadId;
      // Normalize phone
      const normPhone = normalizePhone(primary.phone);
      if (normPhone && normPhone !== primary.phone) updates.phone = normPhone;

      if (Object.keys(updates).length > 0) {
        await updateContact(primary.id, updates);
      }

      // Deactivate secondary
      await deleteContact(secondary.id);

      return { success: true, primaryId: primary.id };
    }),

  // Auto-merge all detected duplicates
  autoMerge: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contacts: contactsTable } = await import("../../drizzle/schema");
      const allContacts = await db.select().from(contactsTable).where(eq(contactsTable.isActive, true));

      const groups = new Map<string, typeof allContacts>();
      for (const c of allContacts) {
        const norm = normalizePhone(c.phone);
        if (!norm) continue;
        const existing = groups.get(norm) || [];
        existing.push(c);
        groups.set(norm, existing);
      }

      let merged = 0;
      for (const [norm, group] of Array.from(groups.entries())) {
        if (group.length <= 1) continue;

        // Pick the best primary: prefer one with conversationId, then most data
        const sorted = [...group].sort((a, b) => {
          if (a.conversationId && !b.conversationId) return -1;
          if (!a.conversationId && b.conversationId) return 1;
          if (a.leadId && !b.leadId) return -1;
          if (!a.leadId && b.leadId) return 1;
          const aScore = (a.name && a.name !== "Cliente" ? 1 : 0) + (a.email ? 1 : 0) + (a.notes ? 1 : 0);
          const bScore = (b.name && b.name !== "Cliente" ? 1 : 0) + (b.email ? 1 : 0) + (b.notes ? 1 : 0);
          return bScore - aScore;
        });

        const primary = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          const secondary = sorted[i];
          const updates: Record<string, any> = {};
          if ((!primary.name || primary.name === "Cliente") && secondary.name && secondary.name !== "Cliente") {
            updates.name = secondary.name;
          }
          if (!primary.email && secondary.email) updates.email = secondary.email;
          if (secondary.notes) {
            updates.notes = primary.notes ? `${primary.notes}\n---\n${secondary.notes}` : secondary.notes;
          }
          const pTags = primary.tags || [];
          const sTags = secondary.tags || [];
          const mTags = Array.from(new Set([...pTags, ...sTags]));
          if (mTags.length > pTags.length) updates.tags = mTags;
          if (!primary.conversationId && secondary.conversationId) updates.conversationId = secondary.conversationId;
          if (!primary.leadId && secondary.leadId) updates.leadId = secondary.leadId;
          updates.phone = norm; // Normalize

          if (Object.keys(updates).length > 0) {
            await updateContact(primary.id, updates);
            // Update primary in memory for next iteration
            Object.assign(primary, updates);
          }
          await deleteContact(secondary.id);
          merged++;
        }
      }

      return { merged };
    }),

  // Sync contacts from existing conversations/leads
  syncFromConversations: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { conversations, leads } = await import("../../drizzle/schema");

      // Get all conversations with phone numbers
      const allConversations = await db.select({
        id: conversations.id,
        phone: conversations.phone,
        contactName: conversations.contactName,
        contactPhoto: conversations.contactPhoto,
        channel: conversations.channel,
      }).from(conversations);

      let created = 0;
      let skipped = 0;
      let updated = 0;

      for (const conv of allConversations) {
        if (!conv.phone) { skipped++; continue; }
        
        try {
          const existing = await getContactByPhone(conv.phone);
          if (existing) {
            // Atualizar dados se necessário
            const updates: Record<string, any> = {};
            if (!existing.conversationId && conv.id) updates.conversationId = conv.id;
            if (conv.contactName && existing.name === "Cliente") updates.name = conv.contactName;
            if (Object.keys(updates).length > 0) {
              await updateContact(existing.id, updates);
              updated++;
            } else {
              skipped++;
            }
          } else {
            // Buscar lead vinculado para enriquecer dados
            const lead = await db.select({
              id: leads.id,
              name: leads.name,
              email: leads.email,
              notes: leads.notes,
            }).from(leads).where(eq(leads.conversationId, conv.id as any)).limit(1);

            const leadData = lead[0];

            await createContact({
              name: conv.contactName || leadData?.name || "Cliente",
              phone: conv.phone,
              email: leadData?.email || undefined,
              notes: leadData?.notes || undefined,
              conversationId: conv.id,
              leadId: leadData?.id || undefined,
              source: (conv.channel || "whatsapp") as any,
              isActive: true,
            });
            created++;
          }
        } catch (err) {
          console.error(`[ContactSync] Erro ao sincronizar ${conv.phone}:`, err);
          skipped++;
        }
      }

      return { created, updated, skipped, total: allConversations.length };
    }),
});
