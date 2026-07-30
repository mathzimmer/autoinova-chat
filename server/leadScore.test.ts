import { describe, it, expect } from "vitest";
import { scoreLead, temperatureFromScore, hottestTemperature, combineTemperature } from "./leadScore";

describe("scoreLead", () => {
  it("lead vazio = 0", () => {
    expect(scoreLead({})).toBe(0);
  });
  it("soma pesos por completude", () => {
    expect(scoreLead({ vehicleInterest: "Corolla" })).toBe(25);
    expect(scoreLead({ vehicleInterest: "Corolla", paymentMethod: "financiamento" })).toBe(45);
    expect(scoreLead({ vehicleInterest: "Corolla", paymentMethod: "financiamento", hasTrade: true })).toBe(60);
  });
  it("ignora 'não definido' e vazios", () => {
    expect(scoreLead({ vehicleInterest: "não definido", city: "  " })).toBe(0);
  });
  it("troca conta por hasTrade OU tradeVehicle", () => {
    expect(scoreLead({ tradeVehicle: "Gol 2012" })).toBe(15);
    expect(scoreLead({ hasTrade: true })).toBe(15);
    expect(scoreLead({ hasTrade: false })).toBe(0);
  });
  it("lead completo = 100 e satura", () => {
    expect(scoreLead({
      vehicleInterest: "Hilux", paymentMethod: "a_vista", hasTrade: true, tradeVehicle: "Gol",
      name: "João", fullName: "João Silva", city: "Ivoti", cpf: "52998224725",
      email: "j@x.com", downPayment: "20000",
    })).toBe(100);
  });
});

describe("temperatureFromScore", () => {
  it("faixas corretas", () => {
    expect(temperatureFromScore(0)).toBe("frio");
    expect(temperatureFromScore(25)).toBe("morno");
    expect(temperatureFromScore(50)).toBe("quente");
    expect(temperatureFromScore(75)).toBe("muito_quente");
    expect(temperatureFromScore(100)).toBe("muito_quente");
  });
});

describe("hottestTemperature / combineTemperature", () => {
  it("retorna a mais quente", () => {
    expect(hottestTemperature("frio", "quente", "morno")).toBe("quente");
    expect(hottestTemperature("frio")).toBe("frio");
  });
  it("combina score + piso do funil", () => {
    // score morno mas funil já negociando (muito_quente) → muito_quente
    expect(combineTemperature("morno", "muito_quente", false)).toBe("muito_quente");
    // score quente, funil frio, sem urgência → quente
    expect(combineTemperature("quente", "frio", false)).toBe("quente");
  });
  it("IA empurra para muito_quente quando urgente", () => {
    expect(combineTemperature("morno", "frio", true)).toBe("muito_quente");
    expect(combineTemperature("morno", "frio", false)).toBe("morno");
  });
});
