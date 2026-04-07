/**
 * Campaign Service — Serviço de envio em massa de templates WhatsApp.
 *
 * Responsável por:
 * - Executar disparos de campanhas (enviar templates para contatos selecionados)
 * - Agendar campanhas recorrentes (a cada X dias)
 * - Rastrear status de entrega (via webhook de status do WhatsApp)
 * - Aplicar tags nas conversas criadas por disparos
 * - Acionar fluxos específicos quando clientes respondem ao disparo
 */

import {
  getCampaignById,
  updateCampaign,
  createCampaignDispatchesBatch,
  updateCampaignDispatch,
  getCampaignDispatchStats,
  getScheduledCampaigns,
  getContactById,
  getCampaignDispatchByWamid,
  updateCampaignDispatchByWamid,
  getCampaignDispatchByPhoneAndCampaign,
  getDb,
  getSetting,
  upsertSetting,
} from "./db";
import { contacts } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { sendWhatsAppTemplate } from "./whatsappTemplates";
import { isConfigured as isWhatsAppConfigured } from "./whatsapp";

// ─── Execute a campaign run ─────────────────────────────────────────────────

export async function executeCampaign(campaignId: number): Promise<{
  sent: number;
  failed: number;
  total: number;
}> {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) throw new Error("Campanha não encontrada");

  if (!isWhatsAppConfigured()) {
    throw new Error("WhatsApp não configurado");
  }

  console.log(`[Campaign] Executando campanha "${campaign.name}" (ID: ${campaignId})`);

  // Update status to running
  await updateCampaign(campaignId, { status: "running" });

  // Resolve contacts to send to
  const contactList = await resolveContacts(campaign);

  if (contactList.length === 0) {
    await updateCampaign(campaignId, {
      status: campaign.scheduleType === "recurring" ? "scheduled" : "completed",
      lastRunAt: Date.now(),
    });
    return { sent: 0, failed: 0, total: 0 };
  }

  // Calculate run number
  const stats = await getCampaignDispatchStats(campaignId);
  const maxRunNumber = stats.total > 0 ? Math.ceil(stats.total / Math.max(contactList.length, 1)) : 0;
  const runNumber = maxRunNumber + 1;

  // Create dispatch records (all pending)
  const dispatches = contactList.map(c => ({
    campaignId,
    contactId: c.id,
    phone: c.phone,
    contactName: c.name || null,
    status: "pending" as const,
    runNumber,
  }));
  await createCampaignDispatchesBatch(dispatches);

  // Fetch created dispatches to get IDs
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const { campaignDispatches } = await import("../drizzle/schema");
  const createdDispatches = await db.select().from(campaignDispatches)
    .where(and(
      eq(campaignDispatches.campaignId, campaignId),
      eq(campaignDispatches.runNumber, runNumber),
    ));

  let sent = 0;
  let failed = 0;

  // Send templates one by one with rate limiting
  for (const dispatch of createdDispatches) {
    try {
      const result = await sendWhatsAppTemplate(
        dispatch.phone,
        campaign.templateName,
        campaign.bodyParams || [],
        campaign.templateLanguage || "pt_BR",
      );

      if (result.success) {
        await updateCampaignDispatch(dispatch.id, {
          status: "sent",
          sentAt: new Date(),
          whatsappMessageId: result.messageId || null,
        });
        sent++;
      } else {
        await updateCampaignDispatch(dispatch.id, {
          status: "failed",
          errorMessage: result.error || "Erro desconhecido",
        });
        failed++;
      }

      // Rate limit: 500ms between sends to avoid WhatsApp throttling
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      await updateCampaignDispatch(dispatch.id, {
        status: "failed",
        errorMessage: err.message || "Erro ao enviar",
      });
      failed++;
    }
  }

  // Update campaign status and schedule next run
  const now = Date.now();
  const updateData: any = {
    lastRunAt: now,
    totalContacts: contactList.length,
  };

  if (campaign.scheduleType === "recurring" && campaign.intervalDays && campaign.intervalDays > 0) {
    updateData.nextRunAt = now + campaign.intervalDays * 24 * 60 * 60 * 1000;
    updateData.status = "scheduled";
  } else {
    updateData.status = "completed";
  }

  await updateCampaign(campaignId, updateData);

  console.log(`[Campaign] Campanha "${campaign.name}" concluída: ${sent} enviados, ${failed} falhas, ${contactList.length} total`);

  return { sent, failed, total: contactList.length };
}

// ─── Resolve contacts for a campaign ────────────────────────────────────────

async function resolveContacts(campaign: any): Promise<Array<{ id: number; name: string; phone: string }>> {
  const db = await getDb();
  if (!db) return [];

  // If specific contact IDs are set, use those
  if (campaign.contactIds && campaign.contactIds.length > 0) {
    const rows = await db.select({
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
    }).from(contacts)
      .where(and(
        inArray(contacts.id, campaign.contactIds),
        eq(contacts.isActive, true),
      ));
    return rows;
  }

  // If filter tags are set, filter by tags
  if (campaign.filterTags && campaign.filterTags.length > 0) {
    const allContacts = await db.select({
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      tags: contacts.tags,
    }).from(contacts)
      .where(eq(contacts.isActive, true));

    return allContacts.filter(c => {
      if (!c.tags || !Array.isArray(c.tags)) return false;
      return campaign.filterTags.some((tag: string) => (c.tags as string[]).includes(tag));
    });
  }

  // No filter = all active contacts
  const rows = await db.select({
    id: contacts.id,
    name: contacts.name,
    phone: contacts.phone,
  }).from(contacts)
    .where(eq(contacts.isActive, true));
  return rows;
}

// ─── Handle delivery status updates from webhook ────────────────────────────

export async function handleCampaignDeliveryStatus(wamid: string, status: string): Promise<boolean> {
  const dispatch = await getCampaignDispatchByWamid(wamid);
  if (!dispatch) return false;

  const statusMap: Record<string, string> = {
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "failed",
  };

  const newStatus = statusMap[status];
  if (!newStatus) return false;

  // Don't downgrade status (e.g., don't go from "read" back to "delivered")
  const statusOrder = ["pending", "sent", "delivered", "read", "responded"];
  const currentIdx = statusOrder.indexOf(dispatch.status);
  const newIdx = statusOrder.indexOf(newStatus);
  if (newStatus !== "failed" && newIdx <= currentIdx) return false;

  const updateData: any = { status: newStatus };
  if (newStatus === "delivered") updateData.deliveredAt = new Date();
  if (newStatus === "read") updateData.readAt = new Date();

  await updateCampaignDispatchByWamid(wamid, updateData);
  return true;
}

// ─── Handle response from customer (mark as responded + trigger flow) ───────

export async function handleCampaignResponse(phone: string): Promise<{
  campaignId: number;
  responseFlowId: number | null;
  conversationTag: string | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  // Find the most recent dispatch for this phone that was sent/delivered/read
  const { campaignDispatches, campaigns: campaignsTable } = await import("../drizzle/schema");
  const { desc } = await import("drizzle-orm");

  const recentDispatches = await db.select({
    dispatchId: campaignDispatches.id,
    campaignId: campaignDispatches.campaignId,
    status: campaignDispatches.status,
  }).from(campaignDispatches)
    .where(eq(campaignDispatches.phone, phone))
    .orderBy(desc(campaignDispatches.createdAt))
    .limit(5);

  // Find the most recent non-responded dispatch
  const activeDispatch = recentDispatches.find(d =>
    d.status === "sent" || d.status === "delivered" || d.status === "read"
  );

  if (!activeDispatch) return null;

  // Mark as responded
  await updateCampaignDispatch(activeDispatch.dispatchId, {
    status: "responded",
    respondedAt: new Date(),
  });

  // Get campaign details for flow and tag
  const campaign = await getCampaignById(activeDispatch.campaignId);
  if (!campaign) return null;

  return {
    campaignId: campaign.id,
    responseFlowId: campaign.responseFlowId,
    conversationTag: campaign.conversationTag,
  };
}

// ─── Scheduler job (runs periodically to check scheduled campaigns) ─────────

let campaignSchedulerInterval: ReturnType<typeof setInterval> | null = null;

export async function checkScheduledCampaigns(): Promise<void> {
  try {
    const scheduled = await getScheduledCampaigns();
    if (scheduled.length === 0) return;

    console.log(`[Campaign] ${scheduled.length} campanha(s) agendada(s) para execução`);

    for (const campaign of scheduled) {
      try {
        await executeCampaign(campaign.id);
      } catch (err) {
        console.error(`[Campaign] Erro ao executar campanha ${campaign.id}:`, err);
        await updateCampaign(campaign.id, { status: "scheduled" }); // Keep scheduled on error
      }
    }
  } catch (err) {
    console.error("[Campaign] Erro no scheduler:", err);
  }
}

export function startCampaignScheduler(): void {
  // Check every 5 minutes for scheduled campaigns
  if (campaignSchedulerInterval) clearInterval(campaignSchedulerInterval);

  campaignSchedulerInterval = setInterval(() => {
    checkScheduledCampaigns().catch(err =>
      console.error("[Campaign] Erro no job periódico:", err)
    );
  }, 5 * 60 * 1000);

  // Also check on startup after 60s
  setTimeout(() => {
    checkScheduledCampaigns().catch(err =>
      console.error("[Campaign] Erro na primeira verificação:", err)
    );
  }, 60_000);

  console.log("[Campaign] Scheduler iniciado: verificação a cada 5 minutos");
}

export function stopCampaignScheduler(): void {
  if (campaignSchedulerInterval) {
    clearInterval(campaignSchedulerInterval);
    campaignSchedulerInterval = null;
  }
}
