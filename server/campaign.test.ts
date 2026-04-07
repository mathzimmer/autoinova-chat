import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@autoinova.com",
    name: "Admin",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("Campaign Router", () => {
  describe("campaign.list", () => {
    it("returns campaign list for admin", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.campaign.list({});
      expect(result).toBeDefined();
      expect(result).toHaveProperty("campaigns");
      expect(Array.isArray(result.campaigns)).toBe(true);
    });

    it("rejects unauthenticated users", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.campaign.list({})).rejects.toThrow();
    });
  });

  describe("campaign.create", () => {
    it("creates a campaign with valid input", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.campaign.create({
        name: "Test Campaign " + Date.now(),
        templateName: "test_template",
        templateLanguage: "pt_BR",
        scheduleType: "once",
        contactIds: [],
        conversationTag: "test-tag",
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty("id");
    });

    it("rejects empty campaign name", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.campaign.create({
          name: "",
          templateName: "test_template",
        })
      ).rejects.toThrow();
    });

    it("rejects empty template name", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.campaign.create({
          name: "Test",
          templateName: "",
        })
      ).rejects.toThrow();
    });
  });

  describe("campaign.getById", () => {
    it("returns a campaign by ID", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      // First create one
      const created = await caller.campaign.create({
        name: "GetById Test " + Date.now(),
        templateName: "test_template",
        scheduleType: "once",
      });

      const campaign = await caller.campaign.getById({ id: created.id });
      expect(campaign).toBeDefined();
      expect(campaign.name).toContain("GetById Test");
      expect(campaign.templateName).toBe("test_template");
    });

    it("throws for non-existent campaign", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.campaign.getById({ id: 999999 })
      ).rejects.toThrow("Campanha não encontrada");
    });
  });

  describe("campaign.update", () => {
    it("updates campaign fields", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.campaign.create({
        name: "Update Test " + Date.now(),
        templateName: "test_template",
      });

      await caller.campaign.update({
        id: created.id,
        name: "Updated Name",
        description: "Updated description",
        conversationTag: "updated-tag",
      });

      const updated = await caller.campaign.getById({ id: created.id });
      expect(updated.name).toBe("Updated Name");
      expect(updated.description).toBe("Updated description");
      expect(updated.conversationTag).toBe("updated-tag");
    });
  });

  describe("campaign.delete", () => {
    it("deletes a campaign", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.campaign.create({
        name: "Delete Test " + Date.now(),
        templateName: "test_template",
      });

      const result = await caller.campaign.delete({ id: created.id });
      expect(result.success).toBe(true);

      await expect(
        caller.campaign.getById({ id: created.id })
      ).rejects.toThrow("Campanha não encontrada");
    });
  });

  describe("campaign.schedule", () => {
    it("schedules a campaign", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.campaign.create({
        name: "Schedule Test " + Date.now(),
        templateName: "test_template",
      });

      const futureDate = Date.now() + 86400000; // +1 day
      await caller.campaign.schedule({
        id: created.id,
        scheduledAt: futureDate,
        intervalDays: 7,
      });

      const updated = await caller.campaign.getById({ id: created.id });
      expect(updated.status).toBe("scheduled");
      expect(updated.scheduleType).toBe("recurring");
    });
  });

  describe("campaign.pause", () => {
    it("pauses a scheduled campaign", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.campaign.create({
        name: "Pause Test " + Date.now(),
        templateName: "test_template",
      });

      // Schedule it first
      await caller.campaign.schedule({
        id: created.id,
        scheduledAt: Date.now() + 86400000,
      });

      // Pause it
      await caller.campaign.pause({ id: created.id });

      const updated = await caller.campaign.getById({ id: created.id });
      expect(updated.status).toBe("paused");
    });
  });

  describe("campaign.dispatches", () => {
    it("returns dispatch list for a campaign", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.campaign.create({
        name: "Dispatches Test " + Date.now(),
        templateName: "test_template",
      });

      const result = await caller.campaign.dispatches({ campaignId: created.id });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("dispatches");
      expect(Array.isArray(result.dispatches)).toBe(true);
    });
  });

  describe("campaign.stats", () => {
    it("returns stats for a campaign", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.campaign.create({
        name: "Stats Test " + Date.now(),
        templateName: "test_template",
      });

      const stats = await caller.campaign.stats({ campaignId: created.id });
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("sent");
      expect(stats).toHaveProperty("delivered");
      expect(stats).toHaveProperty("read");
      expect(stats).toHaveProperty("responded");
      expect(stats).toHaveProperty("failed");
      expect(stats.total).toBe(0);
    });
  });

  describe("campaign.availableFlows", () => {
    it("returns list of available flows", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const flows = await caller.campaign.availableFlows();
      expect(Array.isArray(flows)).toBe(true);
    });
  });
});

describe("Campaign Service - handleCampaignDeliveryStatus", () => {
  it("exports handleCampaignDeliveryStatus function", async () => {
    const { handleCampaignDeliveryStatus } = await import("./campaignService");
    expect(typeof handleCampaignDeliveryStatus).toBe("function");
  });

  it("returns false for unknown wamid", async () => {
    const { handleCampaignDeliveryStatus } = await import("./campaignService");
    const result = await handleCampaignDeliveryStatus("wamid_nonexistent_12345", "delivered");
    expect(result).toBe(false);
  });
});

describe("Campaign Service - handleCampaignResponse", () => {
  it("exports handleCampaignResponse function", async () => {
    const { handleCampaignResponse } = await import("./campaignService");
    expect(typeof handleCampaignResponse).toBe("function");
  });

  it("returns null for unknown phone", async () => {
    const { handleCampaignResponse } = await import("./campaignService");
    const result = await handleCampaignResponse("5500000000000");
    expect(result).toBeNull();
  });
});

describe("Campaign Service - Scheduler", () => {
  it("exports startCampaignScheduler function", async () => {
    const { startCampaignScheduler } = await import("./campaignService");
    expect(typeof startCampaignScheduler).toBe("function");
  });

  it("exports stopCampaignScheduler function", async () => {
    const { stopCampaignScheduler } = await import("./campaignService");
    expect(typeof stopCampaignScheduler).toBe("function");
  });

  it("exports checkScheduledCampaigns function", async () => {
    const { checkScheduledCampaigns } = await import("./campaignService");
    expect(typeof checkScheduledCampaigns).toBe("function");
  });
});

describe("Campaign Schema", () => {
  it("has campaigns table in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.campaigns).toBeDefined();
  });

  it("has campaignDispatches table in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.campaignDispatches).toBeDefined();
  });

  it("campaigns table has required columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.campaigns;
    // Check column existence via the table config
    expect(table.name).toBeDefined();
    expect(table.templateName).toBeDefined();
    expect(table.status).toBeDefined();
    expect(table.scheduleType).toBeDefined();
    expect(table.intervalDays).toBeDefined();
    expect(table.responseFlowId).toBeDefined();
    expect(table.conversationTag).toBeDefined();
    expect(table.contactIds).toBeDefined();
    expect(table.filterTags).toBeDefined();
  });

  it("campaignDispatches table has required columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.campaignDispatches;
    expect(table.campaignId).toBeDefined();
    expect(table.contactId).toBeDefined();
    expect(table.phone).toBeDefined();
    expect(table.status).toBeDefined();
    expect(table.whatsappMessageId).toBeDefined();
    expect(table.sentAt).toBeDefined();
    expect(table.deliveredAt).toBeDefined();
    expect(table.readAt).toBeDefined();
    expect(table.respondedAt).toBeDefined();
    expect(table.errorMessage).toBeDefined();
  });
});
