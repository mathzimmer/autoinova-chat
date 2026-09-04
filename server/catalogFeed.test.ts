import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRows = vi.fn();
vi.mock("./stockSync", () => ({
  getAllCuratedVehicles: () => mockRows(),
}));

import { buildFacebookVehiclesCsv } from "./catalogFeed";

function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const out: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQ) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); out.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); out.push(row); }
  const headers = out.shift()!;
  return { headers, rows: out };
}

describe("buildFacebookVehiclesCsv", () => {
  beforeEach(() => mockRows.mockReset());

  it("gera cabeçalho com campos Vehicles da Meta e 10 colunas de imagem", async () => {
    mockRows.mockResolvedValue([]);
    const csv = await buildFacebookVehiclesCsv();
    const { headers } = parseCsv(csv);
    expect(headers).toContain("vehicle_id");
    expect(headers).toContain("state_of_vehicle");
    expect(headers).toContain("mileage.value");
    expect(headers).toContain("address");
    expect(headers).toContain("image[0].url");
    expect(headers).toContain("image[9].url");
  });

  it("mapeia um veículo com várias fotos e enums corretos", async () => {
    mockRows.mockResolvedValue([{
      id: 12, externalId: 555,
      brand: "Toyota", model: "Corolla", version: "XEI 2.0",
      title: "Toyota Corolla XEI", year: 2020, mileage: 45000,
      price: 118900, promotionPrice: null,
      color: "Prata", fuel: "Flex", transmission: "Automático",
      category: "Sedan", condition: "usado", url: "https://x/c/555",
      images: ["https://img/1.jpg", "https://img/2.jpg", "https://img/3.jpg"],
    }]);
    const csv = await buildFacebookVehiclesCsv();
    const { headers, rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
    const r = Object.fromEntries(headers.map((h, i) => [h, rows[0][i]]));
    expect(r["vehicle_id"]).toBe("555");
    expect(r["make"]).toBe("Toyota");
    expect(r["price"]).toBe("118900 BRL");
    expect(r["mileage.value"]).toBe("45000");
    expect(r["mileage.unit"]).toBe("KM");
    expect(r["state_of_vehicle"]).toBe("USED");
    expect(r["fuel_type"]).toBe("FLEX");
    expect(r["transmission"]).toBe("AUTOMATIC");
    expect(r["body_style"]).toBe("SEDAN");
    expect(r["image[0].url"]).toBe("https://img/1.jpg");
    expect(r["image[2].url"]).toBe("https://img/3.jpg");
    expect(r["image[3].url"]).toBe("");
    // address é JSON válido
    expect(() => JSON.parse(r["address"])).not.toThrow();
    expect(JSON.parse(r["address"]).country).toBe("BR");
  });

  it("usa promotionPrice quando existe e pula veículo sem foto", async () => {
    mockRows.mockResolvedValue([
      { id: 1, brand: "VW", model: "Gol", year: 2018, price: 50000, promotionPrice: 47900, images: ["https://img/a.jpg"] },
      { id: 2, brand: "Fiat", model: "Uno", year: 2015, price: 30000, images: [] },
    ]);
    const csv = await buildFacebookVehiclesCsv();
    const { headers, rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
    const r = Object.fromEntries(headers.map((h, i) => [h, rows[0][i]]));
    expect(r["price"]).toBe("47900 BRL");
  });
});
