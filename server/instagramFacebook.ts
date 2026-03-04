/**
 * Instagram & Facebook Messenger Integration
 * 
 * Handles sending messages via Instagram Direct and Facebook Messenger
 * using the Meta Graph API (Messenger Platform Send API).
 * 
 * IMPORTANT: The correct endpoint is POST /{PAGE_ID}/messages (NOT /me/messages)
 * The access_token must be a Page Access Token with MESSAGE task permission.
 * 
 * For Instagram: uses the Facebook Page ID linked to the Instagram account
 * For Facebook: uses the Facebook Page ID directly
 * 
 * Required env vars:
 * - META_ADS_ACCESS_TOKEN: Page Access Token (same used for ads)
 * - META_ADS_PAGE_ID: Facebook Page ID linked to Instagram
 * - META_ADS_INSTAGRAM_ID: Instagram Professional account ID
 */
import axios from "axios";

const GRAPH_API_URL = "https://graph.facebook.com/v21.0";

function getConfig() {
  const accessToken = process.env.META_ADS_ACCESS_TOKEN;
  const pageId = process.env.META_ADS_PAGE_ID;
  const instagramId = process.env.META_ADS_INSTAGRAM_ID;
  const verifyToken = process.env.META_ADS_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "autoinova_verify_token";

  return { accessToken, pageId, instagramId, verifyToken };
}

export function isInstagramConfigured(): boolean {
  const { accessToken, instagramId } = getConfig();
  return !!(accessToken && instagramId);
}

export function isFacebookConfigured(): boolean {
  const { accessToken, pageId } = getConfig();
  return !!(accessToken && pageId);
}

/**
 * Send a text message via Instagram Direct
 * Uses POST /{PAGE_ID}/messages with IGSID (Instagram-scoped ID) as recipient
 */
export async function sendInstagramMessage(
  recipientId: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, pageId } = getConfig();

  if (!accessToken || !pageId) {
    console.warn("[Instagram] Not configured. Message not sent to:", recipientId);
    return { success: false, error: "Instagram API not configured" };
  }

  try {
    const response = await axios.post(
      `${GRAPH_API_URL}/${pageId}/messages`,
      {
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text },
      },
      {
        params: { access_token: accessToken },
        headers: { "Content-Type": "application/json" },
      }
    );

    const messageId = response.data?.message_id;
    console.log(`[Instagram] Message sent to ${recipientId}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errData = error?.response?.data?.error;
    const errMsg = errData?.message || error.message;
    const errCode = errData?.code;
    console.error(`[Instagram] Failed to send message to ${recipientId}: [${errCode}] ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

/**
 * Send a text message via Facebook Messenger
 * Uses POST /{PAGE_ID}/messages with PSID (Page-scoped ID) as recipient
 */
export async function sendFacebookMessage(
  recipientId: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, pageId } = getConfig();

  if (!accessToken || !pageId) {
    console.warn("[Facebook] Not configured. Message not sent to:", recipientId);
    return { success: false, error: "Facebook Messenger API not configured" };
  }

  try {
    const response = await axios.post(
      `${GRAPH_API_URL}/${pageId}/messages`,
      {
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text },
      },
      {
        params: { access_token: accessToken },
        headers: { "Content-Type": "application/json" },
      }
    );

    const messageId = response.data?.message_id;
    console.log(`[Facebook] Message sent to ${recipientId}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errData = error?.response?.data?.error;
    const errMsg = errData?.message || error.message;
    const errCode = errData?.code;
    console.error(`[Facebook] Failed to send message to ${recipientId}: [${errCode}] ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

/**
 * Send an image via Instagram Direct
 */
export async function sendInstagramImage(
  recipientId: string,
  imageUrl: string,
  caption?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, pageId } = getConfig();

  if (!accessToken || !pageId) {
    return { success: false, error: "Instagram API not configured" };
  }

  try {
    const response = await axios.post(
      `${GRAPH_API_URL}/${pageId}/messages`,
      {
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: {
          attachment: {
            type: "image",
            payload: { url: imageUrl, is_reusable: true },
          },
        },
      },
      {
        params: { access_token: accessToken },
        headers: { "Content-Type": "application/json" },
      }
    );

    const messageId = response.data?.message_id;
    console.log(`[Instagram] Image sent to ${recipientId}, ID: ${messageId}`);

    // Send caption as separate text if provided
    if (caption) {
      await sendInstagramMessage(recipientId, caption);
    }

    return { success: true, messageId };
  } catch (error: any) {
    const errData = error?.response?.data?.error;
    const errMsg = errData?.message || error.message;
    console.error(`[Instagram] Failed to send image to ${recipientId}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Send an image via Facebook Messenger
 */
export async function sendFacebookImage(
  recipientId: string,
  imageUrl: string,
  caption?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, pageId } = getConfig();

  if (!accessToken || !pageId) {
    return { success: false, error: "Facebook Messenger API not configured" };
  }

  try {
    const response = await axios.post(
      `${GRAPH_API_URL}/${pageId}/messages`,
      {
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: {
          attachment: {
            type: "image",
            payload: { url: imageUrl, is_reusable: true },
          },
        },
      },
      {
        params: { access_token: accessToken },
        headers: { "Content-Type": "application/json" },
      }
    );

    const messageId = response.data?.message_id;
    console.log(`[Facebook] Image sent to ${recipientId}, ID: ${messageId}`);

    if (caption) {
      await sendFacebookMessage(recipientId, caption);
    }

    return { success: true, messageId };
  } catch (error: any) {
    const errData = error?.response?.data?.error;
    const errMsg = errData?.message || error.message;
    console.error(`[Facebook] Failed to send image to ${recipientId}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Unified send function — routes to the correct platform
 */
export async function sendPlatformMessage(
  platform: "instagram" | "facebook",
  recipientId: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (platform === "instagram") {
    return sendInstagramMessage(recipientId, text);
  } else {
    return sendFacebookMessage(recipientId, text);
  }
}

/**
 * Unified image send — routes to the correct platform
 */
export async function sendPlatformImage(
  platform: "instagram" | "facebook",
  recipientId: string,
  imageUrl: string,
  caption?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (platform === "instagram") {
    return sendInstagramImage(recipientId, imageUrl, caption);
  } else {
    return sendFacebookImage(recipientId, imageUrl, caption);
  }
}

/**
 * Get user profile from Instagram/Facebook
 * For Instagram: GET /{IGSID}?fields=name,profile_pic using Page Access Token
 * For Facebook: GET /{PSID}?fields=first_name,last_name,profile_pic using Page Access Token
 */
export async function getPlatformUserProfile(
  userId: string,
  platform: "instagram" | "facebook"
): Promise<{ name?: string; profilePic?: string } | null> {
  const { accessToken } = getConfig();
  if (!accessToken) return null;

  try {
    const fields = platform === "instagram" 
      ? "name,profile_pic" 
      : "first_name,last_name,profile_pic";
    
    const response = await axios.get(
      `${GRAPH_API_URL}/${userId}`,
      {
        params: { fields, access_token: accessToken },
      }
    );

    if (platform === "instagram") {
      return {
        name: response.data?.name,
        profilePic: response.data?.profile_pic,
      };
    } else {
      const firstName = response.data?.first_name || "";
      const lastName = response.data?.last_name || "";
      return {
        name: `${firstName} ${lastName}`.trim() || undefined,
        profilePic: response.data?.profile_pic,
      };
    }
  } catch (error: any) {
    const errData = error?.response?.data?.error;
    const errMsg = errData?.message || error.message;
    const errCode = errData?.code;
    console.error(`[${platform}] Failed to get user profile for ${userId}: [${errCode}] ${errMsg}`);
    // Don't fail the whole flow if profile fetch fails
    return null;
  }
}

export { getConfig as getInstagramFacebookConfig };
