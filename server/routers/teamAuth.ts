// ── Team Auth Router (extraído de routers.ts no PR #10 — só move) ───────────
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { AUDIT_COOKIE_NAME, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { getTeamMemberById, getUserByOpenId, upsertUser, createLoginSession } from "../db";
import { authenticateTeamMember } from "../teamAuth";

/** IP do cliente considerando proxy reverso (nginx/traefik). */
function clientIp(req: any): string | undefined {
  const fwd = req?.headers?.["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : (typeof fwd === "string" ? fwd.split(",")[0] : undefined);
  return (raw || req?.ip || req?.socket?.remoteAddress || undefined)?.toString().trim();
}

export const teamAuthRouter = router({
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const member = await authenticateTeamMember(input.email, input.password);
      if (!member) {
        throw new Error("Email ou senha inválidos");
      }
      // Create a virtual openId for this team member
      const virtualOpenId = `team_member_${member.id}`;
      // Ensure a user record exists for this team member
      const existingUser = await getUserByOpenId(virtualOpenId);
      if (!existingUser) {
        await upsertUser({
          openId: virtualOpenId,
          name: member.name,
          email: member.email,
          role: member.cargo === "admin" ? "admin" : "user",
          lastSignedIn: new Date(),
        });
      } else {
        await upsertUser({
          openId: virtualOpenId,
          name: member.name,
          lastSignedIn: new Date(),
        });
      }
      // Create session token and set cookie
      const token = await sdk.createSessionToken(virtualOpenId, { name: member.name });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Auditoria de acesso: registra a sessão e guarda o id num cookie próprio.
      try {
        const auditId = await createLoginSession({
          teamMemberId: member.id,
          memberName: member.name,
          memberEmail: member.email,
          ip: clientIp(ctx.req),
          userAgent: ctx.req?.headers?.["user-agent"]?.toString(),
        });
        if (auditId) {
          ctx.res.cookie(AUDIT_COOKIE_NAME, String(auditId), { ...cookieOptions, maxAge: ONE_YEAR_MS });
        }
      } catch (e) {
        console.error("[teamAuth] falha ao registrar sessão de auditoria:", e);
      }
      return {
        success: true,
        member: { id: member.id, name: member.name, email: member.email, cargo: member.cargo },
      };
    }),

  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    // Check if this is a team member
    if (ctx.user.openId.startsWith("team_member_")) {
      const memberId = parseInt(ctx.user.openId.replace("team_member_", ""));
      const member = await getTeamMemberById(memberId);
      if (member) {
        return {
          ...ctx.user,
          teamMember: { id: member.id, name: member.name, email: member.email, cargo: member.cargo, status: member.status },
          isTeamMember: true,
        };
      }
    }
    return { ...ctx.user, teamMember: null, isTeamMember: false };
  }),
});
