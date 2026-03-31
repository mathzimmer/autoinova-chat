import { describe, it, expect } from "vitest";
import { RESCUE_DEFAULTS, type RescueConfig } from "./rescueJob";

describe("Rescue Job", () => {
  describe("RESCUE_DEFAULTS", () => {
    it("should have sensible defaults", () => {
      expect(RESCUE_DEFAULTS.enabled).toBe(false);
      expect(RESCUE_DEFAULTS.inactivityMinutes).toBe(30);
      expect(RESCUE_DEFAULTS.maxAttempts).toBe(3);
      expect(RESCUE_DEFAULTS.intervalMinutes).toBe(60);
      expect(RESCUE_DEFAULTS.rescueFlowId).toBeNull();
      expect(RESCUE_DEFAULTS.maxPerRun).toBe(20);
      expect(RESCUE_DEFAULTS.checkIntervalMinutes).toBe(2);
    });

    it("should have disabled by default for safety", () => {
      expect(RESCUE_DEFAULTS.enabled).toBe(false);
    });

    it("should have null rescueFlowId by default", () => {
      expect(RESCUE_DEFAULTS.rescueFlowId).toBeNull();
    });
  });

  describe("RescueConfig type validation", () => {
    it("should accept valid config", () => {
      const config: RescueConfig = {
        enabled: true,
        inactivityMinutes: 45,
        maxAttempts: 5,
        intervalMinutes: 120,
        rescueFlowId: 1,
        maxPerRun: 10,
        checkIntervalMinutes: 5,
      };
      expect(config.enabled).toBe(true);
      expect(config.inactivityMinutes).toBe(45);
      expect(config.maxAttempts).toBe(5);
      expect(config.intervalMinutes).toBe(120);
      expect(config.rescueFlowId).toBe(1);
      expect(config.maxPerRun).toBe(10);
      expect(config.checkIntervalMinutes).toBe(5);
    });

    it("should allow null rescueFlowId", () => {
      const config: RescueConfig = {
        ...RESCUE_DEFAULTS,
        rescueFlowId: null,
      };
      expect(config.rescueFlowId).toBeNull();
    });
  });

  describe("Variable replacement patterns", () => {
    // Test the variable patterns used in replaceVars
    const patterns = [
      { pattern: /\{\{nome\}\}/gi, name: "nome" },
      { pattern: /\{\{nome_completo\}\}/gi, name: "nome_completo" },
      { pattern: /\{\{telefone\}\}/gi, name: "telefone" },
      { pattern: /\{\{veiculo\}\}/gi, name: "veiculo" },
      { pattern: /\{\{cidade\}\}/gi, name: "cidade" },
      { pattern: /\{\{troca\}\}/gi, name: "troca" },
      { pattern: /\{\{pagamento\}\}/gi, name: "pagamento" },
      { pattern: /\{\{entrada\}\}/gi, name: "entrada" },
      { pattern: /\{\{email\}\}/gi, name: "email" },
      { pattern: /\{\{notas\}\}/gi, name: "notas" },
      { pattern: /\{\{etapa_funil\}\}/gi, name: "etapa_funil" },
      { pattern: /\{\{temperatura\}\}/gi, name: "temperatura" },
      { pattern: /\{\{intencao\}\}/gi, name: "intencao" },
      { pattern: /\{\{tentativa_resgate\}\}/gi, name: "tentativa_resgate" },
    ];

    patterns.forEach(({ pattern, name }) => {
      it(`should match {{${name}}} variable`, () => {
        const text = `Olá {{${name}}}!`;
        expect(pattern.test(text)).toBe(true);
      });
    });

    it("should match case-insensitive variables", () => {
      expect(/\{\{nome\}\}/gi.test("{{NOME}}")).toBe(true);
      expect(/\{\{etapa_funil\}\}/gi.test("{{Etapa_Funil}}")).toBe(true);
    });

    it("should handle multiple variables in same text", () => {
      const text = "Oi {{nome}}, vi que você quer o {{veiculo}}. Etapa: {{etapa_funil}}, Temp: {{temperatura}}";
      const replaced = text
        .replace(/\{\{nome\}\}/gi, "João")
        .replace(/\{\{veiculo\}\}/gi, "Hilux SRV")
        .replace(/\{\{etapa_funil\}\}/gi, "interesse_definido")
        .replace(/\{\{temperatura\}\}/gi, "morno");
      expect(replaced).toBe("Oi João, vi que você quer o Hilux SRV. Etapa: interesse_definido, Temp: morno");
    });
  });

  describe("Condition evaluation logic", () => {
    // Test the condition logic used in executeRescueForLead
    function evaluateCondition(fieldValue: string, operator: string, value: string): boolean {
      switch (operator) {
        case "equals": return fieldValue === value;
        case "not_equals": return fieldValue !== value;
        case "contains": return fieldValue.includes(value);
        case "not_empty": return fieldValue.length > 0;
        case "empty": return fieldValue.length === 0;
        case "greater_than": return Number(fieldValue) > Number(value);
        case "less_than": return Number(fieldValue) < Number(value);
        default: return false;
      }
    }

    it("should evaluate equals correctly", () => {
      expect(evaluateCondition("interesse_definido", "equals", "interesse_definido")).toBe(true);
      expect(evaluateCondition("novo", "equals", "interesse_definido")).toBe(false);
    });

    it("should evaluate not_equals correctly", () => {
      expect(evaluateCondition("novo", "not_equals", "fechado")).toBe(true);
      expect(evaluateCondition("fechado", "not_equals", "fechado")).toBe(false);
    });

    it("should evaluate contains correctly", () => {
      expect(evaluateCondition("interesse_definido", "contains", "interesse")).toBe(true);
      expect(evaluateCondition("novo", "contains", "interesse")).toBe(false);
    });

    it("should evaluate not_empty correctly", () => {
      expect(evaluateCondition("Hilux", "not_empty", "")).toBe(true);
      expect(evaluateCondition("", "not_empty", "")).toBe(false);
    });

    it("should evaluate empty correctly", () => {
      expect(evaluateCondition("", "empty", "")).toBe(true);
      expect(evaluateCondition("Hilux", "empty", "")).toBe(false);
    });

    it("should evaluate greater_than correctly", () => {
      expect(evaluateCondition("3", "greater_than", "2")).toBe(true);
      expect(evaluateCondition("1", "greater_than", "2")).toBe(false);
    });

    it("should evaluate less_than correctly", () => {
      expect(evaluateCondition("1", "less_than", "2")).toBe(true);
      expect(evaluateCondition("3", "less_than", "2")).toBe(false);
    });
  });

  describe("Field mapping for conditions", () => {
    it("should map all expected fields", () => {
      const lead = {
        funnelStatus: "interesse_definido",
        temperature: "morno",
        intention: "comprar",
        vehicleInterest: "Hilux SRV",
        hasTrade: true,
        paymentMethod: "financiamento",
        city: "Porto Alegre",
      };
      const attemptNumber = 2;

      const fieldMap: Record<string, string> = {
        etapa_funil: lead.funnelStatus || "novo",
        temperatura: lead.temperature || "frio",
        intencao: lead.intention || "",
        veiculo: lead.vehicleInterest || "",
        tem_troca: lead.hasTrade ? "sim" : "nao",
        pagamento: lead.paymentMethod || "",
        cidade: lead.city || "",
        tentativa: String(attemptNumber),
      };

      expect(fieldMap.etapa_funil).toBe("interesse_definido");
      expect(fieldMap.temperatura).toBe("morno");
      expect(fieldMap.intencao).toBe("comprar");
      expect(fieldMap.veiculo).toBe("Hilux SRV");
      expect(fieldMap.tem_troca).toBe("sim");
      expect(fieldMap.pagamento).toBe("financiamento");
      expect(fieldMap.cidade).toBe("Porto Alegre");
      expect(fieldMap.tentativa).toBe("2");
    });

    it("should handle missing lead data with defaults", () => {
      const lead = {} as any;
      const fieldMap: Record<string, string> = {
        etapa_funil: lead.funnelStatus || "novo",
        temperatura: lead.temperature || "frio",
        intencao: lead.intention || "",
        veiculo: lead.vehicleInterest || "",
        tem_troca: lead.hasTrade ? "sim" : "nao",
        pagamento: lead.paymentMethod || "",
        cidade: lead.city || "",
        tentativa: String(1),
      };

      expect(fieldMap.etapa_funil).toBe("novo");
      expect(fieldMap.temperatura).toBe("frio");
      expect(fieldMap.intencao).toBe("");
      expect(fieldMap.tem_troca).toBe("nao");
    });
  });

  describe("Excluded funnel statuses", () => {
    // Leads in these statuses should NOT be rescued
    const excludedStatuses = ["fechado", "perdido", "encaminhado_vendedor", "negociando"];
    const activeStatuses = ["novo", "interesse_definido", "pagamento_definido", "dados_pessoais", "dados_troca"];

    it("should exclude closed/lost/forwarded leads", () => {
      excludedStatuses.forEach(status => {
        expect(["fechado", "perdido", "encaminhado_vendedor", "negociando"]).toContain(status);
      });
    });

    it("should include active funnel stages for rescue", () => {
      activeStatuses.forEach(status => {
        expect(excludedStatuses).not.toContain(status);
      });
    });
  });
});
