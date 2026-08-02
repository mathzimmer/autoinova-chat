// ── Lead Router (extraído de routers.ts no PR #10 — só move) ────────────────
import { z } from "zod";
import { and, desc, eq, gte, inArray, ne, or } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDb, listLeads, getLeadByConversationId, upsertLead,
  getLeadSummaries, upsertLeadSummary, getConversationById,
} from "../db";
import { invokeLLM } from "../_core/llm";
import { currentTeamMember, conversationSourceValue } from "./_helpers";

export const leadRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return listLeads(input);
    }),

  /** Conversas do lead (todos os números) — para o "Ir para conversa" com escolha de instância */
  conversations: protectedProcedure
    .input(z.object({ leadId: z.number(), phone: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversations: convTable } = await import("../../drizzle/schema");
      const { eq, or: orOp, desc: descOp } = await import("drizzle-orm");
      let where = eq(convTable.leadId, input.leadId);
      // fallback por telefone (leads/conversas antigas sem leadId vinculado)
      const rows = await db.select().from(convTable)
        .where(input.phone ? orOp(where, eq(convTable.phone, input.phone))! : where)
        .orderBy(descOp(convTable.lastMessageAt))
        .limit(20);
      // Nome cadastrado das instâncias Zernio (accountId → Deivid, etc.)
      let zernioNameByAccount = new Map<string, string>();
      try {
        const { zernioInstances } = await import("../../drizzle/schema");
        const zi = await db.select().from(zernioInstances);
        zernioNameByAccount = new Map(zi.map(z => [z.accountId, z.displayName || z.phone || z.accountId]));
      } catch { /* tabela pode não existir */ }
      return rows.map((c: any) => ({
        conversationId: c.id,
        source: conversationSourceValue(c),
        channel: c.channel,
        instanceName: c.instanceName,
        label: c.channel === "zernio" ? `Zernio: ${zernioNameByAccount.get(c.instanceName || "") || "Recepção"}`
          : c.channel === "evolution" ? `Vendedor: ${c.instanceName || ""}`
          : c.channel === "whatsapp" && c.instanceName ? `Oficial ${c.instanceName}`
          : "Matriz (oficial)",
        lastMessageAt: c.lastMessageAt,
      }));
    }),

  /** Marca que o contato NÃO é lead (fornecedor, colega, etc.) — tira do funil */
  setNotLead: protectedProcedure
    .input(z.object({ leadId: z.number(), reason: z.string().min(2).max(40) }))
    .mutation(async ({ input }) => {
      const { setLeadNotLead } = await import("../db");
      await setLeadNotLead(input.leadId, input.reason);
      return { success: true };
    }),

  /** Reverte: volta a ser lead */
  setIsLead: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .mutation(async ({ input }) => {
      const { setLeadIsLead } = await import("../db");
      await setLeadIsLead(input.leadId);
      return { success: true };
    }),

  /** Situação de crédito (com/sem crédito, valor, condições, banco) — ou "limpar" */
  setCredit: protectedProcedure
    .input(z.object({
      leadId: z.number(),
      approved: z.enum(["sim", "nao", "limpar"]),
      amount: z.string().max(50).optional(),
      conditions: z.string().max(255).optional(),
      bank: z.string().max(40).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const { leads: leadsT } = await import("../../drizzle/schema");
      const lead = (await db.select().from(leadsT).where(eq(leadsT.id, input.leadId)).limit(1))[0];
      if (!lead) throw new Error("Lead não encontrado");
      const clear = input.approved === "limpar";
      await db.update(leadsT).set({
        creditApproved: clear ? null : input.approved,
        creditAmount: input.approved === "sim" ? (input.amount ?? null) : null,
        creditConditions: input.approved === "sim" ? (input.conditions ?? null) : null,
        creditBank: input.approved === "sim" ? (input.bank ?? null) : null,
        updatedAt: new Date(),
      } as any).where(eq(leadsT.id, input.leadId));
      const { logTimeline } = await import("../db");
      await logTimeline({
        conversationId: lead.conversationId, leadId: input.leadId, userId: ctx.user.id,
        action: clear ? "credito_removido" : "credito",
        details: clear ? {} : { aprovado: input.approved, valor: input.amount, condicoes: input.conditions, banco: input.bank },
      });

      // CRÉDITO APROVADO = sinal FORTE para a Meta ("SubmitApplication").
      // É esse evento que ensina o algoritmo a buscar gente que CONSEGUE crédito.
      if (input.approved === "sim") {
        try {
          const { trackLeadProgress } = await import("../metaConversions");
          void trackLeadProgress(input.leadId, { funnelStatus: "pagamento_definido" });
        } catch (e) { console.error("[CAPI] evento de crédito aprovado:", e); }
      }
      return { success: true };
    }),

  /**
   * Qualidade do lead — o vendedor diz "quero mais clientes assim" (bom) ou
   * "cliente ruim". É o sinal de MAIOR prioridade: manda mais que crédito e IA.
   * "bom" dispara o evento forte na Meta; "ruim" bloqueia os eventos profundos.
   */
  setQuality: protectedProcedure
    .input(z.object({
      leadId: z.number(),
      quality: z.enum(["alta", "baixa", "limpar"]),
      reason: z.string().max(200).optional(),
      visitedStore: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const { leads: leadsT } = await import("../../drizzle/schema");
      const lead = (await db.select().from(leadsT).where(eq(leadsT.id, input.leadId)).limit(1))[0];
      if (!lead) throw new Error("Lead não encontrado");
      const clear = input.quality === "limpar";

      await db.update(leadsT).set({
        quality: clear ? null : input.quality,
        qualitySource: clear ? null : "vendedor",
        qualityReason: clear ? null : (input.reason || null),
        ...(input.visitedStore != null ? { visitedStore: input.visitedStore } : {}),
        updatedAt: new Date(),
      } as any).where(eq(leadsT.id, input.leadId));

      const { logTimeline } = await import("../db");
      await logTimeline({
        conversationId: lead.conversationId, leadId: input.leadId, userId: ctx.user.id,
        action: clear ? "qualidade_removida" : "qualidade",
        details: clear ? {} : { qualidade: input.quality, motivo: input.reason, visitou: input.visitedStore },
      });

      // Qualidade ALTA = sinal forte pra Meta ("quero mais assim"), mesmo sem crédito
      if (input.quality === "alta") {
        try {
          const { trackLeadProgress } = await import("../metaConversions");
          void trackLeadProgress(input.leadId, { funnelStatus: "pagamento_definido" });
        } catch (e) { console.error("[CAPI] evento de lead bom:", e); }
      }
      return { success: true };
    }),

  /** Vincula (ou desvincula) um veículo do estoque ao lead */
  linkVehicle: protectedProcedure
    .input(z.object({ leadId: z.number(), vehicleId: z.number().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const { leads: leadsT, vehicles: vehT } = await import("../../drizzle/schema");
      const lead = (await db.select().from(leadsT).where(eq(leadsT.id, input.leadId)).limit(1))[0];
      if (!lead) throw new Error("Lead não encontrado");
      await db.update(leadsT).set({ vehicleId: input.vehicleId, updatedAt: new Date() } as any).where(eq(leadsT.id, input.leadId));
      if (input.vehicleId) {
        const v = (await db.select().from(vehT).where(eq(vehT.id, input.vehicleId)).limit(1))[0];
        const { logTimeline } = await import("../db");
        await logTimeline({ conversationId: lead.conversationId, leadId: input.leadId, userId: ctx.user.id, action: "veiculo_vinculado", details: { veiculo: v ? `${v.brand} ${v.model} ${v.year}` : String(input.vehicleId) } });
      }
      return { success: true };
    }),

  /** IA analisa UMA conversa: temperatura, objeções, crédito, próxima ação */
  analyze: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      const { analyzeConversation } = await import("../conversationIntelligence");
      const result = await analyzeConversation(input.conversationId);
      if (!result) throw new Error("Sem mensagens suficientes para analisar");
      return result;
    }),

  /** IA analisa em lote as conversas de uma fonte/período (painel do gestor) */
  analyzeBulk: protectedProcedure
    .input(z.object({
      source: z.string().optional(), // "matriz" ou nome da instância
      sinceDays: z.number().min(1).max(90).default(7),
      limit: z.number().min(1).max(80).default(40),
    }))
    .mutation(async ({ input }) => {
      const { analyzeBulk } = await import("../conversationIntelligence");
      return analyzeBulk(input);
    }),

  /** Painel de inteligência: leads com insight, ranqueados por score */
  intelligence: protectedProcedure
    .input(z.object({
      source: z.string().optional(),
      sinceDays: z.number().min(1).max(90).default(7),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { conversationInsights, conversations: convTable } = await import("../../drizzle/schema");
      const { eq, and: andOp, ne: neOp, gte: gteOp, desc: descOp } = await import("drizzle-orm");
      const sinceDays = input?.sinceDays ?? 7;
      const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

      const conds = [gteOp(convTable.lastMessageAt, since), eq(convTable.archived, false)];
      const src = input?.source;
      if (!src || src === "matriz") conds.push(neOp(convTable.channel, "evolution" as any));
      else if (src !== "todas") { conds.push(eq(convTable.channel, "evolution" as any)); conds.push(eq(convTable.instanceName, src)); }

      const rows = await db.select({
        conversationId: convTable.id,
        contactName: convTable.contactName,
        phone: convTable.phone,
        instanceName: convTable.instanceName,
        channel: convTable.channel,
        lastMessageAt: convTable.lastMessageAt,
        assignedTo: convTable.assignedTo,
        temperature: conversationInsights.temperature,
        score: conversationInsights.score,
        summary: conversationInsights.summary,
        buyingSignals: conversationInsights.buyingSignals,
        objections: conversationInsights.objections,
        creditStatus: conversationInsights.creditStatus,
        nextAction: conversationInsights.nextAction,
        vehicleInterest: conversationInsights.vehicleInterest,
        analyzedAt: conversationInsights.analyzedAt,
        messageCount: conversationInsights.messageCount,
      }).from(convTable)
        .innerJoin(conversationInsights, eq(conversationInsights.conversationId, convTable.id))
        .where(andOp(...conds))
        .orderBy(descOp(conversationInsights.score))
        .limit(200);
      return rows;
    }),

  /** List leads with conversation data, vehicle, agent, and latest summary preview */
  listWithDetails: protectedProcedure
    .input(z.object({ status: z.string().optional(), discarded: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const { leads: leadsTable, conversations: convsTable, leadSummaries: summariesTable, vehicles: vehiclesTable, teamMembers: membersTable, sellerAssignments: assignmentsTable, sellers: sellersTable, rescueAttempts: rescueTable } = await import("../../drizzle/schema");
      const { eq, desc, inArray, and: andOp } = await import("drizzle-orm");

      // discarded=true → aba "Não é lead" (isLead=false); senão só os leads reais
      const leadScope = eq(leadsTable.isLead, input?.discarded ? false : true);
      let allLeads;
      if (input?.status && input.status !== "all" && !input?.discarded) {
        allLeads = await db.select().from(leadsTable).where(andOp(eq(leadsTable.status, input.status as any), leadScope)).orderBy(desc(leadsTable.updatedAt));
      } else {
        allLeads = await db.select().from(leadsTable).where(leadScope).orderBy(desc(leadsTable.updatedAt));
      }
      if (allLeads.length === 0) return [];

      // Batch fetch conversations, summaries, vehicles, team members
      const convIds = Array.from(new Set(allLeads.map(l => l.conversationId)));
      const convs = await db.select().from(convsTable).where(inArray(convsTable.id, convIds));
      const convMap = new Map(convs.map(c => [c.id, c]));

      // Conversa MAIS RECENTE de cada lead — a pessoa pode ter falado em vários
      // números/instâncias; a lista deve mostrar a última conversa, não a original.
      const leadIdsForConv = allLeads.map(l => l.id);
      const leadConvs = leadIdsForConv.length
        ? await db.select().from(convsTable).where(inArray(convsTable.leadId, leadIdsForConv))
        : [];
      const recentConvByLead = new Map<number, any>();
      for (const c of leadConvs) {
        if (c.leadId == null) continue;
        const cur = recentConvByLead.get(c.leadId);
        if (!cur || (Number(c.lastMessageAt) || 0) > (Number(cur.lastMessageAt) || 0)) recentConvByLead.set(c.leadId, c);
      }

      // ESCOPO POR VENDEDOR: só vê leads que falaram na instância dele OU que ele é dono.
      const memberL = await currentTeamMember(ctx);
      if (memberL && memberL.cargo === "vendedor") {
        const { allowedInboxSourcesForMember } = await import("../db");
        const allowedSet = new Set(await allowedInboxSourcesForMember(memberL.id));
        const leadSources = new Map<number, Set<string>>();
        for (const c of leadConvs) {
          if (c.leadId == null) continue;
          const s = conversationSourceValue(c as any);
          (leadSources.get(c.leadId) || leadSources.set(c.leadId, new Set<string>()).get(c.leadId)!).add(s);
        }
        allLeads = allLeads.filter((l: any) =>
          (l.ownerId != null && l.ownerId === memberL.id) ||
          Array.from(leadSources.get(l.id) || []).some((s) => allowedSet.has(s))
        );
        if (allLeads.length === 0) return [];
      }
      // ── Não respondidos + tempo de resposta ──────────────────────────────────
      // Decidido pela ORDEM REAL das mensagens (não por colunas de timestamp, que
      // podem vir de fusos/fontes diferentes): se a última mensagem da conversa é
      // do CLIENTE e não houve resposta depois → está aguardando.
      const waitingByLead = new Map<number, number>();   // leadId → desde quando aguarda (epoch ms)
      const avgRespByLead = new Map<number, number>();
      try {
        const { messages: msgsT } = await import("../../drizzle/schema");
        const { gte: gteM } = await import("drizzle-orm");
        // Só conversas com atividade recente (limita o peso da consulta)
        const since30ms = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const activeConvs = leadConvs.filter(c => Number(c.lastMessageAt || 0) >= since30ms).slice(0, 800);
        const convIdsForResp = activeConvs.map(c => c.id);
        if (convIdsForResp.length) {
          const since30 = new Date(since30ms);
          const rows = await db.select({
            conversationId: msgsT.conversationId, senderType: msgsT.senderType, createdAt: msgsT.createdAt,
          }).from(msgsT)
            .where(andOp(inArray(msgsT.conversationId, convIdsForResp), gteM(msgsT.createdAt, since30)))
            .orderBy(msgsT.createdAt);

          const convToLead = new Map<number, number>();
          for (const c of activeConvs) if (c.leadId != null) convToLead.set(c.id, c.leadId);

          // Última do cliente x última resposta (atendente OU IA) por conversa
          const lastCustAt = new Map<number, number>();
          const lastReplyAt = new Map<number, number>();
          // Tempo de resposta: pares (cliente → próxima resposta humana)
          const acc = new Map<number, { sum: number; n: number }>();
          const pendingByConv = new Map<number, number>();

          for (const m of rows) {
            const leadId = convToLead.get(m.conversationId);
            if (leadId == null) continue;
            const t = new Date(m.createdAt as any).getTime();
            if (m.senderType === "customer") {
              lastCustAt.set(m.conversationId, t);
              if (!pendingByConv.has(m.conversationId)) pendingByConv.set(m.conversationId, t);
            } else if (m.senderType === "agent" || m.senderType === "bot") {
              lastReplyAt.set(m.conversationId, t);
              if (m.senderType === "agent") {
                const started = pendingByConv.get(m.conversationId);
                if (started != null) {
                  const a = acc.get(leadId) || { sum: 0, n: 0 };
                  a.sum += (t - started) / 1000; a.n += 1;
                  acc.set(leadId, a);
                }
              }
              pendingByConv.delete(m.conversationId);
            }
          }
          for (const [leadId, a] of Array.from(acc)) if (a.n > 0) avgRespByLead.set(leadId, Math.round(a.sum / a.n));

          // Marca quem está aguardando. waitingSince usa lastCustomerMessageAt
          // (epoch absoluto) para a conta de "há quanto tempo" ficar correta.
          for (const c of activeConvs) {
            if (c.leadId == null) continue;
            const lc = lastCustAt.get(c.id);
            if (!lc) continue;
            const lr = lastReplyAt.get(c.id) || 0;
            if (lc > lr) {
              const since = Number((c as any).lastCustomerMessageAt || 0) || Number(c.lastMessageAt || 0);
              if (!since) continue;
              const cur = waitingByLead.get(c.leadId) || 0;
              if (!cur || since < cur) waitingByLead.set(c.leadId, since); // espera mais antiga
            }
          }
        }
      } catch (e) { console.error("[Leads] tempo de resposta:", e); }

      // JÁ É CLIENTE? Quantas compras a pessoa já fez (oportunidades ganhas).
      // Serve para o vendedor ver de cara que aquele contato já comprou antes.
      const comprasPorLead = new Map<number, number>();
      try {
        const { leadOpportunities } = await import("../../drizzle/schema");
        const won = await db.select({ leadId: leadOpportunities.leadId })
          .from(leadOpportunities)
          .where(andOp(inArray(leadOpportunities.leadId, allLeads.map(l => l.id)), eq(leadOpportunities.status, "won")));
        for (const w of won) comprasPorLead.set(w.leadId, (comprasPorLead.get(w.leadId) || 0) + 1);
      } catch { /* opcional */ }

      // Mapa accountId (instanceName cru do Zernio) → nome cadastrado (Deivid, etc.)
      let zernioNameByAccount = new Map<string, string>();
      try {
        const { zernioInstances } = await import("../../drizzle/schema");
        const zi = await db.select().from(zernioInstances);
        zernioNameByAccount = new Map(zi.map(z => [z.accountId, z.displayName || z.phone || z.accountId]));
      } catch { /* tabela pode não existir */ }

      const leadIds = allLeads.map(l => l.id);
      const summaries = await db.select().from(summariesTable).where(inArray(summariesTable.leadId, leadIds)).orderBy(desc(summariesTable.summaryDate));
      const summaryMap = new Map<number, typeof summaries>();
      summaries.forEach(s => {
        if (!summaryMap.has(s.leadId)) summaryMap.set(s.leadId, []);
        summaryMap.get(s.leadId)!.push(s);
      });

      const vehicleIds = allLeads.filter(l => l.vehicleId).map(l => l.vehicleId!) as number[];
      let vehicleMap = new Map<number, any>();
      if (vehicleIds.length > 0) {
        const vehs = await db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds));
        vehicleMap = new Map(vehs.map(v => [v.id, v]));
      }

      const agentIds = Array.from(new Set(convs.filter(c => c.assignedTo).map(c => c.assignedTo!)));
      let agentMap = new Map<number, any>();
      if (agentIds.length > 0) {
        const agents = await db.select().from(membersTable).where(inArray(membersTable.id, agentIds));
        agentMap = new Map(agents.map(a => [a.id, a]));
      }

      // Batch fetch seller assignments (latest per conversation)
      const allAssignments = convIds.length > 0
        ? await db.select().from(assignmentsTable).where(inArray(assignmentsTable.conversationId, convIds)).orderBy(desc(assignmentsTable.assignedAt))
        : [];
      const assignmentMap = new Map<number, typeof allAssignments[0]>();
      allAssignments.forEach(a => {
        if (!assignmentMap.has(a.conversationId)) assignmentMap.set(a.conversationId, a);
      });

      // Batch fetch sellers for assignments
      const sellerIds = Array.from(new Set(allAssignments.filter(a => a.sellerId).map(a => a.sellerId)));
      let sellerMap = new Map<number, any>();
      if (sellerIds.length > 0) {
        const sllrs = await db.select().from(sellersTable).where(inArray(sellersTable.id, sellerIds));
        sellerMap = new Map(sllrs.map(s => [s.id, s]));
      }

      // Batch fetch rescue attempts
      const allRescues = leadIds.length > 0
        ? await db.select().from(rescueTable).where(inArray(rescueTable.leadId, leadIds)).orderBy(desc(rescueTable.sentAt))
        : [];
      const rescueMap = new Map<number, typeof allRescues>();
      allRescues.forEach(r => {
        if (!rescueMap.has(r.leadId)) rescueMap.set(r.leadId, []);
        rescueMap.get(r.leadId)!.push(r);
      });

      return allLeads.map(lead => {
        // Prefere a conversa MAIS RECENTE do lead; cai pra original se não houver.
        const conv = recentConvByLead.get(lead.id) || convMap.get(lead.conversationId);
        const sums = summaryMap.get(lead.id) || [];
        const vehicle = lead.vehicleId ? vehicleMap.get(lead.vehicleId) : null;
        const agent = conv?.assignedTo ? agentMap.get(conv.assignedTo) : null;
        // Build preview: combine all summaries into one (latest first), max 3 lines
        const fullSummary = sums.map(s => s.summary).join("\n").trim();
        const summaryPreview = fullSummary.split("\n").slice(0, 3).join("\n") || "";

        // Seller assignment info
        const assignment = assignmentMap.get(lead.conversationId);
        const seller = assignment ? sellerMap.get(assignment.sellerId) : null;

        // Rescue attempts info
        const rescues = rescueMap.get(lead.id) || [];

        // Aguardando resposta? (não conta lead fechado/perdido)
        const finalizado = lead.funnelStatus === "fechado" || lead.funnelStatus === "perdido";
        const waitingSince = finalizado ? null : (waitingByLead.get(lead.id) ?? null);

        // ── PONTUAÇÃO DO LEAD (0–100) ──────────────────────────────────────────
        // Soma de sinais objetivos. Serve para priorizar atendimento e, no futuro,
        // para alimentar público/otimização. Tudo transparente e auditável.
        const L: any = lead;
        let pts = 0;
        if (L.creditApproved === "sim") pts += 30;           // crédito aprovado
        if (L.creditApproved === "nao") pts -= 25;           // sem crédito
        if (L.visitedStore) pts += 25;                        // visitou a loja
        if (L.hasTrade) pts += 12;                            // tem troca
        if (L.vehicleId) pts += 10;                           // veículo definido do estoque
        else if (L.vehicleInterest && L.vehicleInterest !== "não definido") pts += 5;
        // Etapa do funil
        const etapaPts: Record<string, number> = {
          negociando: 15, encaminhado_vendedor: 12, dados_troca: 10,
          dados_pessoais: 10, pagamento_definido: 10, interesse_definido: 5, novo: 0,
        };
        pts += etapaPts[String(L.funnelStatus)] ?? 0;
        // Temperatura da IA (leitura da conversa)
        const tempPts: Record<string, number> = { muito_quente: 10, quente: 7, morno: 3, frio: 0 };
        pts += tempPts[String(L.temperature)] ?? 0;
        // Penaliza quem está largado sem resposta
        if (waitingSince) {
          const diasEsperando = (Date.now() - Number(waitingSince)) / 86400000;
          if (diasEsperando > 3) pts -= 10;
          else if (diasEsperando > 1) pts -= 5;
        }
        // Qualidade marcada pelo VENDEDOR pesa forte (é quem viu o cliente)
        if (L.quality === "alta") pts += 20;
        if (L.quality === "baixa") pts -= 20;
        const qualityScore = Math.max(0, Math.min(100, pts));

        return {
          ...lead,
          unanswered: waitingSince != null,
          waitingSince,                                   // epoch ms desde a msg do cliente
          avgResponseSec: avgRespByLead.get(lead.id) ?? null,
          qualityScore,                                   // pontuação 0–100 do lead
          // Já comprou antes? (oportunidades ganhas, ou está fechado agora)
          purchases: (comprasPorLead.get(lead.id) || 0) + (lead.funnelStatus === "fechado" ? 1 : 0),
          isCustomer: (comprasPorLead.get(lead.id) || 0) > 0 || lead.funnelStatus === "fechado",
          conversation: conv ? {
            id: conv.id,
            contactName: conv.contactName,
            contactPhoto: conv.contactPhoto,
            channel: conv.channel,
            instanceName: conv.instanceName,
            // Rótulo amigável da instância (Zernio: accountId → nome cadastrado)
            instanceLabel: conv.channel === "zernio"
              ? (zernioNameByAccount.get(conv.instanceName || "") || "Recepção")
              : (conv.instanceName || null),
            source: conversationSourceValue(conv as any),
            status: conv.status,
            aiActive: conv.aiActive,
            lastMessageAt: conv.lastMessageAt,
          } : null,
          summaryPreview,
          fullSummary,
          summaries: sums.map(s => ({ id: s.id, date: s.summaryDate, summary: s.summary, messageCount: s.messageCount })),
          linkedVehicle: vehicle ? {
            id: vehicle.id,
            brand: vehicle.brand,
            model: vehicle.model,
            year: vehicle.year,
            price: vehicle.price,
            color: vehicle.color,
            imageUrl: vehicle.imageUrl,
            url: vehicle.url,
          } : null,
          assignedAgent: agent ? { id: agent.id, name: agent.name, cargo: agent.cargo } : null,
          sellerAssignment: assignment && seller ? {
            sellerName: seller.name,
            sellerPhone: seller.phone,
            storeLocation: assignment.storeLocation,
            status: assignment.status,
            assignedAt: assignment.assignedAt?.getTime() || null,
            contactedAt: assignment.contactedAt?.getTime() || null,
          } : null,
          rescueInfo: rescues.length > 0 ? {
            totalAttempts: rescues.length,
            lastAttemptAt: rescues[0].sentAt?.getTime() || null,
            responded: rescues.some(r => r.status === "responded"),
            attempts: rescues.map(r => ({
              attemptNumber: r.attemptNumber,
              status: r.status,
              sentAt: r.sentAt?.getTime() || null,
              respondedAt: r.respondedAt?.getTime() || null,
            })),
          } : null,
        };
      });
    }),

  getByConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const lead: any = await getLeadByConversationId(input.conversationId);
      if (!lead) return lead;
      // "Já é cliente": nº de compras (oportunidades ganhas) — o vendedor precisa
      // ver isso de cara ao abrir a conversa.
      let purchases = lead.funnelStatus === "fechado" ? 1 : 0;
      try {
        const db = await getDb();
        if (db) {
          const { leadOpportunities } = await import("../../drizzle/schema");
          const { and: andO } = await import("drizzle-orm");
          const won = await db.select({ id: leadOpportunities.id }).from(leadOpportunities)
            .where(andO(eq(leadOpportunities.leadId, lead.id), eq(leadOpportunities.status, "won")));
          purchases += won.length;
        }
      } catch { /* opcional */ }
      return { ...lead, purchases, isCustomer: purchases > 0 };
    }),

  /** Get summaries for a specific lead */
  getSummaries: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      return getLeadSummaries(input.leadId);
    }),

  /** Generate/update summary for today based on conversation messages */
  generateSummary: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      const lead = await getLeadByConversationId(input.conversationId);
      if (!lead) throw new Error("Lead not found");

      // Get today's messages
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { messages: msgsTable } = await import("../../drizzle/schema");
      const { eq, and: andOp, gte } = await import("drizzle-orm");

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split("T")[0];

      const todayMsgs = await db.select().from(msgsTable)
        .where(andOp(eq(msgsTable.conversationId, input.conversationId), gte(msgsTable.createdAt, today)))
        .orderBy(msgsTable.createdAt);

      if (todayMsgs.length === 0) return null;

      // Build conversation text for summary
      const convText = todayMsgs.map(m => {
        const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Atendente";
        return `${role}: ${m.content}`;
      }).join("\n");

      // Use LLM to generate summary
      const { invokeLLM } = await import("../_core/llm");
      let summaryText: string;
      try {
        const resp = await invokeLLM({
          messages: [
            { role: "system", content: "Você é um assistente que gera resumos concisos de conversas de atendimento de uma loja de veículos. Gere um resumo em 3-5 linhas do que aconteceu na conversa. Inclua: interesse do cliente, veículos mencionados, decisões tomadas, próximos passos. Seja objetivo e direto. NÃO use markdown." },
            { role: "user", content: `Resuma esta conversa do dia ${todayStr}:\n\n${convText}` },
          ],
        });
        const rawContent = resp.choices?.[0]?.message?.content;
        summaryText = (typeof rawContent === "string" ? rawContent : "") || "Resumo indisponível";
      } catch {
        summaryText = `${todayMsgs.length} mensagens trocadas.`;
      }

      await upsertLeadSummary({
        leadId: lead.id,
        conversationId: input.conversationId,
        summaryDate: todayStr,
        summary: summaryText,
        messageCount: todayMsgs.length,
      });

      return { date: todayStr, summary: summaryText, messageCount: todayMsgs.length };
    }),

  update: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      name: z.string().optional(),
      intention: z.string().optional(),
      vehicleInterest: z.string().optional(),
      vehicleId: z.number().nullable().optional(),
      hasTrade: z.boolean().optional(),
      tradeVehicle: z.string().optional(),
      tradeYear: z.string().optional(),
      tradeKm: z.string().optional(),
      paymentMethod: z.string().optional(),
      downPayment: z.string().optional(),
      city: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["new", "qualifying", "qualified", "contacted", "converted", "lost"]).optional(),
      funnelStatus: z.enum(["novo", "interesse_definido", "pagamento_definido", "dados_pessoais", "dados_troca", "encaminhado_vendedor", "negociando", "fechado", "perdido"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { conversationId, funnelStatus, ...data } = input;
      const conv = await getConversationById(conversationId);
      const updateData: any = { ...data };
      let stageChanged = false;
      if (funnelStatus) {
        const prevLead = await getLeadByConversationId(conversationId).catch(() => null);
        stageChanged = (prevLead?.funnelStatus || null) !== funnelStatus;
        updateData.funnelStatus = funnelStatus;
        // Auto-calculate temperature from funnel status
        const tempMap: Record<string, string> = {
          novo: "frio", perdido: "frio",
          interesse_definido: "morno",
          pagamento_definido: "quente", dados_pessoais: "quente", dados_troca: "quente",
          encaminhado_vendedor: "muito_quente", negociando: "muito_quente", fechado: "muito_quente",
        };
        updateData.temperature = tempMap[funnelStatus] || "frio";
      }
      const saved = await upsertLead({
        conversationId,
        phone: conv?.phone || "",
        ...updateData,
      });
      // Gatilho de CRM: entrou em etapa do funil (só quando muda de fato)
      if (stageChanged && funnelStatus) {
        (async () => {
          try {
            const { triggerEventFlow } = await import("../flowEngine");
            await triggerEventFlow({ conversationId, triggerType: "funnel_stage_entered", matchValue: funnelStatus });
          } catch (e) { console.error("[CRM trigger] etapa:", e); }
        })();
      }
      return saved;
    }),
});
