// ── Team Auth Router (extraído de routers.ts no PR #10 — só move) ───────────
import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { AUDIT_COOKIE_NAME, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { getTeamMemberById, getUserByOpenId, upsertUser, createLoginSession, getSetting, upsertSetting } from "../db";
import { authenticateTeamMember } from "../teamAuth";
import { createAndSendOtp, verifyOtp as verifyLoginOtp, is2faEnabled } from "../loginOtp";

type MemberLike = { id: number; name: string; email: string; cargo: string; whatsapp?: string | null };

/** Emite a sessão (cookie + user + auditoria) pra um membro já autenticado. */
async function issueSession(ctx: any, member: MemberLike) {
  const virtualOpenId = `team_member_${member.id}`;
  const existingUser = await getUserByOpenId(virtualOpenId);
  if (!existingUser) {
    await upsertUser({
      openId: virtualOpenId, name: member.name, email: member.email,
      role: member.cargo === "admin" ? "admin" : "user", lastSignedIn: new Date(),
    });
  } else {
    await upsertUser({ openId: virtualOpenId, name: member.name, lastSignedIn: new Date() });
  }
  const token = await sdk.createSessionToken(virtualOpenId, { name: member.name });
  const cookieOptions = getSessionCookieOptions(ctx.req);
  ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
  try {
    const auditId = await createLoginSession({
      teamMemberId: member.id, memberName: member.name, memberEmail: member.email,
      ip: clientIp(ctx.req), userAgent: ctx.req?.headers?.["user-agent"]?.toString(),
    });
    if (auditId) ctx.res.cookie(AUDIT_COOKIE_NAME, String(auditId), { ...cookieOptions, maxAge: ONE_YEAR_MS });
  } catch (e) {
    console.error("[teamAuth] falha ao registrar sessão de auditoria:", e);
  }
  return { success: true, member: { id: member.id, name: member.name, email: member.email, cargo: member.cargo } };
}

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

      // 2FA por WhatsApp: se ligado e o membro tem telefone, NÃO emite a sessão
      // agora — gera um código, envia e exige a verificação no passo 2.
      if (await is2faEnabled()) {
        const challenge = await createAndSendOtp({ id: member.id, name: member.name, email: member.email });
        if (!challenge.ok) throw new Error(challenge.error);
        return { success: true, otpRequired: true as const, challengeId: challenge.challengeId };
      }

      return { ...(await issueSession(ctx, member as any)), otpRequired: false as const };
    }),

  // Passo 2 do 2FA: valida o código e só então emite a sessão.
  verifyOtp: publicProcedure
    .input(z.object({ challengeId: z.number(), code: z.string().min(4).max(8) }))
    .mutation(async ({ input, ctx }) => {
      const res = await verifyLoginOtp(input.challengeId, input.code);
      if (!res.ok) throw new Error(res.error);
      const member = await getTeamMemberById(res.teamMemberId);
      if (!member || (member as any).status !== "ativo") throw new Error("Acesso indisponível. Contate o administrador.");
      return { ...(await issueSession(ctx, member as any)), otpRequired: false as const };
    }),

  // Config do 2FA de login (admin). Começa desligado e sem número aprovador.
  get2faEnabled: adminProcedure.query(async () => {
    const raw = await getSetting("login_2fa_enabled");
    const approverPhone = (await getSetting("login_2fa_approver_phone")) || "";
    return { enabled: String(raw).toLowerCase() === "true", approverPhone };
  }),
  set2faEnabled: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      // Não deixa ligar sem número aprovador (senão ninguém recebe código → trava geral).
      if (input.enabled) {
        const approver = (await getSetting("login_2fa_approver_phone")) || "";
        if (!approver.replace(/\D/g, "")) throw new Error("Defina o número aprovador antes de ligar o 2FA.");
      }
      await upsertSetting("login_2fa_enabled", input.enabled ? "true" : "false", ctx.user.id);
      return { enabled: input.enabled };
    }),
  // Número que recebe TODOS os códigos de login (o aprovador).
  set2faApproverPhone: adminProcedure
    .input(z.object({ phone: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const digits = input.phone.replace(/\D/g, "");
      await upsertSetting("login_2fa_approver_phone", digits, ctx.user.id);
      return { approverPhone: digits };
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
