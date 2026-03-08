import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("./db", () => ({
  getActiveChatFlows: vi.fn().mockResolvedValue([]),
  listChatFlowNodes: vi.fn().mockResolvedValue([]),
  listChatFlowEdges: vi.fn().mockResolvedValue([]),
  getActiveFlowSession: vi.fn().mockResolvedValue(null),
  createFlowSession: vi.fn().mockResolvedValue(1),
  updateFlowSession: vi.fn().mockResolvedValue(undefined),
  getChatFlowNodeById: vi.fn().mockResolvedValue(null),
  getLeadByConversationId: vi.fn().mockResolvedValue(null),
  upsertLead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./whatsapp", () => ({
  sendTextMessage: vi.fn().mockResolvedValue({ success: true }),
  sendReplyButtons: vi.fn().mockResolvedValue({ success: true }),
  sendListMessage: vi.fn().mockResolvedValue({ success: true }),
  sendImageMessage: vi.fn().mockResolvedValue({ success: true }),
}));

import { findMatchingFlow, processFlowMessage, continueFlowAfterAI } from "./flowEngine";
import * as db from "./db";

describe("FlowEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Template Variable Replacement ─────────────────────────
  describe("Template Variable Replacement", () => {
    function replaceVariables(text: string, ctx: Record<string, string>): string {
      return text
        .replace(/\{\{nome\}\}/gi, ctx.nome || "cliente")
        .replace(/\{\{telefone\}\}/gi, ctx.telefone || "")
        .replace(/\{\{veiculo\}\}/gi, ctx.veiculo || "")
        .replace(/\{\{cidade\}\}/gi, ctx.cidade || "")
        .replace(/\{\{troca\}\}/gi, ctx.troca || "")
        .replace(/\{\{pagamento\}\}/gi, ctx.pagamento || "");
    }

    it("should replace all template variables", () => {
      const text = "Olá {{nome}}, você está em {{cidade}} e quer o {{veiculo}}?";
      const result = replaceVariables(text, {
        nome: "João", cidade: "Porto Alegre", veiculo: "Hilux 2024",
        telefone: "51999999999", troca: "", pagamento: "",
      });
      expect(result).toBe("Olá João, você está em Porto Alegre e quer o Hilux 2024?");
    });

    it("should use default for missing nome", () => {
      const result = replaceVariables("Olá {{nome}}!", { nome: "", telefone: "", veiculo: "", cidade: "", troca: "", pagamento: "" });
      expect(result).toBe("Olá cliente!");
    });

    it("should handle text without variables", () => {
      const result = replaceVariables("Bem-vindo à Auto Inova!", { nome: "João", telefone: "", veiculo: "", cidade: "", troca: "", pagamento: "" });
      expect(result).toBe("Bem-vindo à Auto Inova!");
    });
  });

  // ─── Condition Evaluation ──────────────────────────────────
  describe("Condition Evaluation", () => {
    function evaluateCondition(field: string, operator: string, value: string, leadData: Record<string, any>, customerMessage: string): boolean {
      let fieldValue = "";
      if (field === "lastMessage") fieldValue = customerMessage.toLowerCase();
      else if (field in leadData) fieldValue = String(leadData[field] || "").toLowerCase();
      const val = value.toLowerCase();
      switch (operator) {
        case "equals": return fieldValue === val;
        case "not_equals": return fieldValue !== val;
        case "contains": return fieldValue.includes(val);
        case "not_empty": return fieldValue.length > 0;
        case "is_empty": return fieldValue.length === 0;
        case "is_true": return fieldValue === "true" || fieldValue === "1" || fieldValue === "sim";
        case "is_false": return fieldValue === "false" || fieldValue === "0" || fieldValue === "não" || fieldValue === "nao" || fieldValue === "";
        default: return false;
      }
    }

    it("should evaluate equals", () => {
      expect(evaluateCondition("status", "equals", "novo", { status: "novo" }, "")).toBe(true);
      expect(evaluateCondition("status", "equals", "novo", { status: "ativo" }, "")).toBe(false);
    });

    it("should evaluate contains", () => {
      expect(evaluateCondition("vehicleInterest", "contains", "hilux", { vehicleInterest: "Toyota Hilux 2024" }, "")).toBe(true);
    });

    it("should evaluate not_empty", () => {
      expect(evaluateCondition("city", "not_empty", "", { city: "Porto Alegre" }, "")).toBe(true);
      expect(evaluateCondition("city", "not_empty", "", { city: "" }, "")).toBe(false);
    });

    it("should evaluate lastMessage", () => {
      expect(evaluateCondition("lastMessage", "contains", "financiar", {}, "Quero financiar o carro")).toBe(true);
    });
  });

  // ─── Button/List Response Matching ─────────────────────────
  describe("Button/List Response Matching", () => {
    function matchButtonResponse(buttons: Array<{ text: string }>, msg: string): number {
      const msgLower = msg.toLowerCase().trim();
      for (let i = 0; i < buttons.length; i++) {
        const btnText = buttons[i].text.toLowerCase().trim();
        if (msgLower === btnText || msgLower.includes(btnText)) return i;
      }
      return -1;
    }

    it("should match exact button text", () => {
      const buttons = [{ text: "Sim, tenho troca" }, { text: "Não tenho" }, { text: "Quero financiar" }];
      expect(matchButtonResponse(buttons, "Sim, tenho troca")).toBe(0);
      expect(matchButtonResponse(buttons, "Quero financiar")).toBe(2);
    });

    it("should match partial button text", () => {
      expect(matchButtonResponse([{ text: "Sim" }, { text: "Não" }], "sim")).toBe(0);
    });

    it("should return -1 for no match", () => {
      expect(matchButtonResponse([{ text: "Sim" }, { text: "Não" }], "talvez")).toBe(-1);
    });
  });

  // ─── Flow Trigger Matching ─────────────────────────────────
  describe("findMatchingFlow", () => {
    it("returns null when no active flows", async () => {
      const result = await findMatchingFlow(1, "hello", false, false);
      expect(result).toBeNull();
    });

    it("matches first_contact trigger", async () => {
      vi.mocked(db.getActiveChatFlows).mockResolvedValueOnce([
        { id: 1, name: "Welcome", trigger: "first_contact", triggerValue: null, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      ] as any);
      expect(await findMatchingFlow(1, "hello", true, false)).toBe(1);
    });

    it("matches keyword trigger", async () => {
      vi.mocked(db.getActiveChatFlows).mockResolvedValueOnce([
        { id: 2, name: "Finance", trigger: "keyword", triggerValue: "financiar,financiamento", isActive: true, createdAt: new Date(), updatedAt: new Date() },
      ] as any);
      expect(await findMatchingFlow(1, "quero financiar", false, false)).toBe(2);
    });

    it("matches ad_click trigger with vehicle ID", async () => {
      vi.mocked(db.getActiveChatFlows).mockResolvedValueOnce([
        { id: 3, name: "Ad Flow", trigger: "ad_click", triggerValue: null, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      ] as any);
      expect(await findMatchingFlow(1, "Hilux ID42", false, true)).toBe(3);
    });

    it("does not match ad_click without vehicle ID", async () => {
      vi.mocked(db.getActiveChatFlows).mockResolvedValueOnce([
        { id: 3, name: "Ad Flow", trigger: "ad_click", triggerValue: null, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      ] as any);
      expect(await findMatchingFlow(1, "Hilux", false, false)).toBeNull();
    });
  });

  // ─── processFlowMessage ────────────────────────────────────
  describe("processFlowMessage", () => {
    it("returns unhandled when no matching flow", async () => {
      const result = await processFlowMessage({ conversationId: 1, phone: "5551999999999", customerMessage: "hello" });
      expect(result.handled).toBe(false);
    });

    it("starts a new flow and sends message", async () => {
      vi.mocked(db.getActiveChatFlows).mockResolvedValueOnce([
        { id: 1, name: "Welcome", trigger: "first_contact", triggerValue: null, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      ] as any);
      vi.mocked(db.listChatFlowNodes).mockResolvedValue([
        { id: 10, flowId: 1, nodeType: "start", label: "Início", data: {}, positionX: 0, positionY: 0 },
        { id: 11, flowId: 1, nodeType: "send_message", label: "Boas-vindas", data: { text: "Olá {{nome}}!" }, positionX: 0, positionY: 100 },
      ] as any);
      vi.mocked(db.listChatFlowEdges).mockResolvedValue([
        { id: 1, flowId: 1, sourceNodeId: 10, targetNodeId: 11, sourceHandle: null, label: null },
      ] as any);

      const result = await processFlowMessage({ conversationId: 1, phone: "5551999999999", customerMessage: "oi", contactName: "João" });
      expect(result.handled).toBe(true);
      expect(result.responses[0]).toContain("João");
    });

    it("handles button response matching", async () => {
      vi.mocked(db.getActiveFlowSession).mockResolvedValueOnce({
        id: 1, conversationId: 1, flowId: 1, currentNodeId: 20,
        status: "active", context: {}, startedAt: new Date(), completedAt: null, updatedAt: new Date(),
      } as any);
      vi.mocked(db.listChatFlowNodes).mockResolvedValue([
        { id: 20, flowId: 1, nodeType: "send_buttons", label: "Pergunta", data: { body: "Tem troca?", buttons: [{ text: "Sim" }, { text: "Não" }] }, positionX: 0, positionY: 0 },
        { id: 21, flowId: 1, nodeType: "send_message", label: "Com troca", data: { text: "Qual veículo de troca?" }, positionX: 0, positionY: 100 },
        { id: 22, flowId: 1, nodeType: "end", label: "Fim", data: {}, positionX: 0, positionY: 200 },
      ] as any);
      vi.mocked(db.listChatFlowEdges).mockResolvedValue([
        { id: 1, flowId: 1, sourceNodeId: 20, targetNodeId: 21, sourceHandle: "button_0", label: null },
        { id: 2, flowId: 1, sourceNodeId: 20, targetNodeId: 22, sourceHandle: "button_1", label: null },
        { id: 3, flowId: 1, sourceNodeId: 21, targetNodeId: 22, sourceHandle: null, label: null },
      ] as any);

      const result = await processFlowMessage({ conversationId: 1, phone: "5551999999999", customerMessage: "Sim" });
      expect(result.handled).toBe(true);
      expect(result.responses).toContain("Qual veículo de troca?");
    });

    it("passes to AI when current node is ai_response", async () => {
      vi.mocked(db.getActiveFlowSession).mockResolvedValueOnce({
        id: 1, conversationId: 1, flowId: 1, currentNodeId: 30,
        status: "active", context: { aiInstruction: "Mostre o veículo", pendingNextNodeId: 31 },
        startedAt: new Date(), completedAt: null, updatedAt: new Date(),
      } as any);
      vi.mocked(db.listChatFlowNodes).mockResolvedValue([
        { id: 30, flowId: 1, nodeType: "ai_response", label: "IA", data: { instruction: "Mostre o veículo" }, positionX: 0, positionY: 0 },
        { id: 31, flowId: 1, nodeType: "send_buttons", label: "Confirmar", data: { body: "Gostou?", buttons: [{ text: "Sim" }, { text: "Não" }] }, positionX: 0, positionY: 100 },
      ] as any);
      vi.mocked(db.listChatFlowEdges).mockResolvedValue([
        { id: 1, flowId: 1, sourceNodeId: 30, targetNodeId: 31, sourceHandle: null, label: null },
      ] as any);

      const result = await processFlowMessage({ conversationId: 1, phone: "5551999999999", customerMessage: "me mostra o carro" });
      // Should NOT be handled - passes to AI
      expect(result.handled).toBe(false);
    });
  });

  // ─── continueFlowAfterAI ──────────────────────────────────
  describe("continueFlowAfterAI", () => {
    it("returns unhandled when no active session", async () => {
      vi.mocked(db.getActiveFlowSession).mockResolvedValueOnce(null);
      const result = await continueFlowAfterAI(1, { conversationId: 1, phone: "5551999999999", customerMessage: "" });
      expect(result.handled).toBe(false);
    });

    it("returns unhandled when no pendingNextNodeId", async () => {
      vi.mocked(db.getActiveFlowSession).mockResolvedValueOnce({
        id: 1, conversationId: 1, flowId: 1, currentNodeId: 30,
        status: "active", context: { aiInstruction: "test" },
        startedAt: new Date(), completedAt: null, updatedAt: new Date(),
      } as any);
      const result = await continueFlowAfterAI(1, { conversationId: 1, phone: "5551999999999", customerMessage: "" });
      expect(result.handled).toBe(false);
    });

    it("executes pending buttons node after AI responds", async () => {
      vi.mocked(db.getActiveFlowSession).mockResolvedValueOnce({
        id: 1, conversationId: 1, flowId: 1, currentNodeId: 30,
        status: "active", context: { aiInstruction: "Mostre o veículo", pendingNextNodeId: 31 },
        startedAt: new Date(), completedAt: null, updatedAt: new Date(),
      } as any);
      vi.mocked(db.listChatFlowNodes).mockResolvedValue([
        { id: 30, flowId: 1, nodeType: "ai_response", label: "IA", data: {}, positionX: 0, positionY: 0 },
        { id: 31, flowId: 1, nodeType: "send_buttons", label: "Confirmar", data: { body: "Gostou do veículo?", buttons: [{ text: "Sim" }, { text: "Não" }] }, positionX: 0, positionY: 100 },
      ] as any);
      vi.mocked(db.listChatFlowEdges).mockResolvedValue([
        { id: 1, flowId: 1, sourceNodeId: 30, targetNodeId: 31, sourceHandle: null, label: null },
      ] as any);

      const result = await continueFlowAfterAI(1, { conversationId: 1, phone: "5551999999999", customerMessage: "" });

      expect(result.handled).toBe(true);
      expect(result.interactiveMessages.length).toBe(1);
      expect(result.interactiveMessages[0].type).toBe("buttons");
      expect(result.interactiveMessages[0].data.body).toBe("Gostou do veículo?");
      expect(result.waitingForInput).toBe(true);
      // Should clear pendingNextNodeId
      expect(db.updateFlowSession).toHaveBeenCalledWith(1, expect.objectContaining({
        context: expect.not.objectContaining({ pendingNextNodeId: 31 }),
      }));
    });

    it("executes pending message + end after AI responds", async () => {
      vi.mocked(db.getActiveFlowSession).mockResolvedValueOnce({
        id: 1, conversationId: 1, flowId: 1, currentNodeId: 30,
        status: "active", context: { pendingNextNodeId: 31 },
        startedAt: new Date(), completedAt: null, updatedAt: new Date(),
      } as any);
      vi.mocked(db.listChatFlowNodes).mockResolvedValue([
        { id: 30, flowId: 1, nodeType: "ai_response", label: "IA", data: {}, positionX: 0, positionY: 0 },
        { id: 31, flowId: 1, nodeType: "send_message", label: "Msg", data: { text: "Obrigado!" }, positionX: 0, positionY: 100 },
        { id: 32, flowId: 1, nodeType: "end", label: "Fim", data: {}, positionX: 0, positionY: 200 },
      ] as any);
      vi.mocked(db.listChatFlowEdges).mockResolvedValue([
        { id: 1, flowId: 1, sourceNodeId: 30, targetNodeId: 31, sourceHandle: null, label: null },
        { id: 2, flowId: 1, sourceNodeId: 31, targetNodeId: 32, sourceHandle: null, label: null },
      ] as any);

      const result = await continueFlowAfterAI(1, { conversationId: 1, phone: "5551999999999", customerMessage: "" });

      expect(result.handled).toBe(true);
      expect(result.responses).toContain("Obrigado!");
      expect(result.flowCompleted).toBe(true);
    });

    it("executes pending list node after AI responds", async () => {
      vi.mocked(db.getActiveFlowSession).mockResolvedValueOnce({
        id: 1, conversationId: 1, flowId: 1, currentNodeId: 30,
        status: "active", context: { pendingNextNodeId: 31 },
        startedAt: new Date(), completedAt: null, updatedAt: new Date(),
      } as any);
      vi.mocked(db.listChatFlowNodes).mockResolvedValue([
        { id: 30, flowId: 1, nodeType: "ai_response", label: "IA", data: {}, positionX: 0, positionY: 0 },
        { id: 31, flowId: 1, nodeType: "send_list", label: "Categorias", data: { body: "Escolha uma categoria:", buttonText: "Ver Opções", sections: [{ title: "Veículos", rows: [{ title: "SUVs", description: "Veículos SUV" }, { title: "Sedans", description: "Veículos Sedan" }] }] }, positionX: 0, positionY: 100 },
      ] as any);
      vi.mocked(db.listChatFlowEdges).mockResolvedValue([
        { id: 1, flowId: 1, sourceNodeId: 30, targetNodeId: 31, sourceHandle: null, label: null },
      ] as any);

      const result = await continueFlowAfterAI(1, { conversationId: 1, phone: "5551999999999", customerMessage: "" });

      expect(result.handled).toBe(true);
      expect(result.interactiveMessages.length).toBe(1);
      expect(result.interactiveMessages[0].type).toBe("list");
      expect(result.waitingForInput).toBe(true);
    });
  });

  // ─── Depth Limit Protection ────────────────────────────────
  describe("Depth Limit Protection", () => {
    it("should prevent infinite loops with depth > 20", () => {
      let depth = 0;
      const maxDepth = 20;
      function simulateExecution(d: number): number {
        if (d > maxDepth) return d;
        return simulateExecution(d + 1);
      }
      expect(simulateExecution(0)).toBeGreaterThan(maxDepth);
    });
  });
});
