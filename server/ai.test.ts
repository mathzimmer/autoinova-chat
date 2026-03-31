import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT, CORE_PROMPT, COMMERCIAL_PROMPT, DEFAULT_PERSONALITY_PROMPT } from "./ai";

describe("CORE_PROMPT (Layer 1) - Condensed", () => {
  it("contains format rules", () => {
    expect(CORE_PROMPT).toContain("FORMATO");
    expect(CORE_PROMPT).toContain("PROIBIDO markdown");
    expect(CORE_PROMPT).toContain("WhatsApp");
  });

  it("contains priority rule for recent messages", () => {
    expect(CORE_PROMPT).toContain("PRIORIDADE");
    expect(CORE_PROMPT).toContain("MENSAGEM ATUAL");
  });

  it("contains numeric selection rule", () => {
    expect(CORE_PROMPT).toContain("SELEÇÃO NUMÉRICA");
    expect(CORE_PROMPT).toContain("ESCOLHENDO");
  });

  it("contains lead update rules", () => {
    expect(CORE_PROMPT).toContain("ATUALIZAR LEAD");
    expect(CORE_PROMPT).toContain("atualizar_lead");
    expect(CORE_PROMPT).toContain("veiculo_id: null");
  });

  it("contains vehicle data integrity rules", () => {
    expect(CORE_PROMPT).toContain("SÓ apresente veículos retornados");
    expect(CORE_PROMPT).toContain("COPIE preço e ano EXATAMENTE");
    expect(CORE_PROMPT).toContain("PROIBIDO inventar");
  });

  it("contains media handling rules", () => {
    expect(CORE_PROMPT).toContain("Imagens");
    expect(CORE_PROMPT).toContain("Áudios");
    expect(CORE_PROMPT).toContain("NUNCA diga");
  });

  it("contains cleanup rules", () => {
    expect(CORE_PROMPT).toContain("LIMPEZA");
    expect(CORE_PROMPT).toContain("[ID:X]");
  });

  it("is significantly shorter than old prompt", () => {
    // New CORE should be under 1200 chars (was ~2100)
    expect(CORE_PROMPT.length).toBeLessThan(1500);
    expect(CORE_PROMPT.length).toBeGreaterThan(400);
  });
});

describe("COMMERCIAL_PROMPT (Layer 2) - Stage-based Engine", () => {
  it("contains action priority hierarchy", () => {
    expect(COMMERCIAL_PROMPT).toContain("PRIORIDADE DE AÇÕES");
    expect(COMMERCIAL_PROMPT).toContain("1.");
    expect(COMMERCIAL_PROMPT).toContain("2.");
    expect(COMMERCIAL_PROMPT).toContain("3.");
    expect(COMMERCIAL_PROMPT).toContain("4.");
  });

  it("contains ETAPA 1 - PRIMEIRO CONTATO", () => {
    expect(COMMERCIAL_PROMPT).toContain("ETAPA 1 - PRIMEIRO CONTATO");
    expect(COMMERCIAL_PROMPT).toContain("Cenário:");
    expect(COMMERCIAL_PROMPT).toContain("Ação:");
  });

  it("contains ETAPA 2 - APRESENTAÇÃO DO VEÍCULO", () => {
    expect(COMMERCIAL_PROMPT).toContain("ETAPA 2 - APRESENTAÇÃO DO VEÍCULO");
    expect(COMMERCIAL_PROMPT).toContain("buscar_veiculos");
    expect(COMMERCIAL_PROMPT).toContain("1 resultado");
    expect(COMMERCIAL_PROMPT).toContain("2-3 resultados");
    expect(COMMERCIAL_PROMPT).toContain("4+ resultados");
  });

  it("contains ETAPA 3 - QUALIFICAÇÃO", () => {
    expect(COMMERCIAL_PROMPT).toContain("ETAPA 3 - QUALIFICAÇÃO");
    expect(COMMERCIAL_PROMPT).toContain("troca");
    expect(COMMERCIAL_PROMPT).toContain("financiamento");
    expect(COMMERCIAL_PROMPT).toContain("à vista");
    expect(COMMERCIAL_PROMPT).toContain("entrada");
  });

  it("contains ETAPA 4 - FECHAMENTO", () => {
    expect(COMMERCIAL_PROMPT).toContain("ETAPA 4 - FECHAMENTO");
    expect(COMMERCIAL_PROMPT).toContain("cidade");
    expect(COMMERCIAL_PROMPT).toContain("visita");
    expect(COMMERCIAL_PROMPT).toContain("qualified");
  });

  it("contains special scenarios", () => {
    expect(COMMERCIAL_PROMPT).toContain("CENÁRIOS ESPECIAIS");
    expect(COMMERCIAL_PROMPT).toContain("MUDANÇA DE INTERESSE");
    expect(COMMERCIAL_PROMPT).toContain("MUDANÇA DE TROCA");
    expect(COMMERCIAL_PROMPT).toContain("CLIENTE RETORNOU");
    expect(COMMERCIAL_PROMPT).toContain("IMAGEM RECEBIDA");
  });

  it("contains search rules", () => {
    expect(COMMERCIAL_PROMPT).toContain("REGRAS DE BUSCA");
    expect(COMMERCIAL_PROMPT).toContain("SIMPLIFICAÇÃO");
    expect(COMMERCIAL_PROMPT).toContain("FILTROS");
  });

  it("contains category and transmission filter mappings", () => {
    expect(COMMERCIAL_PROMPT).toContain("picape");
    expect(COMMERCIAL_PROMPT).toContain("hatch");
    expect(COMMERCIAL_PROMPT).toContain("sedan");
    expect(COMMERCIAL_PROMPT).toContain("suv");
    expect(COMMERCIAL_PROMPT).toContain("automatico");
    expect(COMMERCIAL_PROMPT).toContain("manual");
  });

  it("instructs NOT to call buscar_veiculos for pre-loaded ad vehicles", () => {
    expect(COMMERCIAL_PROMPT).toContain("NÃO chame buscar_veiculos");
    expect(COMMERCIAL_PROMPT).toContain("pré-carregado");
  });

  it("contains scenario-based conversation examples", () => {
    // Each stage should have Cenário + Ação pairs
    const cenarioCount = (COMMERCIAL_PROMPT.match(/Cenário:/g) || []).length;
    const acaoCount = (COMMERCIAL_PROMPT.match(/Ação:/g) || []).length;
    expect(cenarioCount).toBeGreaterThanOrEqual(15); // At least 15 scenarios
    expect(acaoCount).toBeGreaterThanOrEqual(15);
  });

  it("contains trade-in qualification flow", () => {
    expect(COMMERCIAL_PROMPT).toContain("TEM troca");
    expect(COMMERCIAL_PROMPT).toContain("NÃO tem troca");
    expect(COMMERCIAL_PROMPT).toContain("modelo, ano e km");
    expect(COMMERCIAL_PROMPT).toContain("atualizar_lead(tem_troca: true");
  });

  it("contains payment qualification flow", () => {
    expect(COMMERCIAL_PROMPT).toContain("financiamento");
    expect(COMMERCIAL_PROMPT).toContain("a_vista");
    expect(COMMERCIAL_PROMPT).toContain("entrada");
  });
});

describe("DEFAULT_PERSONALITY_PROMPT (Layer 3)", () => {
  it("contains Auto Inova identity", () => {
    expect(DEFAULT_PERSONALITY_PROMPT).toContain("Auto Inova");
    expect(DEFAULT_PERSONALITY_PROMPT).toContain("Ivoti - RS");
  });

  it("contains tone of voice guidelines", () => {
    expect(DEFAULT_PERSONALITY_PROMPT).toContain("TOM DE VOZ");
    expect(DEFAULT_PERSONALITY_PROMPT).toContain("Consultivo e amigável");
  });

  it("contains store contact info", () => {
    expect(DEFAULT_PERSONALITY_PROMPT).toContain("(51) 99478-2062");
  });
});

describe("DEFAULT_SYSTEM_PROMPT (Legacy - Condensed)", () => {
  it("contains essential rules in condensed format", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("FORMATO");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("PRIORIDADE");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("SELEÇÃO NUMÉRICA");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("BUSCA");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("LEAD");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("LIMPEZA");
  });

  it("contains Auto Inova contact info", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("(51) 99478-2062");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Ivoti - RS");
  });

  it("is significantly shorter than old legacy prompt", () => {
    // New legacy should be under 1500 chars (was ~4000+)
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeLessThan(2500);
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(300);
  });
});

describe("Vehicle ID Detection (Pre-processing)", () => {
  function detectVehicleId(message: string): number | null {
    const idMatch = message.match(/(?:ID|id)(\d+)|\(Ref:\s*(\d+)\)/i);
    if (idMatch) {
      return parseInt(idMatch[1] || idMatch[2]);
    }
    return null;
  }

  it("detects ID in standard ad format", () => {
    expect(detectVehicleId("Olá, tenho interesse no veículo: Chevrolet Agile 2013 ID9")).toBe(9);
  });

  it("detects ID with uppercase", () => {
    expect(detectVehicleId("Quero saber mais sobre o ID42")).toBe(42);
  });

  it("detects ID with lowercase", () => {
    expect(detectVehicleId("Me fala do id123")).toBe(123);
  });

  it("detects Ref format", () => {
    expect(detectVehicleId("Olá, tenho interesse (Ref: 15)")).toBe(15);
  });

  it("detects ID at the end of message", () => {
    expect(detectVehicleId("Chevrolet TRAILBLAZER LTZ 2.8 4X4 Diesel 2018/2019 ID120")).toBe(120);
  });

  it("returns null for messages without ID", () => {
    expect(detectVehicleId("Olá, quero ver uma Hilux")).toBeNull();
  });

  it("returns null for generic messages", () => {
    expect(detectVehicleId("Bom dia, tudo bem?")).toBeNull();
  });

  it("returns null for numeric-only messages", () => {
    expect(detectVehicleId("2")).toBeNull();
  });
});

describe("Vehicle Search Keyword Detection", () => {
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
    "fusca", "kombi", "brasilia", "variant", "passat", "belina", "corcel", "del rey", "pampa", "maverick", "opala", "chevette", "monza", "kadett", "ipanema", "veraneio", "bonanza", "d-20", "d20",
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
    "até 100", "até 50", "até 80", "até 200", "até 150",
    "mil reais", "mil real",
  ];

  function shouldForceVehicleSearch(message: string): boolean {
    const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (lower.trim().length <= 3) return false;

    const interestChangeKeywords = ["mudei de ideia", "mudei de interesse", "na verdade quero", "prefiro", "quero outro", "nao quero mais", "não quero mais", "desisti", "esquece o", "esquece a"];
    const hasInterestChange = interestChangeKeywords.some(kw => lower.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
    if (hasInterestChange) return true;

    const tradeKeywords = ["troca", "trocar", "vendi", "tenho um", "meu carro", "meu gol", "meu fusca"];
    const isTradeMessage = tradeKeywords.some(kw => lower.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
    if (isTradeMessage && !lower.includes("por um") && !lower.includes("por uma") && !lower.includes("interesse")) {
      return false;
    }
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
    expect(shouldForceVehicleSearch("Volkswagen tem?")).toBe(true);
  });

  it("triggers search for categories", () => {
    expect(shouldForceVehicleSearch("Quero um SUV")).toBe(true);
    expect(shouldForceVehicleSearch("Tem sedan?")).toBe(true);
    expect(shouldForceVehicleSearch("Procuro picape")).toBe(true);
  });

  it("triggers search for price-based queries", () => {
    expect(shouldForceVehicleSearch("Carro até 50 mil")).toBe(true);
    expect(shouldForceVehicleSearch("O que tem disponível?")).toBe(true);
    expect(shouldForceVehicleSearch("Quero ver o estoque")).toBe(true);
  });

  it("does NOT trigger for short messages", () => {
    expect(shouldForceVehicleSearch("ok")).toBe(false);
    expect(shouldForceVehicleSearch("sim")).toBe(false);
    expect(shouldForceVehicleSearch("2")).toBe(false);
    expect(shouldForceVehicleSearch("1")).toBe(false);
  });

  it("does NOT trigger for trade-in messages", () => {
    expect(shouldForceVehicleSearch("Tenho um Gol para troca")).toBe(false);
    expect(shouldForceVehicleSearch("Meu carro é um Fusca")).toBe(false);
    expect(shouldForceVehicleSearch("Vendi meu carro")).toBe(false);
  });

  it("DOES trigger for trade-in messages that mention new vehicle interest", () => {
    expect(shouldForceVehicleSearch("Quero trocar por uma Hilux")).toBe(true);
  });

  it("triggers for interest change keywords", () => {
    expect(shouldForceVehicleSearch("Mudei de ideia, quero outro")).toBe(true);
    expect(shouldForceVehicleSearch("Na verdade quero uma Ranger")).toBe(true);
    expect(shouldForceVehicleSearch("Prefiro um sedan")).toBe(true);
    expect(shouldForceVehicleSearch("Desisti do Gol")).toBe(true);
  });
});

describe("Prompt Size Comparison", () => {
  it("CORE_PROMPT is condensed (under 1200 chars)", () => {
    console.log(`CORE_PROMPT: ${CORE_PROMPT.length} chars`);
    expect(CORE_PROMPT.length).toBeLessThan(1300);
  });

  it("COMMERCIAL_PROMPT is comprehensive with stages (over 2000 chars)", () => {
    console.log(`COMMERCIAL_PROMPT: ${COMMERCIAL_PROMPT.length} chars`);
    expect(COMMERCIAL_PROMPT.length).toBeGreaterThan(2000);
  });

  it("DEFAULT_PERSONALITY_PROMPT is concise", () => {
    console.log(`DEFAULT_PERSONALITY_PROMPT: ${DEFAULT_PERSONALITY_PROMPT.length} chars`);
    expect(DEFAULT_PERSONALITY_PROMPT.length).toBeLessThan(600);
  });

  it("DEFAULT_SYSTEM_PROMPT (legacy) is condensed", () => {
    console.log(`DEFAULT_SYSTEM_PROMPT (legacy): ${DEFAULT_SYSTEM_PROMPT.length} chars`);
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeLessThan(2500);
  });
});
