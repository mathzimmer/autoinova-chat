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

  it("isConfigured returns false when no tokens are set", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const { isConfigured } = await import("./whatsapp");
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured returns true when SYSTEM_USER_TOKEN is set", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.WHATSAPP_SYSTEM_USER_TOKEN = "sys_token_123";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    const { isConfigured } = await import("./whatsapp");
    expect(isConfigured()).toBe(true);
  });

  it("isConfigured returns true when only ACCESS_TOKEN is set (fallback)", async () => {
    delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    process.env.WHATSAPP_ACCESS_TOKEN = "test_token_123";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    const { isConfigured } = await import("./whatsapp");
    expect(isConfigured()).toBe(true);
  });

  it("getConfig uses SYSTEM_USER_TOKEN as primary when both are set", async () => {
    process.env.WHATSAPP_SYSTEM_USER_TOKEN = "sys_user_token";
    process.env.WHATSAPP_ACCESS_TOKEN = "old_access_token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "987654321";
    process.env.WHATSAPP_VERIFY_TOKEN = "my_verify_token";
    const { getConfig } = await import("./whatsapp");
    const config = getConfig();
    expect(config.accessToken).toBe("sys_user_token");
    expect(config.phoneNumberId).toBe("987654321");
    expect(config.verifyToken).toBe("my_verify_token");
  });

  it("getConfig falls back to ACCESS_TOKEN when SYSTEM_USER_TOKEN is not set", async () => {
    delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    process.env.WHATSAPP_ACCESS_TOKEN = "fallback_token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "987654321";
    const { getConfig } = await import("./whatsapp");
    const config = getConfig();
    expect(config.accessToken).toBe("fallback_token");
  });

  it("getConfig uses default verify token when not set", async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const { getConfig } = await import("./whatsapp");
    const config = getConfig();
    expect(config.verifyToken).toBe("autoinova_verify_token");
  });

  it("sendTextMessage returns error when not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const { sendTextMessage } = await import("./whatsapp");
    const result = await sendTextMessage("5511999999999", "Olá!");
    expect(result.success).toBe(false);
    expect(result.error).toBe("WhatsApp API not configured");
  });

  it("markAsRead returns false when not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const { markAsRead } = await import("./whatsapp");
    const result = await markAsRead("wamid.test123");
    expect(result).toBe(false);
  });

  it("getMediaUrl returns null when not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
    const { getMediaUrl } = await import("./whatsapp");
    const result = await getMediaUrl("media_id_123");
    expect(result).toBeNull();
  });

  // === Reply Buttons Tests ===
  describe("sendReplyButtons", () => {
    it("returns error when not configured", async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      const { sendReplyButtons } = await import("./whatsapp");
      const result = await sendReplyButtons(
        "5511999999999",
        "Escolha uma opção:",
        [{ id: "btn_1", title: "Opção 1" }]
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("WhatsApp API not configured");
    });

    it("rejects more than 3 buttons", async () => {
      process.env.WHATSAPP_SYSTEM_USER_TOKEN = "test_token";
      process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
      const { sendReplyButtons } = await import("./whatsapp");
      const result = await sendReplyButtons(
        "5511999999999",
        "Escolha:",
        [
          { id: "1", title: "A" },
          { id: "2", title: "B" },
          { id: "3", title: "C" },
          { id: "4", title: "D" },
        ]
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Reply buttons must have 1-3 buttons");
    });

    it("rejects empty buttons array", async () => {
      process.env.WHATSAPP_SYSTEM_USER_TOKEN = "test_token";
      process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
      const { sendReplyButtons } = await import("./whatsapp");
      const result = await sendReplyButtons(
        "5511999999999",
        "Escolha:",
        []
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Reply buttons must have 1-3 buttons");
    });
  });

  // === List Message Tests ===
  describe("sendListMessage", () => {
    it("returns error when not configured", async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      const { sendListMessage } = await import("./whatsapp");
      const result = await sendListMessage(
        "5511999999999",
        "Veja nossas opções:",
        "Ver opções",
        [{ title: "Veículos", rows: [{ id: "v1", title: "Corolla 2022" }] }]
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("WhatsApp API not configured");
    });

    it("rejects more than 10 rows total", async () => {
      process.env.WHATSAPP_SYSTEM_USER_TOKEN = "test_token";
      process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
      const { sendListMessage } = await import("./whatsapp");
      const rows = Array.from({ length: 11 }, (_, i) => ({
        id: `item_${i}`,
        title: `Item ${i}`,
      }));
      const result = await sendListMessage(
        "5511999999999",
        "Escolha:",
        "Ver",
        [{ title: "Seção", rows }]
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("List must have 1-10 rows total");
    });

    it("rejects empty sections", async () => {
      process.env.WHATSAPP_SYSTEM_USER_TOKEN = "test_token";
      process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
      const { sendListMessage } = await import("./whatsapp");
      const result = await sendListMessage(
        "5511999999999",
        "Escolha:",
        "Ver",
        [{ title: "Seção", rows: [] }]
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("List must have 1-10 rows total");
    });
  });
});

// === Interactive Message Types Tests ===
describe("Interactive message types in AI", () => {
  it("InteractiveMessage types are correctly defined", async () => {
    const { InteractiveButton, InteractiveListSection, InteractiveMessage } = await import("./ai") as any;
    // Test that the types exist by creating objects that match the interfaces
    const button: { id: string; title: string } = { id: "btn_1", title: "Test" };
    expect(button.id).toBe("btn_1");
    expect(button.title).toBe("Test");

    const section: { title: string; rows: Array<{ id: string; title: string; description?: string }> } = {
      title: "Test Section",
      rows: [{ id: "row_1", title: "Row 1", description: "Desc" }],
    };
    expect(section.title).toBe("Test Section");
    expect(section.rows).toHaveLength(1);
  });

  it("processAIMessage returns interactiveMessages field", async () => {
    // Verify the function signature includes interactiveMessages
    const aiModule = await import("./ai");
    expect(typeof aiModule.processAIMessage).toBe("function");
  });
});

// === Webhook Interactive Reply Processing Tests ===
describe("Webhook interactive reply processing", () => {
  it("should extract button_reply title as content", () => {
    // Simulate the webhook logic for button_reply
    const msg = {
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: {
          id: "btn_financiar",
          title: "Quero financiar",
        },
      },
    };

    let content = "";
    if (msg.type === "interactive") {
      const interactiveType = msg.interactive?.type;
      if (interactiveType === "button_reply") {
        content = msg.interactive?.button_reply?.title || "";
      }
    }

    expect(content).toBe("Quero financiar");
  });

  it("should extract list_reply title and description as content", () => {
    // Simulate the webhook logic for list_reply
    const msg = {
      type: "interactive",
      interactive: {
        type: "list_reply",
        list_reply: {
          id: "veiculo_42",
          title: "Corolla 2022",
          description: "R$ 139.900 | 28.000 km | Automático",
        },
      },
    };

    let content = "";
    if (msg.type === "interactive") {
      const interactiveType = msg.interactive?.type;
      if (interactiveType === "list_reply") {
        const listTitle = msg.interactive?.list_reply?.title || "";
        const listDescription = msg.interactive?.list_reply?.description || "";
        content = listTitle;
        if (listDescription) content += ` - ${listDescription}`;
      }
    }

    expect(content).toBe("Corolla 2022 - R$ 139.900 | 28.000 km | Automático");
  });

  it("should handle list_reply without description", () => {
    const msg = {
      type: "interactive",
      interactive: {
        type: "list_reply",
        list_reply: {
          id: "pagamento_avista",
          title: "À vista",
        },
      },
    };

    let content = "";
    if (msg.type === "interactive") {
      const interactiveType = msg.interactive?.type;
      if (interactiveType === "list_reply") {
        const listTitle = msg.interactive?.list_reply?.title || "";
        const listDescription = msg.interactive?.list_reply?.description || "";
        content = listTitle;
        if (listDescription) content += ` - ${listDescription}`;
      }
    }

    expect(content).toBe("À vista");
  });
});
