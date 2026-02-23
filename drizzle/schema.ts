import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, bigint } from "drizzle-orm/mysql-core";

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
