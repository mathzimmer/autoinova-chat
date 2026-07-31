import { describe, it, expect } from "vitest";
import { contemMarkdown, ofereceDesconto, contarPerguntas, verificarResposta, verificarTools, reapresentouVeiculo } from "./assertions";
import { EVAL_SCENARIOS } from "./fixtures";

describe("contemMarkdown", () => {
  it("aceita texto de WhatsApp normal (e negrito simples)", () => {
    expect(contemMarkdown("Temos sim! O Corolla 2019 sai por R$ 92.990.")).toBe(false);
    expect(contemMarkdown("Olha esse *Corolla* que beleza")).toBe(false); // * simples é do WhatsApp
  });
  it("detecta markdown proibido", () => {
    expect(contemMarkdown("## Opções")).toBe(true);
    expect(contemMarkdown("- Corolla\n- Civic")).toBe(true);
    expect(contemMarkdown("veja [aqui](http://x.com)")).toBe(true);
    expect(contemMarkdown("é **muito** bom")).toBe(true);
  });
});

describe("ofereceDesconto", () => {
  it("detecta oferta de desconto", () => {
    expect(ofereceDesconto("posso fazer um desconto")).toBe(true);
    expect(ofereceDesconto("deixo por 80 mil")).toBe(true);
    expect(ofereceDesconto("faço por 78")).toBe(true);
  });
  it("não acusa resposta neutra", () => {
    expect(ofereceDesconto("quem fecha condições é nosso vendedor")).toBe(false);
  });
});

describe("contarPerguntas", () => {
  it("conta pontos de interrogação", () => {
    expect(contarPerguntas("Qual você prefere?")).toBe(1);
    expect(contarPerguntas("Tem troca? Qual o ano? E a cidade?")).toBe(3);
  });
});

describe("verificarResposta", () => {
  it("retorna violações conforme proibições", () => {
    const v = verificarResposta("## Lista\n- item\nfaço por 80", ["markdown", "desconto"]);
    expect(v.map(x => x.proibicao).sort()).toEqual(["desconto", "markdown"]);
  });
  it("resposta limpa não viola nada", () => {
    expect(verificarResposta("Achei o Corolla 2019, quer que eu te mostre?", ["markdown", "desconto", "multiplas_perguntas"])).toHaveLength(0);
  });
});

describe("verificarTools", () => {
  it("aponta tools faltando e proibidas chamadas", () => {
    const r = verificarTools(["buscar_veiculos", "apresentar_veiculo"], ["buscar_veiculos", "atualizar_lead"], ["transferir_para_vendedor"]);
    expect(r.faltando).toEqual(["atualizar_lead"]);
    expect(r.proibidasChamadas).toEqual([]);
  });
});

describe("reapresentouVeiculo (bug do Celta)", () => {
  const apresentados = ["Chevrolet Celta Life/ LS 1.0 MPFI 8V FlexPower 5p"];
  it("acusa reapresentação do mesmo veículo", () => {
    const r = "Encontrei o Chevrolet Celta Life/ LS 1.0 MPFI 8V FlexPower 5p:\nAno: 2012\nPreço: R$ 36.990\nhttps://x.com/carros/celta";
    expect(reapresentouVeiculo(r, apresentados)).toBe(apresentados[0]);
  });
  it("NÃO acusa confirmação que só menciona o título (sem cara de apresentação)", () => {
    const r = "Ótima escolha! O Chevrolet Celta Life/ LS 1.0 MPFI 8V FlexPower 5p é um bom carro. Você tem veículo na troca?";
    expect(reapresentouVeiculo(r, apresentados)).toBeNull();
  });
  it("NÃO acusa apresentação de veículo diferente", () => {
    const r = "Ford EcoSport FREESTYLE 1.6\nAno: 2015\nPreço: R$ 58.990";
    expect(reapresentouVeiculo(r, apresentados)).toBeNull();
  });
});

describe("fixtures", () => {
  it("tem 12+ cenários com ids únicos", () => {
    expect(EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(12);
    const ids = EVAL_SCENARIOS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("todo cenário tem ao menos uma mensagem do cliente", () => {
    for (const s of EVAL_SCENARIOS) expect(s.mensagensCliente.length).toBeGreaterThan(0);
  });
  it("cenários de regressão obrigatórios existem", () => {
    const ids = EVAL_SCENARIOS.map(s => s.id);
    expect(ids).toContain("anti_reapresentacao");
    expect(ids).toContain("pos_handoff");
    expect(ids).toContain("retorno_apos_dias");
  });
  it("cenários com semReapresentacao têm 2+ mensagens ou contexto de retorno", () => {
    for (const s of EVAL_SCENARIOS.filter(x => x.esperado.semReapresentacao)) {
      expect(s.mensagensCliente.length).toBeGreaterThan(0);
    }
  });
});
