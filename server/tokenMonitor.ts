/**
 * Token Health Monitor — AutoInova Chat
 *
 * Periodically checks the health of all external API tokens (WhatsApp, Meta Ads)
 * and notifies the owner when any token fails or becomes invalid.
 *
 * Checks:
 * 1. WhatsApp System User Token — GET /{phoneNumberId} (should return phone info)
 * 2. Meta Ads Access Token — GET /me (should return user info)
 *
 * Runs every 30 minutes. On failure, sends notification via notifyOwner().
 */

import axios from "axios";
import { notifyOwner } from "./_core/notification";

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export type TokenStatus = {
  name: string;
  envVar: string;
  status: "ok" | "failed" | "not_configured";
  message: string;
  lastCheckedAt: number;
};

// In-memory store of last check results
let lastCheckResults: TokenStatus[] = [];
let checkTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Check WhatsApp System User Token health
 */
async function checkWhatsAppToken(): Promise<TokenStatus> {
  const token = process.env.WHATSAPP_SYSTEM_USER_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const envVar = process.env.WHATSAPP_SYSTEM_USER_TOKEN
    ? "WHATSAPP_SYSTEM_USER_TOKEN"
    : "WHATSAPP_ACCESS_TOKEN";

  if (!token || !phoneNumberId) {
    return {
      name: "WhatsApp Business API",
      envVar,
      status: "not_configured",
      message: "Token ou Phone Number ID não configurado",
      lastCheckedAt: Date.now(),
    };
  }

  try {
    const response = await axios.get(`${WHATSAPP_API_URL}/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });

    const displayPhone = response.data?.display_phone_number || "OK";
    const qualityRating = response.data?.quality_rating || "N/A";

    return {
      name: "WhatsApp Business API",
      envVar,
      status: "ok",
      message: `Telefone: ${displayPhone} | Qualidade: ${qualityRating}`,
      lastCheckedAt: Date.now(),
    };
  } catch (error: any) {
    const errCode = error?.response?.data?.error?.code;
    const errMsg = error?.response?.data?.error?.message || error.message;
    const statusCode = error?.response?.status;

    let message = `Erro ${statusCode || "desconhecido"}: ${errMsg}`;

    // Specific error messages
    if (statusCode === 401 || errCode === 190) {
      message = "Token expirado ou inválido. Gere um novo token no Meta Business Manager.";
    } else if (errCode === 4) {
      message = "Limite de requisições atingido. Tente novamente em alguns minutos.";
    }

    return {
      name: "WhatsApp Business API",
      envVar,
      status: "failed",
      message,
      lastCheckedAt: Date.now(),
    };
  }
}

/**
 * Check Meta Ads Access Token health
 */
async function checkMetaAdsToken(): Promise<TokenStatus> {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const envVar = "META_ADS_ACCESS_TOKEN";

  if (!token) {
    return {
      name: "Meta Ads (Marketing API)",
      envVar,
      status: "not_configured",
      message: "Token não configurado",
      lastCheckedAt: Date.now(),
    };
  }

  try {
    const response = await axios.get(`${WHATSAPP_API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });

    const name = response.data?.name || "OK";
    return {
      name: "Meta Ads (Marketing API)",
      envVar,
      status: "ok",
      message: `Conta: ${name}`,
      lastCheckedAt: Date.now(),
    };
  } catch (error: any) {
    const errCode = error?.response?.data?.error?.code;
    const errMsg = error?.response?.data?.error?.message || error.message;
    const statusCode = error?.response?.status;

    let message = `Erro ${statusCode || "desconhecido"}: ${errMsg}`;

    if (statusCode === 401 || errCode === 190) {
      message = "Token expirado ou inválido. Gere um novo token no Meta Business Manager.";
    }

    return {
      name: "Meta Ads (Marketing API)",
      envVar,
      status: "failed",
      message,
      lastCheckedAt: Date.now(),
    };
  }
}

/**
 * Run all token health checks and notify owner on failures
 */
export async function runTokenHealthCheck(): Promise<TokenStatus[]> {
  console.log("[TokenMonitor] Running health check...");

  const results = await Promise.all([
    checkWhatsAppToken(),
    checkMetaAdsToken(),
  ]);

  // Check for failures and notify owner
  const failures = results.filter(r => r.status === "failed");

  if (failures.length > 0) {
    const failureDetails = failures
      .map(f => `- ${f.name} (${f.envVar}): ${f.message}`)
      .join("\n");

    const title = `⚠️ Auto Inova Chat — ${failures.length} token(s) com problema`;
    const content = `Os seguintes tokens estão com problema e precisam de atenção:\n\n${failureDetails}\n\nAcesse o Meta Business Manager para verificar e gerar novos tokens se necessário.\n\nVerificação realizada em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;

    try {
      await notifyOwner({ title, content });
      console.log(`[TokenMonitor] Owner notified about ${failures.length} token failure(s)`);
    } catch (err) {
      console.error("[TokenMonitor] Failed to notify owner:", err);
    }
  }

  // Log results
  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : r.status === "failed" ? "❌" : "⚪";
    console.log(`[TokenMonitor] ${icon} ${r.name}: ${r.status} — ${r.message}`);
  }

  lastCheckResults = results;
  return results;
}

/**
 * Get the last health check results (for API endpoint)
 */
export function getLastCheckResults(): TokenStatus[] {
  return lastCheckResults;
}

/**
 * Start periodic token health monitoring
 */
export function startTokenMonitor() {
  // Run first check after 10 seconds (let server start)
  setTimeout(() => {
    runTokenHealthCheck().catch(err => {
      console.error("[TokenMonitor] Initial check failed:", err);
    });
  }, 10000);

  // Then run every 30 minutes
  checkTimer = setInterval(() => {
    runTokenHealthCheck().catch(err => {
      console.error("[TokenMonitor] Periodic check failed:", err);
    });
  }, CHECK_INTERVAL_MS);

  console.log("[TokenMonitor] Started. Checking every 30 minutes.");
}

/**
 * Stop the token monitor
 */
export function stopTokenMonitor() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
    console.log("[TokenMonitor] Stopped.");
  }
}
