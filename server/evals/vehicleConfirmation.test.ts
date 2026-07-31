/**
 * Testes da detecção determinística de confirmação de veículo (PR A7).
 * Reproduzem o bug do "Celta": cliente dizia "sim" e o agente reapresentava o
 * carro em loop. A detecção pura garante o avanço sem depender do LLM.
 */
import { describe, it, expect } from "vitest";
import {
  detectVehicleConfirmation,
  isVehiclePresentationMessage,
  countPresentedVehicles,
  extractPresentedTitle,
} from "../vehicleConfirmation";

const CELTA_MSG = `Encontrei uma opção de Chevrolet Celta para você:

Chevrolet Celta Life/ LS 1.0 MPFI 8V FlexPower 5p
Ano: 2012
Cor: Prata
KM: 179.544 km
Preço: R$ 36.990
Mais detalhes: https://autoinovars.com.br/carros/gm-chevrolet/celta-spirit-lt-1-0-mpfi-8v-flexp-5p/2012/1030854`;

const LISTA_MSG = `Aqui estão algumas opções:

1. Peugeot 206 Techno
Ano: 2006
Preço: R$ 11.990

2. Honda Civic LXS
Ano: 2008
Preço: R$ 23.333`;

const bot = (content: string, id = 10) => ({ id, senderType: "bot", content });
const customer = (content: string, id = 11) => ({ id, senderType: "customer", content });

describe("isVehiclePresentationMessage", () => {
  it("reconhece apresentação por link /carros/ ou linha Ano:", () => {
    expect(isVehiclePresentationMessage(CELTA_MSG)).toBe(true);
    expect(isVehiclePresentationMessage("Olha esse:\nAno: 2015\nPreço: 50.000")).toBe(true);
  });
  it("não confunde texto comum", () => {
    expect(isVehiclePresentationMessage("Temos ótimas opções, me conta seu orçamento")).toBe(false);
    expect(isVehiclePresentationMessage(undefined)).toBe(false);
    expect(isVehiclePresentationMessage(123)).toBe(false);
  });
});

describe("countPresentedVehicles / extractPresentedTitle", () => {
  it("conta veículos por linhas Ano:", () => {
    expect(countPresentedVehicles(CELTA_MSG)).toBe(1);
    expect(countPresentedVehicles(LISTA_MSG)).toBe(2);
  });
  it("extrai o título da linha acima do Ano", () => {
    expect(extractPresentedTitle(CELTA_MSG)).toBe("Chevrolet Celta Life/ LS 1.0 MPFI 8V FlexPower 5p");
  });
});

describe("detectVehicleConfirmation", () => {
  it("detecta 'sim' após apresentação de UM veículo (o bug do Celta)", () => {
    const r = detectVehicleConfirmation("sim", [bot(CELTA_MSG), customer("sim")]);
    expect(r).not.toBeNull();
    expect(r!.vehicleTitle).toContain("Celta");
  });

  it("aceita variações curtas de confirmação", () => {
    for (const m of ["Sim!", "gostei", "quero", "esse", "pode ser", "bora", "fechado", "ok", "beleza", "tenho interesse"]) {
      expect(detectVehicleConfirmation(m, [bot(CELTA_MSG)]), `"${m}" deveria confirmar`).not.toBeNull();
    }
  });

  it("NÃO confirma quando a última apresentação era uma lista (2+ veículos)", () => {
    expect(detectVehicleConfirmation("sim", [bot(LISTA_MSG)])).toBeNull();
  });

  it("NÃO confirma sem apresentação anterior", () => {
    expect(detectVehicleConfirmation("sim", [bot("Claro! Me conta mais o que procura")])).toBeNull();
    expect(detectVehicleConfirmation("sim", [])).toBeNull();
  });

  it("NÃO confirma mensagens longas ou negativas", () => {
    expect(detectVehicleConfirmation("sim, mas antes queria saber sobre financiamento", [bot(CELTA_MSG)])).toBeNull();
    expect(detectVehicleConfirmation("não", [bot(CELTA_MSG)])).toBeNull();
    expect(detectVehicleConfirmation("não gostei", [bot(CELTA_MSG)])).toBeNull();
  });

  it("ignora apresentação se a última mensagem de veículo não é a mais recente... usa a mais recente", () => {
    // Cliente falou de outro assunto DEPOIS da apresentação — a apresentação ainda
    // é a última de veículo, então "sim" confirma (comportamento desejado do fix).
    const msgs = [bot(CELTA_MSG, 10), customer("e o financiamento?", 11), bot("Parcelamos sim! Me diz a entrada.", 12)];
    const r = detectVehicleConfirmation("sim", msgs);
    expect(r).not.toBeNull();
  });
});
