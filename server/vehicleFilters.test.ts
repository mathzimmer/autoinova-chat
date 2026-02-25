import { describe, expect, it, vi, beforeEach } from "vitest";

// Create mock vehicles data
const mockVehicles = [
  { id: 1, brand: "Toyota", model: "Hilux", version: "SRV 2.8 Diesel 4x4", title: "Toyota Hilux SRV 2.8 Diesel 4x4 Aut.", year: 2022, price: 250000, mileage: 30000, color: "Branca", transmission: "automatic", fuel: "diesel", category: "Picapes", available: true, url: "https://autoinova.com/hilux", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 2, brand: "Chevrolet", model: "S10", version: "High Country 2.8 Diesel", title: "Chevrolet S10 High Country 2.8 Diesel 4x4", year: 2021, price: 220000, mileage: 45000, color: "Preta", transmission: "automatic", fuel: "diesel", category: "Picapes", available: true, url: "https://autoinova.com/s10", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 3, brand: "Fiat", model: "Strada", version: "Freedom 1.3", title: "Fiat Strada Freedom 1.3 Flex", year: 2023, price: 85000, mileage: 15000, color: "Vermelha", transmission: "manual", fuel: "flex", category: "Picapes", available: true, url: "https://autoinova.com/strada", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 4, brand: "Volkswagen", model: "Gol", version: "1.0 MPI", title: "Volkswagen Gol 1.0 MPI", year: 2020, price: 55000, mileage: 40000, color: "Prata", transmission: "manual", fuel: "flex", category: "Hatch", available: true, url: "https://autoinova.com/gol", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 5, brand: "Hyundai", model: "HB20", version: "1.0 Turbo", title: "Hyundai HB20 1.0 Turbo", year: 2022, price: 80000, mileage: 20000, color: "Branca", transmission: "automatic", fuel: "flex", category: "Hatch", available: true, url: "https://autoinova.com/hb20", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 6, brand: "Honda", model: "Civic", version: "EX 2.0", title: "Honda Civic EX 2.0 Flex", year: 2022, price: 130000, mileage: 25000, color: "Prata", transmission: "automatic", fuel: "flex", category: "Sedã", available: true, url: "https://autoinova.com/civic", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 7, brand: "Toyota", model: "Corolla", version: "XEI 2.0", title: "Toyota Corolla XEI 2.0 Flex", year: 2021, price: 120000, mileage: 35000, color: "Branca", transmission: "automatic", fuel: "flex", category: "Sedã", available: true, url: "https://autoinova.com/corolla", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 8, brand: "Chevrolet", model: "Onix", version: "LT 1.0 Turbo", title: "Chevrolet Onix LT 1.0 Turbo", year: 2023, price: 75000, mileage: 10000, color: "Azul", transmission: "manual", fuel: "flex", category: "Hatch", available: true, url: "https://autoinova.com/onix", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 9, brand: "Jeep", model: "Compass", version: "Longitude 2.0 Diesel", title: "Jeep Compass Longitude 2.0 Diesel 4x4", year: 2022, price: 180000, mileage: 20000, color: "Preta", transmission: "automatic", fuel: "diesel", category: "SUV / Utilitário Esportivo", available: true, url: "https://autoinova.com/compass", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 10, brand: "Volkswagen", model: "Saveiro", version: "Cross 1.6", title: "Volkswagen Saveiro Cross 1.6 Flex", year: 2022, price: 90000, mileage: 18000, color: "Branca", transmission: "manual", fuel: "flex", category: "Picapes", available: true, url: "https://autoinova.com/saveiro", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 11, brand: "Fiat", model: "Argo", version: "Drive 1.3", title: "Fiat Argo Drive 1.3 Flex", year: 2021, price: 65000, mileage: 30000, color: "Vermelha", transmission: "manual", fuel: "flex", category: "Hatch", available: true, url: "https://autoinova.com/argo", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 12, brand: "Honda", model: "City", version: "EXL 1.5", title: "Honda City EXL 1.5 Flex", year: 2023, price: 110000, mileage: 8000, color: "Cinza", transmission: "automatic", fuel: "flex", category: "Sedã", available: true, url: "https://autoinova.com/city", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 13, brand: "Volkswagen", model: "Polo", version: "TSI 1.0", title: "Volkswagen Polo TSI 1.0", year: 2022, price: 85000, mileage: 22000, color: "Branca", transmission: "automatizado", fuel: "flex", category: "Hatch", available: true, url: "https://autoinova.com/polo", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
];

// Mock the database
const mockDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(mockVehicles),
    }),
  }),
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

describe("Vehicle Search - Category and Transmission Filters", () => {
  let searchVehiclesForAI: any;

  beforeEach(async () => {
    // Override getDb to return our mock
    const dbModule = await import("./db");
    (dbModule.getDb as any).mockResolvedValue(mockDb);
    
    // Re-import to get fresh module
    const stockModule = await import("./stockSync");
    searchVehiclesForAI = stockModule.searchVehiclesForAI;
  });

  describe("Category Mapping", () => {
    it("filters by 'picape' category and returns only Picapes", async () => {
      const result = await searchVehiclesForAI({ category: "picape" });
      expect(result).toContain("Hilux");
      expect(result).toContain("S10");
      expect(result).toContain("Strada");
      expect(result).toContain("Saveiro");
      expect(result).not.toContain("Gol");
      expect(result).not.toContain("Civic");
      expect(result).not.toContain("Compass");
    });

    it("filters by 'camionete' category and maps to Picapes", async () => {
      const result = await searchVehiclesForAI({ category: "camionete" });
      expect(result).toContain("Hilux");
      expect(result).toContain("S10");
      expect(result).not.toContain("Civic");
    });

    it("filters by 'hatch' category", async () => {
      const result = await searchVehiclesForAI({ category: "hatch" });
      expect(result).toContain("Gol");
      expect(result).toContain("HB20");
      expect(result).toContain("Onix");
      expect(result).toContain("Argo");
      expect(result).toContain("Polo");
      expect(result).not.toContain("Hilux");
      expect(result).not.toContain("Civic");
    });

    it("filters by 'sedan' category and maps to Sedã", async () => {
      const result = await searchVehiclesForAI({ category: "sedan" });
      expect(result).toContain("Civic");
      expect(result).toContain("Corolla");
      expect(result).toContain("City");
      expect(result).not.toContain("Gol");
      expect(result).not.toContain("Hilux");
    });

    it("filters by 'suv' category", async () => {
      const result = await searchVehiclesForAI({ category: "suv" });
      expect(result).toContain("Compass");
      expect(result).not.toContain("Civic");
      expect(result).not.toContain("Hilux");
    });

    it("handles case-insensitive category input", async () => {
      const result = await searchVehiclesForAI({ category: "PICAPE" });
      expect(result).toContain("Hilux");
      expect(result).toContain("S10");
    });

    it("handles 'pickup' English term", async () => {
      const result = await searchVehiclesForAI({ category: "pickup" });
      expect(result).toContain("Hilux");
      expect(result).toContain("S10");
    });
  });

  describe("Transmission Mapping", () => {
    it("filters by 'automatico' transmission", async () => {
      const result = await searchVehiclesForAI({ transmission: "automatico" });
      expect(result).toContain("Automático");
      expect(result).not.toContain("Manual");
      // Should include automatic and automatizado vehicles
      expect(result).toContain("Hilux");
      expect(result).toContain("HB20");
      expect(result).toContain("Civic");
      expect(result).toContain("Polo"); // automatizado
      expect(result).not.toContain("Gol"); // manual
    });

    it("filters by 'manual' transmission", async () => {
      const result = await searchVehiclesForAI({ transmission: "manual" });
      expect(result).toContain("Gol");
      expect(result).toContain("Strada");
      expect(result).toContain("Onix");
      expect(result).not.toContain("Hilux"); // automatic
      expect(result).not.toContain("Civic"); // automatic
    });

    it("handles accented 'automático' input", async () => {
      const result = await searchVehiclesForAI({ transmission: "automático" });
      expect(result).toContain("Hilux");
      expect(result).toContain("Civic");
      expect(result).not.toContain("Gol");
    });
  });

  describe("Combined Filters", () => {
    it("filters by category 'picape' + transmission 'automatico'", async () => {
      const result = await searchVehiclesForAI({ category: "picape", transmission: "automatico" });
      expect(result).toContain("Hilux");
      expect(result).toContain("S10");
      expect(result).not.toContain("Strada"); // picape but manual
      expect(result).not.toContain("Saveiro"); // picape but manual
      expect(result).not.toContain("Civic"); // automatic but sedan
    });

    it("filters by category 'hatch' + transmission 'automatico'", async () => {
      const result = await searchVehiclesForAI({ category: "hatch", transmission: "automatico" });
      expect(result).toContain("HB20");
      expect(result).toContain("Polo"); // automatizado
      expect(result).not.toContain("Gol"); // hatch but manual
      expect(result).not.toContain("Onix"); // hatch but manual
      expect(result).not.toContain("Civic"); // automatic but sedan
    });

    it("filters by category 'sedan' + transmission 'manual'", async () => {
      const result = await searchVehiclesForAI({ category: "sedan", transmission: "manual" });
      // No sedans with manual transmission in our mock data
      expect(result).toContain("Nenhum veículo encontrado");
    });

    it("filters by category 'picape' + maxPrice", async () => {
      const result = await searchVehiclesForAI({ category: "picape", maxPrice: 100000 });
      expect(result).toContain("Strada"); // 85000
      expect(result).toContain("Saveiro"); // 90000
      expect(result).not.toContain("Hilux"); // 250000
      expect(result).not.toContain("S10"); // 220000
    });

    it("filters by model + transmission", async () => {
      const result = await searchVehiclesForAI({ model: "hilux", transmission: "automatico" });
      expect(result).toContain("Hilux");
      expect(result).not.toContain("S10");
    });
  });

  describe("Output Format", () => {
    it("includes transmission info in results", async () => {
      const result = await searchVehiclesForAI({ category: "picape", transmission: "automatico" });
      expect(result).toContain("Automático");
    });

    it("includes category info in results", async () => {
      const result = await searchVehiclesForAI({ category: "hatch" });
      expect(result).toContain("Hatch");
    });
  });
});
