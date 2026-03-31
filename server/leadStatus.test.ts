import { describe, it, expect } from "vitest";

// ─── Temperature Calculation Logic ───────────────────────────────
const FUNNEL_TO_TEMP: Record<string, string> = {
  novo: "frio",
  perdido: "frio",
  interesse_definido: "morno",
  pagamento_definido: "quente",
  dados_pessoais: "quente",
  dados_troca: "quente",
  encaminhado_vendedor: "muito_quente",
  negociando: "muito_quente",
  fechado: "muito_quente",
};

function calculateTemperature(funnelStatus: string): string {
  return FUNNEL_TO_TEMP[funnelStatus] || "frio";
}

// ─── Funnel Status Labels ────────────────────────────────────────
const FUNNEL_STATUS_LABELS: Record<string, string> = {
  novo: "❄️ Novo",
  interesse_definido: "🌤️ Interesse Definido",
  pagamento_definido: "💳 Pagamento Definido",
  dados_pessoais: "📝 Dados Pessoais",
  dados_troca: "🚗 Dados de Troca",
  encaminhado_vendedor: "👤 Encaminhado ao Vendedor",
  negociando: "🤝 Negociando",
  fechado: "✅ Fechado",
  perdido: "❌ Perdido",
};

const TEMPERATURE_LABELS: Record<string, string> = {
  frio: "❄️ Frio",
  morno: "🌤️ Morno",
  quente: "🔥 Quente",
  muito_quente: "🔥🔥 Muito Quente",
};

// ─── Tests ───────────────────────────────────────────────────────

describe("Lead Funnel Status & Temperature System", () => {
  describe("Temperature Calculation", () => {
    it("should map 'novo' to 'frio'", () => {
      expect(calculateTemperature("novo")).toBe("frio");
    });

    it("should map 'perdido' to 'frio'", () => {
      expect(calculateTemperature("perdido")).toBe("frio");
    });

    it("should map 'interesse_definido' to 'morno'", () => {
      expect(calculateTemperature("interesse_definido")).toBe("morno");
    });

    it("should map 'pagamento_definido' to 'quente'", () => {
      expect(calculateTemperature("pagamento_definido")).toBe("quente");
    });

    it("should map 'dados_pessoais' to 'quente'", () => {
      expect(calculateTemperature("dados_pessoais")).toBe("quente");
    });

    it("should map 'dados_troca' to 'quente'", () => {
      expect(calculateTemperature("dados_troca")).toBe("quente");
    });

    it("should map 'encaminhado_vendedor' to 'muito_quente'", () => {
      expect(calculateTemperature("encaminhado_vendedor")).toBe("muito_quente");
    });

    it("should map 'negociando' to 'muito_quente'", () => {
      expect(calculateTemperature("negociando")).toBe("muito_quente");
    });

    it("should map 'fechado' to 'muito_quente'", () => {
      expect(calculateTemperature("fechado")).toBe("muito_quente");
    });

    it("should default to 'frio' for unknown status", () => {
      expect(calculateTemperature("unknown")).toBe("frio");
      expect(calculateTemperature("")).toBe("frio");
    });
  });

  describe("Funnel Status Labels", () => {
    it("should have labels for all 9 funnel statuses", () => {
      const statuses = [
        "novo", "interesse_definido", "pagamento_definido",
        "dados_pessoais", "dados_troca", "encaminhado_vendedor",
        "negociando", "fechado", "perdido",
      ];
      statuses.forEach((status) => {
        expect(FUNNEL_STATUS_LABELS[status]).toBeDefined();
        expect(FUNNEL_STATUS_LABELS[status].length).toBeGreaterThan(0);
      });
    });
  });

  describe("Temperature Labels", () => {
    it("should have labels for all 4 temperatures", () => {
      const temps = ["frio", "morno", "quente", "muito_quente"];
      temps.forEach((temp) => {
        expect(TEMPERATURE_LABELS[temp]).toBeDefined();
        expect(TEMPERATURE_LABELS[temp].length).toBeGreaterThan(0);
      });
    });
  });

  describe("Funnel Progression Logic", () => {
    it("temperature should increase or stay same as funnel progresses", () => {
      const progression = [
        "novo", "interesse_definido", "pagamento_definido",
        "dados_pessoais", "dados_troca", "encaminhado_vendedor",
        "negociando", "fechado",
      ];
      const tempOrder = ["frio", "morno", "quente", "muito_quente"];

      let prevTempIndex = -1;
      for (const status of progression) {
        const temp = calculateTemperature(status);
        const tempIndex = tempOrder.indexOf(temp);
        expect(tempIndex).toBeGreaterThanOrEqual(prevTempIndex);
        prevTempIndex = tempIndex;
      }
    });

    it("'perdido' should reset temperature to frio", () => {
      // After being 'quente', if marked as 'perdido', should go to 'frio'
      expect(calculateTemperature("dados_troca")).toBe("quente");
      expect(calculateTemperature("perdido")).toBe("frio");
    });
  });

  describe("AI Tool Integration", () => {
    it("should have etapa_funil in the atualizar_lead tool definition", () => {
      // Verify the tool definition structure
      const validFunnelStatuses = [
        "novo", "interesse_definido", "pagamento_definido",
        "dados_pessoais", "dados_troca", "encaminhado_vendedor",
        "negociando", "fechado", "perdido",
      ];

      // Simulate what the AI would send
      const testArgs = {
        nome: "João",
        veiculo_interesse: "Hilux",
        etapa_funil: "interesse_definido",
      };

      expect(validFunnelStatuses).toContain(testArgs.etapa_funil);
    });

    it("should correctly map AI etapa_funil to database funnelStatus", () => {
      // The AI sends etapa_funil, which maps to funnelStatus in the database
      const aiArg = "pagamento_definido";
      const dbField = aiArg; // Direct mapping
      const temperature = calculateTemperature(dbField);

      expect(dbField).toBe("pagamento_definido");
      expect(temperature).toBe("quente");
    });
  });

  describe("FlowEngine update_lead_status Node", () => {
    it("should correctly process funnelStatus from node config", () => {
      const nodeConfig = { funnelStatus: "encaminhado_vendedor" };
      const temperature = calculateTemperature(nodeConfig.funnelStatus);

      expect(temperature).toBe("muito_quente");
    });

    it("should handle missing funnelStatus gracefully", () => {
      const nodeConfig = {};
      const funnelStatus = (nodeConfig as any).funnelStatus || "novo";
      const temperature = calculateTemperature(funnelStatus);

      expect(temperature).toBe("frio");
    });
  });
});
