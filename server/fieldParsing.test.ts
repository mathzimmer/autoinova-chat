import { describe, it, expect } from "vitest";
import { parseTradeYear, parseTradeKm, parseMoneyToCents, funnelToLeadStatus } from "./fieldParsing";

describe("parseTradeYear", () => {
  it("extrai ano de strings comuns", () => {
    expect(parseTradeYear("2012")).toBe(2012);
    expect(parseTradeYear("2012abc")).toBe(2012);
    expect(parseTradeYear("ano 1998")).toBe(1998);
  });
  it("rejeita ano fora da faixa 1950..anoAtual+1", () => {
    expect(parseTradeYear("1800")).toBeNull();
    expect(parseTradeYear("2199")).toBeNull();
  });
  it("lixo/null → null", () => {
    expect(parseTradeYear("abc")).toBeNull();
    expect(parseTradeYear(null)).toBeNull();
    expect(parseTradeYear(undefined)).toBeNull();
    expect(parseTradeYear("")).toBeNull();
  });
});

describe("parseTradeKm", () => {
  it("parseia formatos comuns", () => {
    expect(parseTradeKm("179.544")).toBe(179544);
    expect(parseTradeKm("179544 km")).toBe(179544);
    expect(parseTradeKm("150 mil")).toBe(150000);
    expect(parseTradeKm("150mil km")).toBe(150000);
    expect(parseTradeKm("80 MIL")).toBe(80000);
  });
  it("lixo/null → null", () => {
    expect(parseTradeKm("não sei")).toBeNull();
    expect(parseTradeKm(null)).toBeNull();
    expect(parseTradeKm("")).toBeNull();
  });
});

describe("parseMoneyToCents", () => {
  it("formatos brasileiros comuns", () => {
    expect(parseMoneyToCents("R$ 20.000")).toBe(2000000);
    expect(parseMoneyToCents("20000")).toBe(2000000);
    expect(parseMoneyToCents("R$ 1.500,00")).toBe(150000);
    expect(parseMoneyToCents("1.500,50")).toBe(150050);
    expect(parseMoneyToCents("20 mil")).toBe(2000000);
    expect(parseMoneyToCents("20 mil reais")).toBe(2000000);
    expect(parseMoneyToCents("500")).toBe(50000);
  });
  it("lixo/null → null", () => {
    expect(parseMoneyToCents("não sei")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents("")).toBeNull();
  });
});

describe("funnelToLeadStatus", () => {
  it("mapeia as 9 etapas do funil", () => {
    expect(funnelToLeadStatus("novo")).toBe("new");
    expect(funnelToLeadStatus("interesse_definido")).toBe("qualifying");
    expect(funnelToLeadStatus("pagamento_definido")).toBe("qualifying");
    expect(funnelToLeadStatus("dados_pessoais")).toBe("qualifying");
    expect(funnelToLeadStatus("dados_troca")).toBe("qualifying");
    expect(funnelToLeadStatus("encaminhado_vendedor")).toBe("contacted");
    expect(funnelToLeadStatus("negociando")).toBe("contacted");
    expect(funnelToLeadStatus("fechado")).toBe("converted");
    expect(funnelToLeadStatus("perdido")).toBe("lost");
  });
  it("valor desconhecido → new", () => {
    expect(funnelToLeadStatus("qualquer")).toBe("new");
  });
});
