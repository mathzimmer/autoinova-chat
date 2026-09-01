// ── WhatsApp Number Router (extraído de routers.ts no PR #10 — só move) ─────
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { currentTeamMember } from "./_helpers";

export const whatsappNumberRouter = router({
  // Lista números oficiais adicionais como "instâncias" (abas no inbox)
  listInstances: protectedProcedure.query(async ({ ctx }) => {
    // Vendedor não vê os números oficiais (só a instância dele)
    const member = await currentTeamMember(ctx);
    if (member && member.cargo === "vendedor") return [];
    const { listWhatsappNumbers } = await import("../whatsappMultiNumber");
    const rows = await listWhatsappNumbers();
    return (rows || []).map((r: any) => ({
      id: r.id,
      instanceName: `official:${r.phoneNumberId}`,
      phoneNumberId: r.phoneNumberId,
      displayName: r.displayName,
      phone: r.phoneDisplay,
      status: r.isActive ? "connected" : "disconnected",
      receiving: !!r.isActive,       // recebimento (assinatura da WABA) ligado?
      wabaId: r.wabaId || null,
      mode: r.mode || "normal",      // 'normal' | 'meta_agent'
      channel: "whatsapp" as const,
    }));
  }),

  // Marca/desmarca o número como gerido pelo Meta Business Agent
  // (mode = meta_agent → o CRM só observa + trata handoff, não responde pela IA).
  setMode: protectedProcedure
    .input(z.object({ id: z.number(), mode: z.enum(["normal", "meta_agent"]) }))
    .mutation(async ({ ctx, input }) => {
      const member = await currentTeamMember(ctx);
      if (member && member.cargo === "vendedor") throw new Error("Apenas administradores");
      const { updateWhatsappNumber } = await import("../whatsappMultiNumber");
      await updateWhatsappNumber(input.id, { mode: input.mode } as any);
      return { success: true, mode: input.mode };
    }),

  // Pausa/retoma o RECEBIMENTO pela API oficial: assina/desassina a WABA no app
  // (a Meta para/volta a mandar webhooks) e marca isActive. Mantém o cadastro.
  setReceiving: protectedProcedure
    .input(z.object({ id: z.number(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const member = await currentTeamMember(ctx);
      if (member && member.cargo === "vendedor") throw new Error("Apenas administradores");
      const {
        getWhatsappNumberById, updateWhatsappNumber, subscribeWabaToApp, unsubscribeWabaFromApp,
      } = await import("../whatsappMultiNumber");
      const rec: any = await getWhatsappNumberById(input.id);
      if (!rec) throw new Error("Número não encontrado");
      if (!rec.wabaId) throw new Error("Número sem WABA cadastrada — não dá para pausar/retomar o recebimento");
      const token = rec.accessToken || undefined;
      const res = input.enabled
        ? await subscribeWabaToApp(rec.wabaId, token)
        : await unsubscribeWabaFromApp(rec.wabaId, token);
      if (!res.success) throw new Error(res.error || "Falha ao alterar a assinatura na Meta");
      await updateWhatsappNumber(input.id, { isActive: input.enabled });
      return { success: true, receiving: input.enabled };
    }),

  createInstance: protectedProcedure
    .input(z.object({
      phoneNumberId: z.string().min(4),
      displayName: z.string().min(1),
      phoneDisplay: z.string().optional(),
      accessToken: z.string().optional(),
      wabaId: z.string().optional(),
      mode: z.enum(["normal", "meta_agent"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { createWhatsappNumber } = await import("../whatsappMultiNumber");
      return createWhatsappNumber(input);
    }),

  // Conexão de 1 clique a partir do Embedded Signup: assina a WABA no app do
  // provedor + salva o número (usa o token do provedor). Só admin.
  connectFromSignup: protectedProcedure
    .input(z.object({
      wabaId: z.string().min(4),
      phoneNumberId: z.string().min(4),
      displayName: z.string().optional(),
      phoneDisplay: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await currentTeamMember(ctx);
      if (member && member.cargo === "vendedor") throw new Error("Apenas administradores");
      const { connectNumberFromSignup } = await import("../whatsappMultiNumber");
      return connectNumberFromSignup(input);
    }),

  deleteInstance: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteWhatsappNumber } = await import("../whatsappMultiNumber");
      await deleteWhatsappNumber(input.id);
      return { success: true };
    }),
});
