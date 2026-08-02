// ── Token Health Router (extraído de routers.ts no PR #10 — só move) ────────
import { adminProcedure, router } from "../_core/trpc";
import { runTokenHealthCheck, getLastCheckResults } from "../tokenMonitor";

export const tokenHealthRouter = router({
  // Get last check results (cached)
  status: adminProcedure.query(() => {
    return getLastCheckResults();
  }),

  // Force a manual health check
  check: adminProcedure.mutation(async () => {
    const results = await runTokenHealthCheck();
    return results;
  }),
});
