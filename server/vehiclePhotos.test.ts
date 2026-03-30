import { describe, it, expect, vi } from "vitest";
import { getVehicleById } from "./db";

// ─── Tests for getVehicleById (used by send_vehicle_photos node) ─────

describe("getVehicleById", () => {
  it("returns a vehicle with images array for a valid ID", async () => {
    // Vehicle ID 2 should exist from stock sync
    const vehicle = await getVehicleById(2);
    expect(vehicle).not.toBeNull();
    if (vehicle) {
      expect(vehicle).toHaveProperty("id", 2);
      expect(vehicle).toHaveProperty("brand");
      expect(vehicle).toHaveProperty("model");
      expect(vehicle).toHaveProperty("images");
      expect(vehicle).toHaveProperty("seller");
      // images should be an array of URLs
      if (vehicle.images) {
        expect(Array.isArray(vehicle.images)).toBe(true);
        const images = vehicle.images as string[];
        if (images.length > 0) {
          expect(typeof images[0]).toBe("string");
          expect(images[0]).toMatch(/^https?:\/\//);
        }
      }
    }
  });

  it("returns null for a non-existent vehicle ID", async () => {
    const vehicle = await getVehicleById(999999);
    expect(vehicle).toBeNull();
  });
});

// ─── Tests for photo slot logic (unit test) ─────────────────────────

describe("send_vehicle_photos slot logic", () => {
  it("correctly maps position to 0-based index", () => {
    const images = ["img1.jpg", "img2.jpg", "img3.jpg", "img4.jpg", "img5.jpg"];
    const photoSlots = [
      { position: 1, caption: "Vista frontal" },
      { position: 3, caption: "Interior" },
      { position: 5, caption: "Motor" },
    ];

    const results: Array<{ url: string; caption: string }> = [];
    for (const slot of photoSlots) {
      const imgIndex = slot.position - 1;
      if (imgIndex >= 0 && imgIndex < images.length) {
        results.push({ url: images[imgIndex], caption: slot.caption });
      }
    }

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ url: "img1.jpg", caption: "Vista frontal" });
    expect(results[1]).toEqual({ url: "img3.jpg", caption: "Interior" });
    expect(results[2]).toEqual({ url: "img5.jpg", caption: "Motor" });
  });

  it("skips slots that exceed available images", () => {
    const images = ["img1.jpg", "img2.jpg"];
    const photoSlots = [
      { position: 1, caption: "Foto 1" },
      { position: 5, caption: "Foto 5" }, // doesn't exist
      { position: 10, caption: "Foto 10" }, // doesn't exist
    ];

    const results: Array<{ url: string; caption: string }> = [];
    for (const slot of photoSlots) {
      const imgIndex = slot.position - 1;
      if (imgIndex >= 0 && imgIndex < images.length) {
        results.push({ url: images[imgIndex], caption: slot.caption });
      }
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ url: "img1.jpg", caption: "Foto 1" });
  });

  it("handles empty photo slots array", () => {
    const images = ["img1.jpg", "img2.jpg"];
    const photoSlots: Array<{ position: number; caption: string }> = [];

    const results: Array<{ url: string; caption: string }> = [];
    for (const slot of photoSlots) {
      const imgIndex = slot.position - 1;
      if (imgIndex >= 0 && imgIndex < images.length) {
        results.push({ url: images[imgIndex], caption: slot.caption });
      }
    }

    expect(results).toHaveLength(0);
  });

  it("replaces caption variables correctly", () => {
    const caption = "{{veiculo}} - {{marca}} {{modelo}} {{ano}} - {{preco}} ({{loja}})";
    const vehicle = {
      brand: "Honda",
      model: "HR-V",
      year: 2023,
      price: "125000",
      seller: "Auto Inova",
    };

    const replaced = caption
      .replace(/\{\{veiculo\}\}/gi, `${vehicle.brand} ${vehicle.model}`)
      .replace(/\{\{marca\}\}/gi, vehicle.brand)
      .replace(/\{\{modelo\}\}/gi, vehicle.model)
      .replace(/\{\{ano\}\}/gi, vehicle.year.toString())
      .replace(/\{\{preco\}\}/gi, `R$ ${Number(vehicle.price).toLocaleString("pt-BR")}`)
      .replace(/\{\{loja\}\}/gi, vehicle.seller);

    expect(replaced).toContain("Honda HR-V");
    expect(replaced).toContain("Honda");
    expect(replaced).toContain("HR-V");
    expect(replaced).toContain("2023");
    expect(replaced).toContain("R$");
    expect(replaced).toContain("Auto Inova");
  });

  it("handles missing vehicle data gracefully in captions", () => {
    const caption = "{{veiculo}} - {{preco}}";
    const vehicle = {
      brand: "Toyota",
      model: "Corolla",
      price: null as string | null,
    };

    const replaced = caption
      .replace(/\{\{veiculo\}\}/gi, `${vehicle.brand} ${vehicle.model}`)
      .replace(/\{\{preco\}\}/gi, vehicle.price ? `R$ ${Number(vehicle.price).toLocaleString("pt-BR")}` : "");

    expect(replaced).toBe("Toyota Corolla - ");
  });
});
