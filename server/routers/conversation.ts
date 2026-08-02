// ── Conversation Router (extraído de routers.ts no PR #10 — só move) ────────
import { z } from "zod";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDb, listConversations, getConversationById, updateConversation,
  markMessagesAsRead, pauseFlowSessionByConversation, upsertLead,
  getContactByPhone, createContact, updateContact, createMessage,
} from "../db";
import { listTeamMembers as listTeamMembersAuth } from "../teamAuth";
import { normalizePhone, phoneVariations } from "../phoneNormalize";
import { sendTextMessage, isConfigured as isWhatsAppConfigured } from "../whatsapp";
import { emitNewMessage, emitConversationUpdate } from "../socket";
import { currentTeamMember, conversationSourceValue } from "./_helpers";

export const conversationRouter = router({
  /** Resolve a "fonte"/aba do inbox de uma conversa (corrige o "Ir para conversa") */
  sourceOf: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) return { source: "matriz" };
      return { source: conversationSourceValue(conv as any) };
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      search: z.string().optional(),
      searchContent: z.boolean().optional(), // procurar também no texto das mensagens
      instance: z.string().optional(), // "matriz" (padrão) ou nome da instância Evolution
      archived: z.boolean().optional(),
      limit: z.number().min(1).max(300).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      // Vendedor só vê as conversas das instâncias atribuídas a ele.
      const member = await currentTeamMember(ctx);
      if (member && member.cargo === "vendedor") {
        const { allowedInboxSourcesForMember } = await import("../db");
        const allowed = await allowedInboxSourcesForMember(member.id);
        if (allowed.length === 0) return [];
        const requested = input?.instance;
        if (requested && requested !== "matriz") {
          // Pediu uma aba específica: só devolve se for dele
          return allowed.includes(requested) ? listConversations(input) : [];
        }
        // Sem aba específica (ou "matriz"): junta as conversas das instâncias dele
        const merged: any[] = [];
        for (const src of allowed) merged.push(...await listConversations({ ...(input || {}), instance: src }));
        merged.sort((a, b) => (Number(b.lastMessageAt) || 0) - (Number(a.lastMessageAt) || 0));
        return merged.slice(0, input?.limit ?? 100);
      }
      return listConversations(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const conv = await getConversationById(input.id);
      if (!conv) throw new Error("Conversation not found");
      // Vendedor não pode abrir conversa de instância que não é dele
      const member = await currentTeamMember(ctx);
      if (member && member.cargo === "vendedor") {
        const { allowedInboxSourcesForMember } = await import("../db");
        const allowed = await allowedInboxSourcesForMember(member.id);
        const src = conversationSourceValue(conv as any);
        if (!allowed.includes(src)) throw new Error("Sem permissão para esta conversa");
      }
      return conv;
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["open", "pending", "resolved", "closed"]),
    }))
    .mutation(async ({ input }) => {
      const conv = await updateConversation(input.id, { status: input.status });
      emitConversationUpdate(input.id, conv);
      // CSAT: pesquisa de satisfação ao resolver (fire-and-forget, se habilitada)
      if (input.status === "resolved") {
        import("../csat").then(({ requestCsat }) => requestCsat(input.id))
          .catch(err => console.error("[CSAT] hook updateStatus:", err));
      }
      return conv;
    }),

  toggleAI: protectedProcedure
    .input(z.object({
      id: z.number(),
      aiActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const conv = await updateConversation(input.id, {
        aiActive: input.aiActive,
        routingState: input.aiActive ? "ai_agent" : "human",
      });
      emitConversationUpdate(input.id, conv);
      return conv;
    }),

  // Roteamento unificado da conversa: um só condutor por vez (fluxo / IA / humano).
  // Trocar de modo é exclusivo — sair para IA ou humano pausa qualquer fluxo ativo.
  // (O modo "flow" é iniciado por flow.startForConversation, que também ajusta o routingState.)
  setRouting: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      mode: z.enum(["ai_agent", "human"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getConversationById(input.conversationId);
      if (!before) throw new Error("Conversa não encontrada");
      // Sempre pausa fluxo ao entregar para IA ou humano
      await pauseFlowSessionByConversation(input.conversationId).catch(() => {});
      if (input.mode === "ai_agent") {
        const conv = await updateConversation(input.conversationId, {
          aiActive: true,
          routingState: "ai_agent",
        });
        emitConversationUpdate(input.conversationId, conv);
        return conv;
      }
      // human
      const conv = await updateConversation(input.conversationId, {
        aiActive: false,
        assignedTo: ctx.user.id,
        routingState: "human",
      });
      emitConversationUpdate(input.conversationId, conv);
      if (before.assignedTo !== ctx.user.id) {
        const { logTimeline } = await import("../db");
        logTimeline({
          conversationId: input.conversationId,
          userId: ctx.user.id,
          action: "atribuido_atendente",
          details: { para: ctx.user.name || null },
        }).catch(() => {});
      }
      return conv;
    }),

  assignAgent: protectedProcedure
    .input(z.object({
      id: z.number(),
      agentId: z.number().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getConversationById(input.id);
      const conv = await updateConversation(input.id, {
        assignedTo: input.agentId,
        aiActive: input.agentId ? false : true,
      });
      emitConversationUpdate(input.id, conv);
      // Linha do tempo: transferência/atribuição de atendente
      if (before?.assignedTo !== input.agentId) {
        const { logTimeline } = await import("../db");
        let fromName: string | null = null, toName: string | null = null;
        try {
          const members = await listTeamMembersAuth();
          fromName = (members as any[]).find((m: any) => m.id === before?.assignedTo)?.name || null;
          toName = (members as any[]).find((m: any) => m.id === input.agentId)?.name || null;
        } catch {}
        logTimeline({
          conversationId: input.id,
          userId: ctx.user.id,
          action: input.agentId ? "atribuido_atendente" : "liberado_atendente",
          details: { de: fromName, para: toName },
        }).catch(() => {});
      }
      return conv;
    }),

  updateContact: protectedProcedure
    .input(z.object({
      id: z.number(),
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
      contactNotes: z.string().optional(),
      // Corrigir telefone manualmente (ex.: contato @lid sem número real)
      phone: z.string().min(10).max(20).regex(/^\d+$/, "Apenas dígitos, com DDI (ex: 5551999998888)").optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const conv = await updateConversation(id, data);
      emitConversationUpdate(id, conv);
      return conv;
    }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await markMessagesAsRead(input.id);
      return { success: true };
    }),

  /**
   * Transfere o atendimento da matriz (API oficial) para a instância de um vendedor:
   * 1. Envia a primeira mensagem ao cliente PELA INSTÂNCIA do vendedor
   * 2. Registra nota interna na conversa oficial informando a transferência
   * 3. Finaliza a conversa oficial (status resolved)
   * O lead/funil continua o mesmo — o histórico fica preservado nos dois lados.
   */
  transferToInstance: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      instanceName: z.string().min(1),
      message: z.string().min(1).max(4000),
    }))
    .mutation(async ({ input, ctx }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new Error("Conversa não encontrada");
      if (conv.channel === "evolution") throw new Error("Esta conversa já está numa instância de vendedor");
      if (!conv.phone) throw new Error("Conversa sem telefone");

      // 1. Envia pela instância do vendedor
      const { evolutionSendText } = await import("../evolutionService");
      const result = await evolutionSendText(input.instanceName, conv.phone, input.message);
      const evoMsgId = (result as any)?.key?.id;

      // 2. Espelha no inbox unificado (cria a conversa da instância já com o histórico iniciado)
      const { mirrorEvolutionMessage } = await import("../db");
      const mirrored = await mirrorEvolutionMessage({
        instanceName: input.instanceName,
        phone: conv.phone,
        remoteJid: `${conv.phone}@s.whatsapp.net`,
        contactName: conv.contactName || undefined,
        content: input.message,
        messageType: "text",
        direction: "outbound",
        senderName: ctx.user.name || "Vendedor",
        externalId: evoMsgId ? `evo_${evoMsgId}` : undefined,
        timestamp: Date.now(),
      });
      if (mirrored) emitNewMessage(mirrored.conversationId, mirrored.message);

      // 3. Nota interna + finaliza a conversa oficial
      const note = await createMessage({
        conversationId: input.conversationId,
        content: `📤 Atendimento transferido para a instância "${input.instanceName}" por ${ctx.user.name || "atendente"}. O vendedor continua a conversa pelo número da instância.`,
        senderType: "internal",
        senderName: ctx.user.name || "Sistema",
        messageType: "text",
      });
      emitNewMessage(input.conversationId, note);
      await updateConversation(input.conversationId, { status: "resolved", aiActive: false });
      emitConversationUpdate(input.conversationId, { status: "resolved" });

      // 4. Transferência = marco de funil: sobe o lead CANÔNICO para "encaminhado
      //    ao vendedor" (dispara InitiateCheckout na Meta, atribuído ao anúncio).
      try {
        const { updateLeadFunnelStatus: updFunnel, getCanonicalLead: getCanon, upsertLead: upLead, logTimeline: logTl } = await import("../db");
        const canonForLog = conv.phone ? await getCanon(conv.phone) : undefined;
        await logTl({ conversationId: input.conversationId, leadId: canonForLog?.id, userId: ctx.user.id, action: "lead_transferido", details: { para: input.instanceName, por: ctx.user.name || "atendente" } });
        // Dono do lead = usuário/vendedor associado à instância de destino (base do acesso do vendedor)
        try {
          const db2 = await getDb();
          if (db2 && canonForLog?.id) {
            const { evolutionInstances, leads: leadsT } = await import("../../drizzle/schema");
            const inst = (await db2.select().from(evolutionInstances).where(eq(evolutionInstances.instanceName, input.instanceName)).limit(1))[0];
            const ownerId = (inst as any)?.assignedUserId || (inst as any)?.sellerId || null;
            if (ownerId) {
              await db2.update(leadsT).set({ ownerId }).where(eq(leadsT.id, canonForLog.id));
              // Atribui a conversa do vendedor a ele → aparece no portal "Meus leads"
              if (mirrored?.conversationId) {
                const { conversations: convT2 } = await import("../../drizzle/schema");
                await db2.update(convT2).set({ assignedTo: ownerId }).where(eq(convT2.id, mirrored.conversationId));
              }
            }
          }
        } catch (e) { console.error("[Transfer] set owner:", e); }
        await updFunnel(input.conversationId, "encaminhado_vendedor");
        // 5. Propaga a atribuição do anúncio (ctwaId) + interesse para o lead do
        //    número do vendedor, para a venda lá continuar atribuída ao anúncio.
        if (mirrored?.conversationId && conv.phone) {
          const canon = await getCanon(conv.phone);
          if (canon && (canon.ctwaId || canon.metaLeadId || (canon as any).vehicleInterest)) {
            await upLead({
              conversationId: mirrored.conversationId,
              phone: conv.phone,
              ctwaId: canon.ctwaId || undefined,
              metaLeadId: canon.metaLeadId || undefined,
              vehicleInterest: (canon as any).vehicleInterest || undefined,
            } as any);
          }
        }
      } catch (e) {
        console.error("[Transfer] funil/atribuição:", e);
      }

      return { success: true, sellerConversationId: mirrored?.conversationId ?? null };
    }),

  /** Verifica se já existe conversa com este número na fonte escolhida */
  findByPhone: protectedProcedure
    .input(z.object({ phone: z.string().min(8), instance: z.string().default("matriz") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const { conversations: convTable } = await import("../../drizzle/schema");
      const { eq, and: andOp, ne: neOp, or: orOp } = await import("drizzle-orm");
      const digits = input.phone.replace(/\D/g, "");
      const variations = Array.from(new Set([digits, ...phoneVariations(digits)]));
      const isMatriz = input.instance === "matriz";
      const phoneCond = orOp(...variations.map(v => eq(convTable.phone, v)))!;
      const row = (await db.select({
        id: convTable.id, contactName: convTable.contactName, phone: convTable.phone,
      }).from(convTable).where(
        isMatriz
          ? andOp(phoneCond, neOp(convTable.channel, "evolution" as any))
          : andOp(phoneCond, eq(convTable.channel, "evolution" as any), eq(convTable.instanceName, input.instance))
      ).limit(1))[0];
      return row || null;
    }),

  /** Fixa (ou solta) o agente de IA de uma conversa */
  setAgent: protectedProcedure
    .input(z.object({ conversationId: z.number(), agentId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const conv = await updateConversation(input.conversationId, { agentId: input.agentId } as any);
      emitConversationUpdate(input.conversationId, { agentId: input.agentId });
      return conv;
    }),

  /** Arquiva/desarquiva uma ou várias conversas */
  setArchived: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations: convTable } = await import("../../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      await db.update(convTable).set({ archived: input.archived, updatedAt: new Date() }).where(inArray(convTable.id, input.ids));
      input.ids.forEach(id => emitConversationUpdate(id, { archived: input.archived }));
      return { success: true, count: input.ids.length };
    }),

  /** Exclui permanentemente uma ou várias conversas (mensagens, labels, lembretes, agendadas) */
  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations: convTable, messages: msgTable, conversationLabels: clTable, conversationReminders: crTable, scheduledMessages: smTable } = await import("../../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      await db.delete(msgTable).where(inArray(msgTable.conversationId, input.ids));
      await db.delete(clTable).where(inArray(clTable.conversationId, input.ids));
      await db.delete(crTable).where(inArray(crTable.conversationId, input.ids));
      await db.delete(smTable).where(inArray(smTable.conversationId, input.ids));
      await db.delete(convTable).where(inArray(convTable.id, input.ids));
      return { success: true, count: input.ids.length };
    }),

  /** Inicia uma nova conversa (matriz ou instância Evolution) com contato novo ou existente */
  startNew: protectedProcedure
    .input(z.object({
      name: z.string().max(255).optional(),
      phone: z.string().min(10).max(20),
      instance: z.string().default("matriz"), // "matriz" ou nome da instância Evolution
      firstMessage: z.string().max(4000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const normPhone = normalizePhone;
      const phone = normPhone(input.phone.replace(/\D/g, ""));
      if (!phone || phone.length < 10) throw new Error("Telefone inválido — use DDI+DDD+número");

      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { conversations: convTable } = await import("../../drizzle/schema");
      const { eq, and: andOp, ne: neOp } = await import("drizzle-orm");

      const isMatriz = input.instance === "matriz";
      const isZernio = input.instance.startsWith("zernio:");
      const zAccountId = isZernio ? input.instance.slice("zernio:".length) : null;
      // API oficial adicional (coexistência ou número oficial): prefixo "official:"
      const isOfficial = input.instance.startsWith("official:");
      const officialPhoneId = isOfficial ? input.instance.slice("official:".length) : null;

      // Localiza conversa existente na fonte escolhida
      let conv = (await db.select().from(convTable).where(
        isMatriz
          ? andOp(eq(convTable.phone, phone), neOp(convTable.channel, "evolution" as any), neOp(convTable.channel, "zernio" as any))
          : isZernio
            ? andOp(eq(convTable.phone, phone), eq(convTable.channel, "zernio" as any), eq(convTable.instanceName, zAccountId!))
            : isOfficial
              ? andOp(eq(convTable.phone, phone), eq(convTable.channel, "whatsapp" as any), eq(convTable.instanceName, officialPhoneId!))
              : andOp(eq(convTable.phone, phone), eq(convTable.channel, "evolution" as any), eq(convTable.instanceName, input.instance))
      ).limit(1))[0];

      if (!conv) {
        const inserted = await db.insert(convTable).values({
          phone,
          contactName: input.name || null,
          channel: isMatriz ? "whatsapp" : isZernio ? ("zernio" as any) : isOfficial ? ("whatsapp" as any) : ("evolution" as any),
          instanceName: isMatriz ? null : isZernio ? zAccountId : isOfficial ? officialPhoneId : input.instance,
          status: "open",
          aiActive: false, // conversa iniciada pelo atendente: sem IA
          assignedTo: ctx.user.id,
          lastMessageAt: Date.now(),
          lastMessagePreview: input.firstMessage?.substring(0, 500) || null,
        }).returning();
        conv = inserted[0];
      }

      // Cadastra o contato na agenda se não existir (com a instância que criou)
      try {
        const existingContact = await getContactByPhone(phone);
        if (!existingContact) {
          await createContact({
            name: input.name || "Cliente",
            phone,
            conversationId: conv.id,
            source: "manual",
            createdByInstance: isMatriz ? null : isOfficial ? officialPhoneId : input.instance,
            isActive: true,
          } as any);
        }
      } catch { /* não-crítico */ }

      // Envia a primeira mensagem, se houver
      let sendError: string | null = null;
      let windowExpired = false;
      if (input.firstMessage?.trim()) {
        try {
          if (isMatriz) {
            if (isWhatsAppConfigured()) {
              const r = await sendTextMessage(phone, input.firstMessage.trim());
              if (!r.success) {
                sendError = r.error || "Falha no envio";
                windowExpired = !!(r.error && (r.error.includes("131047") || r.error.includes("Re-engagement")));
              } else {
                const msg = await createMessage({
                  conversationId: conv.id, content: input.firstMessage.trim(),
                  senderType: "agent", senderName: ctx.user.name || "Atendente",
                  messageType: "text", externalId: r.messageId,
                });
                emitNewMessage(conv.id, msg);
              }
            } else sendError = "WhatsApp oficial não configurado";
          } else if (isZernio) {
            // No Zernio só dá para responder DENTRO de uma conversa existente
            // (a API precisa do zernioConversationId). Iniciar do zero exige que
            // o cliente já tenha falado — ou envio de template (fora do escopo).
            const zConvId = (conv.metadata as any)?.zernioConversationId as string | undefined;
            if (!zConvId) {
              sendError = "No Zernio, só é possível responder a uma conversa iniciada pelo cliente. Este número ainda não tem conversa ativa (fora da janela, seria preciso um template).";
            } else {
              const { zernioReply } = await import("../zernioService");
              const r = await zernioReply(zConvId, input.firstMessage.trim(), zAccountId || undefined);
              if (!r.success) {
                sendError = r.error || "Falha no envio Zernio";
              } else {
                const msg = await createMessage({
                  conversationId: conv.id, content: input.firstMessage.trim(),
                  senderType: "agent", senderName: ctx.user.name || "Atendente",
                  messageType: "text", externalId: r.messageId,
                });
                emitNewMessage(conv.id, msg);
              }
            }
          } else if (isOfficial) {
            // API oficial adicional (coexistência/número oficial) → NÃO usa Evolution
            const { sendTextFromNumber } = await import("../whatsappMultiNumber");
            const r = await sendTextFromNumber(officialPhoneId!, phone, input.firstMessage.trim());
            if (!r.success) {
              sendError = r.error || "Falha no envio (API oficial)";
            } else {
              const msg = await createMessage({
                conversationId: conv.id, content: input.firstMessage.trim(),
                senderType: "agent", senderName: ctx.user.name || "Atendente",
                messageType: "text", externalId: r.messageId,
              });
              emitNewMessage(conv.id, msg);
            }
          } else {
            const { evolutionSendText } = await import("../evolutionService");
            const r = await evolutionSendText(input.instance, phone, input.firstMessage.trim());
            const msg = await createMessage({
              conversationId: conv.id, content: input.firstMessage.trim(),
              senderType: "agent", senderName: ctx.user.name || "Atendente",
              messageType: "text", externalId: (r as any)?.key?.id ? `evo_${(r as any).key.id}` : undefined,
            });
            emitNewMessage(conv.id, msg);
          }
        } catch (err) {
          sendError = err instanceof Error ? err.message : "Falha no envio";
        }
      }

      emitConversationUpdate(conv.id, {});
      return { conversationId: conv.id, sendError, windowExpired };
    }),
});
