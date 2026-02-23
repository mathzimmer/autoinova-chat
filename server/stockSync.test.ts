import { describe, expect, it, vi } from "vitest";

// Mock axios
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock db
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

import axios from "axios";
import { STOCK_URL } from "./stockSync";

describe("stockSync", () => {
  it("uses the correct stock URL", () => {
    expect(STOCK_URL).toBe(
      "https://autoconf-prod.s3.sa-east-1.amazonaws.com/carros-na-serra/642av2OVG5XVCHO5GK8IvGGM5Pqo1JwOYe8swwXv.json"
    );
  });

  it("fetches external stock JSON successfully", async () => {
    const mockData = {
      ADS: {
        AD: [
          {
            ID: 1,
            TITLE: "Honda Civic",
            MAKE: "Honda",
            MODEL: "Civic",
            VERSION: "EX",
            YEAR: "2023",
            FABRIC_YEAR: "2023",
            CONDITION: "usado",
            MILEAGE: 15000,
            FUEL: "flex",
            gear: "automatico",
            BODY: "Sedan",
            COLOR: "prata",
            PRICE: "120000",
            PRICES: { REGULAR_PRICE: "125000", PROMOTION_PRICE: "120000" },
            DOORS: 4,
            DESCRIPTION: "Honda Civic EX 2023",
            SELLER: "Auto Inova",
            NEGOTIATION: "Financiamento",
            PHONE: "5199999999",
            LOCATION_CITY: "Ivoti",
            PLATE: "ABC1234",
            IMAGES: [{ IMAGE_URL: "https://example.com/civic.jpg" }],
            FEATURES: [{ FEATURE: "Ar condicionado" }, { FEATURE: "Direção elétrica" }],
            VIDEO: null,
            URL: "https://autoinova.com/civic",
          },
        ],
      },
    };

    (axios.get as any).mockResolvedValueOnce({ data: mockData });

    // Dynamic import to get the function after mocks are set
    const { fetchExternalStock } = await import("./stockSync");
    const vehicles = await fetchExternalStock();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].MAKE).toBe("Honda");
    expect(vehicles[0].MODEL).toBe("Civic");
    expect(vehicles[0].PRICE).toBe("120000");
    expect(vehicles[0].IMAGES).toHaveLength(1);
    expect(vehicles[0].FEATURES).toHaveLength(2);
  });

  it("throws error for invalid JSON structure", async () => {
    (axios.get as any).mockResolvedValueOnce({ data: { invalid: true } });

    const { fetchExternalStock } = await import("./stockSync");
    await expect(fetchExternalStock()).rejects.toThrow("Invalid stock JSON structure");
  });

  it("getStockSummaryForAI returns unavailable message when db is null", async () => {
    const { getStockSummaryForAI } = await import("./stockSync");
    const summary = await getStockSummaryForAI();
    expect(summary).toBe("Estoque indisponível no momento.");
  });

  it("searchVehiclesForAI returns unavailable message when db is null", async () => {
    const { searchVehiclesForAI } = await import("./stockSync");
    const result = await searchVehiclesForAI({ brand: "Honda" });
    expect(result).toBe("Estoque indisponível no momento.");
  });
});
