import { describe, it, expect } from "vitest";
import { defaultStoreConfig, mergeStoreConfig, DEFAULT_STORE_LOCATION } from "./storeConfig";

describe("defaultStoreConfig", () => {
  it("deriva nomes da loja", () => {
    const c = defaultStoreConfig("Auto Inova - Filial POA");
    expect(c.displayName).toBe("Auto Inova - Filial POA");
    expect(c.iaSenderName).toBe("Auto Inova - Filial POA IA");
    expect(c.storeLocation).toBe("Auto Inova - Filial POA");
  });
  it("constante de fallback existe", () => {
    expect(DEFAULT_STORE_LOCATION).toBe("Auto Inova - Matriz");
  });
});

describe("mergeStoreConfig", () => {
  it("sem overrides → defaults", () => {
    expect(mergeStoreConfig("Loja X")).toEqual(defaultStoreConfig("Loja X"));
  });
  it("overrides válidos ganham", () => {
    const c = mergeStoreConfig("Loja X", { displayName: "Loja X Centro", iaSenderName: "Bot X" });
    expect(c.displayName).toBe("Loja X Centro");
    expect(c.iaSenderName).toBe("Bot X");
  });
  it("overrides vazios/inválidos caem no default", () => {
    const c = mergeStoreConfig("Loja X", { displayName: "  ", iaSenderName: "" });
    expect(c.displayName).toBe("Loja X");
    expect(c.iaSenderName).toBe("Loja X IA");
  });
  it("storeLocation do override nunca vence (chave é a loja pedida)", () => {
    const c = mergeStoreConfig("Loja X", { storeLocation: "Outra" } as any);
    expect(c.storeLocation).toBe("Loja X");
  });
});
