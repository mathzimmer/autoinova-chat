import { describe, it, expect } from "vitest";
import { parseShownFromSearchText, resolveConfirmedVehicleId } from "./ai";

describe("parseShownFromSearchText", () => {
  it("extrai id+título das linhas [ID:X] do resultado da busca", () => {
    const txt = [
      "RESULTADOS DA BUSCA (2 veículos):",
      "1) [ID:457] Toyota Corolla XEI 2.0 | Ano: 2020 | R$ 118.900",
      "2) [ID:462] Hyundai HB20 Comfort | Ano: 2019 | R$ 72.000",
    ].join("\n");
    const out = parseShownFromSearchText(txt);
    expect(out).toEqual([
      { id: 457, title: "Toyota Corolla XEI 2.0" },
      { id: 462, title: "Hyundai HB20 Comfort" },
    ]);
  });

  it("ignora linhas sem [ID:X]", () => {
    expect(parseShownFromSearchText("nenhum id aqui\n2) sem colchete")).toEqual([]);
  });
});

describe("resolveConfirmedVehicleId (não chutar id)", () => {
  const shown = [
    { id: 457, title: "Toyota Corolla XEI" },
    { id: 462, title: "Hyundai HB20 Comfort" },
  ];

  it("usa o último apresentado quando existe", () => {
    expect(resolveConfirmedVehicleId(shown, 462, "qualquer")).toBe(462);
  });

  it("usa o único da lista quando só há um", () => {
    expect(resolveConfirmedVehicleId([{ id: 999, title: "Fiat Toro" }], undefined, undefined)).toBe(999);
  });

  it("casa por título quando não há último nem lista única", () => {
    expect(resolveConfirmedVehicleId(shown, undefined, "Toyota Corolla XEI")).toBe(457);
  });

  it("retorna null quando não dá pra determinar (não chuta)", () => {
    expect(resolveConfirmedVehicleId(shown, undefined, "Nenhum modelo")).toBeNull();
    expect(resolveConfirmedVehicleId([], undefined, undefined)).toBeNull();
  });
});
