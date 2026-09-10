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

// ─── Multi-conta Instagram (fluxo "Instagram API with Instagram login") ──────
// Cada conta tem seu próprio token e é acessada via graph.instagram.com/{IG_ID}.
const IG_GRAPH_URL = "https://graph.instagram.com/v21.0";

export type InstagramAccount = { igId: string; token: string; name?: string };

/** Lê as contas do setting JSON; se vazio, cai pro par único do .env (compat). */
export async function getInstagramAccounts(): Promise<InstagramAccount[]> {
  try {
    const { getSetting } = await import("./db");
    const raw = await getSetting("instagram_accounts");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.filter((a: any) => a && a.igId && a.token)
          .map((a: any) => ({ igId: String(a.igId), token: String(a.token), name: a.name ? String(a.name) : undefined }));
      }
    }
  } catch { /* usa fallback do env */ }
  const { accessToken, instagramId } = getConfig();
  if (accessToken && instagramId) return [{ igId: instagramId, token: accessToken, name: "Instagram" }];
  return [];
}

export async function getInstagramAccountById(igId: string): Promise<InstagramAccount | null> {
  const list = await getInstagramAccounts();
  return list.find((a) => a.igId === String(igId)) || null;
}

/** IDs de todas as contas conectadas (pra ignorar echo das próprias mensagens). */
export async function getInstagramAccountIds(): Promise<string[]> {
  return (await getInstagramAccounts()).map((a) => a.igId);
}

/**
 * Envia DM do Instagram pela CONTA certa (token próprio), via graph.instagram.com.
 * `igId` = conta remetente (a que recebeu a conversa). `recipient` = IGSID do cliente.
 */
export async function sendInstagramDM(
  igId: string,
  recipient: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const acc = await getInstagramAccountById(igId);
  if (!acc) return { success: false, error: `Conta Instagram ${igId} não configurada` };
  try {
    const response = await axios.post(
      `${IG_GRAPH_URL}/${acc.igId}/messages`,
      { recipient: { id: recipient }, message: { text } },
      { params: { access_token: acc.token }, headers: { "Content-Type": "application/json" } }
    );
    const messageId = response.data?.message_id;
    console.log(`[Instagram] DM enviada pela conta ${acc.name || igId} para ${recipient}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errData = error?.response?.data?.error;
    const errMsg = errData?.message || error.message;
    console.error(`[Instagram] Falha ao enviar DM (conta ${igId}) para ${recipient}: [${errData?.code}] ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

/** Perfil do usuário do IG usando o token da CONTA que recebeu a mensagem. */
export async function getInstagramProfileFor(
  igsid: string,
  igId: string
): Promise<{ name?: string; profilePic?: string } | null> {
  const acc = await getInstagramAccountById(igId);
  if (!acc) return null;
  try {
    const response = await axios.get(`${IG_GRAPH_URL}/${igsid}`, {
      params: { fields: "name,username,profile_pic", access_token: acc.token },
    });
    const d = response.data || {};
    return { name: d.name || d.username, profilePic: d.profile_pic };
  } catch {
    return null;
  }
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
