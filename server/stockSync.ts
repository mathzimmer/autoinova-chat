/**
 * Stock Synchronization Module
 * 
 * Fetches vehicle inventory from external S3 JSON feed and syncs with the database.
 * URL: https://autoconf-prod.s3.sa-east-1.amazonaws.com/carros-na-serra/642av2OVG5XVCHO5GK8IvGGM5Pqo1JwOYe8swwXv.json
 */
import axios from "axios";
import { eq, notInArray } from "drizzle-orm";
import { vehicles, InsertVehicle } from "../drizzle/schema";
import { getDb, getSetting } from "./db";

const STOCK_URL = "https://autoconf-prod.s3.sa-east-1.amazonaws.com/carros-na-serra/642av2OVG5XVCHO5GK8IvGGM5Pqo1JwOYe8swwXv.json";

interface ExternalVehicle {
  ID: number;
  URL: string;
  TITLE: string;
  MAKE: string;
  MODEL: string;
  VERSION: string;
  AD_VERSION: string;
  YEAR: string;
  FABRIC_YEAR: string;
  CONDITION: string;
  MILEAGE: number;
  FUEL: string;
  gear: string;
  BODY: string;
  COLOR: string;
  PRICE: string;
  PRICES: { REGULAR_PRICE?: string; PROMOTION_PRICE?: string };
  DOORS: number;
  DESCRIPTION: string;
  SELLER: string;
  NEGOTIATION: string;
  PHONE: string;
  LOCATION_CITY: string;
  PLATE: string;
  IMAGES: Array<{ IMAGE_URL: string }>;
  FEATURES: Array<{ FEATURE: string }>;
  VIDEO: string | null;
  HP: string | null;
  MOTOR: string | null;
  CATEGORY: string;
  [key: string]: unknown;
}

interface SyncResult {
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  errors: number;
  duration: number;
}

/**
 * Fetch the external stock JSON from S3
 */
async function fetchExternalStock(): Promise<ExternalVehicle[]> {
  const response = await axios.get(STOCK_URL, { timeout: 30000 });
  const data = response.data;

  if (data?.ADS?.AD && Array.isArray(data.ADS.AD)) {
    return data.ADS.AD;
  }

  throw new Error("Invalid stock JSON structure: expected ADS.AD array");
}

/**
 * Map external vehicle data to our database schema
 */
function mapExternalToDb(ext: ExternalVehicle): Omit<InsertVehicle, "id" | "createdAt" | "updatedAt"> {
  const rawPrice = Math.round(parseFloat(ext.PRICE || "0"));
  const regularPrice = ext.PRICES?.REGULAR_PRICE ? Math.round(parseFloat(ext.PRICES.REGULAR_PRICE)) : null;
  const promotionPrice = ext.PRICES?.PROMOTION_PRICE ? Math.round(parseFloat(ext.PRICES.PROMOTION_PRICE)) : null;
  // Use REGULAR_PRICE as the main price when available, fallback to raw PRICE
  const price = regularPrice || rawPrice;

  // Map gear values
  let transmission = ext.gear || "manual";
  if (transmission === "automatico" || transmission === "automático") {
    transmission = "automatic";
  }

  // Get first image as main image
  const firstImage = ext.IMAGES?.[0]?.IMAGE_URL || null;

  // Map features to simple string array
  const features = ext.FEATURES?.map(f => f.FEATURE) || [];

  // Map images to URL array
  const images = ext.IMAGES?.map(img => img.IMAGE_URL) || [];

  return {
    externalId: ext.ID,
    brand: ext.MAKE || "Desconhecida",
    model: ext.MODEL || "Desconhecido",
    version: ext.VERSION || null,
    title: ext.TITLE || null,
    year: parseInt(ext.YEAR) || new Date().getFullYear(),
    fabricYear: ext.FABRIC_YEAR ? parseInt(ext.FABRIC_YEAR) : null,
    price,
    regularPrice,
    promotionPrice,
    mileage: ext.MILEAGE || null,
    color: ext.COLOR || null,
    transmission,
    fuel: ext.FUEL || null,
    category: ext.CATEGORY || null,
    vehicleType: ext.BODY || null,
    condition: ext.CONDITION || null,
    doors: ext.DOORS || null,
    description: ext.DESCRIPTION || null,
    url: ext.URL || null,
    imageUrl: firstImage,
    images: images as any,
    features: features as any,
    negotiation: ext.NEGOTIATION || null,
    plate: ext.PLATE || null,
    seller: ext.SELLER || null,
    locationCity: ext.LOCATION_CITY || null,
    phone: ext.PHONE || null,
    available: true,
    lastSyncedAt: new Date(),
  };
}

/**
 * Sync external stock with the database.
 * - Creates new vehicles
 * - Updates existing vehicles
 * - Marks removed vehicles as unavailable
 */
async function syncStock(): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = { total: 0, created: 0, updated: 0, deactivated: 0, errors: 0, duration: 0 };

  try {
    console.log("[StockSync] Starting stock synchronization...");
    
    const externalVehicles = await fetchExternalStock();
    result.total = externalVehicles.length;
    console.log(`[StockSync] Fetched ${externalVehicles.length} vehicles from external source`);

    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const externalIds: number[] = [];

    for (const ext of externalVehicles) {
      try {
        const mapped = mapExternalToDb(ext);
        externalIds.push(ext.ID);

        // Check if vehicle already exists
        const existing = await db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(eq(vehicles.externalId, ext.ID))
          .limit(1);

        if (existing.length > 0) {
          // Update existing vehicle
          await db
            .update(vehicles)
            .set(mapped)
            .where(eq(vehicles.externalId, ext.ID));
          result.updated++;
        } else {
          // Insert new vehicle
          await db.insert(vehicles).values(mapped as any);
          result.created++;
        }
      } catch (err: any) {
        console.error(`[StockSync] Error processing vehicle ${ext.ID}:`, err.message);
        result.errors++;
      }
    }

    // Mark vehicles not in external feed as unavailable
    if (externalIds.length > 0) {
      const deactivated = await db
        .update(vehicles)
        .set({ available: false })
        .where(notInArray(vehicles.externalId!, externalIds));
      result.deactivated = (deactivated as any)?.[0]?.affectedRows || 0;
    }

    result.duration = Date.now() - startTime;
    console.log(`[StockSync] Sync complete: ${result.created} created, ${result.updated} updated, ${result.deactivated} deactivated, ${result.errors} errors (${result.duration}ms)`);

    return result;
  } catch (error: any) {
    result.duration = Date.now() - startTime;
    console.error("[StockSync] Sync failed:", error.message);
    throw error;
  }
}

/**
 * Get a summary of the current stock for the AI agent
 */
// ═══════════════════════════════════════════════════════════════
// Configuração "Estoque para IA" — define O QUE a IA vê de cada veículo
// (campos + rótulos) e QUAIS veículos podem ser ofertados (curadoria).
// ═══════════════════════════════════════════════════════════════

/** Catálogo de campos disponíveis para a ficha da IA (para a tela de config). */
export const STOCK_AI_FIELDS = [
  { key: "titulo", label: "Título" },
  { key: "versao", label: "Versão" },
  { key: "ano", label: "Ano" },
  { key: "km", label: "KM" },
  { key: "cambio", label: "Câmbio" },
  { key: "cor", label: "Cor" },
  { key: "combustivel", label: "Combustível" },
  { key: "preco", label: "Preço" },
  { key: "opcionais", label: "Opcionais" },
  { key: "portas", label: "Portas" },
  { key: "tipo", label: "Tipo" },
  { key: "categoria", label: "Categoria" },
  { key: "descricao", label: "Descrição" },
  { key: "link", label: "Link" },
] as const;

export interface StockAiConfig {
  fields: string[];                 // campos exibidos (na ordem)
  labels: Record<string, string>;   // rótulos personalizados por campo
  onlyKnownVehicles: boolean;       // só carros/motos (esconde barco etc.)
  hideNoPrice: boolean;             // esconde sem preço
  hideNoPhoto: boolean;             // esconde sem foto
  hideCategories: string[];         // categorias a esconder (blocklist)
}

export const DEFAULT_STOCK_AI_CONFIG: StockAiConfig = {
  fields: ["titulo", "ano", "km", "cambio", "preco", "link"],
  labels: {},
  onlyKnownVehicles: true,
  hideNoPrice: true,
  hideNoPhoto: false,
  hideCategories: [],
};

const DEFAULT_LABELS: Record<string, string> = Object.fromEntries(STOCK_AI_FIELDS.map(f => [f.key, f.label]));

export async function getStockAiConfig(): Promise<StockAiConfig> {
  try {
    const raw = await getSetting("ai_stock_config");
    if (raw) {
      const p = JSON.parse(raw);
      return {
        fields: Array.isArray(p.fields) && p.fields.length ? p.fields : DEFAULT_STOCK_AI_CONFIG.fields,
        labels: p.labels && typeof p.labels === "object" ? p.labels : {},
        onlyKnownVehicles: p.onlyKnownVehicles ?? DEFAULT_STOCK_AI_CONFIG.onlyKnownVehicles,
        hideNoPrice: p.hideNoPrice ?? DEFAULT_STOCK_AI_CONFIG.hideNoPrice,
        hideNoPhoto: p.hideNoPhoto ?? DEFAULT_STOCK_AI_CONFIG.hideNoPhoto,
        hideCategories: Array.isArray(p.hideCategories) ? p.hideCategories : [],
      };
    }
  } catch { /* usa padrão */ }
  return DEFAULT_STOCK_AI_CONFIG;
}

function fmtStockPrice(v: any): string {
  return v.promotionPrice && v.promotionPrice < v.price
    ? `R$ ${v.price.toLocaleString("pt-BR")} (promoção: R$ ${v.promotionPrice.toLocaleString("pt-BR")})`
    : `R$ ${v.price.toLocaleString("pt-BR")}`;
}

function stockFieldValue(v: any, key: string): string | null {
  switch (key) {
    case "titulo": return v.title || `${v.brand} ${v.model}`.trim() || null;
    case "versao": return v.version || null;
    case "ano": return v.year ? String(v.year) : null;
    case "km": return v.mileage ? `${v.mileage.toLocaleString("pt-BR")} km` : null;
    case "cambio": return v.transmission === "automatic" ? "Automático" : v.transmission === "manual" ? "Manual" : (v.transmission || null);
    case "cor": return v.color || null;
    case "combustivel": return v.fuel || null;
    case "preco": return v.price ? fmtStockPrice(v) : null;
    case "opcionais": return Array.isArray(v.features) && v.features.length ? v.features.slice(0, 8).join(", ") : null;
    case "portas": return v.doors ? String(v.doors) : null;
    case "tipo": return v.vehicleType || null;
    case "categoria": return v.category === "motos" ? "Moto" : v.category === "carros" ? "Carro" : (v.category || null);
    case "descricao": return v.description ? String(v.description).replace(/\s+/g, " ").slice(0, 300) : null;
    case "link": return v.url || null;
    default: return null;
  }
}

/** Monta a ficha do veículo pra IA conforme a config (campos escolhidos + rótulos). */
export function buildVehicleFicha(v: any, cfg: StockAiConfig, sep: string): string {
  const parts: string[] = [];
  for (const key of cfg.fields) {
    const val = stockFieldValue(v, key);
    if (!val) continue;
    if (key === "titulo") { parts.push(val); continue; } // título vem "puro", sem rótulo
    const label = cfg.labels[key] || DEFAULT_LABELS[key] || key;
    parts.push(`${label}: ${val}`);
  }
  return parts.join(sep);
}

/**
 * Renderiza a legenda da foto a partir de um template editável no nó.
 * Placeholders: {titulo} {versao} {ano} {km} {cambio} {cor} {combustivel}
 * {preco} {opcionais} {portas} {tipo} {categoria} {descricao} {link}
 */
export function renderVehicleCaptionTemplate(template: string, v: any): string {
  const out = template.replace(/\{(\w+)\}/g, (_, k) => stockFieldValue(v, k) || "");
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** True se o veículo PODE ser ofertado pela IA (curadoria — tira lixo do feed). */
export function passesStockCuration(v: any, cfg: StockAiConfig): boolean {
  const cat = (v.category || "").toLowerCase().trim();
  if (cfg.onlyKnownVehicles && cat && !["carros", "motos"].includes(cat)) return false;
  if (cfg.hideCategories.some(c => cat === String(c).toLowerCase().trim())) return false;
  if (cfg.hideNoPrice && (!v.price || v.price <= 0)) return false;
  if (cfg.hideNoPhoto && !v.imageUrl && !(Array.isArray(v.images) && v.images.length)) return false;
  return true;
}

async function getStockSummaryForAI(): Promise<string> {
  const db = await getDb();
  if (!db) return "Estoque indisponível no momento.";

  const allVehicles = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.available, true));

  if (allVehicles.length === 0) {
    return "Nenhum veículo disponível no estoque no momento.";
  }

  // Build a concise summary with category and type breakdown
  const carros = allVehicles.filter(v => v.category === "carros");
  const motos = allVehicles.filter(v => v.category === "motos");
  const outros = allVehicles.filter(v => v.category !== "carros" && v.category !== "motos");

  const carBrands = Array.from(new Set(carros.map(v => v.brand))).sort();
  const motoBrands = Array.from(new Set(motos.map(v => v.brand))).sort();
  const carTypes = Array.from(new Set(carros.map(v => v.vehicleType).filter(Boolean))).sort();
  const motoTypes = Array.from(new Set(motos.map(v => v.vehicleType).filter(Boolean))).sort();

  const priceRange = {
    min: Math.min(...allVehicles.map(v => v.price)),
    max: Math.max(...allVehicles.map(v => v.price)),
  };

  let summary = `ESTOQUE ATUAL DA AUTO INOVA (${allVehicles.length} ve\u00edculos dispon\u00edveis):\n`;
  if (carros.length > 0) {
    summary += `\nCARROS (${carros.length}):\n  Marcas: ${carBrands.join(", ")}\n  Tipos: ${carTypes.join(", ")}`;
  }
  if (motos.length > 0) {
    summary += `\nMOTOS (${motos.length}):\n  Marcas: ${motoBrands.join(", ")}\n  Tipos: ${motoTypes.join(", ")}`;
  }
  if (outros.length > 0) {
    summary += `\nOUTROS (${outros.length})`;
  }
  summary += `\nFaixa de pre\u00e7o: R$ ${priceRange.min.toLocaleString("pt-BR")} a R$ ${priceRange.max.toLocaleString("pt-BR")}\nLocaliza\u00e7\u00e3o: Ivoti - RS`;

  return summary;
}

/**
 * Get a specific vehicle by ID for AI responses (used when customer comes from an ad with IDX)
 */
async function getVehicleByIdForAI(vehicleId: number): Promise<{ found: boolean; text: string; vehicle: any | null }> {
  const db = await getDb();
  if (!db) return { found: false, text: "Estoque indisponível no momento.", vehicle: null };

  const rows = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (rows.length === 0) {
    return { found: false, text: `Veículo com ID ${vehicleId} não encontrado no estoque. Pode ter sido vendido.`, vehicle: null };
  }

  const v = rows[0];
  if (!v.available) {
    return { found: false, text: `O veículo ${v.brand} ${v.model} ${v.year} (ID:${v.id}) não está mais disponível. Pode ter sido vendido recentemente.`, vehicle: v };
  }

  const stockCfg = await getStockAiConfig();
  const text = `VE\u00cdCULO DO AN\u00daCIO (ID:${v.id}):\n${buildVehicleFicha(v, stockCfg, "\n")}`;

  return { found: true, text, vehicle: v };
}

/**
 * Search vehicles with detailed info for AI responses
 */
/**
 * Busca ESTRUTURADA do estoque para o Meta Business Agent (conector).
 * Diferente de searchVehiclesForAI (que devolve texto), aqui devolvemos JSON com
 * as URLs das fotos — pro carrossel/imagem do agente enviar as fotos ao vivo.
 * Aplica a mesma curadoria do estoque (esconde barco, sem preço/foto, etc.).
 */
export async function searchVehiclesStructured(opts: {
  q?: string; maxPrice?: number; minPrice?: number; yearMin?: number; fuel?: string; limit?: number;
}): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];
  const cfg = await getStockAiConfig();
  let all = await db.select().from(vehicles).where(eq(vehicles.available, true));
  all = all.filter((v: any) => passesStockCuration(v, cfg));

  const stop = new Set(["carro", "carros", "quero", "um", "uma", "de", "do", "da", "com", "ate", "até", "por", "o", "a", "veiculo", "veículo"]);
  const kws = (opts.q || "").toLowerCase().replace(/[/\\()\[\]{}]/g, " ").split(/\s+/).filter(w => w.length >= 2 && !stop.has(w));

  const match = (v: any): boolean => {
    if (kws.length) {
      const t = [v.brand, v.model, v.version, v.title].join(" ").toLowerCase();
      if (!kws.some(k => t.includes(k))) return false;
    }
    if (opts.maxPrice && v.price > opts.maxPrice) return false;
    if (opts.minPrice && v.price < opts.minPrice) return false;
    if (opts.yearMin && v.year < opts.yearMin) return false;
    if (opts.fuel && !String(v.fuel || "").toLowerCase().includes(opts.fuel.toLowerCase())) return false;
    return true;
  };

  return all.filter(match).slice(0, opts.limit && opts.limit > 0 ? opts.limit : 10).map((v: any) => ({
    id: v.id,
    titulo: v.title || `${v.brand} ${v.model} ${v.version || ""}`.trim(),
    marca: v.brand, modelo: v.model, versao: v.version,
    ano: v.year, km: v.mileage, preco: v.price,
    cor: v.color, combustivel: v.fuel, cambio: v.transmission,
    link: v.url,
    fotos: Array.isArray(v.images) ? (v.images as string[]).slice(0, 6) : (v.imageUrl ? [v.imageUrl] : []),
  }));
}

/**
 * Retorna TODOS os veículos disponíveis + curados (sem limite), linhas cruas do banco.
 * Usado pelo feed de catálogo do Facebook (server/catalogFeed.ts).
 */
export async function getAllCuratedVehicles(): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];
  const cfg = await getStockAiConfig();
  let all = await db.select().from(vehicles).where(eq(vehicles.available, true));
  all = all.filter((v: any) => passesStockCuration(v, cfg));
  return all;
}

async function searchVehiclesForAI(filters: {
  brand?: string;
  model?: string;
  maxPrice?: number;
  minPrice?: number;
  category?: string;
  vehicleType?: string;
  fuel?: string;
  transmission?: string;
  maxMileage?: number;
  yearMin?: number;
  yearMax?: number;
  color?: string;
  pagina?: number;
}): Promise<string> {
  const db = await getDb();
  if (!db) return "Estoque indisponível no momento.";

  const stockCfg = await getStockAiConfig();
  let allVehicles = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.available, true));

  // Curadoria: remove o que a config manda esconder (barco, sem preço/foto, etc.)
  allVehicles = allVehicles.filter(v => passesStockCuration(v, stockCfg));

  // Apply filters with fuzzy keyword matching
  // Helper: check if ANY keyword matches in ANY of the vehicle's text fields
  function vehicleMatchesKeywords(v: any, keywords: string[]): boolean {
    const searchableText = [
      v.brand || "",
      v.model || "",
      v.version || "",
      v.title || "",
    ].join(" ").toLowerCase();
    return keywords.every(kw => searchableText.includes(kw));
  }

  function vehicleMatchesAnyKeyword(v: any, keywords: string[]): boolean {
    const searchableText = [
      v.brand || "",
      v.model || "",
      v.version || "",
      v.title || "",
    ].join(" ").toLowerCase();
    return keywords.some(kw => searchableText.includes(kw));
  }

  // Extract meaningful keywords from a search term (remove noise words, numbers like 1.8, version suffixes)
  function extractKeywords(term: string): string[] {
    return term
      .toLowerCase()
      .replace(/[/\\()\[\]{}]/g, " ")  // Replace special chars with spaces
      .split(/\s+/)
      .filter(w => w.length >= 2)  // At least 2 chars
      .filter(w => !/^\d+[.,]?\d*$/.test(w))  // Remove pure numbers like "1.8", "1.6", "2019"
      .filter(w => !["de", "do", "da", "em", "um", "uma", "para", "com", "por"].includes(w));  // Remove stop words
  }

  if (filters.brand) {
    const brandKeywords = extractKeywords(filters.brand);
    if (brandKeywords.length > 0) {
      // Try exact brand match first
      const exactMatch = allVehicles.filter(v => v.brand.toLowerCase().includes(filters.brand!.toLowerCase()));
      if (exactMatch.length > 0) {
        allVehicles = exactMatch;
      } else {
        // Fallback: match any keyword in brand/model/title
        allVehicles = allVehicles.filter(v => vehicleMatchesAnyKeyword(v, brandKeywords));
      }
    }
  }
  if (filters.model) {
    const modelKeywords = extractKeywords(filters.model);
    if (modelKeywords.length > 0) {
      // Strategy 1: Try ALL keywords match (most specific)
      let filtered = allVehicles.filter(v => vehicleMatchesKeywords(v, modelKeywords));
      
      // Strategy 2: Try the FIRST keyword only (usually the model name, e.g., "belina")
      if (filtered.length === 0) {
        filtered = allVehicles.filter(v => vehicleMatchesAnyKeyword(v, [modelKeywords[0]]));
        console.log(`[StockSync] Fuzzy search: "${filters.model}" → first keyword "${modelKeywords[0]}" → ${filtered.length} results`);
      }
      
      // Strategy 3: Try ANY keyword match (broadest)
      if (filtered.length === 0 && modelKeywords.length > 1) {
        filtered = allVehicles.filter(v => vehicleMatchesAnyKeyword(v, modelKeywords));
        console.log(`[StockSync] Fuzzy search: "${filters.model}" → any keyword [${modelKeywords.join(", ")}] → ${filtered.length} results`);
      }
      
      if (filtered.length > 0) {
        allVehicles = filtered;
      } else {
        console.log(`[StockSync] No results for model "${filters.model}" with keywords [${modelKeywords.join(", ")}]`);
      }
    }
  }
  if (filters.maxPrice) {
    allVehicles = allVehicles.filter(v => v.price <= filters.maxPrice!);
  }
  if (filters.minPrice) {
    allVehicles = allVehicles.filter(v => v.price >= filters.minPrice!);
  }
  if (filters.category) {
    const catLower = filters.category.toLowerCase().trim();
    // category is now "carros" or "motos"
    const categoryMap: Record<string, string[]> = {
      "carros": ["carros"],
      "carro": ["carros"],
      "motos": ["motos"],
      "moto": ["motos"],
      "motocicleta": ["motos"],
      "motocicletas": ["motos"],
    };
    const mappedCategories = categoryMap[catLower] || null;
    if (mappedCategories) {
      allVehicles = allVehicles.filter(v => {
        const vCat = v.category?.toLowerCase() || "";
        return mappedCategories.some(mc => vCat === mc);
      });
      console.log(`[StockSync] Category mapped: "${catLower}" \u2192 [${mappedCategories.join(", ")}] \u2192 ${allVehicles.length} results`);
    } else {
      allVehicles = allVehicles.filter(v => v.category?.toLowerCase().includes(catLower));
      console.log(`[StockSync] Category direct match: "${catLower}" \u2192 ${allVehicles.length} results`);
    }
  }
  if (filters.fuel) {
    const fuelLower = filters.fuel.toLowerCase();
    allVehicles = allVehicles.filter(v => v.fuel?.toLowerCase().includes(fuelLower));
  }
  if (filters.transmission) {
    const transLower = filters.transmission.toLowerCase().trim();
    // Map common user terms to actual DB transmission values
    const transmissionMap: Record<string, string[]> = {
      "automatico": ["automatic", "automatizado"],
      "automático": ["automatic", "automatizado"],
      "automatic": ["automatic", "automatizado"],
      "auto": ["automatic", "automatizado"],
      "automatizado": ["automatizado", "automatic"],
      "manual": ["manual"],
      "mecanico": ["manual"],
      "mecânico": ["manual"],
    };
    
    const mappedTransmissions = transmissionMap[transLower] || null;
    if (mappedTransmissions) {
      allVehicles = allVehicles.filter(v => {
        const vTrans = v.transmission?.toLowerCase() || "";
        return mappedTransmissions.some(mt => vTrans.includes(mt));
      });
      console.log(`[StockSync] Transmission mapped: "${transLower}" → [${mappedTransmissions.join(", ")}] → ${allVehicles.length} results`);
    } else {
      // Fallback: direct includes match
      allVehicles = allVehicles.filter(v => v.transmission?.toLowerCase().includes(transLower));
      console.log(`[StockSync] Transmission direct match: "${transLower}" → ${allVehicles.length} results`);
    }
  }
  if (filters.maxMileage) {
    allVehicles = allVehicles.filter(v => v.mileage && v.mileage <= filters.maxMileage!);
  }
  if (filters.yearMin) {
    allVehicles = allVehicles.filter(v => v.year >= filters.yearMin!);
  }
  if (filters.yearMax) {
    allVehicles = allVehicles.filter(v => v.year <= filters.yearMax!);
  }
  if (filters.color) {
    const colorLower = filters.color.toLowerCase();
    allVehicles = allVehicles.filter(v => v.color?.toLowerCase().includes(colorLower));
  }

  // Filter by vehicleType (Hatch, Sedã, SUV, Naked, Esportiva, etc.)
  if (filters.vehicleType) {
    const typeLower = filters.vehicleType.toLowerCase().trim();
    const vehicleTypeMap: Record<string, string[]> = {
      "hatch": ["hatch"],
      "hatchback": ["hatch"],
      "compacto": ["hatch"],
      "sedan": ["sed\u00e3", "sedan"],
      "sed\u00e3": ["sed\u00e3", "sedan"],
      "seda": ["sed\u00e3", "sedan"],
      "suv": ["suv / utilit\u00e1rio esportivo", "suv"],
      "utilitario": ["suv / utilit\u00e1rio esportivo", "van/utilit\u00e1rio"],
      "utilit\u00e1rio": ["suv / utilit\u00e1rio esportivo", "van/utilit\u00e1rio"],
      "picape": ["picapes"],
      "picapes": ["picapes"],
      "pickup": ["picapes"],
      "pick-up": ["picapes"],
      "camionete": ["picapes"],
      "van": ["van/utilit\u00e1rio"],
      "minivan": ["minivan"],
      "wagon": ["wagon/perua"],
      "perua": ["wagon/perua"],
      "esportiva": ["esportiva"],
      "esportivo": ["esportiva"],
      "sport": ["esportiva"],
      "naked": ["naked"],
      "street": ["street"],
      "touring": ["touring"],
      "trail": ["trail"],
      "custom": ["custom"],
    };
    const mappedTypes = vehicleTypeMap[typeLower] || null;
    if (mappedTypes) {
      allVehicles = allVehicles.filter(v => {
        const vType = v.vehicleType?.toLowerCase() || "";
        return mappedTypes.some(mt => vType.includes(mt));
      });
      console.log(`[StockSync] VehicleType mapped: "${typeLower}" \u2192 [${mappedTypes.join(", ")}] \u2192 ${allVehicles.length} results`);
    } else {
      allVehicles = allVehicles.filter(v => v.vehicleType?.toLowerCase().includes(typeLower));
      console.log(`[StockSync] VehicleType direct match: "${typeLower}" \u2192 ${allVehicles.length} results`);
    }
  }

  // Filter out motos unless specifically searched by category
  const isSearchingMotos = filters.category && filters.category.toLowerCase().includes("moto");
  if (!isSearchingMotos) {
    allVehicles = allVehicles.filter(v => v.category !== "motos");
  }

  if (allVehicles.length === 0) {
    return "Nenhum veículo encontrado com esses critérios. Tente ampliar a busca.";
  }

  // Sort by price
  const allSorted = allVehicles.sort((a, b) => a.price - b.price);
  
  // Pagination: 10 per page
  const PAGE_SIZE = 10;
  const page = Math.max(1, filters.pagina || 1);
  const startIndex = (page - 1) * PAGE_SIZE;
  const sorted = allSorted.slice(startIndex, startIndex + PAGE_SIZE);
  
  if (sorted.length === 0) {
    return `Não há mais veículos para mostrar. Já foram exibidos todos os ${allVehicles.length} veículos disponíveis com esses critérios.`;
  }

  const vehicleList = sorted.map((v, i) => {
    return `Op\u00e7\u00e3o ${startIndex + i + 1}: [ID:${v.id}] ${buildVehicleFicha(v, stockCfg, " | ")}`;
  }).join("\n");

  const remaining = allVehicles.length - (startIndex + sorted.length);
  const moreText = remaining > 0 
    ? `\n\n(Mostrando página ${page}. Restam mais ${remaining} veículos. Para ver mais, chame buscar_veiculos novamente com pagina: ${page + 1} e os MESMOS filtros.)` 
    : `\n\n(Estes são TODOS os veículos disponíveis com esses critérios. Não há mais opções.)`;

  return `RESULTADOS DA BUSCA (${allVehicles.length} veículos no total, mostrando ${sorted.length} - página ${page}):\n\nIMPORTANTE: Apresente EXATAMENTE os veículos abaixo ao cliente. PROIBIDO inventar, modificar nomes, preços, links ou adicionar veículos que NÃO estão nesta lista. Se o cliente pedir mais opções, chame buscar_veiculos com pagina: ${page + 1}.\n\n${vehicleList}${moreText}`;
}

// Auto-sync interval (every 30 minutes)
let syncInterval: NodeJS.Timeout | null = null;

function startAutoSync(intervalMs: number = 30 * 60 * 1000) {
  // Limpa interval anterior para evitar duplicação (hot-reload)
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }

  // Initial sync after 5 seconds
  setTimeout(() => {
    syncStock().catch(err => console.error("[StockSync] Initial sync failed:", err.message));
  }, 5000);

  // Periodic sync
  syncInterval = setInterval(() => {
    syncStock().catch(err => console.error("[StockSync] Periodic sync failed:", err.message));
  }, intervalMs);

  console.log(`[StockSync] Auto-sync started (every ${intervalMs / 60000} minutes)`);
}

function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[StockSync] Auto-sync stopped");
  }
}

export {
  syncStock,
  fetchExternalStock,
  getStockSummaryForAI,
  getVehicleByIdForAI,
  searchVehiclesForAI,
  startAutoSync,
  stopAutoSync,
  STOCK_URL,
};
