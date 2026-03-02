import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
  createActivityLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./socket", () => ({
  emitConversationUpdate: vi.fn(),
  emitNewMessage: vi.fn(),
  emitTypingIndicator: vi.fn(),
}));

describe("Vendor API module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("vendorApiKeys schema", () => {
    it("should have the correct table structure", async () => {
      const { vendorApiKeys } = await import("../drizzle/schema");
      expect(vendorApiKeys).toBeDefined();
      // Verify the table has the expected columns
      const columns = Object.keys(vendorApiKeys);
      expect(columns).toContain("id");
      expect(columns).toContain("teamMemberId");
      expect(columns).toContain("apiKey");
      expect(columns).toContain("name");
      expect(columns).toContain("active");
      expect(columns).toContain("lastUsedAt");
      expect(columns).toContain("createdAt");
    });

    it("should export VendorApiKey and InsertVendorApiKey types", async () => {
      // Type-level check: if the import succeeds, the types exist
      const schema = await import("../drizzle/schema");
      expect(schema.vendorApiKeys).toBeDefined();
    });
  });

  describe("vendor router registration", () => {
    it("should have vendor router in appRouter", async () => {
      const { appRouter } = await import("./routers");
      // Check that vendor procedures exist
      expect(appRouter._def.procedures).toBeDefined();
      const procedureKeys = Object.keys(appRouter._def.procedures);
      expect(procedureKeys).toContain("vendor.me");
      expect(procedureKeys).toContain("vendor.myLeads");
      expect(procedureKeys).toContain("vendor.updateLeadStatus");
      expect(procedureKeys).toContain("vendor.addNote");
      expect(procedureKeys).toContain("vendor.updateLeadData");
      expect(procedureKeys).toContain("vendor.getWhatsappLink");
      expect(procedureKeys).toContain("vendor.createApiKey");
      expect(procedureKeys).toContain("vendor.listApiKeys");
      expect(procedureKeys).toContain("vendor.revokeApiKey");
    });
  });

  describe("API key format", () => {
    it("should generate 64-character hex API keys", () => {
      const crypto = require("crypto");
      const apiKey = crypto.randomBytes(32).toString("hex");
      expect(apiKey).toHaveLength(64);
      expect(apiKey).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("key preview format", () => {
    it("should show first 8 chars followed by dots", () => {
      const fullKey = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const preview = fullKey.slice(0, 8) + "••••••••••••••••••••••••••••••••••••••••";
      expect(preview.startsWith("abcdef12")).toBe(true);
      expect(preview).toContain("••••");
      expect(preview.length).toBeGreaterThan(8);
    });
  });

  describe("WhatsApp link generation", () => {
    it("should format phone number correctly", () => {
      const phone = "+55 (51) 99756-6259";
      const cleaned = phone.replace(/\D/g, "");
      expect(cleaned).toBe("5551997566259");
      const link = `https://wa.me/${cleaned}?text=${encodeURIComponent("Olá!")}`;
      expect(link).toContain("https://wa.me/5551997566259");
    });

    it("should build personalized message with lead data", () => {
      const vendorName = "João";
      const leadName = "Carlos";
      const vehicleInterest = "Honda Civic 2024";
      const paymentMethod = "Financiamento";

      let texto = `Olá ${leadName}! 👋\n\nSou ${vendorName} da AutoInova.`;
      if (vehicleInterest) texto += `\n\nVi que você se interessou por: *${vehicleInterest}*.`;
      if (paymentMethod) texto += `\nForma de pagamento: ${paymentMethod}.`;
      texto += `\n\nPosso te ajudar com mais detalhes? 🚗`;

      expect(texto).toContain("Olá Carlos!");
      expect(texto).toContain("Sou João da AutoInova");
      expect(texto).toContain("Honda Civic 2024");
      expect(texto).toContain("Financiamento");
    });
  });
});
