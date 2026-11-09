import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * SEGURANÇA: o cookie de sessão vale 1 ano. Se um membro é desativado
 * (status != "ativo") ou removido, a sessão JÁ ABERTA dele precisa parar de
 * funcionar na hora — senão o acesso continua até o cookie expirar. Aqui
 * re-checamos o status do membro em TODA requisição autenticada.
 */
async function assertTeamMemberActive(user: { openId?: string } | null | undefined) {
  const openId = user?.openId || "";
  if (!openId.startsWith("team_member_")) return; // usuário base (admin do .env) não é membro
  const id = parseInt(openId.slice("team_member_".length));
  if (!Number.isFinite(id)) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  const { getTeamMemberById } = await import("../db");
  const m = await getTeamMemberById(id);
  if (!m || m.status !== "ativo") {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Acesso revogado. Faça login novamente." });
  }
}

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  await assertTeamMemberActive(ctx.user);

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    await assertTeamMemberActive(ctx.user);

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
