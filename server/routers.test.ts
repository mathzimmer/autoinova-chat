import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(role: "user" | "admin" = "admin"): { ctx: TrpcContext; clearedCookies: any[] } {
  const clearedCookies: any[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "admin@autoinova.com",
    name: "Admin Auto Inova",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function createPublicContext(): TrpcContext {
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

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });
});

describe("auth.me", () => {
  it("returns null for unauthenticated users", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user data for authenticated users", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.name).toBe("Admin Auto Inova");
    expect(result?.role).toBe("admin");
  });
});

describe("webhook.verify", () => {
  it("returns challenge when token matches", async () => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "autoinova_verify_token";
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.webhook.verify({
      mode: "subscribe",
      token: verifyToken,
      challenge: "test_challenge_123",
    });
    expect(result).toBe("test_challenge_123");
  });

  it("returns Forbidden when token does not match", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.webhook.verify({
      mode: "subscribe",
      token: "wrong_token",
      challenge: "test_challenge_123",
    });
    expect(result).toBe("Forbidden");
  });
});

describe("conversation.list", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.conversation.list()).rejects.toThrow();
  });

  it("returns an array for authenticated users", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.conversation.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("lead.list", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.lead.list()).rejects.toThrow();
  });

  it("returns an array for authenticated users", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.lead.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("vehicle.list", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.vehicle.list()).rejects.toThrow();
  });

  it("returns an array for authenticated users", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.vehicle.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("vehicle.create", () => {
  it("requires admin role", async () => {
    const { ctx } = createAuthContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.vehicle.create({
        brand: "Toyota",
        model: "Corolla",
        year: 2024,
        price: 120000,
      })
    ).rejects.toThrow();
  });
});

describe("dashboard.stats", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.stats()).rejects.toThrow();
  });

  it("returns stats object for authenticated users", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.stats();
    expect(result).toHaveProperty("totalConversations");
    expect(result).toHaveProperty("openConversations");
    expect(result).toHaveProperty("totalLeads");
    expect(result).toHaveProperty("qualifiedLeads");
    expect(result).toHaveProperty("totalVehicles");
    expect(result).toHaveProperty("totalCalls");
    expect(result).toHaveProperty("totalTokens");
    expect(result).toHaveProperty("avgResponseTime");
  });
});

describe("message.send", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.message.send({
        conversationId: 1,
        content: "Olá",
        senderType: "agent",
      })
    ).rejects.toThrow();
  });
});

describe("settings.getPrompt", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.settings.getPrompt()).rejects.toThrow();
  });

  it("returns prompt data for authenticated users", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.settings.getPrompt();
    expect(result).toHaveProperty("corePrompt");
    expect(result).toHaveProperty("commercialPrompt");
    expect(result).toHaveProperty("personalityPrompt");
    expect(result).toHaveProperty("coreIsCustom");
    expect(result).toHaveProperty("commercialIsCustom");
    expect(result).toHaveProperty("personalityIsCustom");
    expect(result).toHaveProperty("defaultCorePrompt");
    expect(result).toHaveProperty("defaultCommercialPrompt");
    expect(result).toHaveProperty("defaultPersonalityPrompt");
    expect(typeof result.corePrompt).toBe("string");
    expect(result.corePrompt.length).toBeGreaterThan(0);
    expect(typeof result.commercialPrompt).toBe("string");
    expect(result.commercialPrompt.length).toBeGreaterThan(0);
    expect(typeof result.personalityPrompt).toBe("string");
    expect(result.personalityPrompt.length).toBeGreaterThan(0);
  });
});

describe("settings.savePrompt", () => {
  it("requires admin role", async () => {
    const { ctx } = createAuthContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.settings.savePrompt({ layer: "personality", prompt: "Novo prompt de teste para o agente de IA" })
    ).rejects.toThrow();
  });

  it("rejects prompt shorter than 10 chars", async () => {
    const { ctx } = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.settings.savePrompt({ layer: "personality", prompt: "curto" })
    ).rejects.toThrow();
  });

  it("accepts valid layer and prompt for admin", async () => {
    const { ctx } = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.settings.savePrompt({ layer: "core", prompt: "Regras do sistema atualizadas pelo admin com mais de 10 caracteres" });
    expect(result.success).toBe(true);
  });
});

describe("settings.resetPrompt", () => {
  it("requires admin role", async () => {
    const { ctx } = createAuthContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.settings.resetPrompt({ layer: "personality" })).rejects.toThrow();
  });

  it("resets a specific layer for admin", async () => {
    const { ctx } = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.settings.resetPrompt({ layer: "core" });
    expect(result.success).toBe(true);
    expect(result.defaultPrompt.length).toBeGreaterThan(0);
  });
});
