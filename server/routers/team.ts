// ── Team Router (extraído de routers.ts no PR #10 — só move) ────────────────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  getDb, getActiveTeamMembers, getTeamMemberById, createActivityLog,
} from "../db";
import {
  createTeamMember, updateTeamMember, deactivateTeamMember, hashPassword,
  listTeamMembers as listTeamMembersAuth,
} from "../teamAuth";

export const teamRouter = router({
  list: protectedProcedure.query(async () => {
    return getActiveTeamMembers();
  }),

  listAll: adminProcedure.query(async () => {
    return listTeamMembersAuth();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getTeamMemberById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
      cargo: z.enum(["admin", "gerente", "vendedor", "suporte"]).default("vendedor"),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await createTeamMember(input.name, input.email, input.password, input.cargo);
      await createActivityLog({
        userId: ctx.user.id,
        action: "create_team_member",
        details: { name: input.name, email: input.email, cargo: input.cargo },
      });
      return { success: true };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      cargo: z.enum(["admin", "gerente", "vendedor", "suporte"]).optional(),
      status: z.enum(["ativo", "inativo"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      await updateTeamMember(id, updates);
      await createActivityLog({
        userId: ctx.user.id,
        action: "update_team_member",
        details: { memberId: id, ...updates },
      });
      return { success: true };
    }),

  resetPassword: adminProcedure
    .input(z.object({
      id: z.number(),
      newPassword: z.string().min(6),
    }))
    .mutation(async ({ input, ctx }) => {
      const newHash = hashPassword(input.newPassword);
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { teamMembers: tm } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(tm).set({ passwordHash: newHash }).where(eq(tm.id, input.id));
      await createActivityLog({
        userId: ctx.user.id,
        action: "reset_password",
        details: { memberId: input.id },
      });
      return { success: true };
    }),

  deactivate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await deactivateTeamMember(input.id);
      await createActivityLog({
        userId: ctx.user.id,
        action: "deactivate_team_member",
        details: { memberId: input.id },
      });
      return { success: true };
    }),
});
