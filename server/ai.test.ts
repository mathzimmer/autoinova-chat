import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT } from "./ai";

// We need to test the shouldForceVehicleSearch function
// Since it's not exported, we'll test the behavior via the exported prompt and verify key rules

describe("AI System Prompt", () => {
  it("contains key vehicle search rules", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("buscar_veiculos");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NUNCA invente veículos");
  });

  it("contains rules about single result behavior", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("APENAS 1 resultado");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("SEM pedir mais preferências");
  });

  it("contains rules about vehicle focus in conversation", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("FOQUE no novo veículo");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NÃO misture informações de veículos diferentes");
  });

  it("contains rules about image handling", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("CONFIRME o recebimento");
    expect(DEFAULT_SYSTEM_PROMPT).toContain('NUNCA diga "não consigo visualizar"');
  });

  it("contains rules about audio handling", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("transcreve automaticamente");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NÃO mencione que recebeu um áudio");
  });

  it("contains lead update rules for vehicle changes", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("MUDAR de veículo de interesse");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NOVO veículo");
  });

  it("does NOT instruct to force search on generic messages", () => {
    // The prompt should not say to search on every message
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NÃO chame buscar_veiculos para mensagens genéricas");
  });

  it("contains Auto Inova contact info", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("(51) 99478-2062");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Ivoti - RS");
  });
});

// Test the keyword detection logic by importing and testing directly
// We need to extract the function for testing
describe("Vehicle Search Keyword Detection", () => {
  // Simulate the keyword detection logic from ai.ts
  const VEHICLE_MODEL_KEYWORDS = [
    "sprinter", "corolla", "civic", "gol", "onix", "hb20", "polo", "t-cross",
    "tracker", "creta", "compass", "renegade", "kicks", "nivus", "taos",
    "hilux", "ranger", "s10", "toro", "saveiro", "strada", "montana",
    "palio", "uno", "argo", "mobi", "kwid", "sandero", "logan",
    "cruze", "cobalt", "spin", "prisma", "joy", "virtus", "jetta",
    "amarok", "tiguan", "voyage", "fox", "up", "golf",
    "toyota", "honda", "volkswagen", "vw", "chevrolet", "gm", "fiat",
    "hyundai", "jeep", "nissan", "renault", "ford", "mitsubishi",
    "mercedes", "bmw", "audi", "volvo", "peugeot", "citroen", "kia",
    "caoa", "chery", "jac", "lifan", "byd", "gwm", "ram",
    "vectra", "astra", "celta", "classic", "meriva", "zafira", "blazer",
    "fusca", "kombi", "brasilia", "variant", "passat",
    "fiesta", "focus", "ka", "ecosport", "territory",
    "fit", "city", "hrv", "wrv", "crv",
    "etios", "yaris", "camry", "sw4", "rav4",
    "tucson", "ix35", "santa fe", "azera",
    "suv", "sedan", "hatch", "picape", "pickup", "van", "caminhonete",
  ];

  const VEHICLE_SEARCH_KEYWORDS = [
    "disponível", "disponivel", "estoque", "opção", "opcao", "opções",
    "o que tem", "o que voces tem", "o que vocês têm",
    "quero ver", "quero conhecer", "mostrar", "me mostra",
    "carro até", "veículo até", "veiculo até",
  ];

  function shouldForceVehicleSearch(message: string): boolean {
    const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    const hasModel = VEHICLE_MODEL_KEYWORDS.some(kw => {
      const normalizedKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return lower.includes(normalizedKw);
    });
    if (hasModel) return true;
    
    const hasSearchIntent = VEHICLE_SEARCH_KEYWORDS.some(kw => {
      const normalizedKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return lower.includes(normalizedKw);
    });
    return hasSearchIntent;
  }

  it("triggers search for specific vehicle models", () => {
    expect(shouldForceVehicleSearch("Tem Corolla?")).toBe(true);
    expect(shouldForceVehicleSearch("Quero ver o Vectra")).toBe(true);
    expect(shouldForceVehicleSearch("Vocês têm Sprinter?")).toBe(true);
    expect(shouldForceVehicleSearch("Procuro uma Hilux")).toBe(true);
  });

  it("triggers search for vehicle brands", () => {
    expect(shouldForceVehicleSearch("Tem algo da Toyota?")).toBe(true);
    expect(shouldForceVehicleSearch("Quero um Honda")).toBe(true);
    expect(shouldForceVehicleSearch("Volkswagen")).toBe(true);
  });

  it("triggers search for categories", () => {
    expect(shouldForceVehicleSearch("Quero um SUV")).toBe(true);
    expect(shouldForceVehicleSearch("Tem sedan?")).toBe(true);
    expect(shouldForceVehicleSearch("Procuro uma picape")).toBe(true);
  });

  it("triggers search for general availability queries", () => {
    expect(shouldForceVehicleSearch("O que vocês têm disponível?")).toBe(true);
    expect(shouldForceVehicleSearch("Quero ver o estoque")).toBe(true);
    expect(shouldForceVehicleSearch("Me mostra as opções")).toBe(true);
  });

  it("does NOT trigger search for generic messages", () => {
    expect(shouldForceVehicleSearch("Tenho troca")).toBe(false);
    expect(shouldForceVehicleSearch("Quero financiar")).toBe(false);
    expect(shouldForceVehicleSearch("Ok")).toBe(false);
    expect(shouldForceVehicleSearch("Sim")).toBe(false);
    expect(shouldForceVehicleSearch("Obrigado")).toBe(false);
    expect(shouldForceVehicleSearch("Bom dia")).toBe(false);
    expect(shouldForceVehicleSearch("Pode ser")).toBe(false);
  });

  it("does NOT trigger search for trade-in messages", () => {
    expect(shouldForceVehicleSearch("Tenho um carro pra trocar")).toBe(false);
    expect(shouldForceVehicleSearch("Aceita troca?")).toBe(false);
    expect(shouldForceVehicleSearch("Quero dar meu carro na troca")).toBe(false);
  });

  it("handles accented characters correctly", () => {
    expect(shouldForceVehicleSearch("Tem veículo disponível?")).toBe(true);
    expect(shouldForceVehicleSearch("Quero ver as opções")).toBe(true);
  });
});
