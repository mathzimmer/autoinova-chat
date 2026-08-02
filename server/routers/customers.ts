// ── Customers Router (extraído de routers.ts no PR #10 — só move, não muda) ─
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";

export const customersRouter = router({
  list: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const { listCustomers } = await import("../customers");
      return listCustomers(input?.limit ?? 50, input?.offset ?? 0);
    }),

  /** DRY-RUN: relatório de duplicados ANTES de escrever qualquer coisa. */
  dryRunBackfill: adminProcedure.query(async () => {
    const { backfillCustomers } = await import("../customers");
    return backfillCustomers({ dryRun: true });
  }),

  /** Executa o backfill de verdade (rode o dryRunBackfill antes!). */
  runBackfill: adminProcedure.mutation(async () => {
    const { backfillCustomers } = await import("../customers");
    return backfillCustomers({ dryRun: false });
  }),

  /**
   * LGPD: soft-anonymize — remove PII do customer + leads/contacts vinculados,
   * PRESERVANDO linhas e métricas. Idempotente.
   */
  anonymize: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { anonymizeCustomer } = await import("../customers");
      return anonymizeCustomer(input.id);
    }),
});
