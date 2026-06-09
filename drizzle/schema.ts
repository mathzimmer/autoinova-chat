import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, bigint, tinyint, decimal } from "drizzle-orm/mysql-core";


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
  contactPhoto: varchar("contactPhoto", { length: 512 }),
  channel: mysqlEnum("channel", ["whatsapp", "instagram", "facebook", "web", "webhook"]).default("whatsapp").notNull(),
  platformUserId: varchar("platformUserId", { length: 255 }),
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
  fullName: varchar("fullName", { length: 255 }),
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
  funnelStatus: mysqlEnum("funnelStatus", [
    "novo",                   // Acabou de chegar
    "interesse_definido",      // Demonstrou interesse em veículo
    "pagamento_definido",      // Definiu forma de pagamento
    "dados_pessoais",          // Enviou dados pessoais (CPF, nome completo, etc.)
    "dados_troca",             // Informou dados do veículo de troca
    "encaminhado_vendedor",    // Foi encaminhado para vendedor
    "negociando",              // Em negociação com vendedor
    "fechado",                 // Negócio fechado
    "perdido",                 // Lead perdido / desistiu
  ]).default("novo").notNull(),
  temperature: mysqlEnum("leadTemperature", ["frio", "morno", "quente", "muito_quente"]).default("frio").notNull(),
  score: int("score").default(0),
  city: varchar("city", { length: 255 }),
  email: varchar("email", { length: 320 }),
  cpf: varchar("cpf", { length: 14 }),
  birthDate: varchar("birthDate", { length: 10 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * Lead Summaries table - daily conversation summaries generated by AI.
 * Each entry represents a summary for a specific day of conversation.
 */
export const leadSummaries = mysqlTable("leadSummaries", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  conversationId: int("conversationId").notNull(),
  summaryDate: varchar("summaryDate", { length: 10 }).notNull(), // YYYY-MM-DD
  summary: text("summary").notNull(),
  messageCount: int("messageCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LeadSummary = typeof leadSummaries.$inferSelect;
export type InsertLeadSummary = typeof leadSummaries.$inferInsert;

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
  vehicleType: varchar("vehicleType", { length: 100 }),
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

/**
 * Vendor API Keys — chaves de acesso para vendedores externos.
 * Permite que vendedores usem uma extensão Chrome para acessar seus leads
 * via API autenticada por chave fixa (X-Vendor-Key header).
 */
export const vendorApiKeys = mysqlTable("vendorApiKeys", {
  id: int("id").autoincrement().primaryKey(),
  teamMemberId: int("teamMemberId").notNull(),
  apiKey: varchar("apiKey", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  active: boolean("active").default(true).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VendorApiKey = typeof vendorApiKeys.$inferSelect;
export type InsertVendorApiKey = typeof vendorApiKeys.$inferInsert;

/**
 * Chat Flows — fluxos de conversa programáveis estilo ManyChat.
 * Cada fluxo é um grafo de nós conectados por edges.
 */
export const chatFlows = mysqlTable("chatFlows", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  trigger: mysqlEnum("flowTrigger", [
    "first_contact",     // Primeiro contato do cliente
    "keyword",           // Palavra-chave detectada
    "button_click",      // Cliente clicou em botão específico
    "ad_click",          // Veio de anúncio (tem ID de veículo)
    "manual",            // Ativado manualmente pelo agente
    "reactivation",      // Cliente retorna após inatividade
    "category_interest", // Cliente pergunta sobre categoria
    "rescue",            // Gatilho de resgate (lead inativo por X minutos)
  ]).default("first_contact").notNull(),
  triggerValue: varchar("triggerValue", { length: 500 }), // Ex: palavra-chave, ID do botão
  active: boolean("active").default(false).notNull(),
  priority: int("priority").default(0).notNull(), // Maior = mais prioridade
  aiPrompt: text("aiPrompt"), // Prompt customizado para a IA dentro deste fluxo (legado, substituído por agentId)
  agentId: int("agentId"), // Referência ao agente de IA configurado para este fluxo
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatFlow = typeof chatFlows.$inferSelect;
export type InsertChatFlow = typeof chatFlows.$inferInsert;

/**
 * Chat Flow Nodes — nós individuais dentro de um fluxo.
 * Cada nó representa uma ação ou decisão na conversa.
 */
export const chatFlowNodes = mysqlTable("chatFlowNodes", {
  id: int("id").autoincrement().primaryKey(),
  flowId: int("flowId").notNull(),
  nodeType: mysqlEnum("nodeType", [
    "start",              // Nó inicial (1 por fluxo)
    "send_message",       // Enviar mensagem de texto
    "send_buttons",       // Enviar Reply Buttons (até 3)
    "send_list",          // Enviar List Message (até 10 itens)
    "send_image",         // Enviar imagem
    "condition",          // Condição (if/else baseado em dados do lead)
    "ai_response",        // Deixar a IA responder livremente
    "update_lead",        // Atualizar dados do lead
    "assign_agent",       // Transferir para agente humano
    "delay",              // Aguardar X segundos antes de continuar
    "wait_input",         // Aguardar resposta livre do cliente (texto)
    "end",                // Fim do fluxo
    "goto_flow",           // Ir para outro fluxo (subfluxo)
    "assign_seller",       // Atribuir vendedor da fila (rodízio por loja)
    "send_vehicle_photos", // Enviar fotos do veículo de interesse com legendas personalizáveis
    "vehicle_presentation", // Apresentação personalizada do veículo com dados do banco
    "update_lead_status",   // Atualizar status/temperatura do lead no funil
  ]).notNull(),
  label: varchar("label", { length: 255 }), // Nome visual do nó
  data: json("data").notNull(), // Configuração específica do tipo de nó (JSON)
  positionX: int("positionX").default(0).notNull(),
  positionY: int("positionY").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatFlowNode = typeof chatFlowNodes.$inferSelect;
export type InsertChatFlowNode = typeof chatFlowNodes.$inferInsert;

/**
 * Chat Flow Edges — conexões entre nós.
 * sourceHandle identifica qual saída do nó (ex: "button_1", "yes", "no", "default")
 */
export const chatFlowEdges = mysqlTable("chatFlowEdges", {
  id: int("id").autoincrement().primaryKey(),
  flowId: int("flowId").notNull(),
  sourceNodeId: int("sourceNodeId").notNull(),
  targetNodeId: int("targetNodeId").notNull(),
  sourceHandle: varchar("sourceHandle", { length: 100 }).default("default"), // "default", "button_0", "yes", "no"
  label: varchar("edgeLabel", { length: 255 }), // Label visual na seta
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatFlowEdge = typeof chatFlowEdges.$inferSelect;
export type InsertChatFlowEdge = typeof chatFlowEdges.$inferInsert;

/**
 * Chat Flow Sessions — rastreia em qual nó cada conversa está dentro de um fluxo.
 * Permite retomar o fluxo quando o cliente responde.
 */
export const chatFlowSessions = mysqlTable("chatFlowSessions", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  flowId: int("flowId").notNull(),
  currentNodeId: int("currentNodeId"),
  status: mysqlEnum("sessionStatus", ["active", "completed", "paused", "cancelled"]).default("active").notNull(),
  context: json("context"), // Dados coletados durante o fluxo
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatFlowSession = typeof chatFlowSessions.$inferSelect;
export type InsertChatFlowSession = typeof chatFlowSessions.$inferInsert;

/**
 * AI Agents — agentes de IA configuráveis com prompt, tools e modelo próprios.
 * Cada agente pode ser vinculado a fluxos ou canais específicos.
 * Sem agente global: se nenhum agente estiver configurado, a IA não responde.
 */
export const aiAgents = mysqlTable("aiAgents", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Prompt layers
  systemPrompt: text("systemPrompt").notNull(),           // Prompt principal do agente (personalidade + instruções)
  includeCoreLayers: boolean("includeCoreLayers").default(true).notNull(), // Se inclui CORE_PROMPT + COMMERCIAL_PROMPT
  // Model config
  model: varchar("model", { length: 100 }).default("gpt-4o-mini").notNull(),
  temperature: decimal("temperature", { precision: 2, scale: 1 }).default("0.7").notNull(),
  maxTokens: int("maxTokens").default(1024).notNull(),
  // Tools habilitadas (JSON array de nomes de tools)
  enabledTools: json("enabledTools").$type<string[]>(),   // ["buscar_veiculos", "atualizar_lead", ...]
  // Status
  active: boolean("active").default(true).notNull(),
  // Metadata
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiAgent = typeof aiAgents.$inferSelect;
export type InsertAiAgent = typeof aiAgents.$inferInsert;


/**
 * Sellers — vendedores cadastrados por loja.
 * Cada vendedor pertence a uma loja (storeLocation) e participa da fila de rodízio.
 */
export const sellers = mysqlTable("sellers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  photoUrl: text("photoUrl"), // URL da foto do vendedor (S3)
  storeLocation: varchar("storeLocation", { length: 200 }).notNull(), // "Auto Inova" ou "Auto Inova - Loja 2"
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(), // Ordem na fila de rodízio
  totalAssignments: int("totalAssignments").default(0).notNull(), // Total de atribuições (para métricas)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Seller = typeof sellers.$inferSelect;
export type InsertSeller = typeof sellers.$inferInsert;

/**
 * Seller Queues — controle de rodízio por loja.
 * Armazena o índice do próximo vendedor na fila para cada loja.
 */
export const sellerQueues = mysqlTable("sellerQueues", {
  id: int("id").autoincrement().primaryKey(),
  storeLocation: varchar("storeLocation", { length: 200 }).notNull().unique(),
  currentIndex: int("currentIndex").default(0).notNull(), // Índice do próximo vendedor
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SellerQueue = typeof sellerQueues.$inferSelect;
export type InsertSellerQueue = typeof sellerQueues.$inferInsert;

/**
 * Seller Assignments — histórico de atribuições de vendedores a conversas.
 * Registra cada vez que um vendedor é atribuído a um cliente via rodízio.
 */
export const sellerAssignments = mysqlTable("sellerAssignments", {
  id: int("id").autoincrement().primaryKey(),
  sellerId: int("sellerId").notNull(),
  conversationId: int("conversationId").notNull(),
  storeLocation: varchar("storeLocation", { length: 200 }).notNull(),
  vehicleId: int("vehicleId"), // Veículo que gerou o interesse
  customerPhone: varchar("customerPhone", { length: 32 }),
  customerName: varchar("customerName", { length: 255 }),
  status: mysqlEnum("sellerAssignmentStatus", ["pending", "contacted", "completed", "expired"]).default("pending").notNull(),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
  contactedAt: timestamp("contactedAt"),
  completedAt: timestamp("completedAt"),
});

export type SellerAssignment = typeof sellerAssignments.$inferSelect;
export type InsertSellerAssignment = typeof sellerAssignments.$inferInsert;

/**
 * Rescue Attempts — rastreia tentativas de resgate de leads inativos.
 * Quando um lead fica sem responder por X minutos, o sistema dispara um fluxo de resgate.
 */
export const rescueAttempts = mysqlTable("rescueAttempts", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  leadId: int("leadId").notNull(),
  flowId: int("flowId"),                  // Fluxo de resgate executado
  attemptNumber: int("attemptNumber").default(1).notNull(),
  status: mysqlEnum("rescueStatus", ["sent", "responded", "expired", "cancelled"]).default("sent").notNull(),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  respondedAt: timestamp("respondedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RescueAttempt = typeof rescueAttempts.$inferSelect;
export type InsertRescueAttempt = typeof rescueAttempts.$inferInsert;

/**
 * Contacts — agenda de contatos para marketing e envio de templates.
 * Contatos podem ser importados via Excel ou criados manualmente.
 */
export const contacts = mysqlTable("contacts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  email: varchar("email", { length: 320 }),
  tags: json("tags").$type<string[]>(),          // Tags para segmentação (ex: ["vip", "troca", "financiamento"])
  notes: text("notes"),                           // Notas sobre o contato
  source: mysqlEnum("contactSource", ["manual", "excel", "whatsapp", "lead"]).default("manual").notNull(),
  conversationId: int("conversationId"),          // Vínculo com conversa existente (se houver)
  leadId: int("leadId"),                          // Vínculo com lead existente (se houver)
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;

/**
 * Template Sends — histórico de envios de templates de marketing para contatos.
 */
export const templateSends = mysqlTable("templateSends", {
  id: int("id").autoincrement().primaryKey(),
  contactId: int("contactId").notNull(),
  templateName: varchar("templateName", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  status: mysqlEnum("templateSendStatus", ["pending", "sent", "delivered", "read", "failed"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  sentBy: int("sentBy"),
});

export type TemplateSend = typeof templateSends.$inferSelect;
export type InsertTemplateSend = typeof templateSends.$inferInsert;


/**
 * Campaigns — campanhas de envio em massa de templates WhatsApp.
 * Cada campanha define: template a enviar, contatos selecionados, agendamento recorrente,
 * fluxo a acionar quando cliente responde, e tag para controle das conversas criadas.
 */
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Template WhatsApp
  templateName: varchar("templateName", { length: 255 }).notNull(),
  templateLanguage: varchar("templateLanguage", { length: 10 }).default("pt_BR").notNull(),
  bodyParams: json("bodyParams").$type<string[]>(),  // Parâmetros do body do template
  // Seleção de contatos
  contactIds: json("contactIds").$type<number[]>(),  // IDs dos contatos selecionados
  filterTags: json("filterTags").$type<string[]>(),  // Tags para filtrar contatos (alternativa a IDs)
  // Agendamento
  scheduleType: mysqlEnum("scheduleType", ["once", "recurring"]).default("once").notNull(),
  scheduledAt: bigint("scheduledAt", { mode: "number" }),  // Timestamp para envio único ou próximo envio
  intervalDays: int("intervalDays"),  // Intervalo em dias para recorrente (ex: 7 = semanal)
  lastRunAt: bigint("lastRunAt", { mode: "number" }),  // Último envio executado
  nextRunAt: bigint("nextRunAt", { mode: "number" }),  // Próximo envio agendado
  // Fluxo de resposta
  responseFlowId: int("responseFlowId"),  // Fluxo a acionar quando cliente responde ao disparo
  // Tag de controle
  conversationTag: varchar("conversationTag", { length: 100 }),  // Tag aplicada às conversas criadas pelo disparo
  // Status
  status: mysqlEnum("campaignStatus", ["draft", "scheduled", "running", "paused", "completed"]).default("draft").notNull(),
  totalContacts: int("totalContacts").default(0).notNull(),
  // Metadata
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

/**
 * Campaign Dispatches — registro individual de cada envio dentro de uma campanha.
 * Rastreia status de entrega por contato (enviado, entregue, lido, falhou, respondido).
 */
export const campaignDispatches = mysqlTable("campaignDispatches", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  contactId: int("contactId").notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  contactName: varchar("contactName", { length: 255 }),
  // Status de entrega
  status: mysqlEnum("dispatchStatus", ["pending", "sent", "delivered", "read", "failed", "responded"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  whatsappMessageId: varchar("whatsappMessageId", { length: 255 }),  // wamid para rastreamento
  // Timestamps
  sentAt: timestamp("sentAt"),
  deliveredAt: timestamp("deliveredAt"),
  readAt: timestamp("readAt"),
  respondedAt: timestamp("respondedAt"),
  // Metadata
  runNumber: int("runNumber").default(1).notNull(),  // Número da execução (para campanhas recorrentes)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CampaignDispatch = typeof campaignDispatches.$inferSelect;
export type InsertCampaignDispatch = typeof campaignDispatches.$inferInsert;

/**
 * Evolution API instances - each instance = one WhatsApp number (vendor/seller)
 */
export const evolutionInstances = mysqlTable("evolutionInstances", {
  id: int("id").autoincrement().primaryKey(),
  instanceName: varchar("instanceName", { length: 100 }).notNull().unique(),
  displayName: varchar("displayName", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  sellerId: int("sellerId"),          // linked seller (optional)
  assignedUserId: int("assignedUserId"), // linked system user (optional)
  status: mysqlEnum("status", ["connecting", "connected", "disconnected", "qr_code"]).default("disconnected").notNull(),
  qrCode: text("qrCode"),             // base64 QR code when connecting
  profilePicUrl: varchar("profilePicUrl", { length: 512 }),
  webhookConfigured: boolean("webhookConfigured").default(false).notNull(),
  lastConnectedAt: bigint("lastConnectedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EvolutionInstance = typeof evolutionInstances.$inferSelect;
export type InsertEvolutionInstance = typeof evolutionInstances.$inferInsert;

/**
 * Evolution conversations - chats from vendor WhatsApp numbers
 */
export const evolutionConversations = mysqlTable("evolutionConversations", {
  id: int("id").autoincrement().primaryKey(),
  instanceId: int("instanceId").notNull(),
  instanceName: varchar("instanceName", { length: 100 }).notNull(),
  remoteJid: varchar("remoteJid", { length: 100 }).notNull(), // phone@s.whatsapp.net
  phone: varchar("phone", { length: 32 }),
  contactName: varchar("contactName", { length: 255 }),
  contactPhoto: varchar("contactPhoto", { length: 512 }),
  lastMessageAt: bigint("lastMessageAt", { mode: "number" }),
  lastMessagePreview: varchar("lastMessagePreview", { length: 500 }),
  unreadCount: int("unreadCount").default(0).notNull(),
  status: mysqlEnum("status", ["open", "pending", "resolved", "closed"]).default("open").notNull(),
  // CRM fields
  contactId: int("contactId"),  // FK -> contacts (vinculação automática)
  leadStatus: varchar("leadStatus", { length: 50 }),
  vehicleInterest: varchar("vehicleInterest", { length: 255 }),
  notes: text("notes"),
  tags: json("tags"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EvolutionConversation = typeof evolutionConversations.$inferSelect;
export type InsertEvolutionConversation = typeof evolutionConversations.$inferInsert;

/**
 * Evolution messages - messages from vendor WhatsApp numbers
 */
export const evolutionMessages = mysqlTable("evolutionMessages", {
  id: int("id").autoincrement().primaryKey(),
  instanceId: int("instanceId").notNull(),
  instanceName: varchar("instanceName", { length: 100 }).notNull(),
  conversationId: int("conversationId"),
  remoteJid: varchar("remoteJid", { length: 100 }).notNull(),
  messageId: varchar("messageId", { length: 255 }).unique(), // WhatsApp message ID
  content: text("content"),
  messageType: mysqlEnum("messageType", ["text", "audio", "image", "document", "video", "sticker", "reaction", "system"]).default("text").notNull(),
  mediaUrl: varchar("mediaUrl", { length: 512 }),
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull(),
  senderName: varchar("senderName", { length: 255 }),
  status: mysqlEnum("status", ["sent", "delivered", "read", "failed"]).default("sent").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  rawPayload: json("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EvolutionMessage = typeof evolutionMessages.$inferSelect;
export type InsertEvolutionMessage = typeof evolutionMessages.$inferInsert;

/**
 * WhatsApp Numbers — múltiplos números WhatsApp Cloud API (Meta oficial).
 * Cada linha representa um número verificado na WABA do cliente.
 * Substitui evolutionInstances para o inbox dos vendedores.
 */
export const whatsappNumbers = mysqlTable("whatsappNumbers", {
  id: int("id").autoincrement().primaryKey(),
  phoneNumberId: varchar("phoneNumberId", { length: 64 }).notNull().unique(), // Meta phone_number_id
  displayName: varchar("displayName", { length: 255 }).notNull(),             // Nome amigável (ex: "Vendedor João")
  phoneDisplay: varchar("phoneDisplay", { length: 32 }),                      // Número formatado (ex: +55 51 99999-9999)
  accessToken: text("accessToken"),                                            // Token específico do número (opcional — usa WHATSAPP_SYSTEM_USER_TOKEN se null)
  sellerId: int("sellerId"),                                                   // Vendedor responsável (tabela sellers)
  assignedUserId: int("assignedUserId"),                                       // Usuário do sistema responsável (tabela teamMembers)
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),                                                        // Observações internas
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type WhatsappNumber = typeof whatsappNumbers.$inferSelect;
export type InsertWhatsappNumber = typeof whatsappNumbers.$inferInsert;

/**
 * WhatsApp Number Conversations — conversas dos números dos vendedores via Cloud API.
 * Similar a evolutionConversations mas usando Cloud API oficial (sem @lid).
 */
export const whatsappNumberConversations = mysqlTable("whatsappNumberConversations", {
  id: int("id").autoincrement().primaryKey(),
  whatsappNumberId: int("whatsappNumberId").notNull(),  // FK -> whatsappNumbers
  phoneNumberId: varchar("phoneNumberId", { length: 64 }).notNull(),  // Meta phone_number_id (denormalized for fast lookup)
  customerPhone: varchar("customerPhone", { length: 32 }).notNull(),  // Número real do cliente (sempre disponível via Cloud API)
  contactName: varchar("contactName", { length: 255 }),
  contactPhoto: varchar("contactPhoto", { length: 512 }),
  lastMessageAt: bigint("lastMessageAt", { mode: "number" }),
  lastMessagePreview: varchar("lastMessagePreview", { length: 500 }),
  unreadCount: int("unreadCount").default(0).notNull(),
  status: mysqlEnum("wnConvStatus", ["open", "pending", "resolved", "closed"]).default("open").notNull(),
  windowExpired: boolean("windowExpired").default(false).notNull(),  // 24h window expired
  // CRM fields
  leadStatus: varchar("leadStatus", { length: 50 }),
  vehicleInterest: varchar("vehicleInterest", { length: 255 }),
  notes: text("notes"),
  tags: json("tags"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type WhatsappNumberConversation = typeof whatsappNumberConversations.$inferSelect;
export type InsertWhatsappNumberConversation = typeof whatsappNumberConversations.$inferInsert;

/**
 * WhatsApp Number Messages — mensagens das conversas dos vendedores via Cloud API.
 */
export const whatsappNumberMessages = mysqlTable("whatsappNumberMessages", {
  id: int("id").autoincrement().primaryKey(),
  whatsappNumberId: int("whatsappNumberId").notNull(),
  conversationId: int("conversationId").notNull(),
  externalMessageId: varchar("externalMessageId", { length: 255 }).unique(), // wamid
  content: text("content"),
  messageType: mysqlEnum("wnMsgType", ["text", "audio", "image", "document", "video", "sticker", "reaction", "system"]).default("text").notNull(),
  mediaUrl: varchar("mediaUrl", { length: 512 }),
  direction: mysqlEnum("wnDirection", ["inbound", "outbound"]).notNull(),
  senderName: varchar("senderName", { length: 255 }),
  status: mysqlEnum("wnMsgStatus", ["sent", "delivered", "read", "failed"]).default("sent").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  rawPayload: json("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WhatsappNumberMessage = typeof whatsappNumberMessages.$inferSelect;
export type InsertWhatsappNumberMessage = typeof whatsappNumberMessages.$inferInsert;
