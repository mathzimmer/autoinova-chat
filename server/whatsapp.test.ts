import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock environment variables
const originalEnv = process.env;

describe("whatsapp module", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("isConfigured returns false when env vars are missing", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const { isConfigured } = await import("./whatsapp");
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured returns true when env vars are set", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test_token_123";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    const { isConfigured } = await import("./whatsapp");
    expect(isConfigured()).toBe(true);
  });

  it("getConfig returns correct values from env", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "my_access_token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "987654321";
    process.env.WHATSAPP_VERIFY_TOKEN = "my_verify_token";
    const { getConfig } = await import("./whatsapp");
    const config = getConfig();
    expect(config.accessToken).toBe("my_access_token");
    expect(config.phoneNumberId).toBe("987654321");
    expect(config.verifyToken).toBe("my_verify_token");
  });

  it("getConfig uses default verify token when not set", async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const { getConfig } = await import("./whatsapp");
    const config = getConfig();
    expect(config.verifyToken).toBe("autoinova_verify_token");
  });

  it("sendTextMessage returns error when not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const { sendTextMessage } = await import("./whatsapp");
    const result = await sendTextMessage("5511999999999", "Olá!");
    expect(result.success).toBe(false);
    expect(result.error).toBe("WhatsApp API not configured");
  });

  it("markAsRead returns false when not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const { markAsRead } = await import("./whatsapp");
    const result = await markAsRead("wamid.test123");
    expect(result).toBe(false);
  });

  it("getMediaUrl returns null when not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const { getMediaUrl } = await import("./whatsapp");
    const result = await getMediaUrl("media_id_123");
    expect(result).toBeNull();
  });
});
