import { describe, it, expect } from "vitest";
import { normalizePhone, phoneVariations, isSamePhone } from "./phoneNormalize";

describe("phoneNormalize", () => {
  describe("normalizePhone", () => {
    it("should return empty string for empty input", () => {
      expect(normalizePhone("")).toBe("");
      expect(normalizePhone(undefined as any)).toBe("");
    });

    it("should normalize phone with country code and 9th digit", () => {
      expect(normalizePhone("5551992281203")).toBe("5551992281203");
    });

    it("should normalize phone with + prefix", () => {
      expect(normalizePhone("+5551992281203")).toBe("5551992281203");
    });

    it("should normalize formatted phone with country code", () => {
      expect(normalizePhone("+55 (51) 99228-1203")).toBe("5551992281203");
    });

    it("should add 9th digit to mobile number missing it", () => {
      // 555192281203 = 55 + 51 + 92281203 (8 digits, starts with 9)
      // Should become 55 + 51 + 9 + 92281203 = 5551992281203
      expect(normalizePhone("555192281203")).toBe("5551992281203");
    });

    it("should add country code to 11-digit number", () => {
      expect(normalizePhone("51992281203")).toBe("5551992281203");
    });

    it("should add country code and 9th digit to 10-digit number", () => {
      // 5192281203 = 51 + 92281203 (10 digits)
      // → 55 + 5192281203 = 555192281203 (12 digits)
      // → starts with 9, so add 9th digit: 5551992281203
      expect(normalizePhone("5192281203")).toBe("5551992281203");
    });

    it("should handle formatted number without country code", () => {
      expect(normalizePhone("(51) 9228-1203")).toBe("5551992281203");
    });

    it("should handle formatted number with 9th digit without country code", () => {
      expect(normalizePhone("(51) 99228-1203")).toBe("5551992281203");
    });

    it("should not add 9th digit to landline numbers", () => {
      // Landline: 55 + 51 + 33191908 (starts with 3, not mobile)
      expect(normalizePhone("555133191908")).toBe("555133191908");
    });

    it("should handle the Thomas case: with and without 9", () => {
      const withoutNine = normalizePhone("+55 (51) 9228-1203");
      const withNine = normalizePhone("+55 (51) 99228-1203");
      expect(withoutNine).toBe(withNine);
      expect(withoutNine).toBe("5551992281203");
    });
  });

  describe("phoneVariations", () => {
    it("should generate variations for a 13-digit number", () => {
      const variations = phoneVariations("5551992281203");
      expect(variations).toContain("5551992281203");
      expect(variations).toContain("555192281203"); // without 9th digit
    });

    it("should generate variations for a 12-digit mobile number", () => {
      const variations = phoneVariations("555192281203");
      expect(variations).toContain("5551992281203"); // with 9th digit
      expect(variations).toContain("555192281203");
    });

    it("should include original stripped version", () => {
      const variations = phoneVariations("+55 (51) 99228-1203");
      expect(variations).toContain("5551992281203");
    });
  });

  describe("isSamePhone", () => {
    it("should detect same phone with different formatting", () => {
      expect(isSamePhone("+55 (51) 9228-1203", "+55 (51) 99228-1203")).toBe(true);
    });

    it("should detect same phone with/without country code", () => {
      expect(isSamePhone("51992281203", "5551992281203")).toBe(true);
    });

    it("should return false for different phones", () => {
      expect(isSamePhone("5551992281203", "5551999887766")).toBe(false);
    });

    it("should return false for empty inputs", () => {
      expect(isSamePhone("", "5551992281203")).toBe(false);
      expect(isSamePhone("5551992281203", "")).toBe(false);
    });

    it("should handle the exact Thomas case", () => {
      // Thomas +55 (51) 9228-1203 vs Thomas Boll +55 (51) 99228-1203
      expect(isSamePhone("5551922812O3", "55519922812O3")).toBe(false); // O is letter, not 0
      expect(isSamePhone("555192281203", "5551992281203")).toBe(true);
    });
  });
});
