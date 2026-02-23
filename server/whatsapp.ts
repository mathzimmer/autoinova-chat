/**
 * WhatsApp Business Cloud API Integration
 * 
 * Handles sending messages, marking as read, and downloading media
 * via the official Meta WhatsApp Cloud API.
 * 
 * Required env vars:
 * - WHATSAPP_ACCESS_TOKEN: Permanent token from Meta Business
 * - WHATSAPP_PHONE_NUMBER_ID: Phone number ID from WhatsApp Business
 * - WHATSAPP_VERIFY_TOKEN: Custom token for webhook verification
 */
import axios from "axios";

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

function getConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "autoinova_verify_token";

  return { accessToken, phoneNumberId, verifyToken };
}

function isConfigured(): boolean {
  const { accessToken, phoneNumberId } = getConfig();
  return !!(accessToken && phoneNumberId);
}

/**
 * Send a text message to a WhatsApp number
 */
async function sendTextMessage(to: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. Message not sent to:", to);
    return { success: false, error: "WhatsApp API not configured" };
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { 
          preview_url: false,
          body: text 
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    console.log(`[WhatsApp] Message sent to ${to}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send message to ${to}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Mark a message as read in WhatsApp
 */
async function markAsRead(messageId: string): Promise<boolean> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) return false;

  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    return true;
  } catch (error: any) {
    console.error("[WhatsApp] Failed to mark as read:", error?.response?.data?.error?.message || error.message);
    return false;
  }
}

/**
 * Download media file from WhatsApp (audio, image, document)
 * Returns the media URL that can be used with transcription services
 */
async function getMediaUrl(mediaId: string): Promise<string | null> {
  const { accessToken } = getConfig();

  if (!accessToken) return null;

  try {
    const response = await axios.get(
      `${WHATSAPP_API_URL}/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    return response.data?.url || null;
  } catch (error: any) {
    console.error("[WhatsApp] Failed to get media URL:", error?.response?.data?.error?.message || error.message);
    return null;
  }
}

/**
 * Download media bytes from WhatsApp (needed for transcription)
 * WhatsApp media URLs require the access token to download
 */
async function downloadMedia(mediaUrl: string): Promise<Buffer | null> {
  const { accessToken } = getConfig();

  if (!accessToken) return null;

  try {
    const response = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      responseType: "arraybuffer",
    });
    return Buffer.from(response.data);
  } catch (error: any) {
    console.error("[WhatsApp] Failed to download media:", error.message);
    return null;
  }
}

/**
 * Send an image message to a WhatsApp number
 */
async function sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. Image message not sent to:", to);
    return { success: false, error: "WhatsApp API not configured" };
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "image",
        image: {
          link: imageUrl,
          ...(caption && { caption }),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    if (messageId) {
      console.log(`[WhatsApp] Image sent successfully to ${to}, message ID: ${messageId}`);
      return { success: true, messageId };
    } else {
      return { success: false, error: "No message ID returned" };
    }
  } catch (error: any) {
    const errorMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send image to ${to}:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Send a reaction to a message
 */
async function sendReaction(to: string, messageId: string, emoji: string): Promise<boolean> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) return false;

  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "reaction",
        reaction: {
          message_id: messageId,
          emoji: emoji,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    return true;
  } catch (error: any) {
    console.error("[WhatsApp] Failed to send reaction:", error.message);
    return false;
  }
}

export {
  isConfigured,
  sendTextMessage,
  sendImageMessage,
  markAsRead,
  getMediaUrl,
  downloadMedia,
  sendReaction,
  getConfig,
};
