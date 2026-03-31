import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/** Parse the origin that was encoded in the OAuth state param */
function parseOriginFromState(state: string): string {
  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8");
    // The state contains the origin URL
    const url = new URL(decoded);
    return url.origin;
  } catch {
    return "";
  }
}

/** Sleep helper for retry delays */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry wrapper for OAuth token exchange with exponential backoff */
async function exchangeWithRetry(code: string, state: string, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sdk.exchangeCodeForToken(code, state);
    } catch (error: any) {
      const isRateLimit =
        error?.status === 429 ||
        error?.statusCode === 429 ||
        error?.message?.includes("Rate exceeded") ||
        error?.message?.includes("429") ||
        error?.response?.status === 429;

      if (isRateLimit && attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000); // 1s, 2s, 4s, 8s
        console.log(`[OAuth] Rate limited, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/** HTML page shown when rate limit is hit after all retries */
function rateLimitPage(origin: string): string {
  const redirectUrl = origin || "/";
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aguarde um momento...</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 2.5rem;
      max-width: 420px;
      text-align: center;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.75rem; }
    p { color: #a3a3a3; font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem; }
    .countdown { color: #22c55e; font-weight: 600; font-size: 1.1rem; }
    .btn {
      display: inline-block;
      background: #22c55e;
      color: #0a0a0a;
      font-weight: 600;
      padding: 0.75rem 2rem;
      border-radius: 8px;
      text-decoration: none;
      font-size: 0.9rem;
      transition: background 0.2s;
    }
    .btn:hover { background: #16a34a; }
    .spinner {
      width: 32px; height: 32px;
      border: 3px solid #2a2a2a;
      border-top-color: #22c55e;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Servidor ocupado</h1>
    <p>O servidor de autenticação está temporariamente sobrecarregado. Vamos tentar novamente automaticamente em <span class="countdown" id="timer">5</span> segundos.</p>
    <a href="${redirectUrl}" class="btn" id="retryBtn">Tentar novamente</a>
  </div>
  <script>
    let seconds = 5;
    const timer = document.getElementById('timer');
    const btn = document.getElementById('retryBtn');
    const interval = setInterval(() => {
      seconds--;
      timer.textContent = seconds;
      if (seconds <= 0) {
        clearInterval(interval);
        window.location.href = '${redirectUrl}';
      }
    }, 1000);
  </script>
</body>
</html>`;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await exchangeWithRetry(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error: any) {
      console.error("[OAuth] Callback failed", error);

      const isRateLimit =
        error?.status === 429 ||
        error?.statusCode === 429 ||
        error?.message?.includes("Rate exceeded") ||
        error?.message?.includes("429") ||
        error?.response?.status === 429;

      if (isRateLimit) {
        const origin = parseOriginFromState(state);
        res.status(429).type("html").send(rateLimitPage(origin));
        return;
      }

      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
