/**
 * Testes dos helpers puros de customers (PR #7) — a lógica que protege o
 * backfill: CPF/data limpos, "nunca sobrescreve dado bom" e agrupamento por
 * telefone canônico (deduplicação de pessoas).
 */
import { describe, it, expect } from "vitest";
import { cleanCpf, cleanBirthDate, pickBetter, groupLeadsByCanonicalPhone } from "./customers";

describe("cleanCpf", () => {
  it("aceita 11 dígitos com ou sem máscara", () => {
    expect(cleanCpf("123.456.789-09")).toBe("12345678909");
    expect(cleanCpf("12345678909")).toBe("12345678909");
  });
  it("rejeita tamanho errado e não-string", () => {
    expect(cleanCpf("123.456.789-0")).toBeNull();   // 10 dígitos
    expect(cleanCpf("abc")).toBeNull();
    expect(cleanCpf(null)).toBeNull();
    expect(cleanCpf(undefined)).toBeNull();
  });
});

describe("cleanBirthDate", () => {
  it("aceita ISO e DD/MM/YYYY", () => {
    expect(cleanBirthDate("1990-05-12")).toBe("1990-05-12");
    expect(cleanBirthDate("12/05/1990")).toBe("1990-05-12");
  });
  it("rejeita formatos desconhecidos", () => {
    expect(cleanBirthDate("05-12-1990")).toBeNull();
    expect(cleanBirthDate("")).toBeNull();
    expect(cleanBirthDate(null)).toBeNull();
  });
});

describe("pickBetter — nunca sobrescreve dado bom", () => {
  it("mantém o atual quando preenchido", () => {
    expect(pickBetter("Matheus", "Matheus Zimmer")).toBe("Matheus");
  });
  it("preenche quando o atual está vazio", () => {
    expect(pickBetter(null, "Matheus")).toBe("Matheus");
    expect(pickBetter("", "Matheus")).toBe("Matheus");
    expect(pickBetter("  ", "Matheus")).toBe("Matheus");
  });
  it("null quando ambos vazios", () => {
    expect(pickBetter(null, null)).toBeNull();
    expect(pickBetter("", "  ")).toBeNull();
  });
});

describe("groupLeadsByCanonicalPhone — deduplicação de pessoas", () => {
  it("mesma pessoa com formatos diferentes vira UM grupo", () => {
    const groups = groupLeadsByCanonicalPhone([
      { id: 1, phone: "+55 (51) 99228-1203", conversationId: 100 },
      { id: 2, phone: "555192281203", conversationId: 101 },
      { id: 3, phone: "5192281203", conversationId: 102 }, // sem 55 e sem 9º dígito
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].leadIds).toHaveLength(3);
    expect(groups[0].conversationIds).toHaveLength(3);
    expect(groups[0].phoneVariants).toHaveLength(3);
  });

  it("pessoas diferentes ficam em grupos diferentes", () => {
    const groups = groupLeadsByCanonicalPhone([
      { id: 1, phone: "5551992281203", conversationId: 100 },
      { id: 2, phone: "5551988776655", conversationId: 101 },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("ignora telefone vazio", () => {
    const groups = groupLeadsByCanonicalPhone([
      { id: 1, phone: "", conversationId: 100 },
      { id: 2, phone: "5551992281203", conversationId: 101 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].leadIds).toEqual([2]);
  });

  it("grupo sem duplicado tem 1 lead e 1 variante (dry-run não reporta)", () => {
    const groups = groupLeadsByCanonicalPhone([
      { id: 1, phone: "5551992281203", conversationId: 100 },
    ]);
    const dups = groups.filter(g => g.leadIds.length > 1 || g.phoneVariants.length > 1);
    expect(dups).toHaveLength(0);
  });
});
