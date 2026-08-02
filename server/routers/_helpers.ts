// ── Helpers compartilhados entre routers (extraídos de routers.ts no PR #10) ─
import { publicProcedure } from "../_core/trpc";
import { getDb, getTeamMemberById } from "../db";

// Identifica o membro da equipe logado (via openId "team_member_<id>").
// Retorna { id, cargo } ou null (usuário base/admin do sistema).
export async function currentTeamMember(ctx: any): Promise<{ id: number; cargo: string } | null> {
  const openId = ctx?.user?.openId as string | undefined;
  if (!openId || !openId.startsWith("team_member_")) return null;
  const id = parseInt(openId.replace("team_member_", ""));
  if (!id) return null;
  try {
    const m = await getTeamMemberById(id);
    return m ? { id: m.id, cargo: m.cargo as string } : null;
  } catch { return null; }
}

// ─── Vendor API (Chrome Extension) ───────────────────────────────────────
export async function getVendorByApiKey(apiKey: string) {
  const db = await getDb();
  if (!db) return null;
  const { vendorApiKeys } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  const result = await db
    .select()
    .from(vendorApiKeys)
    .where(and(eq(vendorApiKeys.apiKey, apiKey), eq(vendorApiKeys.active, true)))
    .limit(1);

  if (!result[0]) return null;

  db.update(vendorApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(vendorApiKeys.id, result[0].id))
    .catch(() => {});

  const { teamMembers } = await import("../../drizzle/schema");
  const member = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.id, result[0].teamMemberId))
    .limit(1);

  return member[0] ?? null;
}

export const vendorKeyProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const apiKey = (ctx.req as any)?.headers?.["x-vendor-key"] as string | undefined;
  if (!apiKey) throw new Error("X-Vendor-Key header missing");
  const vendor = await getVendorByApiKey(apiKey);
  if (!vendor) throw new Error("Invalid or inactive API key");
  return next({ ctx: { ...ctx, vendor } });
});
