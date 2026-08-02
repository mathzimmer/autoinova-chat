import { describe, it, expect } from "vitest";
import { maskCpf, formatCpf } from "@shared/lgpd";

describe("maskCpf", () => {
  it("mascara formatos comuns", () => {
    expect(maskCpf("12345678900")).toBe("***.***.**9-00");
    expect(maskCpf("123.456.789-00")).toBe("***.***.**9-00");
  });
  it("entrada inválida → '***' (nunca vaza parcial)", () => {
    expect(maskCpf("123")).toBe("***");
    expect(maskCpf("")).toBe("***");
    expect(maskCpf(null)).toBe("***");
    expect(maskCpf(undefined)).toBe("***");
  });
});

describe("formatCpf", () => {
  it("formata 11 dígitos", () => {
    expect(formatCpf("12345678900")).toBe("123.456.789-00");
  });
  it("entrada inválida retorna como veio", () => {
    expect(formatCpf("123")).toBe("123");
  });
});
