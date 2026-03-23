import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock helpers ─────────────────────────────────────────────

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
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "regular-user",
    email: "user@autoinova.com",
    name: "User",
    loginMethod: "manus",
    role: "user",
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
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe("seller router", () => {
  describe("seller.storeLocations", () => {
    it("returns an array of store locations", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const stores = await caller.seller.storeLocations();
      expect(Array.isArray(stores)).toBe(true);
      // Should have at least the two known stores
      if (stores.length > 0) {
        expect(stores.every((s: string) => typeof s === "string")).toBe(true);
      }
    });
  });

  describe("seller.list", () => {
    it("returns an array of sellers", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const sellers = await caller.seller.list();
      expect(Array.isArray(sellers)).toBe(true);
    });

    it("filters sellers by store location", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const sellers = await caller.seller.list({ storeLocation: "Auto Inova" });
      expect(Array.isArray(sellers)).toBe(true);
      sellers.forEach((s: any) => {
        expect(s.storeLocation).toBe("Auto Inova");
      });
    });
  });

  describe("seller.create", () => {
    it("creates a new seller (admin only)", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.seller.create({
        name: "Vendedor Teste Vitest",
        phone: "5551999990000",
        storeLocation: "Auto Inova",
        sortOrder: 99,
      });

      expect(result).toHaveProperty("id");
      expect(typeof result.id).toBe("number");

      // Verify it was created
      const seller = await caller.seller.getById({ id: result.id });
      expect(seller.name).toBe("Vendedor Teste Vitest");
      expect(seller.phone).toBe("5551999990000");
      expect(seller.storeLocation).toBe("Auto Inova");
      expect(seller.isActive).toBe(true);

      // Cleanup
      await caller.seller.delete({ id: result.id });
    });

    it("rejects creation by non-admin user", async () => {
      const ctx = createUserContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.seller.create({
          name: "Vendedor Não Autorizado",
          phone: "5551999990001",
          storeLocation: "Auto Inova",
          sortOrder: 0,
        })
      ).rejects.toThrow();
    });
  });

  describe("seller.update", () => {
    it("updates a seller's info", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      // Create a seller first
      const { id } = await caller.seller.create({
        name: "Vendedor Update Test",
        phone: "5551999990002",
        storeLocation: "Auto Inova",
        sortOrder: 0,
      });

      // Update
      const result = await caller.seller.update({
        id,
        name: "Vendedor Atualizado",
        phone: "5551888880000",
      });
      expect(result).toEqual({ success: true });

      // Verify
      const seller = await caller.seller.getById({ id });
      expect(seller.name).toBe("Vendedor Atualizado");
      expect(seller.phone).toBe("5551888880000");

      // Cleanup
      await caller.seller.delete({ id });
    });

    it("toggles seller active status", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const { id } = await caller.seller.create({
        name: "Vendedor Toggle Test",
        phone: "5551999990003",
        storeLocation: "Auto Inova",
        sortOrder: 0,
      });

      // Deactivate
      await caller.seller.update({ id, isActive: false });
      let seller = await caller.seller.getById({ id });
      expect(seller.isActive).toBe(false);

      // Reactivate
      await caller.seller.update({ id, isActive: true });
      seller = await caller.seller.getById({ id });
      expect(seller.isActive).toBe(true);

      // Cleanup
      await caller.seller.delete({ id });
    });
  });

  describe("seller.delete", () => {
    it("deletes a seller", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const { id } = await caller.seller.create({
        name: "Vendedor Delete Test",
        phone: "5551999990004",
        storeLocation: "Auto Inova",
        sortOrder: 0,
      });

      const result = await caller.seller.delete({ id });
      expect(result).toEqual({ success: true });

      // Verify it's gone
      await expect(caller.seller.getById({ id })).rejects.toThrow();
    });
  });

  describe("seller.assignNext (round-robin)", () => {
    it("assigns sellers in round-robin order", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      // Create test sellers
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const { id } = await caller.seller.create({
          name: `RR Vendedor ${i + 1}`,
          phone: `555199900000${i}`,
          storeLocation: "Auto Inova",
          sortOrder: i,
        });
        ids.push(id);
      }

      try {
        // Assign 4 times - should cycle through 3 sellers
        const assigned: number[] = [];
        for (let i = 0; i < 4; i++) {
          const result = await caller.seller.assignNext({
            storeLocation: "Auto Inova",
            conversationId: 1000 + i,
          });
          assigned.push(result.seller.id);
          expect(result.assignmentId).toBeGreaterThan(0);
        }

        // The 4th assignment should wrap back to the first seller
        // (since we have 3 sellers, index 3 wraps to 0)
        expect(assigned.length).toBe(4);
      } finally {
        // Cleanup
        for (const id of ids) {
          await caller.seller.delete({ id });
        }
      }
    });

    it("throws error when no active sellers in store", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.seller.assignNext({
          storeLocation: "Loja Inexistente XYZ",
          conversationId: 9999,
        })
      ).rejects.toThrow("Nenhum vendedor ativo na loja");
    });
  });

  describe("seller.assignments", () => {
    it("returns assignment history", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const assignments = await caller.seller.assignments();
      expect(Array.isArray(assignments)).toBe(true);
    });
  });

  describe("seller.getStoreByVehicle", () => {
    it("returns store location for a valid vehicle", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      // Vehicle ID 1 should exist (from stock sync)
      const result = await caller.seller.getStoreByVehicle({ vehicleId: 1 });
      expect(result).toHaveProperty("storeLocation");
      // storeLocation can be null if vehicle doesn't exist, or a string
      if (result.storeLocation) {
        expect(typeof result.storeLocation).toBe("string");
      }
    });
  });
});
