// ── Zernio Router (extraído de routers.ts no PR #10 — só move) ──────────────
import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { currentTeamMember } from "./_helpers";

export const zernioRouter = router({
  // Instâncias Zernio CADASTRADAS (uma aba por conta). Lê da tabela dedicada —
  // nada a ver com Evolution.
  listInstances: protectedProcedure.query(async ({ ctx }) => {
    const { listZernioInstances } = await import("../db");
    let rows = await listZernioInstances();
    // Vendedor só vê as instâncias atribuídas a ele
    const member = await currentTeamMember(ctx);
    if (member && member.cargo === "vendedor") {
      rows = rows.filter((r: any) => r.assignedUserId === member.id);
    }
    return rows.map((r: any) => ({
      id: r.id,
      instanceName: `zernio:${r.accountId}`, // valor da aba/fonte no inbox
      accountId: r.accountId,
      displayName: r.displayName || r.phone || "WhatsApp (Zernio)",
      phone: r.phone,
      assignedUserId: r.assignedUserId ?? null,
      status: r.active ? "connected" : "disconnected",
      channel: "zernio" as const,
    }));
  }),

  /** Dispara manualmente o sincronizador (recupera mensagens perdidas). */
  sync: adminProcedure.mutation(async () => {
    const { runZernioSync } = await import("../zernioSync");
    return runZernioSync();
  }),

  /** Define o vendedor dono da instância Zernio (vê só ela no inbox). */
  assignUser: adminProcedure
    .input(z.object({ id: z.number(), userId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const { zernioInstances } = await import("../../drizzle/schema");
      await db.update(zernioInstances).set({ assignedUserId: input.userId } as any).where(eq(zernioInstances.id, input.id));
      return { success: true };
    }),

  // Lista as contas disponíveis na conta Zernio (via API) para o usuário escolher
  // qual cadastrar. Aceita uma apiKey opcional (se ainda não estiver no .env).
  availableAccounts: protectedProcedure
    .input(z.object({ apiKey: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { zernioListAccounts } = await import("../zernioService");
        const accounts = await zernioListAccounts(input?.apiKey);
        return (accounts || [])
          .filter((a: any) => String(a?.platform || "").toLowerCase() === "whatsapp")
          .map((a: any) => ({
            accountId: a?._id || a?.id || a?.accountId,
            displayName: a?.displayName || a?.name || a?.username,
            phone: a?.username || a?.phoneNumber,
          }));
      } catch (err) {
        console.error("[Zernio] availableAccounts falhou:", err);
        return [];
      }
    }),

  // Cadastra (ou atualiza) uma instância Zernio
  createInstance: protectedProcedure
    .input(z.object({
      accountId: z.string().min(4),
      displayName: z.string().optional(),
      phone: z.string().optional(),
      apiKey: z.string().optional(),
      webhookSecret: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { createZernioInstance } = await import("../db");
      return createZernioInstance(input);
    }),

  deleteInstance: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteZernioInstance } = await import("../db");
      await deleteZernioInstance(input.id);
      return { success: true };
    }),
});
