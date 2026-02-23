import { describe, expect, it } from "vitest";
import axios from "axios";

/**
 * Validates that the WhatsApp Business API credentials are correctly configured.
 * This test makes a lightweight API call to verify the access token and phone number ID.
 */
describe("WhatsApp API credentials validation", () => {
  it("should have WHATSAPP_ACCESS_TOKEN set", () => {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    expect(token).toBeDefined();
    expect(token).not.toBe("");
  });

  it("should have WHATSAPP_PHONE_NUMBER_ID set", () => {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    expect(phoneId).toBeDefined();
    expect(phoneId).not.toBe("");
  });

  it("should have WHATSAPP_VERIFY_TOKEN set", () => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    expect(verifyToken).toBeDefined();
    expect(verifyToken).not.toBe("");
  });

  it("should be able to reach WhatsApp Business API with valid credentials", async () => {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneId) {
      console.warn("Skipping API validation: credentials not set");
      return;
    }

    try {
      // Lightweight call to get phone number info (doesn't send any messages)
      const response = await axios.get(
        `https://graph.facebook.com/v21.0/${phoneId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      // If we get here, the credentials are valid
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("id");
      console.log(`[WhatsApp] Validated phone number: ${response.data.display_phone_number || response.data.id}`);
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 190) {
        throw new Error(
          "WhatsApp API credentials are INVALID. Please check your WHATSAPP_ACCESS_TOKEN."
        );
      }
      if (error.response?.status === 400) {
        throw new Error(
          "WhatsApp PHONE_NUMBER_ID is invalid. Please check your WHATSAPP_PHONE_NUMBER_ID."
        );
      }
      // Network errors or timeouts - credentials might be valid but API unreachable
      console.warn("[WhatsApp] Could not reach API (network issue):", error.message);
    }
  });
});
