// ── Flow Router (extraído de routers.ts no PR #10 — só move) ────────────────
import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  getDb, listChatFlows, getChatFlowById, createChatFlow, updateChatFlow, deleteChatFlow,
  listChatFlowNodes, createChatFlowNode, updateChatFlowNode, deleteChatFlowNode, bulkUpsertNodes,
  listChatFlowEdges, createChatFlowEdge, replaceFlowEdges,
  getActiveFlowSession, getFlowSessionsByFlow,
  pauseFlowSessionByConversation, pauseAllActiveSessionsByFlow,
  getActiveAiAgents, getConversationById, updateConversation, createMessage,
} from "../db";
import { emitNewMessage, emitConversationUpdate } from "../socket";

export const flowRouter = router({
  /**
   * Monta o Fluxo-Mestre de Triagem pronto para editar:
   * start → classifica intenção → ramifica (compra/pós-venda/informação/financeiro)
   * → para compra: verifica horário → agente Recepção → encaminha vendedor.
   * Usa os agentes que já existem (Recepção/Financeiro/Pós-venda).
   */
  seedMasterFlow: adminProcedure
    .input(z.object({
      postSaleNumber: z.string().optional(), // número do pós-venda
    }).optional())
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { createChatFlow, createChatFlowNode, createChatFlowEdge, getActiveAiAgents } = await import("../db");

      // Localiza os agentes por nome (criados no seedTemplates)
      const agents = await getActiveAiAgents();
      const byName = (n: string) => agents.find(a => a.name.toLowerCase().includes(n))?.id ?? null;
      const recepcaoId = byName("recep");
      const financeiroId = byName("financ");
      const posVendaId = byName("pós") ?? byName("pos");

      const flowId = await createChatFlow({
        name: "Triagem Automática",
        description: "Fluxo-mestre: classifica a intenção do cliente e encaminha para o agente/vendedor certo. Edite à vontade.",
        trigger: "first_contact",
        active: false, // você ativa quando quiser
        priority: 100,
        createdBy: ctx.user.id,
      } as any);

      const mk = async (nodeType: string, label: string, data: any, x: number, y: number) =>
        await createChatFlowNode({ flowId, nodeType: nodeType as any, label, data, positionX: x, positionY: y } as any);
      const link = async (from: any, to: any, handle = "default", label?: string) =>
        createChatFlowEdge({ flowId, sourceNodeId: from, targetNodeId: to, sourceHandle: handle, label } as any);

      // Nós
      const start = await mk("start", "Início", {}, 50, 300);
      const classify = await mk("classify_intent", "Classificar intenção", { categories: ["compra", "pos_venda", "informacao", "financeiro", "outro"] }, 300, 300);

      // Ramo COMPRA → horário → recepção → vendedor
      const hours = await mk("business_hours", "Horário comercial", {
        schedule: {
          "1": [["08:30", "11:30"], ["13:00", "18:00"]],
          "2": [["08:30", "11:30"], ["13:00", "18:00"]],
          "3": [["08:30", "11:30"], ["13:00", "18:00"]],
          "4": [["08:30", "11:30"], ["13:00", "18:00"]],
          "5": [["08:30", "11:30"], ["13:00", "18:00"]],
          "6": [["08:30", "12:00"]],
        },
      }, 600, 150);
      const recepDentro = await mk("ai_response", "IA Recepção (horário)", { agentId: recepcaoId, instruction: "Cumprimente, entenda o veículo de interesse, mande fotos e qualifique (cidade, pagamento, troca). Quando o cliente definir um veículo, encaminhe ao vendedor." }, 900, 80);
      const recepFora = await mk("ai_response", "IA Recepção (fora de hora)", { agentId: recepcaoId, instruction: "Atenda normalmente e qualifique, mas avise que um vendedor entrará em contato no próximo horário comercial. Colete nome, veículo de interesse e cidade." }, 900, 260);
      const assignSeller = await mk("assign_seller", "Encaminhar vendedor", { storeLocation: "Matriz" }, 1250, 150);

      // Ramo PÓS-VENDA → coleta + notifica número
      const posVendaAI = await mk("ai_response", "IA Pós-venda", { agentId: posVendaId, instruction: "Cliente já comprou. Colete nome, veículo comprado e o motivo do contato (garantia, revisão, documentação). Seja acolhedor." }, 600, 400);
      const notifyPos = await mk("notify_number", "Avisar Pós-venda", {
        number: (input?.postSaleNumber || "").replace(/\D/g, ""),
        label: "Pós-venda",
        template: "🔧 Pós-venda: {nome} ({telefone}) precisa de atendimento. Assunto coletado na conversa do CRM.",
      }, 900, 400);

      // Ramo INFORMAÇÃO → agente resolve (usa Recepção/padrão)
      const infoAI = await mk("ai_response", "IA Informação", { agentId: recepcaoId, instruction: "Responda dúvidas gerais (horário, endereço, o que temos em estoque). Resolva sem encaminhar a vendedor, a menos que vire interesse de compra." }, 600, 560);

      // Ramo FINANCEIRO → agente financeiro
      const finAI = await mk("ai_response", "IA Financeiro", { agentId: financeiroId, instruction: "Ajude com financiamento, entrada e simulação. Se o cliente definir veículo e condições, encaminhe ao vendedor." }, 600, 700);

      const endNode = await mk("end", "Fim", {}, 1550, 400);

      // Ligações
      await link(start, classify);
      await link(classify, hours, "compra");
      await link(classify, posVendaAI, "pos_venda");
      await link(classify, infoAI, "informacao");
      await link(classify, finAI, "financeiro");
      await link(classify, infoAI, "outro"); // "outro" cai em informação por padrão
      await link(hours, recepDentro, "dentro");
      await link(hours, recepFora, "fora");
      await link(recepDentro, assignSeller);
      await link(recepFora, endNode);
      await link(assignSeller, endNode);
      await link(posVendaAI, notifyPos);
      await link(notifyPos, endNode);

      return { flowId, message: "Fluxo 'Triagem Automática' criado (inativo). Edite e ative em Fluxos." };
    }),

  // Modelo pronto de pré-atendimento: saudação → pagamento → troca → encaminha ao vendedor.
  seedPreAtendimento: adminProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { createChatFlow, createChatFlowNode, createChatFlowEdge } = await import("../db");

      const flowId = await createChatFlow({
        name: "Pré-atendimento",
        description: "Saudação → pagamento → troca → encaminha ao vendedor. Amarre à conexão e ative.",
        trigger: "first_contact",
        active: false,
        priority: 50,
        createdBy: ctx.user.id,
      } as any);

      const mk = async (nodeType: string, label: string, data: any, x: number, y: number) =>
        await createChatFlowNode({ flowId, nodeType: nodeType as any, label, data, positionX: x, positionY: y } as any);
      const link = async (from: any, to: any, handle = "default") =>
        createChatFlowEdge({ flowId, sourceNodeId: from, targetNodeId: to, sourceHandle: handle } as any);

      const start = await mk("start", "Início", {}, 60, 240);
      const saud = await mk("send_message", "Saudação", {
        text: "Olá {{nome}}! 👋 Aqui é da Auto Inova. Vi o seu interesse e já vou te ajudar. 🚗\n\nSó preciso de 2 respostas rápidas pra adiantar seu atendimento:",
      }, 300, 240);
      const pag = await mk("send_buttons", "Forma de pagamento", {
        body: "Como você pretende pagar?",
        buttons: [{ text: "À vista" }, { text: "Financiamento" }, { text: "Ainda não sei" }],
        onInvalid: "ai",
      }, 560, 240);
      const troca = await mk("send_buttons", "Tem troca?", {
        body: "Você tem um veículo pra dar na troca?",
        buttons: [{ text: "Sim, tenho troca" }, { text: "Não" }],
        onInvalid: "ai",
      }, 820, 240);
      const coletaTroca = await mk("collect_with_ai", "Coletar dados da troca", {
        fields: [
          { key: "tradeVehicle", label: "veículo da troca (marca/modelo)" },
          { key: "tradeYear", label: "ano do veículo da troca" },
          { key: "tradeKm", label: "quilometragem (km) da troca" },
        ],
        instruction: "Colete os dados do veículo que o cliente quer dar na troca, de forma cordial e uma pergunta por vez. Se ele desviar, retome pedindo o que falta.",
        maxAttempts: 4,
        // Sem resposta: lembra 1x após 60min; se continuar mudo, avança com o que tiver.
        noReplyMinutes: 60,
        noReplyMaxAttempts: 1,
        noReplyMessage: "Oi! Só faltam os dados da troca pra eu adiantar seu atendimento. Consegue me passar? 🚗",
      }, 820, 420);
      const stage = await mk("update_lead_status", "Encaminhado", { funnelStatus: "encaminhado_vendedor" }, 1080, 240);
      const seller = await mk("assign_seller", "Encaminhar vendedor", {}, 1320, 240);
      const bye = await mk("send_message", "Passa pro vendedor", {
        text: "Perfeito, {{nome}}! ✅ Já registrei tudo e um consultor vai te chamar por aqui em instantes pra fechar os detalhes. 🚗✨",
      }, 1560, 240);
      const fim = await mk("end", "Fim", {}, 1800, 240);

      await link(start, saud);
      await link(saud, pag);
      // qualquer botão de pagamento → pergunta da troca
      await link(pag, troca, "button_0");
      await link(pag, troca, "button_1");
      await link(pag, troca, "button_2");
      // "Sim, tenho troca" → coleta os dados da troca com IA, depois encaminha
      await link(troca, coletaTroca, "button_0");
      await link(coletaTroca, stage); // avança quando coletar tudo (ou esgotar tentativas)
      // "Não" → encaminha direto
      await link(troca, stage, "button_1");
      await link(stage, seller);
      await link(seller, bye);
      await link(bye, fim);

      return { flowId, message: "Fluxo 'Pré-atendimento' criado (inativo). Amarre à conexão da Bianca e ative." };
    }),

  list: protectedProcedure.query(async () => {
    const flows = await listChatFlows();
    // Count nodes per flow
    const result = [];
    for (const flow of flows) {
      const nodes = await listChatFlowNodes(flow.id);
      const sessions = await getFlowSessionsByFlow(flow.id);
      result.push({
        ...flow,
        nodeCount: nodes.length,
        sessionCount: sessions.length,
        activeSessionCount: sessions.filter(s => s.status === "active").length,
      });
    }
    return result;
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const flow = await getChatFlowById(input.id);
      if (!flow) throw new Error("Flow not found");
      const nodes = await listChatFlowNodes(input.id);
      const edges = await listChatFlowEdges(input.id);
      return { flow, nodes, edges };
    }),

  /**
   * Saúde da Jornada (arquitetura vendedor virtual): funil por nó, totais por
   * tipo de evento e últimos fallbacks — alimentado pelo decision log (flowEvents).
   */
  health: protectedProcedure
    .input(z.object({ flowId: z.number(), days: z.number().min(1).max(90).optional() }))
    .query(async ({ input }) => {
      const { getFlowHealthStats } = await import("../db");
      const stats = await getFlowHealthStats(input.flowId, input.days ?? 7);
      if (!stats) throw new Error("Database not available");
      return stats;
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      trigger: z.enum(["first_contact", "keyword", "button_click", "ad_click", "manual", "reactivation", "category_interest", "rescue", "tag_added", "tag_removed", "funnel_stage_entered"]),
      triggerValue: z.string().optional(),
      connectionType: z.string().optional(),
      instanceName: z.string().optional(),
      connectionId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await createChatFlow({
        name: input.name,
        description: input.description || null,
        trigger: input.trigger,
        triggerValue: input.triggerValue || null,
        connectionType: input.connectionType || null,
        instanceName: input.instanceName || null,
        connectionId: input.connectionId ?? null,
        active: false,
        priority: 0,
        createdBy: ctx.user.id,
      });
      // Create default start node
      await createChatFlowNode({
        flowId: id,
        nodeType: "start",
        label: "Início",
        data: {},
        positionX: 250,
        positionY: 50,
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      trigger: z.enum(["first_contact", "keyword", "button_click", "ad_click", "manual", "reactivation", "category_interest", "rescue", "tag_added", "tag_removed", "funnel_stage_entered"]).optional(),
      triggerValue: z.string().optional(),
      active: z.boolean().optional(),
      priority: z.number().optional(),
      agentId: z.number().nullable().optional(),
      connectionType: z.string().nullable().optional(),
      instanceName: z.string().nullable().optional(),
      connectionId: z.number().nullable().optional(),
      conditions: z.array(z.array(z.object({
        field: z.string(),
        op: z.enum(["eq", "neq"]),
        value: z.string(),
      }))).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateChatFlow(id, data as any);
      // Se estiver inativando o fluxo, pausar todas as sessões ativas
      if (input.active === false) {
        const paused = await pauseAllActiveSessionsByFlow(id);
        console.log(`[Flow] Fluxo ${id} inativado, ${paused} sessões pausadas`);
      }
      return { success: true };
    }),

  // Pausar fluxo ativo de uma conversa manualmente
  pauseSession: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      const paused = await pauseFlowSessionByConversation(input.conversationId);
      return { success: paused };
    }),

  // Verificar se há sessão de fluxo ativa para uma conversa (com nome do fluxo)
  getActiveSession: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const session = await getActiveFlowSession(input.conversationId);
      if (!session) return null;
      const flow = await getChatFlowById(session.flowId);
      return { ...session, flowName: flow?.name || `Fluxo #${session.flowId}` };
    }),

  // Iniciar um fluxo salvo manualmente para uma conversa
  startForConversation: protectedProcedure
    .input(z.object({ conversationId: z.number(), flowId: z.number() }))
    .mutation(async ({ input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new Error("Conversa não encontrada");
      if (!conv.phone) throw new Error("Conversa sem telefone");

      const { startFlowManually } = await import("../flowEngine");
      const flowResult = await startFlowManually({
        conversationId: input.conversationId,
        flowId: input.flowId,
        phone: conv.phone,
        contactName: conv.contactName || undefined,
      });

      // Persiste as mensagens enviadas pelo fluxo (mesmo padrão do debounce)
      for (const response of flowResult.responses) {
        const botMsg = await createMessage({
          conversationId: input.conversationId,
          content: response,
          senderType: "bot",
          senderName: "Auto Inova - Matriz IA",
          messageType: "text",
        });
        emitNewMessage(input.conversationId, botMsg);
      }
      for (const img of flowResult.imageMessages) {
        const imgMsg = await createMessage({
          conversationId: input.conversationId,
          content: img.caption || "[Imagem]",
          senderType: "bot",
          senderName: "Auto Inova - Matriz IA",
          messageType: "image",
          metadata: { mediaUrl: img.imageUrl, caption: img.caption },
        });
        emitNewMessage(input.conversationId, imgMsg);
      }
      for (const im of flowResult.interactiveMessages) {
        const interactiveMetadata: any = { interactiveType: im.type, interactiveData: im.data };
        let content = im.data.body || "";
        if (im.type === "buttons" && im.data.buttons) {
          content += `\n\n[Botões: ${im.data.buttons.map((b: any) => b.title).join(" | ")}]`;
          interactiveMetadata.buttons = im.data.buttons;
        } else if (im.type === "list" && im.data.sections) {
          content += `\n\n[Lista: ${im.data.sections.flatMap((s: any) => (s.rows || []).map((r: any) => r.title)).join(" | ")}]`;
          interactiveMetadata.sections = im.data.sections;
          interactiveMetadata.buttonText = im.data.buttonText;
        }
        const flowInteractiveMsg = await createMessage({
          conversationId: input.conversationId,
          content,
          senderType: "bot",
          senderName: "Auto Inova - Matriz IA",
          messageType: "text",
          metadata: interactiveMetadata,
        });
        emitNewMessage(input.conversationId, flowInteractiveMsg);
      }

      // Roteamento exclusivo: fluxo assume, IA pausa
      const routedConv = await updateConversation(input.conversationId, { aiActive: false, routingState: "flow" });
      emitConversationUpdate(input.conversationId, routedConv);

      return { success: true, messagesSent: flowResult.responses.length + flowResult.imageMessages.length + flowResult.interactiveMessages.length };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteChatFlow(input.id);
      return { success: true };
    }),

  // Save entire flow (nodes + edges) in one operation
  saveFlow: adminProcedure
    .input(z.object({
      flowId: z.number(),
      nodes: z.array(z.object({
        id: z.number().optional(),
        nodeType: z.enum(["start", "send_message", "send_buttons", "send_list", "send_image", "condition", "ai_response", "update_lead", "assign_agent", "delay", "wait_input", "end", "goto_flow", "assign_seller", "send_vehicle_photos", "vehicle_presentation", "update_lead_status", "classify_intent", "business_hours", "notify_number", "collect_with_ai", "vehicle_discovery", "confirm_interest", "collect_sequence"]),
        label: z.string().optional(),
        data: z.any(),
        positionX: z.number(),
        positionY: z.number(),
      })),
      edges: z.array(z.object({
        sourceNodeId: z.number(),
        targetNodeId: z.number(),
        sourceHandle: z.string().optional(),
        label: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      // Delete old nodes that are not in the new list
      const existingNodes = await listChatFlowNodes(input.flowId);
      const newNodeIds = input.nodes.filter(n => n.id).map(n => n.id!);
      for (const existing of existingNodes) {
        if (!newNodeIds.includes(existing.id)) {
          await deleteChatFlowNode(existing.id);
        }
      }
      // Upsert nodes
      const nodeIds = await bulkUpsertNodes(input.flowId, input.nodes.map(n => ({
        id: n.id,
        flowId: input.flowId,
        nodeType: n.nodeType,
        label: n.label || null,
        data: n.data || {},
        positionX: n.positionX,
        positionY: n.positionY,
      })));
      // Build ID mapping (old temp IDs -> new real IDs)
      const idMap = new Map<number, number>();
      input.nodes.forEach((n, i) => {
        const oldId = n.id || -(i + 1); // temp negative IDs for new nodes
        idMap.set(oldId, nodeIds[i]);
      });
      // Replace edges with mapped IDs
      const mappedEdges = input.edges.map(e => ({
        flowId: input.flowId,
        sourceNodeId: idMap.get(e.sourceNodeId) || e.sourceNodeId,
        targetNodeId: idMap.get(e.targetNodeId) || e.targetNodeId,
        sourceHandle: e.sourceHandle || "default",
        label: e.label || null,
      }));
      await replaceFlowEdges(input.flowId, mappedEdges);
      return { success: true, nodeIds };
    }),

  // Duplicate a flow
  duplicate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const flow = await getChatFlowById(input.id);
      if (!flow) throw new Error("Flow not found");
      const nodes = await listChatFlowNodes(input.id);
      const edges = await listChatFlowEdges(input.id);
      // Create new flow
      const newFlowId = await createChatFlow({
        name: `${flow.name} (cópia)`,
        description: flow.description,
        trigger: flow.trigger,
        triggerValue: flow.triggerValue,
        active: false,
        priority: flow.priority,
        createdBy: ctx.user.id,
      });
      // Copy nodes with ID mapping
      const nodeIdMap = new Map<number, number>();
      for (const node of nodes) {
        const newNodeId = await createChatFlowNode({
          flowId: newFlowId,
          nodeType: node.nodeType,
          label: node.label,
          data: node.data,
          positionX: node.positionX,
          positionY: node.positionY,
        });
        nodeIdMap.set(node.id, newNodeId);
      }
      // Copy edges with mapped IDs
      for (const edge of edges) {
        const newSource = nodeIdMap.get(edge.sourceNodeId);
        const newTarget = nodeIdMap.get(edge.targetNodeId);
        if (newSource && newTarget) {
          await createChatFlowEdge({
            flowId: newFlowId,
            sourceNodeId: newSource,
            targetNodeId: newTarget,
            sourceHandle: edge.sourceHandle,
            label: edge.label,
          });
        }
      }
      return { id: newFlowId };
    }),
});
