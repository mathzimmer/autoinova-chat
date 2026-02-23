/**
 * Media handling module
 * 
 * Downloads media from WhatsApp Cloud API and uploads to S3 storage.
 * Returns public URLs for images and audio that can be displayed in the chat
 * and sent to the LLM for vision processing.
 */
import { storagePut } from "./storage";
import { downloadMedia, getMediaUrl } from "./whatsapp";
import { nanoid } from "nanoid";

/**
 * Download media from WhatsApp by media ID and upload to S3.
 * Returns the public S3 URL.
 */
export async function processWhatsAppMedia(
  mediaId: string,
  type: "image" | "audio" | "document",
  mimeType?: string
): Promise<{ url: string; key: string } | null> {
  try {
    // Step 1: Get the download URL from WhatsApp
    const whatsappUrl = await getMediaUrl(mediaId);
    if (!whatsappUrl) {
      console.error(`[Media] Failed to get WhatsApp URL for media ${mediaId}`);
      return null;
    }

    // Step 2: Download the media bytes
    const mediaBuffer = await downloadMedia(whatsappUrl);
    if (!mediaBuffer) {
      console.error(`[Media] Failed to download media from WhatsApp`);
      return null;
    }

    // Step 3: Determine file extension and content type
    const ext = getExtension(type, mimeType);
    // Strip codec params for S3 content type (e.g., 'audio/ogg; codecs=opus' -> 'audio/ogg')
    const contentType = (mimeType || getDefaultMimeType(type)).split(';')[0].trim();
    const uniqueId = nanoid(12);
    const key = `media/${type}/${uniqueId}.${ext}`;

    // Step 4: Upload to S3
    const result = await storagePut(key, mediaBuffer, contentType);
    console.log(`[Media] Uploaded ${type} to S3: ${result.url} (${mediaBuffer.length} bytes)`);

    return { url: result.url, key: result.key };
  } catch (error) {
    console.error(`[Media] Error processing ${type}:`, error);
    return null;
  }
}

/**
 * Upload raw media bytes to S3 (for non-WhatsApp sources).
 */
export async function uploadMediaToS3(
  data: Buffer,
  type: "image" | "audio" | "document",
  mimeType: string
): Promise<{ url: string; key: string } | null> {
  try {
    const ext = getExtension(type, mimeType);
    const uniqueId = nanoid(12);
    const key = `media/${type}/${uniqueId}.${ext}`;

    const result = await storagePut(key, data, mimeType);
    console.log(`[Media] Uploaded ${type} to S3: ${result.url} (${data.length} bytes)`);

    return { url: result.url, key: result.key };
  } catch (error) {
    console.error(`[Media] Error uploading ${type}:`, error);
    return null;
  }
}

function getExtension(type: "image" | "audio" | "document", mimeType?: string): string {
  if (mimeType) {
    // Strip codec parameters (e.g., 'audio/ogg; codecs=opus' -> 'audio/ogg')
    const baseMime = mimeType.split(';')[0].trim().toLowerCase();
    const mimeMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "audio/opus": "ogg",
      "audio/webm": "webm",
      "application/pdf": "pdf",
    };
    if (mimeMap[baseMime]) return mimeMap[baseMime];
  }

  switch (type) {
    case "image": return "jpg";
    case "audio": return "ogg";
    case "document": return "pdf";
  }
}

function getDefaultMimeType(type: "image" | "audio" | "document"): string {
  switch (type) {
    case "image": return "image/jpeg";
    case "audio": return "audio/ogg";
    case "document": return "application/octet-stream";
  }
}
