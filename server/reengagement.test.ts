/**
 * Testes da máquina de estados do motor único de reengajamento (PR #6).
 * Cobrem a garantia central: 1 lead nunca recebe 2 reengajamentos concorrentes.
 */
import { describe, it, expect } from "vitest";
import { decideNextAttempt, REENGAGEMENT_DEFAULTS, type ReengagementConfig } from "./reengagement";

const NOW = 1_800_000_000_000; // timestamp fixo
const MIN = 60_000;

const config: ReengagementConfig = {
  ...REENGAGEMENT_DEFAULTS,
  enabled: true,
  steps: [
    { afterMinutes: 30, strategy: "flow", flowId: 99 },
    { afterMinutes: 1440, strategy: "ai_message" },
    { afterMinutes: 2880, strategy: "template", templateName: "tpl" },
  ],
};

const inativoHa = (minutos: number) => NOW - minutos * MIN;

describe("decideNextAttempt", () => {
  it("primeira tentativa dispara no passo 1 (30min de inatividade)", () => {
    const d = decideNextAttempt(config, 0, inativoHa(45), "customer", NOW);
    expect(d).not.toBeNull();
    expect(d!.attemptNumber).toBe(1);
    expect(d!.step.strategy).toBe("flow");
  });

  it("não dispara antes do limiar do passo 1", () => {
    expect(decideNextAttempt(config, 0, inativoHa(20), "customer", NOW)).toBeNull();
  });

  it("segunda tentativa só no limiar do passo 2 (24h)", () => {
    // Já fez 1 tentativa; inatividade de 2h → ainda não chegou no passo 2
    expect(decideNextAttempt(config, 1, inativoHa(120), "customer", NOW)).toBeNull();
    // 25h → passo 2
    const d = decideNextAttempt(config, 1, inativoHa(1500), "customer", NOW);
    expect(d!.attemptNumber).toBe(2);
    expect(d!.step.strategy).toBe("ai_message");
  });

  it("terceira tentativa só no limiar do passo 3 (48h)", () => {
    expect(decideNextAttempt(config, 2, inativoHa(1500), "customer", NOW)).toBeNull();
    const d = decideNextAttempt(config, 2, inativoHa(2900), "customer", NOW);
    expect(d!.attemptNumber).toBe(3);
    expect(d!.step.strategy).toBe("template");
  });

  it("para após maxAttempts", () => {
    expect(decideNextAttempt(config, 3, inativoHa(10000), "customer", NOW)).toBeNull();
  });

  it("ANTI-DUPLO: última mensagem é do bot → nunca dispara", () => {
    // Mesmo com inatividade suficiente para o próximo passo, se a última
    // mensagem é nossa (bot/agente humano), aguarda o cliente responder.
    expect(decideNextAttempt(config, 1, inativoHa(1500), "bot", NOW)).toBeNull();
    expect(decideNextAttempt(config, 0, inativoHa(1500), "bot", NOW)).toBeNull();
    expect(decideNextAttempt(config, 1, inativoHa(2900), "agent", NOW)).toBeNull();
  });

  it("cliente respondeu (última msg = customer) → reengaja de novo no passo certo", () => {
    // Cliente voltou e sumiu de novo: última msg é dele, inatividade alta
    const d = decideNextAttempt(config, 1, inativoHa(1500), "customer", NOW);
    expect(d!.attemptNumber).toBe(2);
  });

  it("respeita steps.length como teto mesmo com maxAttempts maior", () => {
    const cfg = { ...config, maxAttempts: 10 };
    expect(decideNextAttempt(cfg, 3, inativoHa(10000), "customer", NOW)).toBeNull();
  });
});
