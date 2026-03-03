import { describe, it, expect, vi } from "vitest";
import { isInstagramConfigured, isFacebookConfigured } from "./instagramFacebook";

describe("Instagram/Facebook Messaging Service", () => {
  describe("Configuration checks", () => {
    it("isInstagramConfigured should return boolean based on env vars", () => {
      const result = isInstagramConfigured();
      expect(typeof result).toBe("boolean");
    });

    it("isFacebookConfigured should return boolean based on env vars", () => {
      const result = isFacebookConfigured();
      expect(typeof result).toBe("boolean");
    });

    it("should check META_ADS_ACCESS_TOKEN and META_ADS_INSTAGRAM_ID for Instagram", () => {
      // If both env vars are set, isInstagramConfigured should return true
      const hasToken = !!process.env.META_ADS_ACCESS_TOKEN;
      const hasInstagramId = !!process.env.META_ADS_INSTAGRAM_ID;
      const expected = hasToken && hasInstagramId;
      expect(isInstagramConfigured()).toBe(expected);
    });

    it("should check META_ADS_ACCESS_TOKEN and META_ADS_PAGE_ID for Facebook", () => {
      const hasToken = !!process.env.META_ADS_ACCESS_TOKEN;
      const hasPageId = !!process.env.META_ADS_PAGE_ID;
      const expected = hasToken && hasPageId;
      expect(isFacebookConfigured()).toBe(expected);
    });
  });

  describe("Module exports", () => {
    it("should export sendPlatformMessage function", async () => {
      const mod = await import("./instagramFacebook");
      expect(typeof mod.sendPlatformMessage).toBe("function");
    });

    it("should export sendPlatformImage function", async () => {
      const mod = await import("./instagramFacebook");
      expect(typeof mod.sendPlatformImage).toBe("function");
    });

    it("should export getPlatformUserProfile function", async () => {
      const mod = await import("./instagramFacebook");
      expect(typeof mod.getPlatformUserProfile).toBe("function");
    });
  });
});
