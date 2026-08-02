import {
  pgTable, pgEnum,
  serial, integer, smallint, bigint, numeric,
  varchar, text, boolean, json, jsonb, timestamp, date,
} from "drizzle-orm/pg-core";

// ══════════════════════════════════════════════════════════════════════════════
// ENUMS — declarados globalmente (PostgreSQL cria tipos reais no banco)
// ══════════════════════════════════════════════════════════════════════════════

export const userRoleEnum               = pgEnum("user_role",                ["user", "admin"]);
export const conversationChannelEnum    = pgEnum("conversation_channel",     ["whatsapp", "instagram", "facebook", "web", "webhook", "evolution", "zernio"]);
export const conversationStatusEnum     = pgEnum("conversation_status",      ["open", "pending", "resolved", "closed"]);
export const messageSenderTypeEnum      = pgEnum("message_sender_type",      ["customer", "bot", "agent", "internal"]);
export const messageTypeEnum            = pgEnum("message_type",             ["text", "audio", "image", "document", "system", "video"]);
export const messageStatusEnum          = pgEnum("message_status",           ["sent", "delivered", "read", "failed"]);
export const leadStatusEnum             = pgEnum("lead_status",              ["new", "qualifying", "qualified", "contacted", "converted", "lost"]);
export const funnelStatusEnum           = pgEnum("funnel_status",            ["novo", "interesse_definido", "pagamento_definido", "dados_pessoais", "dados_troca", "encaminhado_vendedor", "negociando", "fechado", "perdido"]);
export const leadTemperatureEnum        = pgEnum("lead_temperature",         ["frio", "morno", "quente", "muito_quente"]);
export const adStatusEnum               = pgEnum("ad_status",                ["paused", "active", "archived"]);
export const adSourceEnum               = pgEnum("ad_source",                ["crm", "imported"]);
export const flowTriggerEnum            = pgEnum("flow_trigger",             ["first_contact", "keyword", "button_click", "ad_click", "manual", "reactivation", "category_interest", "rescue", "tag_added", "tag_removed", "funnel_stage_entered"]);
export const nodeTypeEnum               = pgEnum("node_type",                ["start", "send_message", "send_buttons", "send_list", "send_image", "condition", "ai_response", "update_lead", "assign_agent", "delay", "wait_input", "end", "goto_flow", "assign_seller", "send_vehicle_photos", "vehicle_presentation", "update_lead_status", "classify_intent", "business_hours", "notify_number", "collect_with_ai", "vehicle_discovery", "confirm_interest", "collect_sequence"]);
export const sessionStatusEnum          = pgEnum("session_status",           ["active", "completed", "paused", "cancelled"]);
export const memberCargoEnum            = pgEnum("member_cargo",             ["admin", "gerente", "vendedor", "suporte"]);
export const memberStatusEnum           = pgEnum("member_status",            ["ativo", "inativo"]);
export const assignmentStatusEnum       = pgEnum("assignment_status",        ["active", "released", "transferred"]);
export const sellerAssignmentStatusEnum = pgEnum("seller_assignment_status", ["pending", "contacted", "completed", "expired"]);
export const rescueStatusEnum           = pgEnum("rescue_status",            ["sent", "responded", "expired", "cancelled"]);
export const contactSourceEnum          = pgEnum("contact_source",           ["manual", "excel", "whatsapp", "lead"]);
export const templateSendStatusEnum     = pgEnum("template_send_status",     ["pending", "sent", "delivered", "read", "failed"]);
export const scheduleTypeEnum           = pgEnum("schedule_type",            ["once", "recurring"]);
export const campaignStatusEnum         = pgEnum("campaign_status",          ["draft", "scheduled", "running", "paused", "completed"]);
export const dispatchStatusEnum         = pgEnum("dispatch_status",          ["pending", "sent", "delivered", "read", "failed", "responded"]);
export const evolutionInstanceStatusEnum = pgEnum("evolution_instance_status", ["connecting", "connected", "disconnected", "qr_code"]);
export const evolutionConvStatusEnum    = pgEnum("evolution_conv_status",    ["open", "pending", "resolved", "closed"]);
export const evolutionMsgTypeEnum       = pgEnum("evolution_msg_type",       ["text", "audio", "image", "document", "video", "sticker", "reaction", "system"]);
export const directionEnum              = pgEnum("direction",                ["inbound", "outbound"]);
export const evolutionMsgStatusEnum     = pgEnum("evolution_msg_status",     ["sent", "delivered", "read", "failed"]);
export const wnConvStatusEnum           = pgEnum("wn_conv_status",           ["open", "pending", "resolved", "closed"]);
export const wnMsgTypeEnum              = pgEnum("wn_msg_type",              ["text", "audio", "image", "document", "video", "sticker", "reaction", "system"]);
export const wnDirectionEnum            = pgEnum("wn_direction",             ["inbound", "outbound"]);
export const wnMsgStatusEnum            = pgEnum("wn_msg_status",            ["sent", "delivered", "read", "failed"]);
export const reminderStatusEnum         = pgEnum("reminder_status",          ["pending", "fired", "dismissed"]);
export const scheduledMsgStatusEnum     = pgEnum("scheduled_msg_status",     ["pending", "sent", "failed", "cancelled"]);
export const capiEventStatusEnum        = pgEnum("capi_event_status",        ["sent", "failed", "skipped"]);
export const routingStateEnum           = pgEnum("routing_state",            ["flow", "ai_agent", "human", "handed_off"]);

// ══════════════════════════════════════════════════════════════════════════════
// TABELAS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id:           serial("id").primaryKey(),
  openId:       varchar("openId", { length: 64 }).notNull().unique(),
  name:         text("name"),
  email:        varchar("email", { length: 320 }),
  loginMethod:  varchar("loginMethod", { length: 64 }),
  role:         userRoleEnum("role").default("user").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Conversations table - each conversation represents a chat session with a customer.
 */
export const conversations = pgTable("conversations", {
  id:                      serial("id").primaryKey(),
  phone:                   varchar("phone", { length: 32 }).notNull(),
  contactName:             varchar("contactName", { length: 255 }),
  contactPhoto:            varchar("contactPhoto", { length: 512 }),
  channel:                 conversationChannelEnum("channel").default("whatsapp").notNull(),
  // Instância Evolution de origem (null = número oficial/matriz)
  instanceName:            varchar("instanceName", { length: 100 }),
  // Agente de IA fixado nesta conversa (null = usa a hierarquia padrão)
  agentId:                 integer("agentId"),
  leadId:                  integer("leadId"),           // lead (pessoa) desta conversa
  customerId:              integer("customerId"),        // pessoa canônica (PR #7)
  // Arquivamento (sai da caixa principal sem apagar)
  archived:                boolean("archived").default(false).notNull(),
  platformUserId:          varchar("platformUserId", { length: 255 }),  // BSUID vai aqui
  status:                  conversationStatusEnum("status").default("open").notNull(),
  aiActive:                boolean("aiActive").default(true).notNull(),
  assignedTo:              integer("assignedTo"),
  contactEmail:            varchar("contactEmail", { length: 320 }),
  contactNotes:            text("contactNotes"),
  unreadCount:             integer("unreadCount").default(0).notNull(),
  lastMessageAt:           bigint("lastMessageAt", { mode: "number" }),
  lastCustomerMessageAt:   bigint("lastCustomerMessageAt", { mode: "number" }),
  windowExpired:           smallint("windowExpired").default(0),
  lastMessagePreview:      varchar("lastMessagePreview", { length: 500 }),
  metadata:                jsonb("metadata"),           // CTWAid e outros metadados ficam aqui
  remoteJid:               varchar("remoteJid", { length: 100 }),
  phoneNumberId:           varchar("phoneNumberId", { length: 64 }),
  connectionType:          varchar("connectionType"),
  connectionId:            integer("connectionId"),
  tags:                    jsonb("tags"),
  routingState:            routingStateEnum("routingState").default("flow").notNull(),
  createdAt:               timestamp("createdAt").defaultNow().notNull(),
  updatedAt:               timestamp("updatedAt").defaultNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * Messages table - stores all messages in conversations.
 * senderType: "customer" (incoming), "bot" (AI), "agent" (human operator)
 */
export const messages = pgTable("messages", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  content:        text("content").notNull(),
  senderType:     messageSenderTypeEnum("senderType").notNull(),
  senderName:     varchar("senderName", { length: 255 }),
  messageType:    messageTypeEnum("messageType").default("text").notNull(),
  status:         messageStatusEnum("messageStatus").default("sent").notNull(),
  metadata:       jsonb("metadata"),
  externalId:     varchar("externalId", { length: 255 }),
  deliveryError:  text("deliveryError"),
  direction:      varchar("direction"),
  instanceId:     integer("instanceId"),
  instanceName:   varchar("instanceName", { length: 100 }),
  rawPayload:     jsonb("rawPayload"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/**
 * Leads table - qualified lead information extracted by AI.
 * Inclui colunas de atribuição para tracking de anúncios (Meta CAPI, Google Ads).
 */
export const leads = pgTable("leads", {
  id:              serial("id").primaryKey(),
  conversationId:  integer("conversationId").notNull(),
  phone:           varchar("phone", { length: 32 }).notNull(),
  name:            varchar("name", { length: 255 }),
  fullName:        varchar("fullName", { length: 255 }),
  intention:       varchar("intention", { length: 255 }),
  vehicleInterest: varchar("vehicleInterest", { length: 500 }),
  hasTrade:        boolean("hasTrade"),
  tradeVehicle:    varchar("tradeVehicle", { length: 255 }),
  tradeYear:       varchar("tradeYear", { length: 10 }),
  tradeKm:         varchar("tradeKm", { length: 50 }),
  paymentMethod:   varchar("paymentMethod", { length: 255 }),
  downPayment:     varchar("downPayment", { length: 100 }),
  vehicleId:       integer("vehicleId"),
  customerId:      integer("customerId"),      // pessoa canônica (PR #7)
  status:          leadStatusEnum("leadStatus").default("new").notNull(),
  funnelStatus:    funnelStatusEnum("funnelStatus").default("novo").notNull(),
  temperature:     leadTemperatureEnum("leadTemperature").default("frio").notNull(),
  ownerId:         integer("ownerId"),                     // vendedor dono do lead
  reactivations:   integer("reactivations").default(0).notNull(), // nº de reaberturas
  reopenedAt:      timestamp("reopenedAt"),                // última reativação
  isLead:          boolean("isLead").default(true).notNull(), // false = não é lead (fornecedor/colega...)
  discardReason:   varchar("discardReason", { length: 100 }),  // motivo/tipo quando não é lead
  creditApproved:  varchar("creditApproved", { length: 10 }),   // "sim" | "nao" | null (não avaliado)
  // ── Qualidade do lead: é isso que decide o que reportamos à Meta ────────────
  quality:         varchar("quality", { length: 10 }),          // "bom" | "ruim" | null
  qualitySource:   varchar("qualitySource", { length: 20 }),    // "vendedor" | "credito" | "ia"
  qualityReason:   text("qualityReason"),                        // por que é bom/ruim
  visitedStore:    boolean("visitedStore"),                      // visitou a loja (sinal forte)
  creditAmount:    varchar("creditAmount", { length: 50 }),     // valor liberado
  creditConditions: varchar("creditConditions", { length: 255 }), // condições de parcela
  creditBank:      varchar("creditBank", { length: 40 }),        // banco
  score:           integer("score").default(0),
  city:            varchar("city", { length: 255 }),
  email:           varchar("email", { length: 320 }),
  cpf:             varchar("cpf", { length: 14 }),
  birthDate:       varchar("birthDate", { length: 10 }),
  notes:           text("notes"),

  // ── Atribuição de anúncios (Meta CAPI + Google Ads) ───────────────────────
  // CTWAid: ID gerado quando o lead veio de um anúncio Click-to-WhatsApp
  ctwaId:          varchar("ctwaId", { length: 255 }),
  // Meta Lead ID (15-17 dígitos): lead veio de Lead Ads / Instant Forms (leadgen)
  // Obrigatório para a otimização "Conversion Leads" via CAPI
  metaLeadId:      varchar("metaLeadId", { length: 32 }),
  // BSUID: novo identificador estável do Meta (substitui telefone no futuro)
  bsuid:           varchar("bsuid", { length: 255 }),
  // Google Ads click identifiers
  gclid:           varchar("gclid", { length: 255 }),
  gbraid:          varchar("gbraid", { length: 255 }),
  wbraid:          varchar("wbraid", { length: 255 }),
  // Meta Pixel identifiers
  fbc:             varchar("fbc", { length: 255 }),   // fb.1.<ts>.<fbclid>
  fbp:             varchar("fbp", { length: 255 }),   // cookie _fbp
  // UTM attribution
  utmSource:       varchar("utmSource", { length: 100 }),
  utmMedium:       varchar("utmMedium", { length: 100 }),
  utmCampaign:     varchar("utmCampaign", { length: 255 }),
  utmContent:      varchar("utmContent", { length: 255 }),
  utmTerm:         varchar("utmTerm", { length: 255 }),
  // Landing page e referrer no primeiro toque
  landingPage:     varchar("landingPage", { length: 500 }),
  referrer:        varchar("referrer", { length: 500 }),
  // Identificador externo estável para CAPI (SHA-256 do telefone ou lead_id)
  externalId:      varchar("externalId", { length: 255 }),
  // IP e User-Agent para enriquecer o payload CAPI
  clientIp:        varchar("clientIp", { length: 45 }),
  clientUserAgent: text("clientUserAgent"),
  // Google Analytics client_id (necessário para GA4 Measurement Protocol)
  gaClientId:      varchar("gaClientId", { length: 255 }),
  // Primeiro e último toque (para atribuição first-touch vs last-touch)
  firstTouchAt:    timestamp("firstTouchAt"),
  lastTouchAt:     timestamp("lastTouchAt"),
  // Consentimento LGPD — não enviar PII se false
  consent:         boolean("consent").default(true),

  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * Lead Summaries table - daily conversation summaries generated by AI.
 */
export const leadSummaries = pgTable("leadSummaries", {
  id:             serial("id").primaryKey(),
  leadId:         integer("leadId").notNull(),
  conversationId: integer("conversationId").notNull(),
  summaryDate:    varchar("summaryDate", { length: 10 }).notNull(), // YYYY-MM-DD
  summary:        text("summary").notNull(),
  messageCount:   integer("messageCount").default(0),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
});

export type LeadSummary = typeof leadSummaries.$inferSelect;
export type InsertLeadSummary = typeof leadSummaries.$inferInsert;

/**
 * AI Logs table - tracks AI interactions for monitoring and cost analysis.
 */
export const aiLogs = pgTable("aiLogs", {
  id:               serial("id").primaryKey(),
  conversationId:   integer("conversationId").notNull(),
  promptTokens:     integer("promptTokens").default(0),
  completionTokens: integer("completionTokens").default(0),
  totalTokens:      integer("totalTokens").default(0),
  costEstimate:     varchar("costEstimate", { length: 20 }),
  responseTimeMs:   integer("responseTimeMs"),
  toolUsed:         varchar("toolUsed", { length: 100 }),
  success:          boolean("success").default(true),
  errorMessage:     text("errorMessage"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
});

export type AiLog = typeof aiLogs.$inferSelect;
export type InsertAiLog = typeof aiLogs.$inferInsert;

/**
 * Vehicles table - vehicle inventory for the dealership.
 */
export const vehicles = pgTable("vehicles", {
  id:             serial("id").primaryKey(),
  externalId:     integer("externalId").unique(),
  brand:          varchar("brand", { length: 100 }).notNull(),
  model:          varchar("model", { length: 300 }).notNull(),
  version:        varchar("version", { length: 300 }),
  title:          varchar("title", { length: 500 }),
  year:           integer("year").notNull(),
  fabricYear:     integer("fabricYear"),
  price:          integer("price").notNull(),
  regularPrice:   integer("regularPrice"),
  promotionPrice: integer("promotionPrice"),
  mileage:        integer("mileage"),
  color:          varchar("color", { length: 50 }),
  transmission:   varchar("transmission", { length: 30 }).default("manual"),
  fuel:           varchar("fuel", { length: 50 }),
  category:       varchar("category", { length: 100 }),
  vehicleType:    varchar("vehicleType", { length: 100 }),
  condition:      varchar("vehicleCondition", { length: 30 }),
  doors:          integer("doors"),
  description:    text("description"),
  url:            varchar("url", { length: 500 }),
  imageUrl:       varchar("imageUrl", { length: 500 }),
  images:         jsonb("images"),
  features:       jsonb("features"),
  negotiation:    varchar("negotiation", { length: 100 }),
  plate:          varchar("plate", { length: 20 }),
  seller:         varchar("seller", { length: 200 }),
  locationCity:   varchar("locationCity", { length: 100 }),
  phone:          varchar("vehiclePhone", { length: 32 }),
  available:      boolean("available").default(true).notNull(),
  lastSyncedAt:   timestamp("lastSyncedAt"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
});

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = typeof vehicles.$inferInsert;

/**
 * Settings table - stores system configuration including AI prompt.
 */
export const settings = pgTable("settings", {
  id:        serial("id").primaryKey(),
  key:       varchar("settingKey", { length: 100 }).notNull().unique(),
  value:     text("value").notNull(),
  updatedBy: integer("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;
export type InsertSetting = typeof settings.$inferInsert;

/**
 * Team Members table - represents agents/staff in the dealership.
 */
export const teamMembers = pgTable("teamMembers", {
  id:           serial("id").primaryKey(),
  name:         varchar("name", { length: 255 }).notNull(),
  email:        varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  cargo:        memberCargoEnum("cargo").default("vendedor").notNull(),
  status:       memberStatusEnum("memberStatus").default("ativo").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull(),
});

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = typeof teamMembers.$inferInsert;

/**
 * Conversation Assignments - tracks who is assigned to each conversation.
 */
export const conversationAssignments = pgTable("conversationAssignments", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  assignedToId:   integer("assignedToId").notNull(),
  assignedBy:     integer("assignedBy"),
  assumedAt:      timestamp("assumedAt"),
  releasedAt:     timestamp("releasedAt"),
  status:         assignmentStatusEnum("assignmentStatus").default("active").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
});

export type ConversationAssignment = typeof conversationAssignments.$inferSelect;
export type InsertConversationAssignment = typeof conversationAssignments.$inferInsert;

/**
 * Activity Logs - tracks all actions by team members.
 */
// ─── Oportunidades (ciclos de compra de um lead) ─────────────────────────────
// Um lead (pessoa) pode ter várias oportunidades ao longo do tempo. Cada uma é
// um ciclo com abertura, estágio e desfecho (won/lost). Reativação = nova linha.
export const leadOpportunities = pgTable("leadOpportunities", {
  id:            serial("id").primaryKey(),
  leadId:        integer("leadId").notNull(),
  status:        varchar("status", { length: 20 }).default("open").notNull(), // open | won | lost
  funnelStatus:  varchar("funnelStatus", { length: 50 }).default("novo").notNull(),
  vehicleId:     integer("vehicleId"),
  vehicleInterest: varchar("vehicleInterest", { length: 500 }),
  valueCents:    bigint("valueCents", { mode: "number" }),
  outcome:       varchar("outcome", { length: 100 }),  // motivo de perda / detalhe
  isReactivation: boolean("isReactivation").default(false).notNull(),
  openedAt:      timestamp("openedAt").defaultNow().notNull(),
  closedAt:      timestamp("closedAt"),
});
export type LeadOpportunity = typeof leadOpportunities.$inferSelect;
export type InsertLeadOpportunity = typeof leadOpportunities.$inferInsert;

export const activityLogs = pgTable("activityLogs", {
  id:             serial("id").primaryKey(),
  userId:         integer("userId").notNull(),
  action:         varchar("action", { length: 100 }).notNull(),
  conversationId: integer("conversationId"),
  leadId:         integer("leadId"),        // timeline unificada por lead (pessoa)
  details:        jsonb("details"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

/**
 * Team Notifications - real-time notifications for team members.
 */
export const teamNotifications = pgTable("teamNotifications", {
  id:             serial("id").primaryKey(),
  userId:         integer("userId").notNull(),
  type:           varchar("type", { length: 50 }).notNull(),
  title:          varchar("title", { length: 255 }).notNull(),
  message:        text("message"),
  conversationId: integer("conversationId"),
  read:           boolean("read").default(false).notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type TeamNotification = typeof teamNotifications.$inferSelect;
export type InsertTeamNotification = typeof teamNotifications.$inferInsert;

/**
 * Team Performance Metrics - tracks performance indicators per agent.
 */
export const teamPerformance = pgTable("teamPerformance", {
  id:                    serial("id").primaryKey(),
  userId:                integer("userId").notNull(),
  totalConversations:    integer("totalConversations").default(0),
  totalLeads:            integer("totalLeads").default(0),
  convertedLeads:        integer("convertedLeads").default(0),
  averageResponseTimeMs: integer("averageResponseTimeMs").default(0),
  closureRate:           varchar("closureRate", { length: 10 }),
  updatedAt:             timestamp("updatedAt").defaultNow().notNull(),
});

export type TeamPerformance = typeof teamPerformance.$inferSelect;
export type InsertTeamPerformance = typeof teamPerformance.$inferInsert;

/**
 * AI Decisions table - tracks every tool call made by the AI agent.
 */
export const aiDecisions = pgTable("aiDecisions", {
  id:                serial("id").primaryKey(),
  conversationId:    integer("conversationId").notNull(),
  messageId:         integer("messageId"),
  toolName:          varchar("toolName", { length: 100 }).notNull(),
  toolArgs:          jsonb("toolArgs"),
  toolResultSummary: text("toolResultSummary"),
  resultCount:       integer("resultCount"),
  success:           boolean("success").default(true).notNull(),
  errorMessage:      text("errorMessage"),
  responseTimeMs:    integer("responseTimeMs"),
  promptTokens:      integer("promptTokens").default(0),
  completionTokens:  integer("completionTokens").default(0),
  totalTokens:       integer("totalTokens").default(0),
  model:             varchar("model", { length: 100 }),
  customerMessage:   text("customerMessage"),
  aiResponse:        text("aiResponse"),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
});

export type AiDecision = typeof aiDecisions.$inferSelect;
export type InsertAiDecision = typeof aiDecisions.$inferInsert;

/**
 * Meta Ads — armazena os IDs criados na API do Meta para cada veículo anunciado.
 */
export const metaAds = pgTable("metaAds", {
  id:               serial("id").primaryKey(),
  vehicleId:        integer("vehicleId"),
  campaignId:       varchar("campaignId", { length: 64 }).notNull(),
  adSetId:          varchar("adSetId", { length: 64 }),
  adCreativeId:     varchar("adCreativeId", { length: 64 }),
  adId:             varchar("adId", { length: 64 }).notNull().unique(),
  adName:           varchar("adName", { length: 500 }),
  thumbnailUrl:     text("thumbnailUrl"),
  imageHash:        varchar("imageHash", { length: 64 }),
  status:           adStatusEnum("adStatus").default("paused").notNull(),
  dailyBudgetCents: integer("dailyBudgetCents").default(3000).notNull(),
  source:           adSourceEnum("adSource").default("crm").notNull(),
  impressions:      integer("impressions").default(0),
  clicks:           integer("clicks").default(0),
  leads:            integer("leads").default(0),
  spendCents:       integer("spendCents").default(0),
  lastInsightSync:  timestamp("lastInsightSync"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().notNull(),
});

export type MetaAd = typeof metaAds.$inferSelect;
export type InsertMetaAd = typeof metaAds.$inferInsert;

/**
 * Follow-up logs — rastreia mensagens de reengajamento enviadas automaticamente.
 */
export const followUpLogs = pgTable("followUpLogs", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  phone:          varchar("phone", { length: 32 }).notNull(),
  message:        text("message").notNull(),
  sentAt:         timestamp("sentAt").defaultNow().notNull(),
  attemptNumber:  integer("attemptNumber").default(1).notNull(),
});

export type FollowUpLog = typeof followUpLogs.$inferSelect;
export type InsertFollowUpLog = typeof followUpLogs.$inferInsert;

/**
 * Vendor API Keys — chaves de acesso para vendedores externos.
 */
export const vendorApiKeys = pgTable("vendorApiKeys", {
  id:           serial("id").primaryKey(),
  teamMemberId: integer("teamMemberId").notNull(),
  apiKey:       varchar("apiKey", { length: 64 }).notNull().unique(),
  name:         varchar("name", { length: 100 }),
  active:       boolean("active").default(true).notNull(),
  lastUsedAt:   timestamp("lastUsedAt"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
});

export type VendorApiKey = typeof vendorApiKeys.$inferSelect;
export type InsertVendorApiKey = typeof vendorApiKeys.$inferInsert;

/**
 * Chat Flows — fluxos de conversa programáveis estilo ManyChat.
 */
export const chatFlows = pgTable("chatFlows", {
  id:           serial("id").primaryKey(),
  name:         varchar("name", { length: 255 }).notNull(),
  description:  text("description"),
  trigger:      flowTriggerEnum("flowTrigger").default("first_contact").notNull(),
  triggerValue: varchar("triggerValue", { length: 500 }),
  active:       boolean("active").default(false).notNull(),
  priority:     integer("priority").default(0).notNull(),
  agentId:      integer("agentId"),
  connectionType: varchar("connectionType"),
  connectionId:   integer("connectionId"),
  instanceName:   varchar("instanceName", { length: 100 }),
  // Condições "Somente se" — grupos E/OU: array de grupos; dentro do grupo tudo E, entre grupos OU.
  conditions:   jsonb("conditions"),
  createdBy:    integer("createdBy"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull(),
});

export type ChatFlow = typeof chatFlows.$inferSelect;
export type InsertChatFlow = typeof chatFlows.$inferInsert;

/**
 * Chat Flow Nodes — nós individuais dentro de um fluxo.
 */
export const chatFlowNodes = pgTable("chatFlowNodes", {
  id:        serial("id").primaryKey(),
  flowId:    integer("flowId").notNull(),
  nodeType:  nodeTypeEnum("nodeType").notNull(),
  label:     varchar("label", { length: 255 }),
  data:      jsonb("data").notNull(),
  positionX: integer("positionX").default(0).notNull(),
  positionY: integer("positionY").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ChatFlowNode = typeof chatFlowNodes.$inferSelect;
export type InsertChatFlowNode = typeof chatFlowNodes.$inferInsert;

/**
 * Chat Flow Edges — conexões entre nós.
 */
export const chatFlowEdges = pgTable("chatFlowEdges", {
  id:           serial("id").primaryKey(),
  flowId:       integer("flowId").notNull(),
  sourceNodeId: integer("sourceNodeId").notNull(),
  targetNodeId: integer("targetNodeId").notNull(),
  sourceHandle: varchar("sourceHandle", { length: 100 }).default("default"),
  label:        varchar("edgeLabel", { length: 255 }),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
});

export type ChatFlowEdge = typeof chatFlowEdges.$inferSelect;
export type InsertChatFlowEdge = typeof chatFlowEdges.$inferInsert;

/**
 * Chat Flow Sessions — rastreia em qual nó cada conversa está dentro de um fluxo.
 */
export const chatFlowSessions = pgTable("chatFlowSessions", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  flowId:         integer("flowId").notNull(),
  currentNodeId:  integer("currentNodeId"),
  status:         sessionStatusEnum("sessionStatus").default("active").notNull(),
  context:        jsonb("context"),
  startedAt:      timestamp("startedAt").defaultNow().notNull(),
  completedAt:    timestamp("completedAt"),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
});

export type ChatFlowSession = typeof chatFlowSessions.$inferSelect;
export type InsertChatFlowSession = typeof chatFlowSessions.$inferInsert;

/**
 * Flow Events (decision log) — arquitetura vendedor virtual (fase 1).
 * Cada mensagem classificada, transição de nó, ação executada, fallback e
 * expiração de sessão vira um evento auditável. Alimenta o painel "Saúde da
 * Jornada" no editor de fluxos.
 */
export const flowEvents = pgTable("flowEvents", {
  id:             serial("id").primaryKey(),
  sessionId:      integer("sessionId").notNull(),
  conversationId: integer("conversationId").notNull(),
  flowId:         integer("flowId").notNull(),
  nodeId:         integer("nodeId"),
  event:          varchar("event", { length: 60 }).notNull(),
  payload:        jsonb("payload"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type FlowEvent = typeof flowEvents.$inferSelect;
export type InsertFlowEvent = typeof flowEvents.$inferInsert;

/**
 * AI Agents — agentes de IA configuráveis com prompt, tools e modelo próprios.
 */
export const aiAgents = pgTable("aiAgents", {
  id:                 serial("id").primaryKey(),
  name:               varchar("name", { length: 255 }).notNull(),
  description:        text("description"),
  systemPrompt:       text("systemPrompt").notNull(),
  includeCoreLayers:  boolean("includeCoreLayers").default(true).notNull(),
  model:              varchar("model", { length: 100 }).default("gpt-4o-mini").notNull(),
  temperature:        numeric("temperature", { precision: 2, scale: 1 }).default("0.7").notNull(),
  maxTokens:          integer("maxTokens").default(1024).notNull(),
  enabledTools:       jsonb("enabledTools").$type<string[]>(),
  active:             boolean("active").default(true).notNull(),
  isDefault:          boolean("isDefault").default(false).notNull(), // agente padrão da loja (máx 1)
  createdBy:          integer("createdBy"),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().notNull(),
});

export type AiAgent = typeof aiAgents.$inferSelect;
export type InsertAiAgent = typeof aiAgents.$inferInsert;

/**
 * Sellers — vendedores cadastrados por loja.
 */
export const sellers = pgTable("sellers", {
  id:               serial("id").primaryKey(),
  name:             varchar("name", { length: 255 }).notNull(),
  phone:            varchar("phone", { length: 32 }).notNull(),
  photoUrl:         text("photoUrl"),
  storeLocation:    varchar("storeLocation", { length: 200 }).notNull(),
  isActive:         boolean("isActive").default(true).notNull(),
  sortOrder:        integer("sortOrder").default(0).notNull(),
  totalAssignments: integer("totalAssignments").default(0).notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().notNull(),
});

export type Seller = typeof sellers.$inferSelect;
export type InsertSeller = typeof sellers.$inferInsert;

/**
 * Seller Queues — controle de rodízio por loja.
 */
export const sellerQueues = pgTable("sellerQueues", {
  id:            serial("id").primaryKey(),
  storeLocation: varchar("storeLocation", { length: 200 }).notNull().unique(),
  currentIndex:  integer("currentIndex").default(0).notNull(),
  updatedAt:     timestamp("updatedAt").defaultNow().notNull(),
});

export type SellerQueue = typeof sellerQueues.$inferSelect;
export type InsertSellerQueue = typeof sellerQueues.$inferInsert;

/**
 * Seller Assignments — histórico de atribuições de vendedores a conversas.
 */
export const sellerAssignments = pgTable("sellerAssignments", {
  id:            serial("id").primaryKey(),
  sellerId:      integer("sellerId").notNull(),
  conversationId: integer("conversationId").notNull(),
  storeLocation: varchar("storeLocation", { length: 200 }).notNull(),
  vehicleId:     integer("vehicleId"),
  customerPhone: varchar("customerPhone", { length: 32 }),
  customerName:  varchar("customerName", { length: 255 }),
  status:        sellerAssignmentStatusEnum("sellerAssignmentStatus").default("pending").notNull(),
  assignedAt:    timestamp("assignedAt").defaultNow().notNull(),
  contactedAt:   timestamp("contactedAt"),
  completedAt:   timestamp("completedAt"),
});

export type SellerAssignment = typeof sellerAssignments.$inferSelect;
export type InsertSellerAssignment = typeof sellerAssignments.$inferInsert;

/**
 * Rescue Attempts — rastreia tentativas de resgate de leads inativos.
 */
export const rescueAttempts = pgTable("rescueAttempts", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  leadId:         integer("leadId").notNull(),
  flowId:         integer("flowId"),
  attemptNumber:  integer("attemptNumber").default(1).notNull(),
  status:         rescueStatusEnum("rescueStatus").default("sent").notNull(),
  sentAt:         timestamp("sentAt").defaultNow().notNull(),
  respondedAt:    timestamp("respondedAt"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type RescueAttempt = typeof rescueAttempts.$inferSelect;
export type InsertRescueAttempt = typeof rescueAttempts.$inferInsert;

/**
 * Reengagement Attempts — motor ÚNICO de reengajamento (PR #6).
 * Substitui followUpLogs + rescueAttempts como fonte de verdade: uma fila por
 * conversa, com estratégia escalonada (flow → ai_message → template).
 * Garantia: 1 lead nunca recebe 2 reengajamentos concorrentes — a próxima
 * tentativa só dispara quando a inatividade atinge o limiar do próximo passo.
 */
export const reengagementStrategyEnum = pgEnum("reengagement_strategy", ["flow", "ai_message", "template"]);
export const reengagementStatusEnum   = pgEnum("reengagement_status",   ["sent", "failed", "responded", "cancelled"]);

export const reengagementAttempts = pgTable("reengagementAttempts", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  leadId:         integer("leadId"),
  attemptNumber:  integer("attemptNumber").default(1).notNull(),
  strategy:       reengagementStrategyEnum("strategy").notNull(),
  status:         reengagementStatusEnum("reengagementStatus").default("sent").notNull(),
  flowId:         integer("flowId"),
  message:        text("message"),
  error:          text("error"),
  sentAt:         timestamp("sentAt").defaultNow().notNull(),
  respondedAt:    timestamp("respondedAt"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type ReengagementAttempt = typeof reengagementAttempts.$inferSelect;
export type InsertReengagementAttempt = typeof reengagementAttempts.$inferInsert;

/**
 * Contacts — agenda de contatos para marketing e envio de templates.
 */
export const contacts = pgTable("contacts", {
  id:             serial("id").primaryKey(),
  name:           varchar("name", { length: 255 }).notNull(),
  phone:          varchar("phone", { length: 32 }).notNull(),
  email:          varchar("email", { length: 320 }),
  tags:           jsonb("tags").$type<string[]>(),
  notes:          text("notes"),
  source:         contactSourceEnum("contactSource").default("manual").notNull(),
  conversationId: integer("conversationId"),
  leadId:         integer("leadId"),
  customerId:     integer("customerId"),      // pessoa canônica (PR #7)
  // ── Classificação e dados completos ──
  kind:           varchar("contactKind", { length: 40 }).default("lead").notNull(), // lead | cliente | tipos customizados
  // Instância Evolution que originou/criou o contato (null = matriz/oficial)
  createdByInstance: varchar("createdByInstance", { length: 100 }),
  cpf:            varchar("cpf", { length: 14 }),
  birthDate:      varchar("birthDate", { length: 10 }),
  address:        varchar("address", { length: 500 }),
  city:           varchar("city", { length: 100 }),
  // ── Última negociação (preenchido automaticamente quando o funil fecha) ──
  purchasedVehicleId: integer("purchasedVehicleId"),
  purchasedVehicle:   varchar("purchasedVehicle", { length: 300 }),
  purchasedAt:        timestamp("purchasedAt"),
  lastDealValue:      integer("lastDealValue"),
  isActive:       boolean("isActive").default(true).notNull(),
  createdBy:      integer("createdBy"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
});

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;

/**
 * Customers — PESSOA CANÔNICA (PR #7).
 * Uma linha por ser humano, identificada por canonicalPhone (normalizePhone).
 * leads/conversations/contacts apontam para cá via customerId — acaba a
 * duplicação "mesmo cliente, várias conversas/canais". consentAt/Source
 * alimentam o LGPD (PR #9).
 */
export const customers = pgTable("customers", {
  id:             serial("id").primaryKey(),
  canonicalPhone: varchar("canonicalPhone", { length: 20 }).notNull().unique(),
  name:           varchar("name", { length: 255 }),
  fullName:       varchar("fullName", { length: 255 }),
  email:          varchar("email", { length: 320 }),
  cpf:            varchar("cpf", { length: 11 }),          // só dígitos
  birthDate:      date("birthDate"),                        // YYYY-MM-DD
  city:           varchar("city", { length: 255 }),
  consentAt:      timestamp("consentAt"),
  consentSource:  varchar("consentSource", { length: 50 }),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

/**
 * Template Sends — histórico de envios de templates de marketing para contatos.
 */
export const templateSends = pgTable("templateSends", {
  id:           serial("id").primaryKey(),
  contactId:    integer("contactId").notNull(),
  templateName: varchar("templateName", { length: 255 }).notNull(),
  phone:        varchar("phone", { length: 32 }).notNull(),
  status:       templateSendStatusEnum("templateSendStatus").default("pending").notNull(),
  errorMessage: text("errorMessage"),
  sentAt:       timestamp("sentAt").defaultNow().notNull(),
  sentBy:       integer("sentBy"),
});

export type TemplateSend = typeof templateSends.$inferSelect;
export type InsertTemplateSend = typeof templateSends.$inferInsert;

/**
 * Campaigns — campanhas de envio em massa de templates WhatsApp.
 */
export const campaigns = pgTable("campaigns", {
  id:               serial("id").primaryKey(),
  name:             varchar("name", { length: 255 }).notNull(),
  description:      text("description"),
  templateName:     varchar("templateName", { length: 255 }).notNull(),
  templateLanguage: varchar("templateLanguage", { length: 10 }).default("pt_BR").notNull(),
  bodyParams:       jsonb("bodyParams").$type<string[]>(),
  contactIds:       jsonb("contactIds").$type<number[]>(),
  filterTags:       jsonb("filterTags").$type<string[]>(),
  filterKind:       varchar("filterKind", { length: 10 }), // null=todos | lead | cliente
  scheduleType:     scheduleTypeEnum("scheduleType").default("once").notNull(),
  scheduledAt:      bigint("scheduledAt", { mode: "number" }),
  intervalDays:     integer("intervalDays"),
  lastRunAt:        bigint("lastRunAt", { mode: "number" }),
  nextRunAt:        bigint("nextRunAt", { mode: "number" }),
  responseFlowId:   integer("responseFlowId"),
  conversationTag:  varchar("conversationTag", { length: 100 }),
  status:           campaignStatusEnum("campaignStatus").default("draft").notNull(),
  totalContacts:    integer("totalContacts").default(0).notNull(),
  createdBy:        integer("createdBy"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

/**
 * Campaign Dispatches — registro individual de cada envio dentro de uma campanha.
 */
export const campaignDispatches = pgTable("campaignDispatches", {
  id:                 serial("id").primaryKey(),
  campaignId:         integer("campaignId").notNull(),
  contactId:          integer("contactId").notNull(),
  phone:              varchar("phone", { length: 32 }).notNull(),
  contactName:        varchar("contactName", { length: 255 }),
  status:             dispatchStatusEnum("dispatchStatus").default("pending").notNull(),
  errorMessage:       text("errorMessage"),
  whatsappMessageId:  varchar("whatsappMessageId", { length: 255 }),
  sentAt:             timestamp("sentAt"),
  deliveredAt:        timestamp("deliveredAt"),
  readAt:             timestamp("readAt"),
  respondedAt:        timestamp("respondedAt"),
  runNumber:          integer("runNumber").default(1).notNull(),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
});

export type CampaignDispatch = typeof campaignDispatches.$inferSelect;
export type InsertCampaignDispatch = typeof campaignDispatches.$inferInsert;

/**
 * Evolution API instances - each instance = one WhatsApp number (vendor/seller).
 */
export const evolutionInstances = pgTable("evolutionInstances", {
  id:                 serial("id").primaryKey(),
  instanceName:       varchar("instanceName", { length: 100 }).notNull().unique(),
  displayName:        varchar("displayName", { length: 255 }),
  phone:              varchar("phone", { length: 32 }),
  sellerId:           integer("sellerId"),
  assignedUserId:     integer("assignedUserId"),
  status:             evolutionInstanceStatusEnum("status").default("disconnected").notNull(),
  qrCode:             text("qrCode"),
  profilePicUrl:      varchar("profilePicUrl", { length: 512 }),
  webhookConfigured:  boolean("webhookConfigured").default(false).notNull(),
  lastConnectedAt:    bigint("lastConnectedAt", { mode: "number" }),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().notNull(),
});

export type EvolutionInstance = typeof evolutionInstances.$inferSelect;
export type InsertEvolutionInstance = typeof evolutionInstances.$inferInsert;

// ─── Instâncias Zernio (coexistência WhatsApp oficial) ────────────────────────
// Cada linha = uma conta WhatsApp conectada no Zernio, cadastrada manualmente.
// apiKey é opcional: se vazio, usa a ZERNIO_API_KEY global do ambiente.
export const zernioInstances = pgTable("zernioInstances", {
  id:            serial("id").primaryKey(),
  accountId:     varchar("accountId", { length: 100 }).notNull().unique(), // id da conta no Zernio
  displayName:   varchar("displayName", { length: 255 }),
  phone:         varchar("phone", { length: 32 }),
  apiKey:        text("apiKey"),        // opcional; fallback para ZERNIO_API_KEY
  webhookSecret: text("webhookSecret"), // secret do webhook desta conta (multi-conta)
  assignedUserId: integer("assignedUserId"), // vendedor dono (vê só esta instância no inbox)
  active:        boolean("active").default(true).notNull(),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
  updatedAt:     timestamp("updatedAt").defaultNow().notNull(),
});

export type ZernioInstance = typeof zernioInstances.$inferSelect;
export type InsertZernioInstance = typeof zernioInstances.$inferInsert;

/**
 * Evolution conversations - chats from vendor WhatsApp numbers.
 */
export const evolutionConversations = pgTable("evolutionConversations", {
  id:                  serial("id").primaryKey(),
  instanceId:          integer("instanceId").notNull(),
  instanceName:        varchar("instanceName", { length: 100 }).notNull(),
  remoteJid:           varchar("remoteJid", { length: 100 }).notNull(),
  phone:               varchar("phone", { length: 32 }),
  contactName:         varchar("contactName", { length: 255 }),
  contactPhoto:        varchar("contactPhoto", { length: 512 }),
  lastMessageAt:       bigint("lastMessageAt", { mode: "number" }),
  lastMessagePreview:  varchar("lastMessagePreview", { length: 500 }),
  unreadCount:         integer("unreadCount").default(0).notNull(),
  status:              evolutionConvStatusEnum("status").default("open").notNull(),
  contactId:           integer("contactId"),
  leadStatus:          varchar("leadStatus", { length: 50 }),
  vehicleInterest:     varchar("vehicleInterest", { length: 255 }),
  notes:               text("notes"),
  tags:                jsonb("tags"),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().notNull(),
});

export type EvolutionConversation = typeof evolutionConversations.$inferSelect;
export type InsertEvolutionConversation = typeof evolutionConversations.$inferInsert;

/**
 * Evolution messages - messages from vendor WhatsApp numbers.
 */
export const evolutionMessages = pgTable("evolutionMessages", {
  id:           serial("id").primaryKey(),
  instanceId:   integer("instanceId").notNull(),
  instanceName: varchar("instanceName", { length: 100 }).notNull(),
  conversationId: integer("conversationId"),
  remoteJid:    varchar("remoteJid", { length: 100 }).notNull(),
  messageId:    varchar("messageId", { length: 255 }).unique(),
  content:      text("content"),
  messageType:  evolutionMsgTypeEnum("messageType").default("text").notNull(),
  mediaUrl:     varchar("mediaUrl", { length: 512 }),
  direction:    directionEnum("direction").notNull(),
  senderName:   varchar("senderName", { length: 255 }),
  status:       evolutionMsgStatusEnum("status").default("sent").notNull(),
  timestamp:    bigint("timestamp", { mode: "number" }).notNull(),
  rawPayload:   jsonb("rawPayload"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
});

export type EvolutionMessage = typeof evolutionMessages.$inferSelect;
export type InsertEvolutionMessage = typeof evolutionMessages.$inferInsert;

/**
 * WhatsApp Numbers — múltiplos números WhatsApp Cloud API (Meta oficial).
 */
export const whatsappNumbers = pgTable("whatsappNumbers", {
  id:             serial("id").primaryKey(),
  phoneNumberId:  varchar("phoneNumberId", { length: 64 }).notNull().unique(),
  wabaId:         varchar("wabaId", { length: 64 }),
  displayName:    varchar("displayName", { length: 255 }).notNull(),
  phoneDisplay:   varchar("phoneDisplay", { length: 32 }),
  accessToken:    text("accessToken"),
  sellerId:       integer("sellerId"),
  assignedUserId: integer("assignedUserId"),
  isActive:       boolean("isActive").default(true).notNull(),
  notes:          text("notes"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
});

export type WhatsappNumber = typeof whatsappNumbers.$inferSelect;
export type InsertWhatsappNumber = typeof whatsappNumbers.$inferInsert;

/**
 * WhatsApp Number Conversations — conversas dos números dos vendedores via Cloud API.
 */
export const whatsappNumberConversations = pgTable("whatsappNumberConversations", {
  id:                 serial("id").primaryKey(),
  whatsappNumberId:   integer("whatsappNumberId").notNull(),
  phoneNumberId:      varchar("phoneNumberId", { length: 64 }).notNull(),
  customerPhone:      varchar("customerPhone", { length: 32 }).notNull(),
  contactName:        varchar("contactName", { length: 255 }),
  contactPhoto:       varchar("contactPhoto", { length: 512 }),
  lastMessageAt:      bigint("lastMessageAt", { mode: "number" }),
  lastMessagePreview: varchar("lastMessagePreview", { length: 500 }),
  unreadCount:        integer("unreadCount").default(0).notNull(),
  status:             wnConvStatusEnum("wnConvStatus").default("open").notNull(),
  windowExpired:      boolean("windowExpired").default(false).notNull(),
  leadStatus:         varchar("leadStatus", { length: 50 }),
  vehicleInterest:    varchar("vehicleInterest", { length: 255 }),
  notes:              text("notes"),
  tags:               jsonb("tags"),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().notNull(),
});

export type WhatsappNumberConversation = typeof whatsappNumberConversations.$inferSelect;
export type InsertWhatsappNumberConversation = typeof whatsappNumberConversations.$inferInsert;

/**
 * WhatsApp Number Messages — mensagens das conversas dos vendedores via Cloud API.
 */
export const whatsappNumberMessages = pgTable("whatsappNumberMessages", {
  id:                serial("id").primaryKey(),
  whatsappNumberId:  integer("whatsappNumberId").notNull(),
  conversationId:    integer("conversationId").notNull(),
  externalMessageId: varchar("externalMessageId", { length: 255 }).unique(),
  content:           text("content"),
  messageType:       wnMsgTypeEnum("wnMsgType").default("text").notNull(),
  mediaUrl:          varchar("mediaUrl", { length: 512 }),
  direction:         wnDirectionEnum("wnDirection").notNull(),
  senderName:        varchar("senderName", { length: 255 }),
  status:            wnMsgStatusEnum("wnMsgStatus").default("sent").notNull(),
  timestamp:         bigint("timestamp", { mode: "number" }).notNull(),
  rawPayload:        jsonb("rawPayload"),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
});

export type WhatsappNumberMessage = typeof whatsappNumberMessages.$inferSelect;
export type InsertWhatsappNumberMessage = typeof whatsappNumberMessages.$inferInsert;

/**
 * Quick Replies — respostas prontas acionadas via "/" no composer do inbox.
 * Suporta variáveis: {{nome}}, {{telefone}}, {{atendente}}.
 */
export const quickReplies = pgTable("quickReplies", {
  id:        serial("id").primaryKey(),
  shortcut:  varchar("shortcut", { length: 50 }).notNull().unique(), // ex: "endereco"
  title:     varchar("title", { length: 100 }).notNull(),
  content:   text("content").notNull(),
  category:  varchar("category", { length: 50 }),
  createdBy: integer("createdBy"),
  usageCount: integer("usageCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type QuickReply = typeof quickReplies.$inferSelect;
export type InsertQuickReply = typeof quickReplies.$inferInsert;

/**
 * Labels — etiquetas coloridas aplicáveis a conversas.
 */
export const labels = pgTable("labels", {
  id:        serial("id").primaryKey(),
  name:      varchar("name", { length: 50 }).notNull().unique(),
  color:     varchar("color", { length: 7 }).notNull().default("#00a884"), // hex
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Label = typeof labels.$inferSelect;
export type InsertLabel = typeof labels.$inferInsert;

/**
 * Conversation Labels — junção conversa <-> etiqueta.
 */
export const conversationLabels = pgTable("conversationLabels", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  labelId:        integer("labelId").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type ConversationLabel = typeof conversationLabels.$inferSelect;
export type InsertConversationLabel = typeof conversationLabels.$inferInsert;

/**
 * Conversation Reminders — lembretes/snooze por conversa e atendente.
 */
export const conversationReminders = pgTable("conversationReminders", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  teamMemberId:   integer("teamMemberId").notNull(),
  note:           varchar("note", { length: 255 }),
  remindAt:       bigint("remindAt", { mode: "number" }).notNull(), // epoch ms
  status:         reminderStatusEnum("reminderStatus").default("pending").notNull(),
  firedAt:        timestamp("firedAt"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type ConversationReminder = typeof conversationReminders.$inferSelect;
export type InsertConversationReminder = typeof conversationReminders.$inferInsert;

/**
 * Scheduled Messages — mensagens individuais agendadas.
 * Se a janela de 24h expirar antes do disparo, usa fallbackTemplateName (se houver)
 * ou marca como failed e notifica o criador.
 */
export const scheduledMessages = pgTable("scheduledMessages", {
  id:                   serial("id").primaryKey(),
  conversationId:       integer("conversationId").notNull(),
  content:              text("content").notNull(),
  scheduledAt:          bigint("scheduledAt", { mode: "number" }).notNull(), // epoch ms
  status:               scheduledMsgStatusEnum("scheduledMsgStatus").default("pending").notNull(),
  fallbackTemplateName: varchar("fallbackTemplateName", { length: 255 }),
  error:                text("error"),
  createdBy:            integer("createdBy"),
  createdByName:        varchar("createdByName", { length: 255 }),
  sentAt:               timestamp("sentAt"),
  createdAt:            timestamp("createdAt").defaultNow().notNull(),
});

export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type InsertScheduledMessage = typeof scheduledMessages.$inferInsert;

/**
 * CAPI Events — log de eventos enviados à Meta Conversions API.
 * Dedupe: um evento por (leadId, eventName).
 */
export const capiEvents = pgTable("capiEvents", {
  id:             serial("id").primaryKey(),
  leadId:         integer("leadId"),          // null = conversão vinda do site (sem lead no CRM)
  conversationId: integer("conversationId"),
  eventName:      varchar("eventName", { length: 100 }).notNull(),
  funnelStatus:   varchar("funnelStatus", { length: 50 }),
  actionSource:   varchar("actionSource", { length: 50 }),        // business_messaging | website
  value:          numeric("value", { precision: 12, scale: 2 }),
  currency:       varchar("currency", { length: 3 }),
  status:         capiEventStatusEnum("capiEventStatus").default("sent").notNull(),
  error:          text("error"),
  fbtraceId:      varchar("fbtraceId", { length: 255 }),
  payload:        jsonb("payload"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type CapiEvent = typeof capiEvents.$inferSelect;
export type InsertCapiEvent = typeof capiEvents.$inferInsert;

/**
 * CSAT — avaliação de atendimento pós-resolução (nota 1 a 5).
 */
export const csatRatings = pgTable("csatRatings", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  teamMemberId:   integer("teamMemberId"), // atendente avaliado (assignedTo no momento da resolução)
  rating:         integer("rating"),       // 1-5
  status:         varchar("csatStatus", { length: 20 }).default("pending").notNull(), // pending|rated|expired
  requestedAt:    timestamp("requestedAt").defaultNow().notNull(),
  ratedAt:        timestamp("ratedAt"),
});

export type CsatRating = typeof csatRatings.$inferSelect;
export type InsertCsatRating = typeof csatRatings.$inferInsert;

/**
 * Conversation Insights — análise de IA da conversa (inteligência comercial).
 * Um registro por conversa (upsert), atualizado quando o gestor pede análise.
 */
export const conversationInsights = pgTable("conversationInsights", {
  id:              serial("id").primaryKey(),
  conversationId:  integer("conversationId").notNull().unique(),
  temperature:     varchar("temperature", { length: 15 }).notNull(), // frio|morno|quente|muito_quente
  score:           integer("score").default(0).notNull(),            // 0-100 probabilidade de fechar
  summary:         text("summary"),                                   // resumo do estágio da conversa
  buyingSignals:   jsonb("buyingSignals").$type<string[]>(),          // sinais de compra detectados
  objections:      jsonb("objections").$type<string[]>(),             // objeções/travas
  creditStatus:    varchar("creditStatus", { length: 200 }),          // situação de crédito/pagamento
  nextAction:      text("nextAction"),                                // próxima ação sugerida ao vendedor
  vehicleInterest: varchar("vehicleInterest", { length: 300 }),
  messageCount:    integer("messageCount").default(0).notNull(),      // nº de mensagens no momento da análise
  analyzedAt:      timestamp("analyzedAt").defaultNow().notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export type ConversationInsight = typeof conversationInsights.$inferSelect;
export type InsertConversationInsight = typeof conversationInsights.$inferInsert;

// ── Avaliação de vendedores/pré-vendedores (coaching IA) ─────────────────────
// Cada linha é uma "foto" da performance de um atendente num período/instância,
// com a nota composta (5 pilares), métricas e o parecer qualitativo da IA.
export const sellerEvaluations = pgTable("sellerEvaluations", {
  id:                 serial("id").primaryKey(),
  memberId:           integer("memberId").notNull(),                 // teamMembers.id
  instanceName:       varchar("instanceName", { length: 100 }),      // null = todas as instâncias
  periodDays:         integer("periodDays").default(30).notNull(),
  // Nota final e pilares (0-100)
  score:              integer("score").default(0).notNull(),
  conversionScore:    integer("conversionScore").default(0).notNull(),
  speedScore:         integer("speedScore").default(0).notNull(),
  conductScore:       integer("conductScore").default(0).notNull(),  // avaliado pela IA
  valueScore:         integer("valueScore").default(0).notNull(),
  activityScore:      integer("activityScore").default(0).notNull(),
  // Métricas brutas
  leadsReceived:      integer("leadsReceived").default(0).notNull(),
  leadsConverted:     integer("leadsConverted").default(0).notNull(),
  avgFirstResponseSec: integer("avgFirstResponseSec").default(0).notNull(),
  valueSoldCents:     bigint("valueSoldCents", { mode: "number" }).default(0).notNull(),
  leadsNoReply:       integer("leadsNoReply").default(0).notNull(),  // recebidos sem nenhuma resposta do vendedor
  // Parecer da IA
  summary:            text("summary"),
  strengths:          jsonb("strengths").$type<string[]>(),
  improvements:       jsonb("improvements").$type<string[]>(),
  tips:               jsonb("tips").$type<string[]>(),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
});

export type SellerEvaluation = typeof sellerEvaluations.$inferSelect;
export type InsertSellerEvaluation = typeof sellerEvaluations.$inferInsert;

export const knowledgeBase = pgTable("knowledgeBase", {
  id:          serial("id").primaryKey(),
  category:    varchar("category", { length: 100 }).notNull(),
  title:       varchar("title", { length: 255 }).notNull(),
  content:     text("content").notNull(),
  isActive:    boolean("isActive").default(true).notNull(),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
  updatedAt:   timestamp("updatedAt").defaultNow().notNull(),
});

export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeBase = typeof knowledgeBase.$inferInsert;

