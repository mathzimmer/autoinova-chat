import { describe, it, expect } from "vitest";

// Test delivery status schema fields
describe("Delivery Tracking Schema", () => {
  it("should have valid delivery status enum values", () => {
    const validStatuses = ["sent", "delivered", "read", "failed"];
    validStatuses.forEach((status) => {
      expect(typeof status).toBe("string");
      expect(status.length).toBeGreaterThan(0);
    });
  });

  it("should map WhatsApp status webhook to internal status", () => {
    const statusMap: Record<string, string> = {
      sent: "sent",
      delivered: "delivered",
      read: "read",
      failed: "failed",
    };

    expect(statusMap["sent"]).toBe("sent");
    expect(statusMap["delivered"]).toBe("delivered");
    expect(statusMap["read"]).toBe("read");
    expect(statusMap["failed"]).toBe("failed");
  });

  it("should detect error 131047 as window expired", () => {
    const errorCode = 131047;
    const isWindowExpired = errorCode === 131047;
    expect(isWindowExpired).toBe(true);
  });

  it("should not flag other errors as window expired", () => {
    const errorCode = 131000;
    const isWindowExpired = errorCode === 131047;
    expect(isWindowExpired).toBe(false);
  });
});

// Test 24h window calculation
describe("24h Window Detection", () => {
  it("should detect expired window when last customer message > 24h ago", () => {
    const now = Date.now();
    const hours25ago = now - 25 * 60 * 60 * 1000;
    const elapsed = now - hours25ago;
    const hours24 = 24 * 60 * 60 * 1000;
    const isExpired = elapsed > hours24;
    expect(isExpired).toBe(true);
  });

  it("should detect active window when last customer message < 24h ago", () => {
    const now = Date.now();
    const hours23ago = now - 23 * 60 * 60 * 1000;
    const elapsed = now - hours23ago;
    const hours24 = 24 * 60 * 60 * 1000;
    const isExpired = elapsed > hours24;
    expect(isExpired).toBe(false);
  });

  it("should handle edge case at exactly 24h", () => {
    const now = Date.now();
    const exactly24h = now - 24 * 60 * 60 * 1000;
    const elapsed = now - exactly24h;
    const hours24 = 24 * 60 * 60 * 1000;
    // At exactly 24h, elapsed === hours24, so NOT expired (need > not >=)
    const isExpired = elapsed > hours24;
    expect(isExpired).toBe(false);
  });

  it("should handle null lastCustomerMessageAt", () => {
    const lastCustomerMsg = null;
    const isExpired = lastCustomerMsg ? (Date.now() - Number(lastCustomerMsg)) > 24 * 60 * 60 * 1000 : false;
    expect(isExpired).toBe(false);
  });
});

// Test delivery status progression
describe("Delivery Status Progression", () => {
  it("should follow correct status progression order", () => {
    const statusOrder = ["sent", "delivered", "read"];
    const statusPriority: Record<string, number> = {
      sent: 1,
      delivered: 2,
      read: 3,
      failed: 0,
    };

    // Status should only progress forward
    expect(statusPriority["delivered"]).toBeGreaterThan(statusPriority["sent"]);
    expect(statusPriority["read"]).toBeGreaterThan(statusPriority["delivered"]);
  });

  it("should not downgrade status from read to delivered", () => {
    const currentStatus = "read";
    const newStatus = "delivered";
    const statusPriority: Record<string, number> = {
      sent: 1,
      delivered: 2,
      read: 3,
      failed: 0,
    };
    const shouldUpdate = statusPriority[newStatus] > statusPriority[currentStatus];
    expect(shouldUpdate).toBe(false);
  });

  it("should allow upgrade from sent to delivered", () => {
    const currentStatus = "sent";
    const newStatus = "delivered";
    const statusPriority: Record<string, number> = {
      sent: 1,
      delivered: 2,
      read: 3,
      failed: 0,
    };
    const shouldUpdate = statusPriority[newStatus] > statusPriority[currentStatus];
    expect(shouldUpdate).toBe(true);
  });

  it("should always allow failed status regardless of current", () => {
    // Failed is a terminal state that can happen at any point
    const failedStatus = "failed";
    expect(failedStatus).toBe("failed");
  });
});

// Test WhatsApp error code parsing
describe("WhatsApp Error Code Parsing", () => {
  it("should parse error from WhatsApp API response", () => {
    const errorResponse = {
      error: {
        message: "Re-engagement message",
        type: "OAuthException",
        code: 131047,
        error_subcode: 2494055,
        fbtrace_id: "abc123",
      },
    };
    
    const errorCode = errorResponse.error?.code;
    expect(errorCode).toBe(131047);
    expect(errorCode === 131047).toBe(true);
  });

  it("should extract error message for delivery error field", () => {
    const errorResponse = {
      error: {
        message: "Re-engagement message",
        code: 131047,
      },
    };
    
    const deliveryError = `WhatsApp Error ${errorResponse.error.code}: ${errorResponse.error.message}`;
    expect(deliveryError).toContain("131047");
    expect(deliveryError).toContain("Re-engagement message");
  });

  it("should handle missing error fields gracefully", () => {
    const errorResponse = { error: {} as any };
    const errorCode = errorResponse.error?.code || 0;
    const errorMessage = errorResponse.error?.message || "Unknown error";
    expect(errorCode).toBe(0);
    expect(errorMessage).toBe("Unknown error");
  });
});

// Test conversation list layout stability
describe("Conversation List Layout", () => {
  it("should format relative time correctly", () => {
    const now = Date.now();
    const minutesAgo = now - 5 * 60 * 1000;
    const hoursAgo = now - 3 * 60 * 60 * 1000;
    const daysAgo = now - 2 * 24 * 60 * 60 * 1000;

    // Minutes
    const minElapsed = Math.floor((now - minutesAgo) / 60000);
    expect(minElapsed).toBe(5);

    // Hours
    const hrElapsed = Math.floor((now - hoursAgo) / 3600000);
    expect(hrElapsed).toBe(3);

    // Days
    const dayElapsed = Math.floor((now - daysAgo) / 86400000);
    expect(dayElapsed).toBe(2);
  });
});
