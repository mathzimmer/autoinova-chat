// ── Auditoria de acesso ─────────────────────────────────────────────────────
// Quem está online agora, e o histórico de sessões (entrou / saiu / última
// atividade / IP). O heartbeat é chamado pelo client de tempos em tempos para
// manter a sessão "viva". Listagens são só para admin/gerente.
import { z } from "zod";
import { parse as parseCookie } from "cookie";
import { AUDIT_COOKIE_NAME } from "@shared/const";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  touchOrOpenLoginSession,
  listOnlineSessions,
  listRecentLoginSessions,
  ONLINE_WINDOW_MIN,
  getTeamMemberById,
} from "../db";

function clientIp(req: any): string | undefined {
  const fwd = req?.headers?.["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : (typeof fwd === "string" ? fwd.split(",")[0] : undefined);
  return (raw || req?.ip || req?.socket?.remoteAddress || undefined)?.toString().trim();
}

/** Extrai o id do membro da equipe a partir do openId virtual. */
function teamMemberIdFromCtx(ctx: any): number | null {
  const openId: string = ctx?.user?.openId || "";
  if (!openId.startsWith("team_member_")) return null;
  const id = parseInt(openId.replace("team_member_", ""));
  return Number.isFinite(id) ? id : null;
}

async function ensureGestor(ctx: any) {
  const id = teamMemberIdFromCtx(ctx);
  if (ctx?.user?.role === "admin") return; // usuário base admin
  if (id != null) {
    const m = await getTeamMemberById(id);
    if (m && (m.cargo === "admin" || m.cargo === "gerente")) return;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para ver auditoria de acesso." });
}

export const accessAuditRouter = router({
  // Batida de atividade — mantém a pessoa "online". Chamado periodicamente.
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    const memberId = teamMemberIdFromCtx(ctx);
    if (memberId == null) return { ok: false } as const;
    let auditSid: number | undefined;
    try {
      const cookies = parseCookie((ctx.req as any)?.headers?.cookie || "");
      const n = Number(cookies[AUDIT_COOKIE_NAME]);
      if (Number.isFinite(n)) auditSid = n;
    } catch { /* noop */ }
    // Se não houver sessão aberta (ex.: já estava logado antes, cookie de 1 ano),
    // abre uma agora — assim TODA pessoa ativa aparece na auditoria.
    const m = await getTeamMemberById(memberId);
    await touchOrOpenLoginSession({
      teamMemberId: memberId,
      sessionId: auditSid,
      memberName: m?.name,
      memberEmail: m?.email,
      ip: clientIp(ctx.req),
      userAgent: (ctx.req as any)?.headers?.["user-agent"]?.toString(),
    });
    return { ok: true } as const;
  }),

  // Quem está online agora.
  online: protectedProcedure.query(async ({ ctx }) => {
    await ensureGestor(ctx);
    const rows = await listOnlineSessions();
    return { windowMin: ONLINE_WINDOW_MIN, sessions: rows };
  }),

  // Histórico de sessões (entradas/saídas).
  history: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(500).optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureGestor(ctx);
      return listRecentLoginSessions(input?.limit ?? 100);
    }),
});
