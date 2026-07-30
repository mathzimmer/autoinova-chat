import { describe, it, expect } from "vitest";
import { contemMarkdown, ofereceDesconto, contarPerguntas, verificarResposta, verificarTools } from "./assertions";
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

describe("fixtures", () => {
  it("tem 12+ cenários com ids únicos", () => {
    expect(EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(12);
    const ids = EVAL_SCENARIOS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("todo cenário tem ao menos uma mensagem do cliente", () => {
    for (const s of EVAL_SCENARIOS) expect(s.mensagensCliente.length).toBeGreaterThan(0);
  });
});
