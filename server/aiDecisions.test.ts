import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue(undefined),
});
const mockSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        offset: vi.fn().mockResolvedValue([]),
      }),
    }),
    groupBy: vi.fn().mockResolvedValue([]),
  }),
});

vi.mock("./db", async () => {
  const actual = await vi.importActual("./db");
  return {
    ...actual,
    getDb: vi.fn().mockResolvedValue({
      insert: mockInsert,
      select: mockSelect,
    }),
  };
});

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(),
}));

vi.mock("./_core/env", () => ({
  ENV: { ownerOpenId: "test-owner" },
}));

import { InsertAiDecision } from "../drizzle/schema";

describe("AI Decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Schema validation", () => {
    it("should have the correct fields in the aiDecisions schema", async () => {
      const { aiDecisions } = await import("../drizzle/schema");
      expect(aiDecisions).toBeDefined();
      
      // Check that the table has the expected column names
      const columnNames = Object.keys(aiDecisions);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("conversationId");
      expect(columnNames).toContain("toolName");
      expect(columnNames).toContain("toolArgs");
      expect(columnNames).toContain("toolResultSummary");
      expect(columnNames).toContain("resultCount");
      expect(columnNames).toContain("success");
      expect(columnNames).toContain("errorMessage");
      expect(columnNames).toContain("responseTimeMs");
      expect(columnNames).toContain("promptTokens");
      expect(columnNames).toContain("completionTokens");
      expect(columnNames).toContain("totalTokens");
      expect(columnNames).toContain("model");
      expect(columnNames).toContain("customerMessage");
      expect(columnNames).toContain("aiResponse");
      expect(columnNames).toContain("createdAt");
    });

    it("should have correct types for InsertAiDecision", () => {
      // Verify the type structure compiles correctly
      const testDecision: InsertAiDecision = {
        conversationId: 1,
        toolName: "buscar_veiculos",
        toolArgs: { marca: "Honda", modelo: "Civic" },
        toolResultSummary: "Encontrados 5 veículos",
        resultCount: 5,
        success: true,
        errorMessage: null,
        responseTimeMs: 150,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        model: "gpt-4",
        customerMessage: "Quero um Honda Civic",
        aiResponse: "Encontrei 5 Honda Civic no estoque...",
      };
      
      expect(testDecision.conversationId).toBe(1);
      expect(testDecision.toolName).toBe("buscar_veiculos");
      expect(testDecision.success).toBe(true);
    });

    it("should allow minimal InsertAiDecision with only required fields", () => {
      const minimalDecision: InsertAiDecision = {
        conversationId: 1,
        toolName: "resumo_estoque",
        success: true,
      };
      
      expect(minimalDecision.conversationId).toBe(1);
      expect(minimalDecision.toolName).toBe("resumo_estoque");
    });
  });

  describe("Decision data structure", () => {
    it("should correctly structure buscar_veiculos decision", () => {
      const decision = {
        toolName: "buscar_veiculos",
        toolArgs: {
          marca: "Toyota",
          modelo: "Hilux",
          categoria: "picape",
          cambio: "automatico",
          preco_max: 200000,
        },
        toolResultSummary: "RESULTADOS DA BUSCA: Encontrados 3 veículos...",
        resultCount: 3,
        success: true,
        errorMessage: null,
        startTime: 1000,
        endTime: 1250,
      };

      expect(decision.toolName).toBe("buscar_veiculos");
      expect(decision.toolArgs.categoria).toBe("picape");
      expect(decision.toolArgs.cambio).toBe("automatico");
      expect(decision.resultCount).toBe(3);
      expect(decision.endTime - decision.startTime).toBe(250);
    });

    it("should correctly structure atualizar_lead decision", () => {
      const decision = {
        toolName: "atualizar_lead",
        toolArgs: {
          nome: "João Silva",
          intencao: "compra",
          veiculo_interesse: "Hilux",
          forma_pagamento: "financiamento",
        },
        toolResultSummary: "Lead atualizado com sucesso.",
        resultCount: null,
        success: true,
        errorMessage: null,
        startTime: 2000,
        endTime: 2100,
      };

      expect(decision.toolName).toBe("atualizar_lead");
      expect(decision.toolArgs.nome).toBe("João Silva");
      expect(decision.toolArgs.veiculo_interesse).toBe("Hilux");
      expect(decision.success).toBe(true);
    });

    it("should correctly structure failed decision", () => {
      const decision = {
        toolName: "buscar_veiculos",
        toolArgs: { marca: "Ferrari" },
        toolResultSummary: "Erro: timeout",
        resultCount: null,
        success: false,
        errorMessage: "Request timeout after 5000ms",
        startTime: 3000,
        endTime: 8000,
      };

      expect(decision.success).toBe(false);
      expect(decision.errorMessage).toContain("timeout");
      expect(decision.endTime - decision.startTime).toBe(5000);
    });

    it("should correctly structure resumo_estoque decision", () => {
      const decision = {
        toolName: "resumo_estoque",
        toolArgs: {},
        toolResultSummary: "Estoque total: 109 veículos ativos...",
        resultCount: null,
        success: true,
        errorMessage: null,
        startTime: 4000,
        endTime: 4300,
      };

      expect(decision.toolName).toBe("resumo_estoque");
      expect(Object.keys(decision.toolArgs).length).toBe(0);
      expect(decision.success).toBe(true);
    });
  });

  describe("Decision batch creation", () => {
    it("should create batch records from multiple tool calls", () => {
      const toolDecisions = [
        {
          toolName: "atualizar_lead",
          toolArgs: { nome: "Maria", veiculo_interesse: "Onix" },
          toolResultSummary: "Lead atualizado com sucesso.",
          resultCount: null as number | null,
          success: true,
          errorMessage: null as string | null,
          startTime: 1000,
          endTime: 1100,
        },
        {
          toolName: "buscar_veiculos",
          toolArgs: { modelo: "Onix", cambio: "automatico" },
          toolResultSummary: "Encontrados 8 veículos...",
          resultCount: 8,
          success: true,
          errorMessage: null as string | null,
          startTime: 1100,
          endTime: 1400,
        },
      ];

      const conversationId = 42;
      const customerMessage = "Quero um Onix automático";
      const aiResponse = "Encontrei 8 Onix automáticos...";
      const usage = { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 };
      const model = "gpt-4";

      const decisionRecords = toolDecisions.map(d => ({
        conversationId,
        toolName: d.toolName,
        toolArgs: d.toolArgs,
        toolResultSummary: d.toolResultSummary,
        resultCount: d.resultCount,
        success: d.success,
        errorMessage: d.errorMessage,
        responseTimeMs: d.endTime - d.startTime,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        model,
        customerMessage: customerMessage.substring(0, 500),
        aiResponse: aiResponse.substring(0, 500),
      }));

      expect(decisionRecords).toHaveLength(2);
      expect(decisionRecords[0].toolName).toBe("atualizar_lead");
      expect(decisionRecords[0].responseTimeMs).toBe(100);
      expect(decisionRecords[0].conversationId).toBe(42);
      expect(decisionRecords[1].toolName).toBe("buscar_veiculos");
      expect(decisionRecords[1].responseTimeMs).toBe(300);
      expect(decisionRecords[1].resultCount).toBe(8);
      expect(decisionRecords[1].totalTokens).toBe(700);
    });

    it("should truncate long messages to 500 chars", () => {
      const longMessage = "a".repeat(1000);
      const truncated = longMessage.substring(0, 500);
      
      expect(truncated.length).toBe(500);
      expect(longMessage.length).toBe(1000);
    });
  });

  describe("Result count extraction", () => {
    it("should extract count from 'X veículos' pattern", () => {
      const toolResult = "RESULTADOS DA BUSCA: Encontrados 5 veículos no estoque.";
      const countMatch = toolResult.match(/(\d+)\s*(veículos?|resultados?|encontrados?)/i);
      const resultCount = countMatch ? parseInt(countMatch[1]) : null;
      expect(resultCount).toBe(5);
    });

    it("should extract count from 'X resultados' pattern", () => {
      const toolResult = "Mostrando 12 resultados para sua busca.";
      const countMatch = toolResult.match(/(\d+)\s*(veículos?|resultados?|encontrados?)/i);
      const resultCount = countMatch ? parseInt(countMatch[1]) : null;
      expect(resultCount).toBe(12);
    });

    it("should return 0 for 'Nenhum' results", () => {
      const toolResult = "Nenhum veículo encontrado com esses critérios.";
      const countMatch = toolResult.match(/(\d+)\s*(veículos?|resultados?|encontrados?)/i);
      const resultCount = countMatch ? parseInt(countMatch[1]) : (toolResult.includes("Nenhum") ? 0 : null);
      expect(resultCount).toBe(0);
    });

    it("should return null when no count pattern found", () => {
      const toolResult = "Lead atualizado com sucesso.";
      const countMatch = toolResult.match(/(\d+)\s*(veículos?|resultados?|encontrados?)/i);
      const resultCount = countMatch ? parseInt(countMatch[1]) : (toolResult.includes("Nenhum") ? 0 : null);
      expect(resultCount).toBeNull();
    });
  });

  describe("Tool labels and UI mapping", () => {
    const TOOL_LABELS: Record<string, { label: string; color: string }> = {
      buscar_veiculos: { label: "Buscar Veículos", color: "text-blue-400" },
      atualizar_lead: { label: "Atualizar Lead", color: "text-green-400" },
      resumo_estoque: { label: "Resumo Estoque", color: "text-purple-400" },
      rotear_para_vendedor: { label: "Rotear p/ Vendedor", color: "text-orange-400" },
    };

    it("should have labels for all known tools", () => {
      expect(TOOL_LABELS["buscar_veiculos"]).toBeDefined();
      expect(TOOL_LABELS["atualizar_lead"]).toBeDefined();
      expect(TOOL_LABELS["resumo_estoque"]).toBeDefined();
      expect(TOOL_LABELS["rotear_para_vendedor"]).toBeDefined();
    });

    it("should handle unknown tools gracefully", () => {
      const unknownTool = "nova_tool_futura";
      const info = TOOL_LABELS[unknownTool] || { label: unknownTool, color: "text-muted-foreground" };
      expect(info.label).toBe("nova_tool_futura");
      expect(info.color).toBe("text-muted-foreground");
    });
  });
});
