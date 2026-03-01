import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock axios before importing the module
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock notification
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import axios from "axios";
import { notifyOwner } from "./_core/notification";

// We need to test the functions directly, so we import after mocks
import { runTokenHealthCheck, getLastCheckResults, startTokenMonitor, stopTokenMonitor } from "./tokenMonitor";

describe("Token Health Monitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up env vars for testing
    process.env.WHATSAPP_SYSTEM_USER_TOKEN = "test-whatsapp-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    process.env.META_ADS_ACCESS_TOKEN = "test-meta-token";
  });

  afterEach(() => {
    stopTokenMonitor();
    delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.META_ADS_ACCESS_TOKEN;
  });

  it("should return OK status when all tokens are valid", async () => {
    const mockedGet = vi.mocked(axios.get);
    
    // WhatsApp check succeeds
    mockedGet.mockResolvedValueOnce({
      data: { display_phone_number: "+5551999999999", quality_rating: "GREEN" },
    });
    
    // Meta Ads check succeeds
    mockedGet.mockResolvedValueOnce({
      data: { name: "Test Account" },
    });

    const results = await runTokenHealthCheck();

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("WhatsApp Business API");
    expect(results[0].status).toBe("ok");
    expect(results[1].name).toBe("Meta Ads (Marketing API)");
    expect(results[1].status).toBe("ok");

    // Should NOT notify owner when all OK
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("should detect failed WhatsApp token and notify owner", async () => {
    const mockedGet = vi.mocked(axios.get);
    
    // WhatsApp check fails with 401
    mockedGet.mockRejectedValueOnce({
      response: {
        status: 401,
        data: { error: { code: 190, message: "Invalid OAuth access token" } },
      },
    });
    
    // Meta Ads check succeeds
    mockedGet.mockResolvedValueOnce({
      data: { name: "Test Account" },
    });

    const results = await runTokenHealthCheck();

    expect(results[0].status).toBe("failed");
    expect(results[0].message).toContain("Token expirado ou inválido");
    expect(results[1].status).toBe("ok");

    // Should notify owner about the failure
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("1 token(s) com problema"),
      })
    );
  });

  it("should detect failed Meta Ads token and notify owner", async () => {
    const mockedGet = vi.mocked(axios.get);
    
    // WhatsApp check succeeds
    mockedGet.mockResolvedValueOnce({
      data: { display_phone_number: "+5551999999999", quality_rating: "GREEN" },
    });
    
    // Meta Ads check fails
    mockedGet.mockRejectedValueOnce({
      response: {
        status: 401,
        data: { error: { code: 190, message: "Token expired" } },
      },
    });

    const results = await runTokenHealthCheck();

    expect(results[0].status).toBe("ok");
    expect(results[1].status).toBe("failed");
    expect(notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("should return not_configured when tokens are missing", async () => {
    delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.META_ADS_ACCESS_TOKEN;
    // Also clear fallback
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    const results = await runTokenHealthCheck();

    expect(results[0].status).toBe("not_configured");
    expect(results[1].status).toBe("not_configured");
    // Should NOT notify for not_configured (only for failed)
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("should store results accessible via getLastCheckResults", async () => {
    const mockedGet = vi.mocked(axios.get);
    mockedGet.mockResolvedValueOnce({ data: { display_phone_number: "+55", quality_rating: "GREEN" } });
    mockedGet.mockResolvedValueOnce({ data: { name: "Test" } });

    await runTokenHealthCheck();
    const cached = getLastCheckResults();

    expect(cached).toHaveLength(2);
    expect(cached[0].lastCheckedAt).toBeGreaterThan(0);
  });

  it("should detect both tokens failed and notify with count 2", async () => {
    const mockedGet = vi.mocked(axios.get);
    
    mockedGet.mockRejectedValueOnce({
      response: { status: 401, data: { error: { code: 190, message: "Invalid" } } },
    });
    mockedGet.mockRejectedValueOnce({
      response: { status: 401, data: { error: { code: 190, message: "Expired" } } },
    });

    const results = await runTokenHealthCheck();

    expect(results[0].status).toBe("failed");
    expect(results[1].status).toBe("failed");
    expect(notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("2 token(s) com problema"),
      })
    );
  });
});
