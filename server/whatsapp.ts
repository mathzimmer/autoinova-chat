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
  // Use WHATSAPP_SYSTEM_USER_TOKEN as primary (permanent, never expires)
  // Fallback to WHATSAPP_ACCESS_TOKEN for backward compatibility
  const accessToken = process.env.WHATSAPP_SYSTEM_USER_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "autoinova_verify_token";

  if (!process.env.WHATSAPP_SYSTEM_USER_TOKEN && process.env.WHATSAPP_ACCESS_TOKEN) {
    console.warn("[WhatsApp] Using WHATSAPP_ACCESS_TOKEN (may expire). Set WHATSAPP_SYSTEM_USER_TOKEN for a permanent token.");
  }

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

/**
 * Build multipart/form-data body manually (no external dependency needed)
 */
function buildMultipartFormData(fields: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>): { body: Buffer; boundary: string } {
  const boundary = `----WebKitFormBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  for (const field of fields) {
    let header = `--${boundary}\r\n`;
    if (field.filename) {
      header += `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n`;
      header += `Content-Type: ${field.contentType || "application/octet-stream"}\r\n`;
    } else {
      header += `Content-Disposition: form-data; name="${field.name}"\r\n`;
    }
    header += `\r\n`;
    parts.push(Buffer.from(header, "utf-8"));
    parts.push(typeof field.value === "string" ? Buffer.from(field.value, "utf-8") : field.value);
    parts.push(Buffer.from("\r\n", "utf-8"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));
  return { body: Buffer.concat(parts), boundary };
}

/**
 * Upload media to WhatsApp's media API and get a media_id.
 * This is the recommended approach instead of using hosted URLs (link).
 * Uploaded media persists for 30 days.
 */
async function uploadMedia(buffer: Buffer, mimeType: string, filename: string): Promise<{ mediaId: string } | null> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. Cannot upload media.");
    return null;
  }

  try {
    console.log(`[WhatsApp] Uploading media: ${filename} (${mimeType}, ${buffer.length} bytes)`);

    const { body, boundary } = buildMultipartFormData([
      { name: "messaging_product", value: "whatsapp" },
      { name: "type", value: mimeType },
      { name: "file", value: buffer, filename, contentType: mimeType },
    ]);

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/media`,
      body,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        maxContentLength: 16 * 1024 * 1024,
        maxBodyLength: 16 * 1024 * 1024,
      }
    );

    const mediaId = response.data?.id;
    if (mediaId) {
      console.log(`[WhatsApp] Media uploaded successfully. Media ID: ${mediaId}`);
      return { mediaId };
    } else {
      console.error("[WhatsApp] Upload returned no media ID:", response.data);
      return null;
    }
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to upload media:`, errMsg);
    if (error?.response?.data) {
      console.error(`[WhatsApp] Upload error details:`, JSON.stringify(error.response.data));
    }
    return null;
  }
}

/**
 * Send an audio message to a WhatsApp number.
 * 
 * Strategy:
 * 1. If audioBuffer is provided: upload to WhatsApp media API first, then send using media_id (recommended)
 * 2. Fallback: send using hosted URL link (not recommended by WhatsApp)
 * 
 * The `voice: true` flag makes it appear as a voice message with waveform and auto-download.
 */
async function sendAudioMessage(
  to: string, 
  audioUrl: string, 
  audioBuffer?: Buffer
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. Audio message not sent to:", to);
    return { success: false, error: "WhatsApp API not configured" };
  }

  try {
    let audioPayload: any;

    // Strategy 1: Upload to WhatsApp media API (recommended)
    if (audioBuffer) {
      console.log(`[WhatsApp] Attempting to upload audio to WhatsApp media API (${audioBuffer.length} bytes)`);
      const uploadResult = await uploadMedia(audioBuffer, "audio/ogg", "voice-message.ogg");
      
      if (uploadResult) {
        audioPayload = {
          id: uploadResult.mediaId,
          voice: true, // Display as voice message with waveform
        };
        console.log(`[WhatsApp] Using uploaded media ID: ${uploadResult.mediaId}`);
      } else {
        console.warn(`[WhatsApp] Upload failed, falling back to link method`);
        audioPayload = {
          link: audioUrl,
          voice: true,
        };
      }
    } else {
      // Strategy 2: Use hosted URL (fallback)
      console.log(`[WhatsApp] Using link method (no buffer provided): ${audioUrl}`);
      audioPayload = {
        link: audioUrl,
        voice: true,
      };
    }

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "audio",
        audio: audioPayload,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    console.log(`[WhatsApp] Audio sent to ${to}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send audio to ${to}:`, errMsg);
    if (error?.response?.data) {
      console.error(`[WhatsApp] Error details:`, JSON.stringify(error.response.data));
    }
    return { success: false, error: errMsg };
  }
}

/**
 * Send a document message to a WhatsApp number
 */
async function sendDocumentMessage(to: string, documentUrl: string, filename?: string, caption?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    return { success: false, error: "WhatsApp API not configured" };
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "document",
        document: {
          link: documentUrl,
          ...(filename && { filename }),
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
    console.log(`[WhatsApp] Document sent to ${to}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send document to ${to}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

export {
  isConfigured,
  sendTextMessage,
  sendImageMessage,
  sendAudioMessage,
  sendDocumentMessage,
  markAsRead,
  getMediaUrl,
  downloadMedia,
  sendReaction,
  getConfig,
};
