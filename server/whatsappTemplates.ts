/**
 * WhatsApp Message Templates API — AutoInova Chat
 *
 * Handles sending pre-approved message templates via WhatsApp Business API.
 * Templates are required for messages sent outside the 24-hour customer service window.
 *
 * Templates must be created and approved in the Meta Business Manager before use.
 */

import axios from "axios";
import { getConfig } from "./whatsapp";

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

export type TemplateComponent = {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url";
  index?: string;
  parameters?: Array<{
    type: "text" | "image" | "document" | "video";
    text?: string;
    image?: { link: string };
  }>;
};

export type WhatsAppTemplate = {
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
};

/**
 * List all message templates for the WhatsApp Business Account
 */
export async function listTemplates(): Promise<WhatsAppTemplate[]> {
  const { accessToken } = getConfig();
  const wabaid = process.env.META_ADS_ACCOUNT_ID; // WABA ID

  if (!accessToken || !wabaid) {
    console.warn("[WhatsAppTemplates] Not configured.");
    return [];
  }

  try {
    // Try using WHATSAPP_BUSINESS_ACCOUNT_ID first, fall back to phone number ID
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) return [];

    // Get WABA ID from phone number
    const phoneRes = await axios.get(
      `${WHATSAPP_API_URL}/${phoneNumberId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: "id,display_phone_number,verified_name" },
      }
    );

    // List templates using the phone number's WABA
    // We need to get the WABA ID first
    const wabaRes = await axios.get(
      `${WHATSAPP_API_URL}/${phoneNumberId}/whatsapp_business_profile`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    // Alternative: try direct template listing via business account
    // The WABA ID is typically available via META_ADS_ACCOUNT_ID or a separate env var
    const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.META_ADS_PAGE_ID;
    if (!businessAccountId) {
      console.warn("[WhatsAppTemplates] No WABA ID available for template listing.");
      return [];
    }

    const response = await axios.get(
      `${WHATSAPP_API_URL}/${businessAccountId}/message_templates`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 100 },
      }
    );

    const templates = (response.data?.data || []) as WhatsAppTemplate[];
    console.log(`[WhatsAppTemplates] Found ${templates.length} templates`);
    return templates;
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error("[WhatsAppTemplates] Failed to list templates:", errMsg);
    return [];
  }
}

/**
 * Send a message using an approved WhatsApp template
 * This is required for messages sent outside the 24-hour customer service window.
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  bodyParams: string[] = [],
  language: string = "pt_BR",
  headerParams?: string[],
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsAppTemplates] Not configured.");
    return { success: false, error: "WhatsApp API not configured" };
  }

  try {
    const components: TemplateComponent[] = [];

    // Add header parameters if provided
    if (headerParams && headerParams.length > 0) {
      components.push({
        type: "header",
        parameters: headerParams.map(text => ({ type: "text" as const, text })),
      });
    }

    // Add body parameters
    if (bodyParams.length > 0) {
      components.push({
        type: "body",
        parameters: bodyParams.map(text => ({ type: "text" as const, text })),
      });
    }

    const payload: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    console.log(`[WhatsAppTemplates] Template "${templateName}" sent to ${to}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsAppTemplates] Failed to send template to ${to}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Check if a specific template exists and is approved
 */
export async function isTemplateApproved(templateName: string): Promise<boolean> {
  const templates = await listTemplates();
  return templates.some(t => t.name === templateName && t.status === "APPROVED");
}
