import { eq, desc, and, sql, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  conversations, InsertConversation, Conversation,
  messages, InsertMessage,
  leads, InsertLead,
  aiLogs, InsertAiLog,
  vehicles,
  settings,
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
  const result = await db.select().from(conversations).where(eq(conversations.phone, phone)).limit(1);
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
export async function listMessages(conversationId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(limit);
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

export async function upsertLead(data: InsertLead) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getLeadByConversationId(data.conversationId);
  if (existing) {
    // Only update non-null fields (preserve existing data)
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined && key !== "id" && key !== "conversationId") {
        updateData[key] = value;
      }
    }
    await db.update(leads).set(updateData).where(eq(leads.id, existing.id));
    return { ...existing, ...updateData };
  }
  const result = await db.insert(leads).values(data);
  return { ...data, id: result[0].insertId };
}

// ─── AI Log Queries ────────────────────────────────────────────
export async function createAiLog(data: InsertAiLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(aiLogs).values(data);
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
