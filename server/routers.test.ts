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
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.webhook.verify({
      mode: "subscribe",
      token: "autoinova_verify_token",
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
