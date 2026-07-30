import { describe, it, expect } from "vitest";
import { validateLeadArgs, isValidCPF, formatValidationErrors } from "./leadValidation";

describe("isValidCPF", () => {
  it("aceita CPF válido", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true); // CPF de teste clássico válido
    expect(isValidCPF("52998224725")).toBe(true);
  });
  it("rejeita dígitos verificadores errados", () => {
    expect(isValidCPF("529.982.247-24")).toBe(false);
    expect(isValidCPF("12345678900")).toBe(false);
  });
  it("rejeita todos os dígitos iguais e tamanho errado", () => {
    expect(isValidCPF("111.111.111-11")).toBe(false);
    expect(isValidCPF("123")).toBe(false);
  });
});

describe("validateLeadArgs", () => {
  it("passa CPF válido para cleaned (só dígitos) e não gera erro", () => {
    const { cleaned, errors } = validateLeadArgs({ cpf: "529.982.247-25" });
    expect(cleaned.cpf).toBe("52998224725");
    expect(errors).toHaveLength(0);
  });

  it("rejeita CPF inválido: não grava e reporta erro", () => {
    const { cleaned, errors } = validateLeadArgs({ cpf: "111.111.111-11" });
    expect(cleaned.cpf).toBeUndefined();
    expect(errors.map(e => e.field)).toContain("cpf");
  });

  it("normaliza e valida e-mail (trim + lowercase)", () => {
    const { cleaned, errors } = validateLeadArgs({ email: "  Fulano@Email.COM " });
    expect(cleaned.email).toBe("fulano@email.com");
    expect(errors).toHaveLength(0);
  });

  it("rejeita e-mail com formato inválido", () => {
    const { cleaned, errors } = validateLeadArgs({ email: "não-é-email" });
    expect(cleaned.email).toBeUndefined();
    expect(errors.map(e => e.field)).toContain("email");
  });

  it("coage km_troca/ano_troca numéricos para string limpa", () => {
    const { cleaned, errors } = validateLeadArgs({ km_troca: "85000", ano_troca: 2015 });
    expect(cleaned.km_troca).toBe("85000");
    expect(cleaned.ano_troca).toBe("2015");
    expect(errors).toHaveLength(0);
  });

  it("rejeita ano_troca fora da faixa e km não-numérico", () => {
    const { cleaned, errors } = validateLeadArgs({ ano_troca: 1800, km_troca: "muitos" });
    expect(cleaned.ano_troca).toBeUndefined();
    expect(cleaned.km_troca).toBeUndefined();
    expect(errors.map(e => e.field).sort()).toEqual(["ano_troca", "km_troca"]);
  });

  it("aceita etapa_funil do domínio e rejeita fora do domínio", () => {
    expect(validateLeadArgs({ etapa_funil: "interesse_definido" }).cleaned.etapa_funil).toBe("interesse_definido");
    const bad = validateLeadArgs({ etapa_funil: "super_quente" });
    expect(bad.cleaned.etapa_funil).toBeUndefined();
    expect(bad.errors.map(e => e.field)).toContain("etapa_funil");
  });

  it("rejeita intencao e forma_pagamento fora do domínio", () => {
    const { cleaned, errors } = validateLeadArgs({ intencao: "xpto", forma_pagamento: "bitcoin" });
    expect(cleaned.intencao).toBeUndefined();
    expect(cleaned.forma_pagamento).toBeUndefined();
    expect(errors.map(e => e.field).sort()).toEqual(["forma_pagamento", "intencao"]);
  });

  it("aceita veiculo_id null (limpar) e inteiro positivo; rejeita lixo", () => {
    expect(validateLeadArgs({ veiculo_id: null }).cleaned.veiculo_id).toBeNull();
    expect(validateLeadArgs({ veiculo_id: "42" }).cleaned.veiculo_id).toBe(42);
    const bad = validateLeadArgs({ veiculo_id: "abc" });
    expect(bad.cleaned.veiculo_id).toBeUndefined();
    expect(bad.errors.map(e => e.field)).toContain("veiculo_id");
  });

  it("faz trim de campos livres e mantém boolean tem_troca", () => {
    const { cleaned } = validateLeadArgs({ veiculo_interesse: "  Corolla 2019 ", notas: " ok ", tem_troca: true });
    expect(cleaned.veiculo_interesse).toBe("Corolla 2019");
    expect(cleaned.notas).toBe("ok");
    expect(cleaned.tem_troca).toBe(true);
  });

  it("ignora campos ausentes/vazios sem gerar erro", () => {
    const { cleaned, errors } = validateLeadArgs({ nome: "", cidade: undefined });
    expect(Object.keys(cleaned)).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("formatValidationErrors gera mensagem para o modelo", () => {
    const msg = formatValidationErrors([{ field: "cpf", message: "dígitos verificadores não conferem" }]);
    expect(msg).toContain("cpf");
    expect(msg).toContain("Peça novamente");
    expect(formatValidationErrors([])).toBe("");
  });
});
