import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock vehicles data with new category (carros/motos) and vehicleType (body type)
const mockVehicles = [
  { id: 1, brand: "Toyota", model: "Hilux", version: "SRV 2.8 Diesel 4x4", title: "Toyota Hilux SRV 2.8 Diesel 4x4 Aut.", year: 2022, price: 250000, mileage: 30000, color: "Branca", transmission: "automatic", fuel: "diesel", category: "carros", vehicleType: "Picapes", available: true, url: "https://autoinova.com/hilux", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 2, brand: "Chevrolet", model: "S10", version: "High Country 2.8 Diesel", title: "Chevrolet S10 High Country 2.8 Diesel 4x4", year: 2021, price: 220000, mileage: 45000, color: "Preta", transmission: "automatic", fuel: "diesel", category: "carros", vehicleType: "Picapes", available: true, url: "https://autoinova.com/s10", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 3, brand: "Fiat", model: "Strada", version: "Freedom 1.3", title: "Fiat Strada Freedom 1.3 Flex", year: 2023, price: 85000, mileage: 15000, color: "Vermelha", transmission: "manual", fuel: "flex", category: "carros", vehicleType: "Picapes", available: true, url: "https://autoinova.com/strada", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 4, brand: "Volkswagen", model: "Gol", version: "1.0 MPI", title: "Volkswagen Gol 1.0 MPI", year: 2020, price: 55000, mileage: 40000, color: "Prata", transmission: "manual", fuel: "flex", category: "carros", vehicleType: "Hatch", available: true, url: "https://autoinova.com/gol", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 5, brand: "Hyundai", model: "HB20", version: "1.0 Turbo", title: "Hyundai HB20 1.0 Turbo", year: 2022, price: 80000, mileage: 20000, color: "Branca", transmission: "automatic", fuel: "flex", category: "carros", vehicleType: "Hatch", available: true, url: "https://autoinova.com/hb20", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 6, brand: "Honda", model: "Civic", version: "EX 2.0", title: "Honda Civic EX 2.0 Flex", year: 2022, price: 130000, mileage: 25000, color: "Prata", transmission: "automatic", fuel: "flex", category: "carros", vehicleType: "Sedã", available: true, url: "https://autoinova.com/civic", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 7, brand: "Toyota", model: "Corolla", version: "XEI 2.0", title: "Toyota Corolla XEI 2.0 Flex", year: 2021, price: 120000, mileage: 35000, color: "Branca", transmission: "automatic", fuel: "flex", category: "carros", vehicleType: "Sedã", available: true, url: "https://autoinova.com/corolla", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 8, brand: "Chevrolet", model: "Onix", version: "LT 1.0 Turbo", title: "Chevrolet Onix LT 1.0 Turbo", year: 2023, price: 75000, mileage: 10000, color: "Azul", transmission: "manual", fuel: "flex", category: "carros", vehicleType: "Hatch", available: true, url: "https://autoinova.com/onix", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 9, brand: "Jeep", model: "Compass", version: "Longitude 2.0 Diesel", title: "Jeep Compass Longitude 2.0 Diesel 4x4", year: 2022, price: 180000, mileage: 20000, color: "Preta", transmission: "automatic", fuel: "diesel", category: "carros", vehicleType: "SUV / Utilitário Esportivo", available: true, url: "https://autoinova.com/compass", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 10, brand: "Volkswagen", model: "Saveiro", version: "Cross 1.6", title: "Volkswagen Saveiro Cross 1.6 Flex", year: 2022, price: 90000, mileage: 18000, color: "Branca", transmission: "manual", fuel: "flex", category: "carros", vehicleType: "Picapes", available: true, url: "https://autoinova.com/saveiro", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 11, brand: "Fiat", model: "Argo", version: "Drive 1.3", title: "Fiat Argo Drive 1.3 Flex", year: 2021, price: 65000, mileage: 30000, color: "Vermelha", transmission: "manual", fuel: "flex", category: "carros", vehicleType: "Hatch", available: true, url: "https://autoinova.com/argo", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 12, brand: "Honda", model: "City", version: "EXL 1.5", title: "Honda City EXL 1.5 Flex", year: 2023, price: 110000, mileage: 8000, color: "Cinza", transmission: "automatic", fuel: "flex", category: "carros", vehicleType: "Sedã", available: true, url: "https://autoinova.com/city", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 13, brand: "Volkswagen", model: "Polo", version: "TSI 1.0", title: "Volkswagen Polo TSI 1.0", year: 2022, price: 85000, mileage: 22000, color: "Branca", transmission: "automatizado", fuel: "flex", category: "carros", vehicleType: "Hatch", available: true, url: "https://autoinova.com/polo", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  // Motos
  { id: 14, brand: "Honda", model: "CB 500F", version: "ABS", title: "Honda CB 500F ABS", year: 2023, price: 35000, mileage: 5000, color: "Preta", transmission: "manual", fuel: "gasolina", category: "motos", vehicleType: "Naked", available: true, url: "https://autoinova.com/cb500f", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 15, brand: "Yamaha", model: "MT-07", version: "ABS", title: "Yamaha MT-07 ABS", year: 2022, price: 42000, mileage: 8000, color: "Azul", transmission: "manual", fuel: "gasolina", category: "motos", vehicleType: "Naked", available: true, url: "https://autoinova.com/mt07", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
  { id: 16, brand: "Kawasaki", model: "Ninja 400", version: "ABS", title: "Kawasaki Ninja 400 ABS", year: 2023, price: 32000, mileage: 3000, color: "Verde", transmission: "manual", fuel: "gasolina", category: "motos", vehicleType: "Esportiva", available: true, url: "https://autoinova.com/ninja400", imageUrl: null, images: [], features: [], promotionPrice: null, regularPrice: null },
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

describe("Vehicle Search - Category, VehicleType and Transmission Filters", () => {
  let searchVehiclesForAI: any;

  beforeEach(async () => {
    // Override getDb to return our mock
    const dbModule = await import("./db");
    (dbModule.getDb as any).mockResolvedValue(mockDb);
    
    // Re-import to get fresh module
    const stockModule = await import("./stockSync");
    searchVehiclesForAI = stockModule.searchVehiclesForAI;
  });

  describe("Category Mapping (carros/motos)", () => {
    it("filters by 'carros' category and excludes motos", async () => {
      const result = await searchVehiclesForAI({ category: "carros" });
      // Page 1 shows cheapest 10 cars (sorted by price)
      expect(result).toContain("Gol"); // 55000
      expect(result).toContain("Civic"); // 130000
      expect(result).not.toContain("CB 500F"); // moto
      expect(result).not.toContain("Ninja 400"); // moto
    });

    it("filters by 'motos' category and returns only motos", async () => {
      const result = await searchVehiclesForAI({ category: "motos" });
      expect(result).toContain("CB 500F");
      expect(result).toContain("MT-07");
      expect(result).toContain("Ninja 400");
      expect(result).not.toContain("Hilux");
      expect(result).not.toContain("Gol");
    });

    it("excludes motos by default when no category specified", async () => {
      const result = await searchVehiclesForAI({});
      // Default: only carros, page 1 (10 cheapest)
      expect(result).toContain("Gol"); // 55000
      expect(result).toContain("Onix"); // 75000
      expect(result).not.toContain("CB 500F"); // moto
      expect(result).not.toContain("Ninja 400"); // moto
      // Hilux (250000) is on page 2 due to pagination
      const page2 = await searchVehiclesForAI({ pagina: 2 });
      expect(page2).toContain("Hilux");
    });

    it("handles 'moto' singular term", async () => {
      const result = await searchVehiclesForAI({ category: "moto" });
      expect(result).toContain("CB 500F");
      expect(result).not.toContain("Hilux");
    });
  });

  describe("VehicleType Mapping (body type)", () => {
    it("filters by 'picape' vehicleType", async () => {
      const result = await searchVehiclesForAI({ vehicleType: "picape" });
      expect(result).toContain("Hilux");
      expect(result).toContain("S10");
      expect(result).toContain("Strada");
      expect(result).toContain("Saveiro");
      expect(result).not.toContain("Gol");
      expect(result).not.toContain("Civic");
    });

    it("filters by 'hatch' vehicleType", async () => {
      const result = await searchVehiclesForAI({ vehicleType: "hatch" });
      expect(result).toContain("Gol");
      expect(result).toContain("HB20");
      expect(result).toContain("Onix");
      expect(result).toContain("Argo");
      expect(result).toContain("Polo");
      expect(result).not.toContain("Hilux");
      expect(result).not.toContain("Civic");
    });

    it("filters by 'sedan' vehicleType and maps to Sedã", async () => {
      const result = await searchVehiclesForAI({ vehicleType: "sedan" });
      expect(result).toContain("Civic");
      expect(result).toContain("Corolla");
      expect(result).toContain("City");
      expect(result).not.toContain("Gol");
      expect(result).not.toContain("Hilux");
    });

    it("filters by 'suv' vehicleType", async () => {
      const result = await searchVehiclesForAI({ vehicleType: "suv" });
      expect(result).toContain("Compass");
      expect(result).not.toContain("Civic");
      expect(result).not.toContain("Hilux");
    });

    it("filters by 'naked' vehicleType for motos", async () => {
      const result = await searchVehiclesForAI({ category: "motos", vehicleType: "naked" });
      expect(result).toContain("CB 500F");
      expect(result).toContain("MT-07");
      expect(result).not.toContain("Ninja 400");
    });

    it("filters by 'esportiva' vehicleType for motos", async () => {
      const result = await searchVehiclesForAI({ category: "motos", vehicleType: "esportiva" });
      expect(result).toContain("Ninja 400");
      expect(result).not.toContain("CB 500F");
    });

    it("handles 'camionete' as synonym for picape", async () => {
      const result = await searchVehiclesForAI({ vehicleType: "camionete" });
      expect(result).toContain("Hilux");
      expect(result).toContain("S10");
      expect(result).not.toContain("Civic");
    });

    it("handles 'pickup' English term", async () => {
      const result = await searchVehiclesForAI({ vehicleType: "pickup" });
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
  });

  describe("Combined Filters", () => {
    it("combines vehicleType and transmission filters", async () => {
      const result = await searchVehiclesForAI({ vehicleType: "hatch", transmission: "manual" });
      expect(result).toContain("Gol");
      expect(result).toContain("Onix");
      expect(result).toContain("Argo");
      expect(result).not.toContain("HB20"); // automatic hatch
      expect(result).not.toContain("Polo"); // automatizado hatch
      expect(result).not.toContain("Hilux"); // picape
    });

    it("combines category motos + vehicleType naked", async () => {
      const result = await searchVehiclesForAI({ category: "motos", vehicleType: "naked" });
      expect(result).toContain("CB 500F");
      expect(result).toContain("MT-07");
      expect(result).not.toContain("Ninja 400"); // esportiva
      expect(result).not.toContain("Gol"); // carro
    });

    it("combines vehicleType and price filters", async () => {
      const result = await searchVehiclesForAI({ vehicleType: "picape", maxPrice: 100000 });
      expect(result).toContain("Strada"); // 85000
      expect(result).toContain("Saveiro"); // 90000
      expect(result).not.toContain("Hilux"); // 250000
      expect(result).not.toContain("S10"); // 220000
    });
  });
});
