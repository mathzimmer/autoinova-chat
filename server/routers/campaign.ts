// ── Campaign Router (extraído de routers.ts no PR #10 — só move, não muda) ──
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { executeCampaign } from "../campaignService";
import {
  createCampaign as createCampaignDb,
  getCampaignById as getCampaignByIdDb,
  listCampaigns as listCampaignsDb,
  updateCampaign as updateCampaignDb,
  deleteCampaign as deleteCampaignDb,
  getCampaignDispatchesByCampaign,
  getCampaignDispatchStats,
  getDb,
} from "../db";

// ── Campaign (Envio em Massa) Router ────────────────────────────────────────

export const campaignRouter = router({
  // List all campaigns
  list: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return listCampaignsDb(input || {});
    }),

  // Get campaign by ID
  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.id);
      if (!campaign) throw new Error("Campanha não encontrada");
      return campaign;
    }),

  // Create new campaign
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      templateName: z.string().min(1),
      templateLanguage: z.string().default("pt_BR"),
      bodyParams: z.array(z.string()).optional(),
      contactIds: z.array(z.number()).optional(),
      filterTags: z.array(z.string()).optional(),
      filterKind: z.enum(["lead", "cliente"]).optional(), // público: só leads ou só clientes
      scheduleType: z.enum(["once", "recurring"]).default("once"),
      scheduledAt: z.number().optional(),
      intervalDays: z.number().min(1).max(365).optional(),
      responseFlowId: z.number().optional(),
      conversationTag: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const nextRunAt = input.scheduledAt || undefined;
      const campaign = await createCampaignDb({
        ...input,
        bodyParams: input.bodyParams || null,
        contactIds: input.contactIds || null,
        filterTags: input.filterTags || null,
        filterKind: input.filterKind || null,
        nextRunAt,
        status: input.scheduledAt ? "scheduled" : "draft",
        totalContacts: input.contactIds?.length || 0,
        createdBy: ctx.user.id,
      });
      return campaign;
    }),

  // Update campaign
  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      templateName: z.string().optional(),
      templateLanguage: z.string().optional(),
      bodyParams: z.array(z.string()).optional(),
      contactIds: z.array(z.number()).optional(),
      filterTags: z.array(z.string()).optional(),
      scheduleType: z.enum(["once", "recurring"]).optional(),
      scheduledAt: z.number().optional(),
      intervalDays: z.number().min(1).max(365).optional(),
      responseFlowId: z.number().nullable().optional(),
      conversationTag: z.string().nullable().optional(),
      status: z.enum(["draft", "scheduled", "paused"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.contactIds) updateData.totalContacts = data.contactIds.length;
      if (data.scheduledAt) updateData.nextRunAt = data.scheduledAt;
      return updateCampaignDb(id, updateData);
    }),

  // Delete campaign
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteCampaignDb(input.id);
      return { success: true };
    }),

  // Execute campaign immediately
  execute: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return executeCampaign(input.id);
    }),

  // Schedule campaign (set status to scheduled)
  schedule: adminProcedure
    .input(z.object({
      id: z.number(),
      scheduledAt: z.number(),
      intervalDays: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      return updateCampaignDb(input.id, {
        status: "scheduled",
        scheduledAt: input.scheduledAt,
        nextRunAt: input.scheduledAt,
        intervalDays: input.intervalDays,
        scheduleType: input.intervalDays ? "recurring" : "once",
      });
    }),

  // Pause campaign
  pause: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return updateCampaignDb(input.id, { status: "paused" });
    }),

  // Get dispatch history for a campaign
  dispatches: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      runNumber: z.number().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return getCampaignDispatchesByCampaign(input.campaignId, input);
    }),

  // Get stats for a campaign
  stats: adminProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return getCampaignDispatchStats(input.campaignId);
    }),

  // List available flows for response trigger
  availableFlows: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { chatFlows } = await import("../../drizzle/schema");
    return db.select({
      id: chatFlows.id,
      name: chatFlows.name,
      trigger: chatFlows.trigger,
      active: chatFlows.active,
    }).from(chatFlows);
  }),

  // Add contact to campaign
  addContact: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      contactId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada");
      
      const currentIds = campaign.contactIds || [];
      if (!currentIds.includes(input.contactId)) {
        currentIds.push(input.contactId);
      }
      
      return updateCampaignDb(input.campaignId, {
        contactIds: currentIds,
        totalContacts: currentIds.length,
      });
    }),

  // Remove contact from campaign
  removeContact: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      contactId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada");
      
      const currentIds = (campaign.contactIds || []).filter(id => id !== input.contactId);
      
      return updateCampaignDb(input.campaignId, {
        contactIds: currentIds,
        totalContacts: currentIds.length,
      });
    }),

  // Add multiple contacts to campaign
  addContacts: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      contactIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada");
      
      const currentIds = campaign.contactIds || [];
      const newIds = new Set([...currentIds, ...input.contactIds]);
      const mergedIds = Array.from(newIds);
      
      return updateCampaignDb(input.campaignId, {
        contactIds: mergedIds,
        totalContacts: mergedIds.length,
      });
    }),

  // Remove multiple contacts from campaign
  removeContacts: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      contactIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaignByIdDb(input.campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada");
      
      const removeSet = new Set(input.contactIds);
      const currentIds = (campaign.contactIds || []).filter(id => !removeSet.has(id));
      
      return updateCampaignDb(input.campaignId, {
        contactIds: currentIds,
        totalContacts: currentIds.length,
      });
    }),
});
