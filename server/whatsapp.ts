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
 * 
 * FIXES APPLIED (Rodada 45):
 * 1. MIME type agora é "audio/ogg; codecs=opus" — a API do WhatsApp exige o codec explícito
 *    para mensagens de voz. Usar apenas "audio/ogg" faz a API rejeitar o arquivo silenciosamente.
 * 2. Logs detalhados do erro para diagnóstico (código de erro Meta + mensagem completa).
 * 3. Validação dos magic bytes OggS antes de fazer upload — garante que o buffer é um OGG válido.
 */
async function uploadMedia(buffer: Buffer, mimeType: string, filename: string): Promise<{ mediaId: string } | null> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. Cannot upload media.");
    return null;
  }

  // FIX 1: Validar magic bytes OggS antes de enviar
  // Se o buffer não começa com OggS (0x4F 0x67 0x67 0x53), é inválido e vai ser rejeitado
  if (mimeType.includes("ogg") && buffer.length >= 4) {
    const isValidOgg = buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53;
    if (!isValidOgg) {
      console.error(`[WhatsApp] UPLOAD BLOCKED: Buffer does not have OGG magic bytes (OggS). First 4 bytes: ${buffer.slice(0, 4).toString("hex")}`);
      return null;
    }
    console.log(`[WhatsApp] OGG magic bytes validated (OggS)`);
  }

  try {
    // FIX 2: Usar "audio/ogg; codecs=opus" como MIME type no campo "type"
    // A API do WhatsApp para voz (voice: true) requer o codec Opus explicitamente.
    // Sem isso, o arquivo é aceito no upload mas falha na entrega ao destinatário.
    const whatsappMimeType = mimeType === "audio/ogg" ? "audio/ogg; codecs=opus" : mimeType;
    
    console.log(`[WhatsApp] Uploading media to WhatsApp Media API:`);
    console.log(`[WhatsApp]   Filename: ${filename}`);
    console.log(`[WhatsApp]   MIME type: ${whatsappMimeType}`);
    console.log(`[WhatsApp]   Size: ${buffer.length} bytes`);

    const { body, boundary } = buildMultipartFormData([
      { name: "messaging_product", value: "whatsapp" },
      { name: "type", value: whatsappMimeType },
      { name: "file", value: buffer, filename, contentType: whatsappMimeType },
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
      console.error("[WhatsApp] Upload returned no media ID. Response:", JSON.stringify(response.data));
      return null;
    }
  } catch (error: any) {
    // FIX 3: Logs detalhados com código de erro Meta para diagnóstico preciso
    const errMsg = error?.response?.data?.error?.message || error.message;
    const errCode = error?.response?.data?.error?.code;
    const errSubcode = error?.response?.data?.error?.error_subcode;
    const errType = error?.response?.data?.error?.type;
    console.error(`[WhatsApp] Failed to upload media to WhatsApp Media API:`);
    console.error(`[WhatsApp]   Error: ${errMsg}`);
    if (errCode) console.error(`[WhatsApp]   Code: ${errCode}, Subcode: ${errSubcode}, Type: ${errType}`);
    if (error?.response?.data) {
      console.error(`[WhatsApp]   Full error response:`, JSON.stringify(error.response.data));
    }
    return null;
  }
}

/**
 * Send an audio message to a WhatsApp number.
 * 
 * FIXES APPLIED (Rodada 45):
 * 1. Quando upload para WhatsApp Media API FALHA, NÃO usar "voice: true" com link.
 *    "voice: true" com link falha porque o WhatsApp não consegue baixar a URL do Manus proxy
 *    (pode ter expiração, autenticação, ou Content-Type incompatível).
 *    Fallback agora usa "voice: false" (áudio normal, sem waveform) — funciona com link público.
 * 2. Logs melhorados para saber qual estratégia foi usada.
 * 
 * Estratégia:
 * 1. Se audioBuffer fornecido: upload para WhatsApp Media API → enviar com media_id + voice: true
 * 2. Se upload falhar: enviar com link + voice: false (áudio normal, sem waveform mas chega!)
 * 3. Se sem buffer: enviar com link + voice: false
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
    let strategy = "unknown";

    if (audioBuffer) {
      console.log(`[WhatsApp] Strategy 1: Upload to WhatsApp Media API (${audioBuffer.length} bytes)`);
      const uploadResult = await uploadMedia(audioBuffer, "audio/ogg", "voice-message.ogg");
      
      if (uploadResult) {
        // Melhor estratégia: media_id + voice:true = mensagem de voz com waveform
        audioPayload = {
          id: uploadResult.mediaId,
          voice: true,
        };
        strategy = "media_id+voice";
        console.log(`[WhatsApp] Using Strategy 1 (media_id): ${uploadResult.mediaId}`);
      } else {
        // FIX: fallback usa voice:false com o link
        // voice:true + link = o WhatsApp tenta baixar o arquivo da URL e pode falhar
        // voice:false + link = entrega como áudio normal, sem waveform mas chega ao cliente
        console.warn(`[WhatsApp] Upload to Media API failed. Falling back to Strategy 2 (link, no voice flag)`);
        audioPayload = {
          link: audioUrl,
          // NÃO usar voice: true aqui — falha com URLs do Manus proxy
          // voice: false é o comportamento padrão quando omitido
        };
        strategy = "link_no_voice";
        console.log(`[WhatsApp] Using Strategy 2 (link): ${audioUrl}`);
      }
    } else {
      // Sem buffer: usar link sem voice flag
      console.log(`[WhatsApp] Strategy 2 (link, no buffer): ${audioUrl}`);
      audioPayload = {
        link: audioUrl,
      };
      strategy = "link_no_buffer";
    }

    console.log(`[WhatsApp] Sending audio to ${to} via strategy: ${strategy}`);

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
    console.log(`[WhatsApp] Audio sent to ${to}, strategy=${strategy}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    const errCode = error?.response?.data?.error?.code;
    console.error(`[WhatsApp] Failed to send audio to ${to}: ${errMsg} (code: ${errCode})`);
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

/**
 * Send an interactive Reply Buttons message (up to 3 buttons)
 * https://developers.facebook.com/docs/whatsapp/guides/interactive-messages
 */
async function sendReplyButtons(
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
  header?: string,
  footer?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. Reply buttons not sent to:", to);
    return { success: false, error: "WhatsApp API not configured" };
  }

  if (buttons.length === 0 || buttons.length > 3) {
    console.error(`[WhatsApp] Reply buttons must have 1-3 buttons, got ${buttons.length}`);
    return { success: false, error: "Reply buttons must have 1-3 buttons" };
  }

  // Validate button titles (max 20 chars) and IDs (max 256 chars)
  const validButtons = buttons.map(b => ({
    type: "reply" as const,
    reply: {
      id: b.id.substring(0, 256),
      title: b.title.substring(0, 20),
    },
  }));

  try {
    const interactive: any = {
      type: "button",
      body: { text: body.substring(0, 1024) },
      action: { buttons: validButtons },
    };
    if (header) interactive.header = { type: "text", text: header.substring(0, 60) };
    if (footer) interactive.footer = { text: footer.substring(0, 60) };

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    console.log(`[WhatsApp] Reply buttons sent to ${to}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send reply buttons to ${to}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Send an interactive List Message (up to 10 items in sections)
 * https://developers.facebook.com/docs/whatsapp/guides/interactive-messages
 */
async function sendListMessage(
  to: string,
  body: string,
  buttonText: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  header?: string,
  footer?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. List message not sent to:", to);
    return { success: false, error: "WhatsApp API not configured" };
  }

  // Validate: max 10 rows total across all sections
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  if (totalRows === 0 || totalRows > 10) {
    console.error(`[WhatsApp] List must have 1-10 rows total, got ${totalRows}`);
    return { success: false, error: "List must have 1-10 rows total" };
  }

  // Validate row titles (max 24 chars), descriptions (max 72 chars), IDs (max 200 chars)
  const validSections = sections.map(s => ({
    title: s.title.substring(0, 24),
    rows: s.rows.map(r => ({
      id: r.id.substring(0, 200),
      title: r.title.substring(0, 24),
      ...(r.description && { description: r.description.substring(0, 72) }),
    })),
  }));

  try {
    const interactive: any = {
      type: "list",
      body: { text: body.substring(0, 1024) },
      action: {
        button: buttonText.substring(0, 20),
        sections: validSections,
      },
    };
    if (header) interactive.header = { type: "text", text: header.substring(0, 60) };
    if (footer) interactive.footer = { text: footer.substring(0, 60) };

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    console.log(`[WhatsApp] List message sent to ${to}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send list message to ${to}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Send a contact card (vCard) to a WhatsApp number.
 * Used to share seller contact information with customers.
 * Note: WhatsApp Cloud API does not support photos in contact cards. Send photo as separate image message.
 */
async function sendContactCard(
  to: string,
  contact: {
    name: string;
    phone: string;
    organization?: string;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. Contact card not sent to:", to);
    return { success: false, error: "WhatsApp API not configured" };
  }

  try {
    // Format phone for vCard (remove leading +)
    const formattedPhone = contact.phone.replace(/^\+/, "");
    const nameParts = contact.name.split(" ");
    const firstName = nameParts[0] || contact.name;
    const lastName = nameParts.slice(1).join(" ") || "";

    // Build contact object
    const contactObj: any = {
      name: {
        formatted_name: contact.name,
        first_name: firstName,
        ...(lastName && { last_name: lastName }),
      },
      phones: [
        {
          phone: `+${formattedPhone}`,
          type: "WORK",
          wa_id: formattedPhone,
        },
      ],
    };

    // Add organization if provided
    if (contact.organization) {
      contactObj.org = { company: contact.organization };
    }

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "contacts",
        contacts: [contactObj],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    console.log(`[WhatsApp] Contact card sent to ${to} (${contact.name}), ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send contact card to ${to}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Send notification to seller about a new lead assignment.
 * Uses WhatsApp template for messages outside the 24h window.
 * Falls back to regular text message if within the window.
 */
async function sendSellerNotification(
  sellerPhone: string,
  data: {
    sellerName: string;
    customerName: string;
    customerPhone: string;
    vehicleInterest: string;
    conversationSummary: string;
    storeLocation: string;
    customMessage?: string;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();

  if (!accessToken || !phoneNumberId) {
    console.warn("[WhatsApp] Not configured. Seller notification not sent to:", sellerPhone);
    return { success: false, error: "WhatsApp API not configured" };
  }

  try {
    // Build the notification message
    const defaultMessage = `🔔 *Novo Lead Atribuído*\n\n` +
      `Olá ${data.sellerName}!\n\n` +
      `Um novo cliente foi direcionado para você:\n\n` +
      `👤 *Cliente:* ${data.customerName}\n` +
      `📱 *Telefone:* ${data.customerPhone}\n` +
      `🚗 *Veículo de interesse:* ${data.vehicleInterest}\n` +
      `🏪 *Loja:* ${data.storeLocation}\n\n` +
      `📋 *Resumo da conversa:*\n${data.conversationSummary}\n\n` +
      `Entre em contato o mais rápido possível!`;

    const message = data.customMessage
      ? data.customMessage
          .replace(/\{vendedor\}/gi, data.sellerName)
          .replace(/\{cliente\}/gi, data.customerName)
          .replace(/\{telefone\}/gi, data.customerPhone)
          .replace(/\{veiculo\}/gi, data.vehicleInterest)
          .replace(/\{resumo\}/gi, data.conversationSummary)
          .replace(/\{loja\}/gi, data.storeLocation)
      : defaultMessage;

    // 1) TEXTO LIVRE primeiro (funciona dentro da janela de 24h, sem template)
    const textResult = await sendTextMessage(sellerPhone, message);
    if (textResult.success) {
      console.log(`[WhatsApp] Seller notification enviada por TEXTO a ${sellerPhone}, ID: ${textResult.messageId}`);
      return textResult;
    }

    // 2) Fallback: TEMPLATE (funciona fora das 24h, requer aprovação na Meta)
    console.log(`[WhatsApp] Texto falhou p/ ${sellerPhone} (${textResult.error}), tentando template.`);
    const { sendWhatsAppTemplate } = await import("./whatsappTemplates");
    const templateResult = await sendWhatsAppTemplate(
      sellerPhone,
      "novo_lead_vendedor",
      [
        data.sellerName,
        data.customerName,
        data.customerPhone,
        data.vehicleInterest,
        data.storeLocation,
        data.conversationSummary || "Sem resumo disponível",
      ],
      "pt_BR"
    );
    if (templateResult.success) {
      console.log(`[WhatsApp] Seller notification enviada por TEMPLATE a ${sellerPhone}, ID: ${templateResult.messageId}`);
    }
    return templateResult;
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send seller notification to ${sellerPhone}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Send a video message to a WhatsApp number
 */
async function sendVideoMessage(to: string, videoUrl: string, caption?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { accessToken, phoneNumberId } = getConfig();
  if (!accessToken || !phoneNumberId) return { success: false, error: "WhatsApp API not configured" };
  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "video",
        video: { link: videoUrl, ...(caption && { caption }) },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
    const messageId = response.data?.messages?.[0]?.id;
    console.log(`[WhatsApp] Video sent to ${to}, ID: ${messageId}`);
    return { success: true, messageId };
  } catch (error: any) {
    const errMsg = error?.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp] Failed to send video to ${to}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

export {
  isConfigured,
  sendTextMessage,
  sendImageMessage,
  sendAudioMessage,
  sendVideoMessage,
  sendDocumentMessage,
  sendReplyButtons,
  sendListMessage,
  sendContactCard,
  sendSellerNotification,
  markAsRead,
  getMediaUrl,
  downloadMedia,
  sendReaction,
  getConfig,
};
