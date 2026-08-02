// ── Automation AI Router (extraído de routers.ts no PR #10 — só move) ───────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { upsertSetting } from "../db";

export const automationAiRouter = router({
  listConnections: protectedProcedure.query(async () => {
    const { getConnectionAiAuto, listEvolutionInstances, listZernioInstances } = await import("../db");
    const out: { key: string; type: string; label: string; aiAuto: boolean }[] = [];

    try {
      const evos = await listEvolutionInstances();
      for (const e of (evos || []) as any[]) {
        const key = `evolution:${e.instanceName}`;
        out.push({ key, type: "Evolution", label: e.displayName || e.instanceName, aiAuto: await getConnectionAiAuto(key) });
      }
    } catch { /* noop */ }

    try {
      const zs = await listZernioInstances();
      for (const zi of (zs || []) as any[]) {
        const key = `zernio:${zi.accountId}`;
        out.push({ key, type: "Zernio", label: zi.displayName || zi.phone || zi.accountId, aiAuto: await getConnectionAiAuto(key) });
      }
    } catch { /* noop */ }

    try {
      const { listWhatsappNumbers } = await import("../whatsappMultiNumber");
      const ns = await listWhatsappNumbers();
      for (const n of (ns || []) as any[]) {
        const key = `official:${n.phoneNumberId}`;
        out.push({ key, type: "Oficial", label: n.displayName || n.phoneDisplay || n.phoneNumberId, aiAuto: await getConnectionAiAuto(key) });
      }
    } catch { /* noop */ }

    for (const ch of ["instagram", "facebook"] as const) {
      const key = `meta:${ch}`;
      out.push({ key, type: "Meta", label: ch === "instagram" ? "Instagram" : "Facebook", aiAuto: await getConnectionAiAuto(key) });
    }

    return out;
  }),

  setConnectionAiAuto: adminProcedure
    .input(z.object({ key: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { upsertSetting, setConnectionConversationsAiActive } = await import("../db");
      await upsertSetting(`ai_auto:${input.key}`, String(input.enabled), ctx.user.id);
      // Efeito imediato: aplica também nas conversas abertas dessa conexão
      const affected = await setConnectionConversationsAiActive(input.key, input.enabled).catch(() => 0);
      return { success: true, affected };
    }),
});
