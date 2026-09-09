import { describe, it, expect } from "vitest";
import { canonicalizeFeatures, tagsFromRequest, labelsForTags } from "./vehicleFeatures";

describe("vehicleFeatures — taxonomia de opcionais", () => {
  it("canoniza opcionais crus com grafia variável", () => {
    expect(canonicalizeFeatures(["Teto Solar"])).toContain("teto_solar");
    expect(canonicalizeFeatures(["Bancos em Couro"])).toContain("bancos_couro");
    expect(canonicalizeFeatures(["Câmera de ré"])).toContain("camera_re");
    expect(canonicalizeFeatures(["Tração 4x4"])).toContain("tracao_4x4");
    expect(canonicalizeFeatures(["7 lugares"])).toContain("sete_lugares");
  });

  it("ar-condicionado digital implica ar_condicionado", () => {
    const tags = canonicalizeFeatures(["Ar-condicionado digital"]);
    expect(tags).toContain("ar_digital");
    expect(tags).toContain("ar_condicionado");
  });

  it("extrai tags também da descrição/título", () => {
    const tags = canonicalizeFeatures([], "Lindo SUV com teto panorâmico, CarPlay e Android Auto");
    expect(tags).toEqual(expect.arrayContaining(["teto_panoramico", "carplay", "android_auto"]));
  });

  it("traduz pedido em texto livre para tags", () => {
    const tags = tagsFromRequest("quero um com teto solar e couro");
    expect(tags).toEqual(expect.arrayContaining(["teto_solar", "bancos_couro"]));
  });

  it("pedido sem opcional reconhecido volta vazio", () => {
    expect(tagsFromRequest("carro bom e bonito")).toEqual([]);
  });

  it("gera rótulos amigáveis a partir das tags", () => {
    expect(labelsForTags(["teto_solar", "camera_re"])).toEqual(["Teto solar", "Câmera de ré"]);
  });

  it("não inventa tag quando não há sinal", () => {
    expect(canonicalizeFeatures(["Direção hidráulica"])).not.toContain("teto_solar");
  });
});
