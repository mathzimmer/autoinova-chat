import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("./db", () => ({
  getDb: vi.fn(),
  listLeads: vi.fn(),
  getLeadByConversationId: vi.fn(),
  upsertLead: vi.fn(),
  getLeadSummaries: vi.fn(),
  getLeadSummariesByConversation: vi.fn(),
  upsertLeadSummary: vi.fn(),
  getFullLeadSummaryText: vi.fn(),
}));

import {
  listLeads,
  getLeadByConversationId,
  upsertLead,
  getLeadSummaries,
  upsertLeadSummary,
  getFullLeadSummaryText,
} from "./db";

const mockedListLeads = vi.mocked(listLeads);
const mockedGetLeadByConversation = vi.mocked(getLeadByConversationId);
const mockedUpsertLead = vi.mocked(upsertLead);
const mockedGetLeadSummaries = vi.mocked(getLeadSummaries);
const mockedUpsertLeadSummary = vi.mocked(upsertLeadSummary);
const mockedGetFullSummaryText = vi.mocked(getFullLeadSummaryText);

describe("Lead module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listLeads", () => {
    it("should return all leads when no filter", async () => {
      const mockLeads = [
        { id: 1, conversationId: 10, phone: "5551997566259", name: "João", status: "new" },
        { id: 2, conversationId: 11, phone: "5551998877665", name: "Maria", status: "qualified" },
      ];
      mockedListLeads.mockResolvedValue(mockLeads as any);

      const result = await listLeads();
      expect(result).toHaveLength(2);
      expect(mockedListLeads).toHaveBeenCalledTimes(1);
    });

    it("should filter by status", async () => {
      const mockLeads = [
        { id: 1, conversationId: 10, phone: "5551997566259", name: "João", status: "new" },
      ];
      mockedListLeads.mockResolvedValue(mockLeads as any);

      const result = await listLeads({ status: "new" });
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("new");
    });
  });

  describe("getLeadByConversationId", () => {
    it("should return lead for a conversation", async () => {
      const mockLead = { id: 1, conversationId: 10, phone: "5551997566259", name: "João" };
      mockedGetLeadByConversation.mockResolvedValue(mockLead as any);

      const result = await getLeadByConversationId(10);
      expect(result).toBeDefined();
      expect(result?.conversationId).toBe(10);
    });

    it("should return undefined for non-existent conversation", async () => {
      mockedGetLeadByConversation.mockResolvedValue(undefined);

      const result = await getLeadByConversationId(999);
      expect(result).toBeUndefined();
    });
  });

  describe("upsertLead", () => {
    it("should create a new lead", async () => {
      const newLead = {
        conversationId: 10,
        phone: "5551997566259",
        name: "João",
        city: "Porto Alegre",
        vehicleInterest: "Hilux 2020",
      };
      mockedUpsertLead.mockResolvedValue({ ...newLead, id: 1 } as any);

      const result = await upsertLead(newLead as any);
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.city).toBe("Porto Alegre");
    });

    it("should update existing lead with city", async () => {
      const updateData = {
        conversationId: 10,
        phone: "5551997566259",
        city: "Canoas",
        status: "qualified" as const,
      };
      mockedUpsertLead.mockResolvedValue({ ...updateData, id: 1 } as any);

      const result = await upsertLead(updateData as any);
      expect(result.city).toBe("Canoas");
      expect(result.status).toBe("qualified");
    });
  });

  describe("Lead Summaries", () => {
    it("should return summaries for a lead", async () => {
      const mockSummaries = [
        { id: 1, leadId: 1, conversationId: 10, summaryDate: "2026-03-06", summary: "Cliente interessado em Hilux", messageCount: 5 },
        { id: 2, leadId: 1, conversationId: 10, summaryDate: "2026-03-05", summary: "Primeiro contato", messageCount: 3 },
      ];
      mockedGetLeadSummaries.mockResolvedValue(mockSummaries as any);

      const result = await getLeadSummaries(1);
      expect(result).toHaveLength(2);
      expect(result[0].summaryDate).toBe("2026-03-06");
    });

    it("should upsert a summary", async () => {
      const summaryData = {
        leadId: 1,
        conversationId: 10,
        summaryDate: "2026-03-06",
        summary: "Cliente quer Hilux 2020, tem Gol para troca",
        messageCount: 5,
      };
      mockedUpsertLeadSummary.mockResolvedValue({ ...summaryData, id: 1 } as any);

      const result = await upsertLeadSummary(summaryData);
      expect(result).toBeDefined();
      expect(result?.summary).toContain("Hilux 2020");
    });

    it("should return full summary text in chronological order", async () => {
      mockedGetFullSummaryText.mockResolvedValue(
        "[2026-03-05]\nPrimeiro contato\n\n[2026-03-06]\nCliente interessado em Hilux"
      );

      const text = await getFullLeadSummaryText(10);
      expect(text).toContain("[2026-03-05]");
      expect(text).toContain("[2026-03-06]");
      // Chronological: 05 should come before 06
      expect(text.indexOf("2026-03-05")).toBeLessThan(text.indexOf("2026-03-06"));
    });
  });
});

describe("Phone formatting", () => {
  function formatPhone(phone: string): string {
    if (!phone) return "";
    let p = phone.replace(/\D/g, "");
    if (p.startsWith("55") && p.length > 11) p = p.substring(2);
    return p;
  }

  it("should remove +55 prefix", () => {
    expect(formatPhone("+5551997566259")).toBe("51997566259");
  });

  it("should remove 55 prefix", () => {
    expect(formatPhone("5551997566259")).toBe("51997566259");
  });

  it("should keep phone without prefix", () => {
    expect(formatPhone("51997566259")).toBe("51997566259");
  });

  it("should handle empty phone", () => {
    expect(formatPhone("")).toBe("");
  });
});

describe("Lead copy info formatting", () => {
  it("should format lead info for clipboard", () => {
    const lead = {
      name: "João Silva",
      phone: "5551997566259",
      city: "Porto Alegre",
      vehicleInterest: "Hilux 2020",
      hasTrade: true,
      tradeVehicle: "Gol",
      tradeYear: "2015",
      tradeKm: "80000",
      paymentMethod: "Financiamento",
      downPayment: "R$ 20.000",
      status: "qualified",
    };

    const parts: string[] = [];
    parts.push(`Nome: ${lead.name}`);
    // Format phone without 55
    let p = lead.phone.replace(/\D/g, "");
    if (p.startsWith("55") && p.length > 11) p = p.substring(2);
    parts.push(`Telefone: ${p}`);
    if (lead.city) parts.push(`Cidade: ${lead.city}`);
    if (lead.vehicleInterest) parts.push(`Veículo de interesse: ${lead.vehicleInterest}`);
    if (lead.hasTrade && lead.tradeVehicle) parts.push(`Veículo de troca: ${lead.tradeVehicle} ${lead.tradeYear || ""} ${lead.tradeKm ? `(${lead.tradeKm} km)` : ""}`);
    if (lead.paymentMethod) parts.push(`Pagamento: ${lead.paymentMethod}${lead.downPayment ? ` - Entrada: ${lead.downPayment}` : ""}`);

    const result = parts.join("\n");
    expect(result).toContain("Nome: João Silva");
    expect(result).toContain("Telefone: 51997566259");
    expect(result).toContain("Cidade: Porto Alegre");
    expect(result).toContain("Veículo de interesse: Hilux 2020");
    expect(result).toContain("Veículo de troca: Gol 2015 (80000 km)");
    expect(result).toContain("Pagamento: Financiamento - Entrada: R$ 20.000");
  });
});
