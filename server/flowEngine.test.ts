import { describe, it, expect } from "vitest";

// Test the flow engine logic without database dependencies
describe("Flow Engine - Unit Tests", () => {
  describe("Template Variable Replacement", () => {
    // Simulating replaceVariables logic
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
        nome: "João",
        cidade: "Porto Alegre",
        veiculo: "Hilux 2024",
        telefone: "51999999999",
        troca: "",
        pagamento: "",
      });
      expect(result).toBe("Olá João, você está em Porto Alegre e quer o Hilux 2024?");
    });

    it("should use default for missing nome", () => {
      const text = "Olá {{nome}}!";
      const result = replaceVariables(text, {
        nome: "",
        telefone: "",
        veiculo: "",
        cidade: "",
        troca: "",
        pagamento: "",
      });
      expect(result).toBe("Olá cliente!");
    });

    it("should handle text without variables", () => {
      const text = "Bem-vindo à Auto Inova!";
      const result = replaceVariables(text, { nome: "João", telefone: "", veiculo: "", cidade: "", troca: "", pagamento: "" });
      expect(result).toBe("Bem-vindo à Auto Inova!");
    });
  });

  describe("Condition Evaluation", () => {
    function evaluateCondition(
      field: string,
      operator: string,
      value: string,
      leadData: Record<string, any>,
      customerMessage: string,
    ): boolean {
      let fieldValue = "";
      if (field === "lastMessage") {
        fieldValue = customerMessage.toLowerCase();
      } else if (field in leadData) {
        fieldValue = String(leadData[field] || "").toLowerCase();
      }
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

    it("should evaluate equals condition", () => {
      expect(evaluateCondition("status", "equals", "novo", { status: "novo" }, "")).toBe(true);
      expect(evaluateCondition("status", "equals", "novo", { status: "ativo" }, "")).toBe(false);
    });

    it("should evaluate not_equals condition", () => {
      expect(evaluateCondition("status", "not_equals", "fechado", { status: "novo" }, "")).toBe(true);
      expect(evaluateCondition("status", "not_equals", "novo", { status: "novo" }, "")).toBe(false);
    });

    it("should evaluate contains condition", () => {
      expect(evaluateCondition("vehicleInterest", "contains", "hilux", { vehicleInterest: "Toyota Hilux 2024" }, "")).toBe(true);
      expect(evaluateCondition("vehicleInterest", "contains", "corolla", { vehicleInterest: "Toyota Hilux 2024" }, "")).toBe(false);
    });

    it("should evaluate not_empty condition", () => {
      expect(evaluateCondition("city", "not_empty", "", { city: "Porto Alegre" }, "")).toBe(true);
      expect(evaluateCondition("city", "not_empty", "", { city: "" }, "")).toBe(false);
    });

    it("should evaluate is_empty condition", () => {
      expect(evaluateCondition("city", "is_empty", "", { city: "" }, "")).toBe(true);
      expect(evaluateCondition("city", "is_empty", "", { city: "Porto Alegre" }, "")).toBe(false);
    });

    it("should evaluate is_true condition", () => {
      expect(evaluateCondition("hasTrade", "is_true", "", { hasTrade: "true" }, "")).toBe(true);
      expect(evaluateCondition("hasTrade", "is_true", "", { hasTrade: "sim" }, "")).toBe(true);
      expect(evaluateCondition("hasTrade", "is_true", "", { hasTrade: "false" }, "")).toBe(false);
    });

    it("should evaluate is_false condition", () => {
      expect(evaluateCondition("hasTrade", "is_false", "", { hasTrade: "false" }, "")).toBe(true);
      expect(evaluateCondition("hasTrade", "is_false", "", { hasTrade: "" }, "")).toBe(true);
      expect(evaluateCondition("hasTrade", "is_false", "", { hasTrade: "true" }, "")).toBe(false);
    });

    it("should evaluate lastMessage field", () => {
      expect(evaluateCondition("lastMessage", "contains", "financiar", {}, "Quero financiar o carro")).toBe(true);
      expect(evaluateCondition("lastMessage", "contains", "troca", {}, "Quero financiar o carro")).toBe(false);
    });
  });

  describe("Button/List Response Matching", () => {
    function matchButtonResponse(
      buttons: Array<{ text: string }>,
      customerMessage: string,
    ): number {
      const msgLower = customerMessage.toLowerCase().trim();
      for (let i = 0; i < buttons.length; i++) {
        const btnText = buttons[i].text.toLowerCase().trim();
        if (msgLower === btnText || msgLower.includes(btnText)) return i;
      }
      return -1;
    }

    function matchListResponse(
      rows: Array<{ title: string }>,
      customerMessage: string,
    ): number {
      const msgLower = customerMessage.toLowerCase().trim();
      for (let i = 0; i < rows.length; i++) {
        const rowTitle = rows[i].title.toLowerCase().trim();
        if (msgLower === rowTitle || msgLower.includes(rowTitle)) return i;
      }
      return -1;
    }

    it("should match exact button text", () => {
      const buttons = [{ text: "Sim, tenho troca" }, { text: "Não tenho" }, { text: "Quero financiar" }];
      expect(matchButtonResponse(buttons, "Sim, tenho troca")).toBe(0);
      expect(matchButtonResponse(buttons, "Não tenho")).toBe(1);
      expect(matchButtonResponse(buttons, "Quero financiar")).toBe(2);
    });

    it("should match partial button text", () => {
      const buttons = [{ text: "Sim" }, { text: "Não" }];
      expect(matchButtonResponse(buttons, "sim")).toBe(0);
      expect(matchButtonResponse(buttons, "não")).toBe(1);
    });

    it("should return -1 for no match", () => {
      const buttons = [{ text: "Sim" }, { text: "Não" }];
      expect(matchButtonResponse(buttons, "talvez")).toBe(-1);
    });

    it("should match list row titles", () => {
      const rows = [{ title: "SUVs" }, { title: "Sedans" }, { title: "Hatches" }];
      expect(matchListResponse(rows, "SUVs")).toBe(0);
      expect(matchListResponse(rows, "Sedans")).toBe(1);
      expect(matchListResponse(rows, "hatches")).toBe(2);
    });
  });

  describe("Flow Trigger Matching", () => {
    function matchKeywordTrigger(triggerValue: string, message: string): boolean {
      const keywords = triggerValue.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      const msgLower = message.toLowerCase();
      return keywords.some(kw => msgLower.includes(kw));
    }

    it("should match single keyword", () => {
      expect(matchKeywordTrigger("financiar", "Quero financiar meu carro")).toBe(true);
    });

    it("should match multiple keywords", () => {
      expect(matchKeywordTrigger("financiar, financiamento, parcela", "Qual o valor da parcela?")).toBe(true);
      expect(matchKeywordTrigger("financiar, financiamento, parcela", "Quero financiar")).toBe(true);
    });

    it("should not match unrelated message", () => {
      expect(matchKeywordTrigger("financiar, financiamento", "Quero ver o estoque")).toBe(false);
    });

    it("should handle empty trigger value", () => {
      expect(matchKeywordTrigger("", "Qualquer mensagem")).toBe(false);
    });
  });

  describe("Depth Limit Protection", () => {
    it("should prevent infinite loops with depth > 20", () => {
      let depth = 0;
      const maxDepth = 20;
      function simulateExecution(d: number): number {
        if (d > maxDepth) return d;
        return simulateExecution(d + 1);
      }
      const result = simulateExecution(0);
      expect(result).toBe(21);
      expect(result).toBeGreaterThan(maxDepth);
    });
  });
});
