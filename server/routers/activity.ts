// ── Activity Router (extraído de routers.ts no PR #10 — só move) ────────────
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { listActivityLogs, listActivityLogsByLead } from "../db";
import { listTeamMembers as listTeamMembersAuth } from "../teamAuth";

export const activityRouter = router({
  list: protectedProcedure
    .input(z.object({
      conversationId: z.number().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listActivityLogs(input?.conversationId, input?.limit);
    }),

  /** Linha do tempo do lead: eventos + notas, com nome do usuário resolvido */
  timeline: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const logs = await listActivityLogs(input.conversationId, 200);
      let members: any[] = [];
      try { members = (await listTeamMembersAuth()) as any[]; } catch {}
      const nameOf = (uid: number) => uid === 0 ? "Sistema" : (members.find(m => m.id === uid)?.name || "Usuário");
      return (logs as any[]).map(l => ({
        id: l.id,
        action: l.action,
        userId: l.userId,
        userName: nameOf(l.userId),
        details: l.details,
        createdAt: l.createdAt,
      }));
    }),

  /** Linha do tempo UNIFICADA por lead (todos os números/conversas da pessoa) */
  timelineByLead: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      const { listActivityLogsByLead } = await import("../db");
      const logs = await listActivityLogsByLead(input.leadId, 120);
      let members: any[] = [];
      try { members = (await listTeamMembersAuth()) as any[]; } catch {}
      const nameOf = (uid: number) => uid === 0 ? "Sistema" : (members.find(m => m.id === uid)?.name || "Usuário");
      return (logs as any[]).map(l => ({
        id: l.id, action: l.action, userId: l.userId, userName: nameOf(l.userId),
        details: l.details, createdAt: l.createdAt,
      }));
    }),

  /** Adiciona uma nota manual à linha do tempo (registra quem, quando) */
  addNote: protectedProcedure
    .input(z.object({ conversationId: z.number(), note: z.string().min(1).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const { logTimeline } = await import("../db");
      await logTimeline({
        conversationId: input.conversationId,
        userId: ctx.user.id,
        action: "nota",
        details: { note: input.note.trim(), authorName: ctx.user.name || "Atendente" },
      });
      return { success: true };
    }),
});
