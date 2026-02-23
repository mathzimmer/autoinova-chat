import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT } from "./ai";

describe("AI System Prompt", () => {
  it("contains format rules - no markdown", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("PROIBIDO usar asteriscos");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("PROIBIDO usar formatação markdown");
  });

  it("contains rules about prioritizing recent messages over lead data", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("PRIORIDADE DA CONVERSA RECENTE");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("MENSAGEM ATUAL");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("mensagem atual SEMPRE vence");
  });

  it("contains rules about numeric selections", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("RESPOSTAS NUMÉRICAS");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("ESCOLHENDO aquela opção da lista");
  });

  it("contains vehicle search rules with CRITICAL copy rule", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("buscar_veiculos");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NUNCA modifique, resuma ou invente veículos");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Copie EXATAMENTE");
  });

  it("contains rules about single result behavior", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("1 resultado: apresente direto");
  });

  it("contains lead update rules with notes/summary and interest change flow", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("MUDAR de veículo de interesse");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("MUDAR dados da troca");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("notas");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("veiculo_id: null");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("FLUXO DE MUDANÇA DE INTERESSE");
  });

  it("contains image handling rules", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NUNCA diga");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("não consigo visualizar");
  });

  it("contains audio handling rules", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("transcritos automaticamente");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NUNCA mencione que é áudio");
  });

  it("contains Auto Inova contact info", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("(51) 99478-2062");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Ivoti - RS");
  });

  it("does NOT instruct to search on generic messages", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NÃO chame buscar_veiculos para");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("ok");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("tenho troca");
  });
});

describe("Vehicle Search Keyword Detection", () => {
  // Replicate the detection logic from ai.ts for testing
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
    "até 100", "até 50", "até 80", "até 200", "até 150",
    "mil reais", "mil real",
  ];

  function shouldForceVehicleSearch(message: string): boolean {
    const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (lower.trim().length <= 3) return false;

    // Detect explicit vehicle interest change
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
    expect(shouldForceVehicleSearch("Procuro uma picape")).toBe(true);
  });

  it("triggers search for general availability queries", () => {
    expect(shouldForceVehicleSearch("O que vocês têm disponível?")).toBe(true);
    expect(shouldForceVehicleSearch("Quero ver o estoque")).toBe(true);
    expect(shouldForceVehicleSearch("Me mostra as opções")).toBe(true);
  });

  it("triggers search for price range queries", () => {
    expect(shouldForceVehicleSearch("Me diz uma coisa que tu tem de carro aí até 100 mil reais")).toBe(true);
    expect(shouldForceVehicleSearch("Quero ver carro até 50 mil")).toBe(true);
    expect(shouldForceVehicleSearch("Veículo até 80 mil")).toBe(true);
  });

  it("triggers search for interest change keywords", () => {
    expect(shouldForceVehicleSearch("Mudei de ideia, quero outra coisa")).toBe(true);
    expect(shouldForceVehicleSearch("Na verdade quero um carro menor")).toBe(true);
    expect(shouldForceVehicleSearch("Prefiro ver outras opções")).toBe(true);
    expect(shouldForceVehicleSearch("Não quero mais a Sprinter")).toBe(true);
    expect(shouldForceVehicleSearch("Desisti daquele carro")).toBe(true);
    expect(shouldForceVehicleSearch("Esquece o Vectra")).toBe(true);
  });

  it("does NOT trigger search for short messages (numeric selections)", () => {
    expect(shouldForceVehicleSearch("2")).toBe(false);
    expect(shouldForceVehicleSearch("1")).toBe(false);
    expect(shouldForceVehicleSearch("Ok")).toBe(false);
    expect(shouldForceVehicleSearch("Sim")).toBe(false);
  });

  it("does NOT trigger search for generic messages", () => {
    expect(shouldForceVehicleSearch("Obrigado pela informação")).toBe(false);
    expect(shouldForceVehicleSearch("Bom dia, tudo bem?")).toBe(false);
    expect(shouldForceVehicleSearch("Pode ser")).toBe(false);
    expect(shouldForceVehicleSearch("Quero financiar")).toBe(false);
  });

  it("does NOT trigger search for trade-in messages", () => {
    expect(shouldForceVehicleSearch("Tenho um carro pra troca")).toBe(false);
    expect(shouldForceVehicleSearch("Aceita troca?")).toBe(false);
    expect(shouldForceVehicleSearch("Vendi meu Fusca, agora tenho um Gol")).toBe(false);
    expect(shouldForceVehicleSearch("Meu Gol tem 150 mil km")).toBe(false);
  });

  it("DOES trigger search for trade-in messages that mention a target vehicle", () => {
    expect(shouldForceVehicleSearch("Quero trocar por uma Hilux")).toBe(true);
    expect(shouldForceVehicleSearch("Tenho interesse na Sprinter")).toBe(true);
  });

  it("handles accented characters correctly", () => {
    expect(shouldForceVehicleSearch("Tem veículo disponível?")).toBe(true);
    expect(shouldForceVehicleSearch("Quero ver as opções")).toBe(true);
  });
});

describe("Markdown Stripping", () => {
  function stripMarkdown(text: string): string {
    return text
      .replace(/```json[\s\S]*?```/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\{[\s\S]*?"lead_data"[\s\S]*?\}/g, "")
      .replace(/\*\*\*(.*?)\*\*\*/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[\s]*[-•\*]\s+/gm, "")
      .replace(/^[\s]*\d+\.\s{2,}/gm, (match) => match.replace(/\s{2,}$/, " "))
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  it("removes bold formatting", () => {
    expect(stripMarkdown("**Toyota Hilux** 2012")).toBe("Toyota Hilux 2012");
  });

  it("removes italic formatting", () => {
    expect(stripMarkdown("*Preço especial*")).toBe("Preço especial");
  });

  it("removes bold+italic formatting", () => {
    expect(stripMarkdown("***Destaque***")).toBe("Destaque");
  });

  it("removes underscore formatting", () => {
    expect(stripMarkdown("__negrito__ e _itálico_")).toBe("negrito e itálico");
  });

  it("removes bullet points", () => {
    expect(stripMarkdown("- Item 1\n- Item 2\n* Item 3")).toBe("Item 1\nItem 2\nItem 3");
  });

  it("removes headers", () => {
    expect(stripMarkdown("# Título\n## Subtítulo")).toBe("Título\nSubtítulo");
  });

  it("converts markdown links to plain text", () => {
    expect(stripMarkdown("[Veja aqui](https://example.com)")).toBe("Veja aqui https://example.com");
  });

  it("removes code blocks", () => {
    expect(stripMarkdown("Texto\n```json\n{}\n```\nMais texto")).toBe("Texto\n\nMais texto");
  });

  it("limits consecutive newlines", () => {
    expect(stripMarkdown("A\n\n\n\nB")).toBe("A\n\nB");
  });
});
