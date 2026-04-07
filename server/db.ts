import { eq, desc, and, sql, like, or, inArray, notInArray, lt, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  conversations, InsertConversation, Conversation,
  messages, InsertMessage,
  leads, InsertLead,
  aiLogs, InsertAiLog,
  vehicles,
  settings,
  teamMembers, InsertTeamMember,
  conversationAssignments,
  activityLogs, InsertActivityLog,
  teamNotifications,
  teamPerformance,
  aiDecisions, InsertAiDecision,
  leadSummaries, InsertLeadSummary,
  chatFlows, InsertChatFlow,
  chatFlowNodes, InsertChatFlowNode,
  chatFlowEdges, InsertChatFlowEdge,
  chatFlowSessions, InsertChatFlowSession,
  aiAgents, InsertAiAgent,
  sellers, InsertSeller,
  sellerQueues, InsertSellerQueue,
  sellerAssignments, InsertSellerAssignment,
  rescueAttempts, InsertRescueAttempt,
  contacts, InsertContact,
  templateSends, InsertTemplateSend,
  campaigns, InsertCampaign,
  campaignDispatches, InsertCampaignDispatch,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User Queries ──────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Conversation Queries ──────────────────────────────────────
export async function listConversations(filters?: { status?: string; search?: string }) {
  const db = await getDb();
  if (!db) return [];
  let query = db.select().from(conversations).orderBy(desc(conversations.lastMessageAt));
  const conditions = [];
  if (filters?.status && filters.status !== "all") {
    conditions.push(eq(conversations.status, filters.status as any));
  }
  if (filters?.search) {
    conditions.push(
      or(
        like(conversations.contactName, `%${filters.search}%`),
        like(conversations.phone, `%${filters.search}%`)
      )!
    );
  }
  if (conditions.length > 0) {
    return db.select().from(conversations).where(and(...conditions)).orderBy(desc(conversations.lastMessageAt));
  }
  return query;
}

export async function getConversationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return result[0];
}

export async function getConversationByPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;
  // Try exact match first
  const exact = await db.select().from(conversations).where(eq(conversations.phone, phone)).limit(1);
  if (exact[0]) return exact[0];
  // Try all phone variations (handles 9th digit, formatting differences)
  const { phoneVariations } = await import("./phoneNormalize");
  const variations = phoneVariations(phone);
  for (const v of variations) {
    if (v === phone) continue; // already tried
    const row = await db.select().from(conversations).where(eq(conversations.phone, v)).limit(1);
    if (row[0]) return row[0];
  }
  return undefined;
}

export async function getConversationByPlatformUserId(platformUserId: string, channel: "instagram" | "facebook") {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(conversations)
    .where(and(eq(conversations.platformUserId, platformUserId), eq(conversations.channel, channel)))
    .limit(1);
  return result[0];
}

export async function createConversation(data: InsertConversation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(conversations).values(data);
  const id = result[0].insertId;
  return getConversationById(id);
}

export async function updateConversation(id: number, data: Partial<InsertConversation>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(conversations).set(data).where(eq(conversations.id, id));
  return getConversationById(id);
}

// ─── Message Queries ───────────────────────────────────────────
export async function listMessages(conversationId: number, limit = 500) {
  const db = await getDb();
  if (!db) return [];
  // Get the last N messages ordered by createdAt ascending
  // Using subquery approach: get IDs of last N, then fetch in order
  const result = await db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  // Reverse to get chronological order
  return result.reverse();
}

export async function createMessage(data: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(messages).values(data);
  const id = result[0].insertId;
  const msg = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  // Update conversation's last message
  await db.update(conversations).set({
    lastMessageAt: Date.now(),
    lastMessagePreview: data.content.substring(0, 200),
    unreadCount: data.senderType === "customer"
      ? sql`${conversations.unreadCount} + 1`
      : sql`${conversations.unreadCount}`,
  }).where(eq(conversations.id, data.conversationId));
  return msg[0];
}

export async function getMessageByExternalId(externalId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(messages).where(eq(messages.externalId, externalId)).limit(1);
  return result[0] || null;
}

export async function markMessagesAsRead(conversationId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conversationId));
}

// ─── Delivery Status Tracking ─────────────────────────────────

export async function updateMessageDeliveryStatus(
  whatsappMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(messages).where(eq(messages.externalId, whatsappMessageId)).limit(1);
  const msg = result[0];
  if (!msg) return null;

  // Only advance status forward: sent -> delivered -> read. Failed can come from any state.
  const statusOrder: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 0 };
  const currentOrder = statusOrder[msg.status] ?? 0;
  const newOrder = statusOrder[status] ?? 0;
  
  // Allow update if: moving forward, or setting to failed
  if (status !== "failed" && newOrder <= currentOrder) return msg;

  const updateData: any = { status };
  if (errorMessage) updateData.deliveryError = errorMessage;
  
  await db.update(messages).set(updateData).where(eq(messages.externalId, whatsappMessageId));
  return { ...msg, ...updateData };
}

export async function updateMessageExternalId(messageId: number, externalId: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(messages).set({ externalId }).where(eq(messages.id, messageId));
}

export async function updateLastCustomerMessageAt(conversationId: number, timestamp: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(conversations).set({ 
    lastCustomerMessageAt: timestamp,
    windowExpired: 0 
  }).where(eq(conversations.id, conversationId));
}

export async function setWindowExpired(conversationId: number, expired: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(conversations).set({ windowExpired: expired ? 1 : 0 }).where(eq(conversations.id, conversationId));
}

// ─── Lead Queries ──────────────────────────────────────────────
export async function listLeads(filters?: { status?: string }) {
  const db = await getDb();
  if (!db) return [];
  if (filters?.status && filters.status !== "all") {
    return db.select().from(leads).where(eq(leads.status, filters.status as any)).orderBy(desc(leads.updatedAt));
  }
  return db.select().from(leads).orderBy(desc(leads.updatedAt));
}

export async function getLeadByConversationId(conversationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(leads).where(eq(leads.conversationId, conversationId)).limit(1);
  return result[0];
}

// ─── Temperature Calculation ─────────────────────────────────
/**
 * Calcula a temperatura do lead automaticamente baseado no status do funil.
 * frio: novo
 * morno: interesse_definido
 * quente: pagamento_definido, dados_pessoais, dados_troca
 * muito_quente: encaminhado_vendedor, negociando, fechado
 */
export function calculateTemperature(funnelStatus: string): "frio" | "morno" | "quente" | "muito_quente" {
  switch (funnelStatus) {
    case "novo":
    case "perdido":
      return "frio";
    case "interesse_definido":
      return "morno";
    case "pagamento_definido":
    case "dados_pessoais":
    case "dados_troca":
      return "quente";
    case "encaminhado_vendedor":
    case "negociando":
    case "fechado":
      return "muito_quente";
    default:
      return "frio";
  }
}

export async function upsertLead(data: InsertLead) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getLeadByConversationId(data.conversationId);
  if (existing) {
    // Update non-undefined fields (null is allowed to explicitly clear a field)
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && key !== "id" && key !== "conversationId") {
        updateData[key] = value;
      }
    }
    // Auto-calculate temperature when funnelStatus changes
    if (updateData.funnelStatus && typeof updateData.funnelStatus === "string") {
      updateData.temperature = calculateTemperature(updateData.funnelStatus);
    }
    await db.update(leads).set(updateData).where(eq(leads.id, existing.id));
    return { ...existing, ...updateData };
  }
  // Auto-calculate temperature for new leads
  if (data.funnelStatus) {
    (data as any).temperature = calculateTemperature(data.funnelStatus);
  }
  const result = await db.insert(leads).values(data);
  return { ...data, id: result[0].insertId };
}

// ─── Update Lead Funnel Status ───────────────────────────────
export async function updateLeadFunnelStatus(conversationId: number, funnelStatus: string) {
  const db = await getDb();
  if (!db) return null;
  const lead = await getLeadByConversationId(conversationId);
  if (!lead) return null;
  const temperature = calculateTemperature(funnelStatus);
  await db.update(leads).set({ funnelStatus: funnelStatus as any, temperature: temperature as any }).where(eq(leads.id, lead.id));
  return { ...lead, funnelStatus, temperature };
}

// ─── Lead Summary Queries ─────────────────────────────────────
export async function getLeadSummaries(leadId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leadSummaries).where(eq(leadSummaries.leadId, leadId)).orderBy(desc(leadSummaries.summaryDate));
}

export async function getLeadSummariesByConversation(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leadSummaries).where(eq(leadSummaries.conversationId, conversationId)).orderBy(desc(leadSummaries.summaryDate));
}

export async function upsertLeadSummary(data: { leadId: number; conversationId: number; summaryDate: string; summary: string; messageCount: number }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(leadSummaries)
    .where(and(eq(leadSummaries.leadId, data.leadId), eq(leadSummaries.summaryDate, data.summaryDate)))
    .limit(1);
  if (existing[0]) {
    await db.update(leadSummaries).set({ summary: data.summary, messageCount: data.messageCount }).where(eq(leadSummaries.id, existing[0].id));
    return { ...existing[0], ...data };
  }
  const result = await db.insert(leadSummaries).values(data);
  return { ...data, id: result[0].insertId };
}

export async function getFullLeadSummaryText(conversationId: number): Promise<string> {
  const summaries = await getLeadSummariesByConversation(conversationId);
  if (summaries.length === 0) return "";
  // Oldest first for chronological reading
  return summaries.reverse().map(s => `[${s.summaryDate}]\n${s.summary}`).join("\n\n");
}

// ─── AI Log Queries ────────────────────────────────────────────
export async function createAiLog(data: InsertAiLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(aiLogs).values(data);
}

// ─── AI Decision Queries ───────────────────────────────────────
export async function createAiDecision(data: InsertAiDecision) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(aiDecisions).values(data);
  } catch (err) {
    console.error("[DB] Failed to create AI decision log:", err);
  }
}

export async function createAiDecisionsBatch(decisions: InsertAiDecision[]) {
  const db = await getDb();
  if (!db || decisions.length === 0) return;
  try {
    await db.insert(aiDecisions).values(decisions);
  } catch (err) {
    console.error("[DB] Failed to batch create AI decision logs:", err);
  }
}

export async function listAiDecisions(opts: { conversationId?: number; toolName?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { decisions: [], total: 0 };
  const conditions: any[] = [eq(aiDecisions.conversationId, opts.conversationId ?? 0)];
  let query = db.select().from(aiDecisions);
  
  const whereConditions: any[] = [];
  if (opts.conversationId) whereConditions.push(eq(aiDecisions.conversationId, opts.conversationId));
  if (opts.toolName) whereConditions.push(eq(aiDecisions.toolName, opts.toolName));
  
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;
  
  if (whereConditions.length > 0) {
    const results = await db.select().from(aiDecisions).where(and(...whereConditions)).orderBy(desc(aiDecisions.createdAt)).limit(limit).offset(offset);
    const countResult = await db.select({ count: sql<number>`COUNT(*)` }).from(aiDecisions).where(and(...whereConditions));
    return { decisions: results, total: countResult[0]?.count || 0 };
  }
  
  const results = await db.select().from(aiDecisions).orderBy(desc(aiDecisions.createdAt)).limit(limit).offset(offset);
  const countResult = await db.select({ count: sql<number>`COUNT(*)` }).from(aiDecisions);
  return { decisions: results, total: countResult[0]?.count || 0 };
}

export async function getAiDecisionsByConversation(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiDecisions).where(eq(aiDecisions.conversationId, conversationId)).orderBy(desc(aiDecisions.createdAt)).limit(50);
}

export async function getAiDecisionStats() {
  const db = await getDb();
  if (!db) return { totalDecisions: 0, toolBreakdown: [], successRate: 0, avgResponseTime: 0 };
  
  const total = await db.select({ count: sql<number>`COUNT(*)` }).from(aiDecisions);
  const breakdown = await db.select({
    toolName: aiDecisions.toolName,
    count: sql<number>`COUNT(*)`,
    successCount: sql<number>`SUM(CASE WHEN ${aiDecisions.success} = true THEN 1 ELSE 0 END)`,
    avgTime: sql<number>`COALESCE(AVG(${aiDecisions.responseTimeMs}), 0)`,
  }).from(aiDecisions).groupBy(aiDecisions.toolName);
  
  const successTotal = await db.select({
    successCount: sql<number>`SUM(CASE WHEN ${aiDecisions.success} = true THEN 1 ELSE 0 END)`,
    avgTime: sql<number>`COALESCE(AVG(${aiDecisions.responseTimeMs}), 0)`,
  }).from(aiDecisions);
  
  const totalCount = total[0]?.count || 0;
  const successCount = successTotal[0]?.successCount || 0;
  
  return {
    totalDecisions: totalCount,
    toolBreakdown: breakdown,
    successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0,
    avgResponseTime: Math.round(successTotal[0]?.avgTime || 0),
  };
}

export async function getAiStats() {
  const db = await getDb();
  if (!db) return { totalCalls: 0, totalTokens: 0, avgResponseTime: 0 };
  const result = await db.select({
    totalCalls: sql<number>`COUNT(*)`,
    totalTokens: sql<number>`COALESCE(SUM(${aiLogs.totalTokens}), 0)`,
    avgResponseTime: sql<number>`COALESCE(AVG(${aiLogs.responseTimeMs}), 0)`,
  }).from(aiLogs);
  return result[0];
}

// ─── Vehicle Queries ───────────────────────────────────────────
export async function searchVehicles(filters?: { brand?: string; model?: string; maxPrice?: number; category?: string; transmission?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(vehicles.available, true)];
  if (filters?.brand) conditions.push(like(vehicles.brand, `%${filters.brand}%`));
  if (filters?.model) conditions.push(like(vehicles.model, `%${filters.model}%`));
  if (filters?.maxPrice) conditions.push(sql`${vehicles.price} <= ${filters.maxPrice}`);
  if (filters?.category) conditions.push(like(vehicles.category, `%${filters.category}%`));
  if (filters?.transmission) conditions.push(eq(vehicles.transmission, filters.transmission as any));
  return db.select().from(vehicles).where(and(...conditions)).orderBy(vehicles.price);
}

export async function listVehicles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(vehicles).orderBy(vehicles.brand);
}

export async function createVehicle(data: typeof vehicles.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vehicles).values(data);
  return result[0].insertId;
}

// ─── Dashboard Stats ───────────────────────────────────────────
export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return { totalConversations: 0, openConversations: 0, totalLeads: 0, qualifiedLeads: 0, totalVehicles: 0 };

  const [convStats] = await db.select({
    total: sql<number>`COUNT(*)`,
    open: sql<number>`SUM(CASE WHEN ${conversations.status} = 'open' THEN 1 ELSE 0 END)`,
  }).from(conversations);

  const [leadStats] = await db.select({
    total: sql<number>`COUNT(*)`,
    qualified: sql<number>`SUM(CASE WHEN ${leads.status} = 'qualified' THEN 1 ELSE 0 END)`,
  }).from(leads);

  const [vehicleStats] = await db.select({
    total: sql<number>`COUNT(*)`,
  }).from(vehicles).where(eq(vehicles.available, true));

  return {
    totalConversations: convStats?.total ?? 0,
    openConversations: convStats?.open ?? 0,
    totalLeads: leadStats?.total ?? 0,
    qualifiedLeads: leadStats?.qualified ?? 0,
    totalVehicles: vehicleStats?.total ?? 0,
  };
}

// ─── Settings Queries ──────────────────────────────────────────
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return result.length > 0 ? result[0].value : null;
}

export async function upsertSetting(key: string, value: string, updatedBy?: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select({ id: settings.id }).from(settings).where(eq(settings.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(settings).set({ value, updatedBy: updatedBy || null }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value, updatedBy: updatedBy || null });
  }
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select().from(settings);
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ─── Team Members Queries ─────────────────────────────────────
export async function listTeamMembers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: teamMembers.id,
    name: teamMembers.name,
    email: teamMembers.email,
    cargo: teamMembers.cargo,
    status: teamMembers.status,
    createdAt: teamMembers.createdAt,
    updatedAt: teamMembers.updatedAt,
  }).from(teamMembers);
}

export async function getTeamMemberById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({
    id: teamMembers.id,
    name: teamMembers.name,
    email: teamMembers.email,
    cargo: teamMembers.cargo,
    status: teamMembers.status,
    createdAt: teamMembers.createdAt,
    updatedAt: teamMembers.updatedAt,
  }).from(teamMembers).where(eq(teamMembers.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getActiveTeamMembers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: teamMembers.id,
    name: teamMembers.name,
    cargo: teamMembers.cargo,
  }).from(teamMembers).where(eq(teamMembers.status, "ativo"));
}

// ─── Activity Logs Queries ────────────────────────────────────
export async function createActivityLog(data: InsertActivityLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(activityLogs).values(data);
}

export async function listActivityLogs(conversationId?: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  if (conversationId) {
    return db.select().from(activityLogs)
      .where(eq(activityLogs.conversationId, conversationId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }
  return db.select().from(activityLogs)
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);
}

// ─── Team Notifications Queries ───────────────────────────────
export async function createTeamNotification(data: {
  userId: number;
  type: string;
  title: string;
  message?: string;
  conversationId?: number;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(teamNotifications).values(data);
}

export async function listTeamNotifications(userId: number, unreadOnly = false) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(teamNotifications.userId, userId)];
  if (unreadOnly) conditions.push(eq(teamNotifications.read, false));
  return db.select().from(teamNotifications)
    .where(and(...conditions))
    .orderBy(desc(teamNotifications.createdAt))
    .limit(50);
}

export async function markNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(teamNotifications)
    .set({ read: true })
    .where(eq(teamNotifications.userId, userId));
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(teamNotifications)
    .where(and(eq(teamNotifications.userId, userId), eq(teamNotifications.read, false)));
  return result[0]?.count ?? 0;
}


// ─── Chat Flows Queries ──────────────────────────────────────
export async function listChatFlows() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatFlows).orderBy(desc(chatFlows.updatedAt));
}

export async function getChatFlowById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(chatFlows).where(eq(chatFlows.id, id)).limit(1);
  return result[0];
}

export async function createChatFlow(data: InsertChatFlow) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatFlows).values(data);
  return result[0].insertId;
}

export async function updateChatFlow(id: number, data: Partial<InsertChatFlow>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(chatFlows).set(data).where(eq(chatFlows.id, id));
}

export async function deleteChatFlow(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete edges, nodes, sessions, then flow
  await db.delete(chatFlowEdges).where(eq(chatFlowEdges.flowId, id));
  await db.delete(chatFlowNodes).where(eq(chatFlowNodes.flowId, id));
  await db.delete(chatFlowSessions).where(eq(chatFlowSessions.flowId, id));
  await db.delete(chatFlows).where(eq(chatFlows.id, id));
}

export async function getActiveChatFlows() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatFlows)
    .where(eq(chatFlows.active, true))
    .orderBy(desc(chatFlows.priority));
}

// ─── Chat Flow Nodes Queries ─────────────────────────────────
export async function listChatFlowNodes(flowId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatFlowNodes).where(eq(chatFlowNodes.flowId, flowId));
}

export async function getChatFlowNodeById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(chatFlowNodes).where(eq(chatFlowNodes.id, id)).limit(1);
  return result[0];
}

export async function createChatFlowNode(data: InsertChatFlowNode) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatFlowNodes).values(data);
  return result[0].insertId;
}

export async function updateChatFlowNode(id: number, data: Partial<InsertChatFlowNode>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(chatFlowNodes).set(data).where(eq(chatFlowNodes.id, id));
}

export async function deleteChatFlowNode(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete connected edges first
  await db.delete(chatFlowEdges).where(
    sql`${chatFlowEdges.sourceNodeId} = ${id} OR ${chatFlowEdges.targetNodeId} = ${id}`
  );
  await db.delete(chatFlowNodes).where(eq(chatFlowNodes.id, id));
}

export async function bulkUpsertNodes(flowId: number, nodes: Array<InsertChatFlowNode & { id?: number }>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ids: number[] = [];
  for (const node of nodes) {
    if (node.id && node.id > 0) {
      await db.update(chatFlowNodes).set({
        nodeType: node.nodeType,
        label: node.label,
        data: node.data,
        positionX: node.positionX,
        positionY: node.positionY,
      }).where(eq(chatFlowNodes.id, node.id));
      ids.push(node.id);
    } else {
      const result = await db.insert(chatFlowNodes).values({ ...node, flowId });
      ids.push(result[0].insertId);
    }
  }
  return ids;
}

// ─── Chat Flow Edges Queries ─────────────────────────────────
export async function listChatFlowEdges(flowId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatFlowEdges).where(eq(chatFlowEdges.flowId, flowId));
}

export async function createChatFlowEdge(data: InsertChatFlowEdge) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatFlowEdges).values(data);
  return result[0].insertId;
}

export async function deleteChatFlowEdge(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(chatFlowEdges).where(eq(chatFlowEdges.id, id));
}

export async function replaceFlowEdges(flowId: number, edges: InsertChatFlowEdge[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(chatFlowEdges).where(eq(chatFlowEdges.flowId, flowId));
  if (edges.length > 0) {
    await db.insert(chatFlowEdges).values(edges.map(e => ({ ...e, flowId })));
  }
}

// ─── Chat Flow Sessions Queries ──────────────────────────────
export async function getActiveFlowSession(conversationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(chatFlowSessions)
    .where(and(
      eq(chatFlowSessions.conversationId, conversationId),
      eq(chatFlowSessions.status, "active")
    ))
    .orderBy(desc(chatFlowSessions.startedAt))
    .limit(1);
  return result[0];
}

export async function createFlowSession(data: InsertChatFlowSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatFlowSessions).values(data);
  return result[0].insertId;
}

export async function updateFlowSession(id: number, data: Partial<InsertChatFlowSession>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(chatFlowSessions).set(data).where(eq(chatFlowSessions.id, id));
}

export async function getFlowSessionsByFlow(flowId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatFlowSessions)
    .where(eq(chatFlowSessions.flowId, flowId))
    .orderBy(desc(chatFlowSessions.startedAt))
    .limit(100);
}

export async function pauseFlowSessionByConversation(conversationId: number) {
  const db = await getDb();
  if (!db) return false;
  const session = await getActiveFlowSession(conversationId);
  if (!session) return false;
  await db.update(chatFlowSessions)
    .set({ status: "paused" })
    .where(eq(chatFlowSessions.id, session.id));
  return true;
}

export async function pauseAllActiveSessionsByFlow(flowId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.update(chatFlowSessions)
    .set({ status: "paused" })
    .where(and(
      eq(chatFlowSessions.flowId, flowId),
      eq(chatFlowSessions.status, "active")
    ));
  return result[0].affectedRows || 0;
}

// ─── AI Agents CRUD ──────────────────────────────────────────

export async function listAiAgents() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiAgents).orderBy(aiAgents.name);
}

export async function getAiAgentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(aiAgents).where(eq(aiAgents.id, id)).limit(1);
  return rows[0] || null;
}

export async function createAiAgent(data: InsertAiAgent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(aiAgents).values(data);
  return { id: result[0].insertId };
}

export async function updateAiAgent(id: number, data: Partial<InsertAiAgent>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(aiAgents).set(data).where(eq(aiAgents.id, id));
}

export async function deleteAiAgent(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Remove agent references from flows
  await db.update(chatFlows).set({ agentId: null }).where(eq(chatFlows.agentId, id));
  // Remove channel agent settings
  const channelSettings = ["channel_whatsapp_agent_id", "channel_instagram_agent_id", "channel_facebook_agent_id"];
  for (const key of channelSettings) {
    const setting = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    if (setting[0] && setting[0].value === String(id)) {
      await db.update(settings).set({ value: "" }).where(eq(settings.id, setting[0].id));
    }
  }
  await db.delete(aiAgents).where(eq(aiAgents.id, id));
}

export async function getActiveAiAgents() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiAgents).where(eq(aiAgents.active, true)).orderBy(aiAgents.name);
}

export async function getAiAgentForChannel(channel: string): Promise<typeof aiAgents.$inferSelect | null> {
  const settingKey = `channel_${channel}_agent_id`;
  const agentIdStr = await getSetting(settingKey);
  if (!agentIdStr) return null;
  const agentId = parseInt(agentIdStr, 10);
  if (isNaN(agentId)) return null;
  const agent = await getAiAgentById(agentId);
  if (agent && agent.active) return agent;
  return null;
}

export async function getAiAgentForFlow(flowId: number): Promise<typeof aiAgents.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;
  const flow = await getChatFlowById(flowId);
  if (!flow?.agentId) return null;
  const agent = await getAiAgentById(flow.agentId);
  if (agent && agent.active) return agent;
  return null;
}

// ─── Seller Queries ───────────────────────────────────────────
export async function listSellers(storeLocation?: string) {
  const db = await getDb();
  if (!db) return [];
  if (storeLocation) {
    return db.select().from(sellers).where(eq(sellers.storeLocation, storeLocation)).orderBy(sellers.sortOrder, sellers.id);
  }
  return db.select().from(sellers).orderBy(sellers.storeLocation, sellers.sortOrder, sellers.id);
}

export async function listActiveSellers(storeLocation: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sellers)
    .where(and(eq(sellers.storeLocation, storeLocation), eq(sellers.isActive, true)))
    .orderBy(sellers.sortOrder, sellers.id);
}

export async function getSellerById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sellers).where(eq(sellers.id, id)).limit(1);
  return rows[0] || null;
}

export async function createSeller(data: Omit<InsertSeller, "id" | "createdAt" | "updatedAt">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(sellers).values(data as any);
  return (result as any)[0].insertId;
}

export async function updateSeller(id: number, data: Partial<InsertSeller>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(sellers).set(data as any).where(eq(sellers.id, id));
}

export async function deleteSeller(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(sellers).where(eq(sellers.id, id));
}

// ─── Seller Queue (Round-Robin) ───────────────────────────────
export async function getSellerQueue(storeLocation: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sellerQueues).where(eq(sellerQueues.storeLocation, storeLocation)).limit(1);
  return rows[0] || null;
}

export async function upsertSellerQueue(storeLocation: string, currentIndex: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await getSellerQueue(storeLocation);
  if (existing) {
    await db.update(sellerQueues).set({ currentIndex }).where(eq(sellerQueues.id, existing.id));
  } else {
    await db.insert(sellerQueues).values({ storeLocation, currentIndex } as any);
  }
}

/**
 * Get the next seller in the round-robin queue for a store.
 * Atomically advances the queue index.
 */
export async function getNextSellerInQueue(storeLocation: string) {
  const activeSellers = await listActiveSellers(storeLocation);
  if (activeSellers.length === 0) return null;

  const queue = await getSellerQueue(storeLocation);
  const currentIndex = queue?.currentIndex ?? 0;

  // Ensure index is within bounds
  const safeIndex = currentIndex % activeSellers.length;
  const selectedSeller = activeSellers[safeIndex];

  // Advance to next index
  const nextIndex = (safeIndex + 1) % activeSellers.length;
  await upsertSellerQueue(storeLocation, nextIndex);

  // Increment total assignments
  const db = await getDb();
  if (db) {
    await db.update(sellers)
      .set({ totalAssignments: sql`${sellers.totalAssignments} + 1` })
      .where(eq(sellers.id, selectedSeller.id));
  }

  return selectedSeller;
}

// ─── Seller Assignments ───────────────────────────────────────
export async function createSellerAssignment(data: Omit<InsertSellerAssignment, "id" | "assignedAt">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(sellerAssignments).values(data as any);
  return (result as any)[0].insertId;
}

export async function listSellerAssignments(storeLocation?: string, sellerId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (storeLocation) conditions.push(eq(sellerAssignments.storeLocation, storeLocation));
  if (sellerId) conditions.push(eq(sellerAssignments.sellerId, sellerId));
  if (conditions.length > 0) {
    return db.select().from(sellerAssignments).where(and(...conditions)).orderBy(desc(sellerAssignments.assignedAt));
  }
  return db.select().from(sellerAssignments).orderBy(desc(sellerAssignments.assignedAt));
}

export async function updateSellerAssignment(id: number, data: Partial<InsertSellerAssignment>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(sellerAssignments).set(data as any).where(eq(sellerAssignments.id, id));
}

/**
 * Get the store location from a vehicle ID.
 * Used to determine which seller queue to use.
 */
export async function getStoreLocationByVehicleId(vehicleId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ seller: vehicles.seller }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return rows[0]?.seller || null;
}

/**
 * Get distinct store locations from vehicles table.
 */
export async function getDistinctStoreLocations(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.selectDistinct({ seller: vehicles.seller }).from(vehicles).where(eq(vehicles.available, true));
  return rows.map(r => r.seller).filter(Boolean) as string[];
}


/**
 * Get a vehicle by ID with all photos (images array).
 * Used by the send_vehicle_photos flow node.
 */
export async function getVehicleById(vehicleId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return rows[0] || null;
}

// ─── Rescue Attempts Queries ─────────────────────────────────
export async function createRescueAttempt(data: Omit<InsertRescueAttempt, "id" | "createdAt">) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(rescueAttempts).values(data as any);
  return result[0].insertId;
}

export async function getRescueAttemptsByConversation(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rescueAttempts)
    .where(eq(rescueAttempts.conversationId, conversationId))
    .orderBy(desc(rescueAttempts.sentAt));
}

export async function getLastRescueAttempt(conversationId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(rescueAttempts)
    .where(eq(rescueAttempts.conversationId, conversationId))
    .orderBy(desc(rescueAttempts.sentAt))
    .limit(1);
  return rows[0] || null;
}

export async function updateRescueAttemptStatus(id: number, status: string, respondedAt?: Date) {
  const db = await getDb();
  if (!db) return;
  const updateData: Record<string, any> = { status };
  if (respondedAt) updateData.respondedAt = respondedAt;
  await db.update(rescueAttempts).set(updateData).where(eq(rescueAttempts.id, id));
}

/**
 * Busca leads inativos que são candidatos para resgate.
 * Critérios:
 * - Conversa aberta (não resolvida/fechada)
 * - Lead não está com funnelStatus "fechado" ou "perdido"
 * - Lead não está encaminhado para vendedor
 * - Última mensagem do cliente foi há mais de inactivityMinutes
 * - Não excedeu o máximo de tentativas
 */
export async function getInactiveLeadsForRescue(
  inactivityMinutes: number,
  maxAttempts: number,
  minIntervalMinutes: number,
) {
  const db = await getDb();
  if (!db) return [];

  const cutoffTime = Date.now() - (inactivityMinutes * 60 * 1000);
  const minIntervalTime = new Date(Date.now() - (minIntervalMinutes * 60 * 1000));

  // Get all open conversations with leads that have been inactive
  const allLeads = await db.select().from(leads)
    .innerJoin(conversations, eq(leads.conversationId, conversations.id))
    .where(
      and(
        // Conversa aberta ou pendente (não resolvida/fechada)
        inArray(conversations.status, ["open", "pending"]),
        // Lead não está fechado ou perdido
        notInArray(leads.funnelStatus, ["fechado", "perdido", "encaminhado_vendedor"]),
        // Última mensagem do cliente foi antes do cutoff
        lt(conversations.lastCustomerMessageAt, cutoffTime),
        // Tem última mensagem do cliente (não é conversa vazia)
        isNotNull(conversations.lastCustomerMessageAt),
      )
    );

  // Filter by rescue attempt count and interval
  const results = [];
  for (const row of allLeads) {
    const attempts = await getRescueAttemptsByConversation(row.conversations.id);
    const attemptCount = attempts.filter(a => a.status === "sent" || a.status === "responded").length;

    // Skip if max attempts reached
    if (attemptCount >= maxAttempts) continue;

    // Skip if last attempt was too recent
    if (attempts.length > 0) {
      const lastAttempt = attempts[0]; // Already sorted by sentAt desc
      if (lastAttempt.sentAt && lastAttempt.sentAt > minIntervalTime) continue;
    }

    results.push({
      lead: row.leads,
      conversation: row.conversations,
      attemptCount,
    });
  }

  return results;
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export async function listContacts(opts?: { search?: string; tag?: string; source?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { contacts: [], total: 0 };
  const conditions: any[] = [eq(contacts.isActive, true)];
  if (opts?.search) {
    conditions.push(
      or(
        like(contacts.name, `%${opts.search}%`),
        like(contacts.phone, `%${opts.search}%`),
        like(contacts.email, `%${opts.search}%`)
      )!
    );
  }
  if (opts?.source) {
    conditions.push(eq(contacts.source, opts.source as any));
  }
  const where = and(...conditions);
  const [rows, countResult] = await Promise.all([
    db.select().from(contacts).where(where).orderBy(desc(contacts.createdAt)).limit(opts?.limit || 50).offset(opts?.offset || 0),
    db.select({ count: sql<number>`count(*)` }).from(contacts).where(where),
  ]);
  // Filter by tag in JS (JSON column)
  let filtered = rows;
  if (opts?.tag) {
    filtered = rows.filter(c => c.tags && (c.tags as string[]).includes(opts.tag!));
  }
  return { contacts: filtered, total: Number(countResult[0]?.count || 0) };
}

export async function getContactById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return rows[0] || null;
}

export async function getContactByPhone(phone: string) {
  const db = await getDb();
  if (!db) return null;
  // Try exact match first
  const exact = await db.select().from(contacts).where(and(eq(contacts.phone, phone), eq(contacts.isActive, true))).limit(1);
  if (exact[0]) return exact[0];
  // Try all phone variations (handles 9th digit, formatting differences)
  const { phoneVariations } = await import("./phoneNormalize");
  const variations = phoneVariations(phone);
  for (const v of variations) {
    if (v === phone) continue;
    const row = await db.select().from(contacts).where(and(eq(contacts.phone, v), eq(contacts.isActive, true))).limit(1);
    if (row[0]) return row[0];
  }
  return null;
}

export async function createContact(data: Omit<InsertContact, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(contacts).values(data);
  const id = Number(result[0].insertId);
  return getContactById(id);
}

export async function updateContact(id: number, data: Partial<InsertContact>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(contacts).set(data).where(eq(contacts.id, id));
  return getContactById(id);
}

export async function deleteContact(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(contacts).set({ isActive: false }).where(eq(contacts.id, id));
}

export async function bulkCreateContacts(rows: Array<Omit<InsertContact, "id" | "createdAt" | "updatedAt">>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (rows.length === 0) return { created: 0, skipped: 0, merged: 0 };
  const { normalizePhone } = await import("./phoneNormalize");
  let created = 0;
  let skipped = 0;
  let merged = 0;
  for (const row of rows) {
    // Normalize the phone before checking
    const normalizedPhone = normalizePhone(row.phone);
    const existing = await getContactByPhone(row.phone);
    if (existing) {
      // Merge: update existing with better data if available
      const updates: Partial<InsertContact> = {};
      if (row.name && row.name !== "Cliente" && (!existing.name || existing.name === "Cliente")) {
        updates.name = row.name;
      }
      if (row.email && !existing.email) updates.email = row.email;
      if (row.notes && !existing.notes) updates.notes = row.notes;
      if (row.conversationId && !existing.conversationId) updates.conversationId = row.conversationId;
      // Merge tags
      if (row.tags && row.tags.length > 0) {
        const existingTags = existing.tags || [];
        const mergedTags = Array.from(new Set([...existingTags, ...row.tags]));
        if (mergedTags.length > existingTags.length) updates.tags = mergedTags;
      }
      // Normalize phone on existing record if different
      if (existing.phone !== normalizedPhone && normalizedPhone.length >= 12) {
        updates.phone = normalizedPhone;
      }
      if (Object.keys(updates).length > 0) {
        await db.update(contacts).set(updates).where(eq(contacts.id, existing.id));
        merged++;
      } else {
        skipped++;
      }
      continue;
    }
    // Store with normalized phone
    await db.insert(contacts).values({ ...row, phone: normalizedPhone || row.phone });
    created++;
  }
  return { created, skipped, merged };
}

export async function getAllContactTags() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ tags: contacts.tags }).from(contacts).where(eq(contacts.isActive, true));
  const tagSet = new Set<string>();
  for (const row of rows) {
    if (row.tags && Array.isArray(row.tags)) {
      for (const tag of row.tags) tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

// ─── Template Sends ─────────────────────────────────────────────────────────

export async function createTemplateSend(data: Omit<InsertTemplateSend, "id" | "sentAt">) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(templateSends).values(data);
  return Number(result[0].insertId);
}

export async function listTemplateSends(opts?: { contactId?: number; templateName?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.contactId) conditions.push(eq(templateSends.contactId, opts.contactId));
  if (opts?.templateName) conditions.push(eq(templateSends.templateName, opts.templateName));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(templateSends).where(where).orderBy(desc(templateSends.sentAt)).limit(opts?.limit || 50).offset(opts?.offset || 0);
}

export async function updateTemplateSendStatus(id: number, status: string, errorMessage?: string) {
  const db = await getDb();
  if (!db) return;
  const data: any = { status };
  if (errorMessage) data.errorMessage = errorMessage;
  await db.update(templateSends).set(data).where(eq(templateSends.id, id));
}

// ─── Campaign Queries ──────────────────────────────────────────

export async function createCampaign(data: Omit<InsertCampaign, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(campaigns).values(data);
  const id = (result as any)[0]?.insertId;
  return getCampaignById(id);
}

export async function getCampaignById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return rows[0] || null;
}

export async function listCampaigns(opts?: { status?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { campaigns: [], total: 0 };
  const conditions: any[] = [];
  if (opts?.status) conditions.push(eq(campaigns.status, opts.status as any));

  const query = conditions.length > 0
    ? db.select().from(campaigns).where(and(...conditions))
    : db.select().from(campaigns);

  const allRows = await query.orderBy(desc(campaigns.createdAt));
  const total = allRows.length;
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  return { campaigns: allRows.slice(offset, offset + limit), total };
}

export async function updateCampaign(id: number, data: Partial<InsertCampaign>) {
  const db = await getDb();
  if (!db) return null;
  await db.update(campaigns).set(data).where(eq(campaigns.id, id));
  return getCampaignById(id);
}

export async function deleteCampaign(id: number) {
  const db = await getDb();
  if (!db) return;
  // Delete dispatches first
  await db.delete(campaignDispatches).where(eq(campaignDispatches.campaignId, id));
  await db.delete(campaigns).where(eq(campaigns.id, id));
}

// ─── Campaign Dispatch Queries ──────────────────────────────────

export async function createCampaignDispatch(data: Omit<InsertCampaignDispatch, "id" | "createdAt">) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(campaignDispatches).values(data);
  return (result as any)[0]?.insertId;
}

export async function createCampaignDispatchesBatch(dispatches: Omit<InsertCampaignDispatch, "id" | "createdAt">[]) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (dispatches.length === 0) return;
  await db.insert(campaignDispatches).values(dispatches);
}

export async function updateCampaignDispatch(id: number, data: Partial<InsertCampaignDispatch>) {
  const db = await getDb();
  if (!db) return;
  await db.update(campaignDispatches).set(data).where(eq(campaignDispatches.id, id));
}

export async function updateCampaignDispatchByWamid(wamid: string, data: Partial<InsertCampaignDispatch>) {
  const db = await getDb();
  if (!db) return;
  await db.update(campaignDispatches).set(data).where(eq(campaignDispatches.whatsappMessageId, wamid));
}

export async function getCampaignDispatchesByCampaign(campaignId: number, opts?: { runNumber?: number; status?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { dispatches: [], total: 0 };
  const conditions: any[] = [eq(campaignDispatches.campaignId, campaignId)];
  if (opts?.runNumber) conditions.push(eq(campaignDispatches.runNumber, opts.runNumber));
  if (opts?.status) conditions.push(eq(campaignDispatches.status, opts.status as any));

  const allRows = await db.select().from(campaignDispatches)
    .where(and(...conditions))
    .orderBy(desc(campaignDispatches.createdAt));
  const total = allRows.length;
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  return { dispatches: allRows.slice(offset, offset + limit), total };
}

export async function getCampaignDispatchStats(campaignId: number) {
  const db = await getDb();
  if (!db) return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, responded: 0, pending: 0 };

  const rows = await db.select({
    status: campaignDispatches.status,
    count: sql<number>`count(*)`,
  }).from(campaignDispatches)
    .where(eq(campaignDispatches.campaignId, campaignId))
    .groupBy(campaignDispatches.status);

  const stats = { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, responded: 0, pending: 0 };
  for (const row of rows) {
    const count = Number(row.count);
    stats.total += count;
    if (row.status === "sent") stats.sent = count;
    else if (row.status === "delivered") stats.delivered = count;
    else if (row.status === "read") stats.read = count;
    else if (row.status === "failed") stats.failed = count;
    else if (row.status === "responded") stats.responded = count;
    else if (row.status === "pending") stats.pending = count;
  }
  return stats;
}

export async function getScheduledCampaigns() {
  const db = await getDb();
  if (!db) return [];
  const now = Date.now();
  return db.select().from(campaigns)
    .where(
      and(
        eq(campaigns.status, "scheduled"),
        sql`${campaigns.nextRunAt} <= ${now}`
      )
    );
}

export async function getCampaignDispatchByWamid(wamid: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(campaignDispatches)
    .where(eq(campaignDispatches.whatsappMessageId, wamid))
    .limit(1);
  return rows[0] || null;
}

export async function getCampaignDispatchByPhoneAndCampaign(phone: string, campaignId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(campaignDispatches)
    .where(and(
      eq(campaignDispatches.phone, phone),
      eq(campaignDispatches.campaignId, campaignId),
    ))
    .orderBy(desc(campaignDispatches.createdAt))
    .limit(1);
  return rows[0] || null;
}
