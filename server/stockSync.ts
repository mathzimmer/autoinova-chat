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
  const price = Math.round(parseFloat(ext.PRICE || "0"));
  const regularPrice = ext.PRICES?.REGULAR_PRICE ? Math.round(parseFloat(ext.PRICES.REGULAR_PRICE)) : null;
  const promotionPrice = ext.PRICES?.PROMOTION_PRICE ? Math.round(parseFloat(ext.PRICES.PROMOTION_PRICE)) : null;

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
}): Promise<string> {
  const db = await getDb();
  if (!db) return "Estoque indisponível no momento.";

  let allVehicles = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.available, true));

  // Apply filters
  if (filters.brand) {
    const brandLower = filters.brand.toLowerCase();
    allVehicles = allVehicles.filter(v => v.brand.toLowerCase().includes(brandLower));
  }
  if (filters.model) {
    const modelLower = filters.model.toLowerCase();
    allVehicles = allVehicles.filter(v => v.model.toLowerCase().includes(modelLower));
  }
  if (filters.maxPrice) {
    allVehicles = allVehicles.filter(v => v.price <= filters.maxPrice!);
  }
  if (filters.minPrice) {
    allVehicles = allVehicles.filter(v => v.price >= filters.minPrice!);
  }
  if (filters.category) {
    const catLower = filters.category.toLowerCase();
    allVehicles = allVehicles.filter(v => v.category?.toLowerCase().includes(catLower));
  }
  if (filters.fuel) {
    const fuelLower = filters.fuel.toLowerCase();
    allVehicles = allVehicles.filter(v => v.fuel?.toLowerCase().includes(fuelLower));
  }
  if (filters.transmission) {
    const transLower = filters.transmission.toLowerCase();
    allVehicles = allVehicles.filter(v => v.transmission?.toLowerCase().includes(transLower));
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

  if (allVehicles.length === 0) {
    return "Nenhum veículo encontrado com esses critérios. Tente ampliar a busca.";
  }

  // Limit to top 10 results, sorted by price
  const sorted = allVehicles.sort((a, b) => a.price - b.price).slice(0, 10);

  const vehicleList = sorted.map((v, i) => {
    const priceStr = v.promotionPrice && v.promotionPrice < v.price
      ? `De R$ ${v.regularPrice?.toLocaleString("pt-BR") || v.price.toLocaleString("pt-BR")} por R$ ${v.promotionPrice.toLocaleString("pt-BR")}`
      : `R$ ${v.price.toLocaleString("pt-BR")}`;
    
    const features = Array.isArray(v.features) ? (v.features as string[]).slice(0, 5).join(", ") : "";
    const mileageStr = v.mileage ? `${v.mileage.toLocaleString("pt-BR")} km` : "N/I";
    
    return `${i + 1}. **${v.title || `${v.brand} ${v.model}`}**
   ${priceStr} | ${v.year} | ${mileageStr} | ${v.fuel || ""} | ${v.transmission || ""}
   ${v.color ? `Cor: ${v.color}` : ""} ${v.condition ? `| ${v.condition}` : ""}
   ${features ? `Destaques: ${features}` : ""}
   ${v.url ? `Link: ${v.url}` : ""}`;
  }).join("\n\n");

  return `Encontrei ${allVehicles.length} veículo(s) (mostrando ${sorted.length}):\n\n${vehicleList}`;
}

// Auto-sync interval (every 30 minutes)
let syncInterval: NodeJS.Timeout | null = null;

function startAutoSync(intervalMs: number = 30 * 60 * 1000) {
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
