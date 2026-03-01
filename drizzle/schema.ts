import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, bigint, tinyint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Conversations table - each conversation represents a chat session with a customer.
 */
export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  phone: varchar("phone", { length: 32 }).notNull(),
  contactName: varchar("contactName", { length: 255 }),
  channel: mysqlEnum("channel", ["whatsapp", "web", "webhook"]).default("whatsapp").notNull(),
  status: mysqlEnum("status", ["open", "pending", "resolved", "closed"]).default("open").notNull(),
  aiActive: boolean("aiActive").default(true).notNull(),
  assignedTo: int("assignedTo"),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactNotes: text("contactNotes"),
  unreadCount: int("unreadCount").default(0).notNull(),
  lastMessageAt: bigint("lastMessageAt", { mode: "number" }),
  lastCustomerMessageAt: bigint("lastCustomerMessageAt", { mode: "number" }),
  windowExpired: tinyint("windowExpired").default(0),
  lastMessagePreview: varchar("lastMessagePreview", { length: 500 }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * Messages table - stores all messages in conversations.
 * senderType: "customer" (incoming), "bot" (AI), "agent" (human operator)
 */
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  content: text("content").notNull(),
  senderType: mysqlEnum("senderType", ["customer", "bot", "agent"]).notNull(),
  senderName: varchar("senderName", { length: 255 }),
  messageType: mysqlEnum("messageType", ["text", "audio", "image", "document", "system"]).default("text").notNull(),
  status: mysqlEnum("messageStatus", ["sent", "delivered", "read", "failed"]).default("sent").notNull(),
  metadata: json("metadata"),
  externalId: varchar("externalId", { length: 255 }),
  deliveryError: text("deliveryError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/**
 * Leads table - qualified lead information extracted by AI.
 */
export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  name: varchar("name", { length: 255 }),
  intention: varchar("intention", { length: 255 }),
  vehicleInterest: varchar("vehicleInterest", { length: 500 }),
  hasTrade: boolean("hasTrade"),
  tradeVehicle: varchar("tradeVehicle", { length: 255 }),
  tradeYear: varchar("tradeYear", { length: 10 }),
  tradeKm: varchar("tradeKm", { length: 50 }),
  paymentMethod: varchar("paymentMethod", { length: 255 }),
  downPayment: varchar("downPayment", { length: 100 }),
  vehicleId: int("vehicleId"),
  status: mysqlEnum("leadStatus", ["new", "qualifying", "qualified", "contacted", "converted", "lost"]).default("new").notNull(),
  score: int("score").default(0),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * AI Logs table - tracks AI interactions for monitoring and cost analysis.
 */
export const aiLogs = mysqlTable("aiLogs", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  promptTokens: int("promptTokens").default(0),
  completionTokens: int("completionTokens").default(0),
  totalTokens: int("totalTokens").default(0),
  costEstimate: varchar("costEstimate", { length: 20 }),
  responseTimeMs: int("responseTimeMs"),
  toolUsed: varchar("toolUsed", { length: 100 }),
  success: boolean("success").default(true),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiLog = typeof aiLogs.$inferSelect;
export type InsertAiLog = typeof aiLogs.$inferInsert;

/**
 * Vehicles table - vehicle inventory for the dealership.
 * Synced from external S3 JSON feed.
 */
export const vehicles = mysqlTable("vehicles", {
  id: int("id").autoincrement().primaryKey(),
  externalId: int("externalId").unique(),
  brand: varchar("brand", { length: 100 }).notNull(),
  model: varchar("model", { length: 300 }).notNull(),
  version: varchar("version", { length: 300 }),
  title: varchar("title", { length: 500 }),
  year: int("year").notNull(),
  fabricYear: int("fabricYear"),
  price: int("price").notNull(),
  regularPrice: int("regularPrice"),
  promotionPrice: int("promotionPrice"),
  mileage: int("mileage"),
  color: varchar("color", { length: 50 }),
  transmission: varchar("transmission", { length: 30 }).default("manual"),
  fuel: varchar("fuel", { length: 50 }),
  category: varchar("category", { length: 100 }),
  condition: varchar("vehicleCondition", { length: 30 }),
  doors: int("doors"),
  description: text("description"),
  url: varchar("url", { length: 500 }),
  imageUrl: varchar("imageUrl", { length: 500 }),
  images: json("images"),
  features: json("features"),
  negotiation: varchar("negotiation", { length: 100 }),
  plate: varchar("plate", { length: 20 }),
  seller: varchar("seller", { length: 200 }),
  locationCity: varchar("locationCity", { length: 100 }),
  phone: varchar("vehiclePhone", { length: 32 }),
  available: boolean("available").default(true).notNull(),
  lastSyncedAt: timestamp("lastSyncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = typeof vehicles.$inferInsert;

/**
 * Settings table - stores system configuration including AI prompt.
 */
export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("settingKey", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;
export type InsertSetting = typeof settings.$inferInsert;


/**
 * Team Members table - represents agents/staff in the dealership
 * Separate from Manus auth users to allow multiple team members per Manus account
 */
export const teamMembers = mysqlTable("teamMembers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  cargo: mysqlEnum("cargo", ["admin", "gerente", "vendedor", "suporte"]).default("vendedor").notNull(),
  status: mysqlEnum("memberStatus", ["ativo", "inativo"]).default("ativo").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = typeof teamMembers.$inferInsert;

/**
 * Conversation Assignments - tracks who is assigned to each conversation
 */
export const conversationAssignments = mysqlTable("conversationAssignments", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  assignedToId: int("assignedToId").notNull(),
  assignedBy: int("assignedBy"),
  assumedAt: timestamp("assumedAt"),
  releasedAt: timestamp("releasedAt"),
  status: mysqlEnum("assignmentStatus", ["active", "released", "transferred"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ConversationAssignment = typeof conversationAssignments.$inferSelect;
export type InsertConversationAssignment = typeof conversationAssignments.$inferInsert;

/**
 * Activity Logs - tracks all actions by team members
 */
export const activityLogs = mysqlTable("activityLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  conversationId: int("conversationId"),
  details: json("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

/**
 * Team Notifications - real-time notifications for team members
 */
export const teamNotifications = mysqlTable("teamNotifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  conversationId: int("conversationId"),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TeamNotification = typeof teamNotifications.$inferSelect;
export type InsertTeamNotification = typeof teamNotifications.$inferInsert;

/**
 * Team Performance Metrics - tracks performance indicators per agent
 */
export const teamPerformance = mysqlTable("teamPerformance", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  totalConversations: int("totalConversations").default(0),
  totalLeads: int("totalLeads").default(0),
  convertedLeads: int("convertedLeads").default(0),
  averageResponseTimeMs: int("averageResponseTimeMs").default(0),
  closureRate: varchar("closureRate", { length: 10 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TeamPerformance = typeof teamPerformance.$inferSelect;
export type InsertTeamPerformance = typeof teamPerformance.$inferInsert;

/**
 * AI Decisions table - tracks every tool call made by the AI agent for audit and improvement.
 * Records which tool was called, what arguments/filters were used, the result summary, and timing.
 */
export const aiDecisions = mysqlTable("aiDecisions", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  messageId: int("messageId"),
  toolName: varchar("toolName", { length: 100 }).notNull(),
  toolArgs: json("toolArgs"),
  toolResultSummary: text("toolResultSummary"),
  resultCount: int("resultCount"),
  success: boolean("success").default(true).notNull(),
  errorMessage: text("errorMessage"),
  responseTimeMs: int("responseTimeMs"),
  promptTokens: int("promptTokens").default(0),
  completionTokens: int("completionTokens").default(0),
  totalTokens: int("totalTokens").default(0),
  model: varchar("model", { length: 100 }),
  customerMessage: text("customerMessage"),
  aiResponse: text("aiResponse"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiDecision = typeof aiDecisions.$inferSelect;
export type InsertAiDecision = typeof aiDecisions.$inferInsert;

/**
 * Meta Ads — armazena os IDs criados na API do Meta para cada veículo anunciado.
 * Permite criar, monitorar, pausar e reativar anúncios direto do CRM.
 */
export const metaAds = mysqlTable("metaAds", {
  id:               int("id").autoincrement().primaryKey(),
  vehicleId:        int("vehicleId"),  // nullable — anúncios importados podem não ter veículo vinculado
  campaignId:       varchar("campaignId", { length: 64 }).notNull(),
  adSetId:          varchar("adSetId", { length: 64 }),
  adCreativeId:     varchar("adCreativeId", { length: 64 }),
  adId:             varchar("adId", { length: 64 }).notNull().unique(),
  adName:           varchar("adName", { length: 500 }),  // nome do anúncio na Meta
  thumbnailUrl:     text("thumbnailUrl"),  // URL da thumbnail do criativo
  imageHash:        varchar("imageHash", { length: 64 }),
  status:           mysqlEnum("adStatus", ["paused", "active", "archived"]).default("paused").notNull(),
  dailyBudgetCents: int("dailyBudgetCents").default(3000).notNull(),
  source:           mysqlEnum("adSource", ["crm", "imported"]).default("crm").notNull(),  // origem do anúncio
  // Métricas cacheadas (atualizadas via syncInsights)
  impressions:      int("impressions").default(0),
  clicks:           int("clicks").default(0),
  leads:            int("leads").default(0),
  spendCents:       int("spendCents").default(0),
  lastInsightSync:  timestamp("lastInsightSync"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MetaAd = typeof metaAds.$inferSelect;
export type InsertMetaAd = typeof metaAds.$inferInsert;

/**
 * Follow-up logs — rastreia mensagens de reengajamento enviadas automaticamente.
 * O job cron verifica conversas inativas há 24h e dispara mensagens personalizadas.
 */
export const followUpLogs = mysqlTable("followUpLogs", {
  id:             int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  phone:          varchar("phone", { length: 32 }).notNull(),
  message:        text("message").notNull(),
  sentAt:         timestamp("sentAt").defaultNow().notNull(),
  attemptNumber:  int("attemptNumber").default(1).notNull(),
});

export type FollowUpLog = typeof followUpLogs.$inferSelect;
export type InsertFollowUpLog = typeof followUpLogs.$inferInsert;
