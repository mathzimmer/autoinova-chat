/**
 * Stock Synchronization Module
 * 
 * Fetches vehicle inventory from external S3 JSON feed and syncs with the database.
 * URL: https://autoconf-prod.s3.sa-east-1.amazonaws.com/carros-na-serra/642av2OVG5XVCHO5GK8IvGGM5Pqo1JwOYe8swwXv.json
 */
import axios from "axios";
import { eq, notInArray } from "drizzle-orm";
import { vehicles, InsertVehicle } from "../drizzle/schema";
import { getDb } from "./db";

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
    category: ext.BODY || null,
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

  // Build a concise summary
  const brands = Array.from(new Set(allVehicles.map(v => v.brand))).sort();
  const priceRange = {
    min: Math.min(...allVehicles.map(v => v.price)),
    max: Math.max(...allVehicles.map(v => v.price)),
  };
  const categories = Array.from(new Set(allVehicles.map(v => v.category).filter(Boolean))).sort();

  return `ESTOQUE ATUAL DA AUTO INOVA (${allVehicles.length} veículos disponíveis):
Marcas: ${brands.join(", ")}
Categorias: ${categories.join(", ")}
Faixa de preço: R$ ${priceRange.min.toLocaleString("pt-BR")} a R$ ${priceRange.max.toLocaleString("pt-BR")}
Localização: Ivoti - RS`;
}

/**
 * Search vehicles with detailed info for AI responses
 */
async function searchVehiclesForAI(filters: {
  brand?: string;
  model?: string;
  maxPrice?: number;
  minPrice?: number;
  category?: string;
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

  let allVehicles = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.available, true));

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
    // Map common user terms to actual DB category values
    const categoryMap: Record<string, string[]> = {
      // Picapes
      "picape": ["picapes"],
      "picapes": ["picapes"],
      "picap": ["picapes"],
      "camionete": ["picapes"],
      "camioneta": ["picapes"],
      "caminhonete": ["picapes"],
      "pickup": ["picapes"],
      "pick-up": ["picapes"],
      "cabine dupla": ["picapes"],
      // Hatch
      "hatch": ["hatch"],
      "hatchback": ["hatch"],
      "compacto": ["hatch"],
      // Sedan
      "sedan": ["sedã", "sedan"],
      "sedã": ["sedã", "sedan"],
      "seda": ["sedã", "sedan"],
      // SUV
      "suv": ["suv / utilitário esportivo", "suv"],
      "utilitario": ["suv / utilitário esportivo", "van/utilitário"],
      "utilitário": ["suv / utilitário esportivo", "van/utilitário"],
      // Van
      "van": ["van/utilitário"],
      // Wagon
      "wagon": ["wagon/perua"],
      "perua": ["wagon/perua"],
      // Esportivo
      "esportivo": ["esportiva"],
      "esportiva": ["esportiva"],
      "sport": ["esportiva"],
    };
    
    const mappedCategories = categoryMap[catLower] || null;
    if (mappedCategories) {
      allVehicles = allVehicles.filter(v => {
        const vCat = v.category?.toLowerCase() || "";
        return mappedCategories.some(mc => vCat.includes(mc));
      });
      console.log(`[StockSync] Category mapped: "${catLower}" → [${mappedCategories.join(", ")}] → ${allVehicles.length} results`);
    } else {
      // Fallback: direct includes match
      allVehicles = allVehicles.filter(v => v.category?.toLowerCase().includes(catLower));
      console.log(`[StockSync] Category direct match: "${catLower}" → ${allVehicles.length} results`);
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

  // Filter out non-car items (motos, barcos, quadriciclos, etc.) unless specifically searched
  const nonCarCategories = ["motos", "moto", "barco", "barcos", "quadriciclo", "utv", "atv"];
  const isSearchingNonCar = filters.category && nonCarCategories.some(nc => filters.category!.toLowerCase().includes(nc));
  if (!isSearchingNonCar) {
    allVehicles = allVehicles.filter(v => {
      const cat = (v.category || "").toLowerCase();
      const model = (v.model || "").toLowerCase();
      const brand = (v.brand || "").toLowerCase();
      // Exclude motos, barcos, etc
      const isNonCar = nonCarCategories.some(nc => cat.includes(nc)) ||
        ["honda/c100", "yamaha", "suzuki gsx", "bmw g 310", "bmw r 1200", "royal enfield", "barco", "polaris", "buggy"].some(nc => 
          brand.toLowerCase().includes(nc) || model.toLowerCase().includes(nc) || (v.title || "").toLowerCase().includes(nc)
        );
      return !isNonCar;
    });
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
    // price = REGULAR_PRICE (preço principal), promotionPrice = PROMOTION_PRICE (preço com desconto)
    const priceStr = v.promotionPrice && v.promotionPrice < v.price
      ? `R$ ${v.price.toLocaleString("pt-BR")} (promoção: R$ ${v.promotionPrice.toLocaleString("pt-BR")})`
      : `R$ ${v.price.toLocaleString("pt-BR")}`;
    
    const mileageStr = v.mileage ? `${v.mileage.toLocaleString("pt-BR")} km` : "N/I";
    
    // Compact format to prevent AI from inventing details
    const transStr = v.transmission === "automatic" ? "Automático" : v.transmission === "manual" ? "Manual" : v.transmission || "";
    const catStr = v.category || "";
    return `Opção ${startIndex + i + 1}: [ID:${v.id}] ${v.title || `${v.brand} ${v.model}`} - ${v.year} - ${v.color || ""} - ${mileageStr} - ${transStr} - ${catStr} - ${priceStr} - ${v.url || ""}`;
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
  searchVehiclesForAI,
  startAutoSync,
  stopAutoSync,
  STOCK_URL,
};
