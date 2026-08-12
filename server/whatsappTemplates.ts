/**
 * WhatsApp Message Templates API — AutoInova Chat
 *
 * Handles listing and sending pre-approved message templates via WhatsApp Business API.
 * Templates are required for messages sent outside the 24-hour customer service window.
 *
 * Uses WHATSAPP_SYSTEM_USER_TOKEN (with whatsapp_business_management permission)
 * and WHATSAPP_BUSINESS_ACCOUNT_ID (WABA ID) to access templates.
 */

import axios from "axios";

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
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    example?: { body_text?: string[][] };
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
};

function getTemplateConfig() {
  const systemUserToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN;
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  return { systemUserToken, wabaId, phoneNumberId };
}

/**
 * Check if WhatsApp Templates are properly configured
 */
export function isTemplatesConfigured(): { configured: boolean; missingVars: string[] } {
  const { systemUserToken, wabaId } = getTemplateConfig();
  const missingVars: string[] = [];

  if (!systemUserToken) missingVars.push("WHATSAPP_SYSTEM_USER_TOKEN");
  if (!wabaId) missingVars.push("WHATSAPP_BUSINESS_ACCOUNT_ID");

  return { configured: missingVars.length === 0, missingVars };
}

/**
 * Resolve as credenciais de MODELOS (WABA + token + phoneNumberId) de uma
 * INSTÂNCIA. Se o phoneNumberId for de um número registrado, usa a WABA e o
 * token DAQUELE número (independência por instância). Caso contrário, cai no
 * padrão do .env (o antigo "Matriz"). Aceita "official:<id>" ou o id cru.
 */
export async function resolveTemplateCreds(phoneNumberId?: string | null): Promise<{
  wabaId?: string; token?: string; phoneNumberId?: string; source: "instancia" | "matriz";
}> {
  const env = getTemplateConfig();
  const raw = phoneNumberId && phoneNumberId !== "matriz" ? phoneNumberId : undefined;
  const pid = raw ? (raw.startsWith("official:") ? raw.slice("official:".length) : raw) : undefined;
  if (pid) {
    try {
      const { getWhatsappNumberByPhoneNumberId } = await import("./whatsappMultiNumber");
      const rec = await getWhatsappNumberByPhoneNumberId(pid);
      if (rec?.wabaId) {
        return {
          wabaId: rec.wabaId,
          token: rec.accessToken || env.systemUserToken || undefined,
          phoneNumberId: pid,
          source: "instancia",
        };
      }
    } catch (e) {
      console.error("[WhatsAppTemplates] resolveTemplateCreds falhou, usando .env:", e);
    }
  }
  return { wabaId: env.wabaId, token: env.systemUserToken, phoneNumberId: env.phoneNumberId, source: "matriz" };
}

/**
 * List all message templates for a WhatsApp Business Account.
 * Sem `opts`, usa a WABA/token padrão do .env; com `opts`, usa os da instância.
 */
export async function listTemplates(opts?: { wabaId?: string | null; token?: string | null }): Promise<WhatsAppTemplate[]> {
  const wabaId = opts?.wabaId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const systemUserToken = opts?.token ?? process.env.WHATSAPP_SYSTEM_USER_TOKEN;

  if (!systemUserToken || !wabaId) {
    console.warn("[WhatsAppTemplates] Sem credenciais (WABA + token) para listar modelos.");
    return [];
  }

  try {
    const allTemplates: WhatsAppTemplate[] = [];
    let url: string | null = `${WHATSAPP_API_URL}/${wabaId}/message_templates`;
    let params: Record<string, any> = { limit: 100 };

    // Paginate through all templates
    while (url) {
      const response: any = await axios.get(url, {
        headers: { Authorization: `Bearer ${systemUserToken}` },
        params,
      });

      const templates = (response.data?.data || []) as WhatsAppTemplate[];
      allTemplates.push(...templates);

      // Check for next page
      url = response.data?.paging?.next || null;
      params = {}; // Next page URL already includes params
    }

    console.log(`[WhatsAppTemplates] Found ${allTemplates.length} templates from WABA ${wabaId}`);
    return allTemplates;
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    const errCode = error?.response?.data?.error?.code;
    console.error(`[WhatsAppTemplates] Failed to list templates (code: ${errCode}):`, errMsg);
    return [];
  }
}

/**
 * Send a message using an approved WhatsApp template.
 * This is required for messages sent outside the 24-hour customer service window.
 *
 * Uses the System User Token for sending (it has whatsapp_business_messaging permission).
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  bodyParams: string[] = [],
  language: string = "pt_BR",
  headerParams?: string[],
  opts?: { phoneNumberId?: string | null; token?: string | null },
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const phoneNumberId = opts?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const systemUserToken = opts?.token ?? process.env.WHATSAPP_SYSTEM_USER_TOKEN;

  if (!systemUserToken || !phoneNumberId) {
    console.warn("[WhatsAppTemplates] Sem credenciais para enviar modelo.");
    return { success: false, error: "WhatsApp Templates API sem credenciais (número + token)" };
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
          Authorization: `Bearer ${systemUserToken}`,
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
