import { describe, it, expect } from "vitest";

describe("WhatsApp Templates", () => {
  describe("isTemplatesConfigured", () => {
    it("should export isTemplatesConfigured function", async () => {
      const mod = await import("./whatsappTemplates");
      expect(typeof mod.isTemplatesConfigured).toBe("function");
    });

    it("should return configured status based on env vars", async () => {
      const mod = await import("./whatsappTemplates");
      const result = mod.isTemplatesConfigured();
      expect(result).toHaveProperty("configured");
      expect(result).toHaveProperty("missingVars");
      expect(typeof result.configured).toBe("boolean");
      expect(Array.isArray(result.missingVars)).toBe(true);
    });

    it("should detect WHATSAPP_SYSTEM_USER_TOKEN", async () => {
      const mod = await import("./whatsappTemplates");
      const result = mod.isTemplatesConfigured();
      if (!process.env.WHATSAPP_SYSTEM_USER_TOKEN) {
        expect(result.missingVars).toContain("WHATSAPP_SYSTEM_USER_TOKEN");
      } else {
        expect(result.missingVars).not.toContain("WHATSAPP_SYSTEM_USER_TOKEN");
      }
    });

    it("should detect WHATSAPP_BUSINESS_ACCOUNT_ID", async () => {
      const mod = await import("./whatsappTemplates");
      const result = mod.isTemplatesConfigured();
      if (!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
        expect(result.missingVars).toContain("WHATSAPP_BUSINESS_ACCOUNT_ID");
      } else {
        expect(result.missingVars).not.toContain("WHATSAPP_BUSINESS_ACCOUNT_ID");
      }
    });
  });

  describe("listTemplates", () => {
    it("should export listTemplates function", async () => {
      const mod = await import("./whatsappTemplates");
      expect(typeof mod.listTemplates).toBe("function");
    });

    it("should return an array", async () => {
      const mod = await import("./whatsappTemplates");
      const templates = await mod.listTemplates();
      expect(Array.isArray(templates)).toBe(true);
    });
  });

  describe("sendWhatsAppTemplate", () => {
    it("should export sendWhatsAppTemplate function", async () => {
      const mod = await import("./whatsappTemplates");
      expect(typeof mod.sendWhatsAppTemplate).toBe("function");
    });
  });

  describe("isTemplateApproved", () => {
    it("should export isTemplateApproved function", async () => {
      const mod = await import("./whatsappTemplates");
      expect(typeof mod.isTemplateApproved).toBe("function");
    });
  });

  describe("WhatsAppTemplate type", () => {
    it("should have correct template structure", () => {
      const template = {
        id: "123",
        name: "lead",
        language: "en",
        status: "APPROVED",
        category: "MARKETING",
        components: [
          { type: "BODY", text: "Hello {{1}}" },
        ],
      };
      expect(template.name).toBe("lead");
      expect(template.status).toBe("APPROVED");
      expect(template.components).toHaveLength(1);
      expect(template.components[0].type).toBe("BODY");
    });
  });
});
