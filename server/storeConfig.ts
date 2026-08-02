/**
 * StoreConfig — configuração por loja (PR #9).
 *
 * Hoje a loja é quase sempre implícita ("Auto Inova - Matriz" hardcoded em
 * vários jobs). Este módulo centraliza: dado um storeLocation, devolve nome de
 * exibição e remetente da IA. Config editável via setting `store_config:<loja>`
 * (JSON parcial — merge com defaults), sem deploy.
 *
 * A parte PURA (defaults + merge) não importa db — sem ciclo de import.
 */

export const DEFAULT_STORE_LOCATION = "Auto Inova - Matriz";

export interface StoreConfig {
  storeLocation: string;
  /** Nome de exibição da loja (prompts, mensagens) */
  displayName: string;
  /** Remetente das mensagens da IA dessa loja */
  iaSenderName: string;
}

/** Defaults derivados só do nome da loja. */
export function defaultStoreConfig(storeLocation: string): StoreConfig {
  return {
    storeLocation,
    displayName: storeLocation,
    iaSenderName: `${storeLocation} IA`,
  };
}

/** Merge puro: overrides válidos ganham dos defaults. */
export function mergeStoreConfig(
  storeLocation: string,
  overrides?: Partial<StoreConfig> | null,
): StoreConfig {
  const base = defaultStoreConfig(storeLocation);
  if (!overrides) return base;
  return {
    storeLocation,
    displayName: typeof overrides.displayName === "string" && overrides.displayName.trim()
      ? overrides.displayName.trim()
      : base.displayName,
    iaSenderName: typeof overrides.iaSenderName === "string" && overrides.iaSenderName.trim()
      ? overrides.iaSenderName.trim()
      : base.iaSenderName,
  };
}

/**
 * Config efetiva da loja. Sem storeLocation, usa a primeira loja distinta
 * cadastrada (fallback DEFAULT_STORE_LOCATION). Lê `store_config:<loja>` das
 * settings; qualquer falha → defaults (nunca quebra o job chamador).
 */
export async function getStoreConfig(storeLocation?: string): Promise<StoreConfig> {
  let loc = storeLocation?.trim() || "";
  try {
    const { getDistinctStoreLocations, getSetting } = await import("./db");
    if (!loc) {
      const stores = await getDistinctStoreLocations().catch(() => [] as string[]);
      loc = stores[0] || DEFAULT_STORE_LOCATION;
    }
    const raw = await getSetting(`store_config:${loc}`).catch(() => null);
    if (raw) {
      try {
        return mergeStoreConfig(loc, JSON.parse(raw));
      } catch { /* JSON inválido → defaults */ }
    }
  } catch { /* sem db → defaults */ }
  return mergeStoreConfig(loc || DEFAULT_STORE_LOCATION);
}
