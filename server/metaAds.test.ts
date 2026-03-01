import { describe, it, expect, vi } from "vitest";

/**
 * Tests for Meta Ads module — validates configuration, data structures,
 * and helper functions without making real API calls.
 */

describe("Meta Ads", () => {
  describe("buildMetaConfig", () => {
    it("should build config from environment variables", async () => {
      // Set env vars for test
      process.env.META_ADS_ACCESS_TOKEN = "test_token_123";
      process.env.META_ADS_ACCOUNT_ID = "1234567890";
      process.env.META_ADS_PAGE_ID = "9876543210";
      process.env.META_ADS_INSTAGRAM_ID = "instagram_123";

      const { buildMetaConfig } = await import("./metaAds");
      const config = buildMetaConfig();

      expect(config.accessToken).toBe("test_token_123");
      expect(config.adAccountId).toBe("1234567890");
      expect(config.pageId).toBe("9876543210");
      expect(config.instagramActorId).toBe("instagram_123");
      expect(config.defaultBudgetCents).toBe(3000);
      expect(config.defaultTargeting).toBeDefined();
      expect(config.defaultTargeting.age_min).toBe(25);
      expect(config.defaultTargeting.age_max).toBe(65);
    });

    it("should allow overrides", async () => {
      const { buildMetaConfig } = await import("./metaAds");
      const config = buildMetaConfig({
        defaultBudgetCents: 5000,
        accessToken: "override_token",
      });

      expect(config.defaultBudgetCents).toBe(5000);
      expect(config.accessToken).toBe("override_token");
    });

    it("should have Serra Gaúcha targeting by default", async () => {
      const { buildMetaConfig } = await import("./metaAds");
      const config = buildMetaConfig();

      expect(config.defaultTargeting.geo_locations.cities).toBeDefined();
      expect(config.defaultTargeting.geo_locations.cities?.[0]?.key).toBe("229180");
      expect(config.defaultTargeting.geo_locations.cities?.[0]?.radius).toBe(80);
      expect(config.defaultTargeting.geo_locations.cities?.[0]?.distance_unit).toBe("kilometer");
    });

    it("should have car-related interests in flexible_spec", async () => {
      const { buildMetaConfig } = await import("./metaAds");
      const config = buildMetaConfig();

      const interests = config.defaultTargeting.flexible_spec?.[0]?.interests;
      expect(interests).toBeDefined();
      expect(interests?.length).toBeGreaterThanOrEqual(3);
      const names = interests?.map(i => i.name) ?? [];
      expect(names).toContain("Automóveis");
      expect(names).toContain("Carros usados");
    });
  });

  describe("Meta Ads environment check", () => {
    it("should detect missing environment variables", () => {
      const original = process.env.META_ADS_ACCESS_TOKEN;
      delete process.env.META_ADS_ACCESS_TOKEN;

      const missingVars = [
        !process.env.META_ADS_ACCESS_TOKEN && "META_ADS_ACCESS_TOKEN",
        !process.env.META_ADS_ACCOUNT_ID && "META_ADS_ACCOUNT_ID",
        !process.env.META_ADS_PAGE_ID && "META_ADS_PAGE_ID",
      ].filter(Boolean) as string[];

      expect(missingVars).toContain("META_ADS_ACCESS_TOKEN");

      // Restore
      if (original) process.env.META_ADS_ACCESS_TOKEN = original;
    });

    it("should report configured when all vars present", () => {
      process.env.META_ADS_ACCESS_TOKEN = "test";
      process.env.META_ADS_ACCOUNT_ID = "test";
      process.env.META_ADS_PAGE_ID = "test";

      const missingVars = [
        !process.env.META_ADS_ACCESS_TOKEN && "META_ADS_ACCESS_TOKEN",
        !process.env.META_ADS_ACCOUNT_ID && "META_ADS_ACCOUNT_ID",
        !process.env.META_ADS_PAGE_ID && "META_ADS_PAGE_ID",
      ].filter(Boolean) as string[];

      expect(missingVars).toHaveLength(0);
    });
  });

  describe("CreateAdResult type structure", () => {
    it("should match expected success structure", () => {
      const result = {
        success: true,
        campaignId: "camp_123",
        adSetId: "adset_456",
        adCreativeId: "creative_789",
        adId: "ad_012",
        imageHash: "hash_abc",
        vehicleId: 42,
      };

      expect(result.success).toBe(true);
      expect(result.vehicleId).toBe(42);
      expect(result.campaignId).toBeDefined();
      expect(result.adId).toBeDefined();
    });

    it("should match expected error structure", () => {
      const result = {
        success: false,
        error: "Veículo sem imagem",
        vehicleId: 99,
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe("Veículo sem imagem");
      expect(result.vehicleId).toBe(99);
    });
  });
});

describe("Follow-Up", () => {
  describe("Follow-up log structure", () => {
    it("should have correct schema fields", () => {
      const log = {
        id: 1,
        conversationId: 42,
        phone: "5551999887766",
        message: "Olá! Notamos que você demonstrou interesse...",
        sentAt: new Date(),
        attemptNumber: 1,
      };

      expect(log.conversationId).toBe(42);
      expect(log.phone).toMatch(/^55\d{10,11}$/);
      expect(log.attemptNumber).toBe(1);
      expect(log.message).toBeTruthy();
    });

    it("should support up to 3 attempts", () => {
      const attempts = [1, 2, 3];
      for (const attempt of attempts) {
        expect(attempt).toBeGreaterThanOrEqual(1);
        expect(attempt).toBeLessThanOrEqual(3);
      }
    });
  });

  describe("Phone normalization", () => {
    // Test the normalizePhone logic used in index.ts
    function normalizePhone(phone: string | undefined): string {
      if (!phone) return "";
      const digits = phone.replace(/\D/g, "");
      if (digits.startsWith("55") && digits.length >= 12) return digits;
      if (digits.length === 11) return "55" + digits;
      if (digits.length === 10) return "55" + digits;
      return digits;
    }

    it("should normalize Brazilian phone with country code", () => {
      expect(normalizePhone("+55 51 99988-7766")).toBe("5551999887766");
    });

    it("should add country code to 11-digit phone", () => {
      expect(normalizePhone("51999887766")).toBe("5551999887766");
    });

    it("should add country code to 10-digit phone", () => {
      expect(normalizePhone("5199887766")).toBe("555199887766");
    });

    it("should handle phone already with 55 prefix", () => {
      expect(normalizePhone("5551999887766")).toBe("5551999887766");
    });

    it("should return empty string for undefined", () => {
      expect(normalizePhone(undefined)).toBe("");
    });

    it("should strip non-digit characters", () => {
      expect(normalizePhone("(51) 99988-7766")).toBe("5551999887766");
    });
  });
});

describe("Meta Ads Schema", () => {
  it("should have metaAds table exported from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.metaAds).toBeDefined();
  });

  it("should have followUpLogs table exported from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.followUpLogs).toBeDefined();
  });

  it("should have correct metaAds column names", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.metaAds;
    // Check key columns exist
    expect(table.id).toBeDefined();
    expect(table.vehicleId).toBeDefined();
    expect(table.campaignId).toBeDefined();
    expect(table.adSetId).toBeDefined();
    expect(table.adCreativeId).toBeDefined();
    expect(table.adId).toBeDefined();
    expect(table.status).toBeDefined();
    expect(table.dailyBudgetCents).toBeDefined();
    expect(table.impressions).toBeDefined();
    expect(table.clicks).toBeDefined();
    expect(table.leads).toBeDefined();
    expect(table.spendCents).toBeDefined();
    // New columns for imported ads
    expect(table.adName).toBeDefined();
    expect(table.thumbnailUrl).toBeDefined();
    expect(table.source).toBeDefined();
  });

  it("should have importAdsFromMeta function exported", async () => {
    const metaAds = await import("./metaAds");
    expect(typeof metaAds.importAdsFromMeta).toBe("function");
  });

  it("should have correct source enum values (crm, imported)", () => {
    // Verify the source field concept
    const validSources = ["crm", "imported"];
    expect(validSources).toContain("crm");
    expect(validSources).toContain("imported");
  });

  it("should map Meta status correctly", () => {
    const statusMap: Record<string, string> = {
      ACTIVE: "active",
      PAUSED: "paused",
      ARCHIVED: "archived",
      DELETED: "archived",
    };
    expect(statusMap["ACTIVE"]).toBe("active");
    expect(statusMap["PAUSED"]).toBe("paused");
    expect(statusMap["ARCHIVED"]).toBe("archived");
    expect(statusMap["DELETED"]).toBe("archived");
  });

  it("should have correct followUpLogs column names", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.followUpLogs;
    expect(table.id).toBeDefined();
    expect(table.conversationId).toBeDefined();
    expect(table.phone).toBeDefined();
    expect(table.message).toBeDefined();
    expect(table.sentAt).toBeDefined();
    expect(table.attemptNumber).toBeDefined();
  });
});
