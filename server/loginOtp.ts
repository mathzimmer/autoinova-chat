/**
 * Login 2FA por WhatsApp — geração, envio e verificação do código (OTP).
 *
 * Fluxo: após a senha conferir, cria-se um desafio (código de 6 dígitos), guarda-se
 * só o HASH com validade de 5 min, e envia-se o código pelo WhatsApp do membro
 * (via Evolution). A sessão só é emitida depois que o código é verificado.
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { loginOtps, teamMembers } from "../drizzle/schema";

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutos
const MAX_ATTEMPTS = 5;

function hashCode(code: string, memberId: number): string {
  return crypto.createHash("sha256").update(`${memberId}:${code}`).digest("hex");
}

/** Mascara o telefone pra UI: mostra só os 4 últimos dígitos. */
export function maskPhone(phone: string): string {
  const d = String(phone).replace(/\D/g, "");
  if (d.length < 4) return "•••";
  return `•••••${d.slice(-4)}`;
}

/** Escolhe uma instância Evolution conectada pra enviar o código. */
async function pickEvolutionInstance(): Promise<string | null> {
  try {
    const { listEvolutionInstances } = await import("./db");
    const list: any[] = await listEvolutionInstances().catch(() => []);
    if (!list.length) return null;
    const connected = list.find((i) => String(i.status).toLowerCase() === "connected" || String(i.status).toLowerCase() === "open");
    return (connected || list[0]).instanceName || null;
  } catch {
    return null;
  }
}

async function sendOtpWhatsApp(phone: string, text: string): Promise<boolean> {
  const instance = await pickEvolutionInstance();
  if (!instance) {
    console.error("[LoginOTP] nenhuma instância Evolution disponível pra enviar o código");
    return false;
  }
  try {
    const { evolutionSendText } = await import("./evolutionService");
    await evolutionSendText(instance, String(phone).replace(/\D/g, ""), text);
    return true;
  } catch (e) {
    console.error("[LoginOTP] falha ao enviar código:", e);
    return false;
  }
}

/** Número APROVADOR — recebe os códigos de TODOS os logins (setting login_2fa_approver_phone). */
export async function getApproverPhone(): Promise<string> {
  try {
    const { getSetting } = await import("./db");
    const raw = await getSetting("login_2fa_approver_phone");
    return (raw || "").replace(/\D/g, "");
  } catch {
    return "";
  }
}

/**
 * Cria um desafio OTP para o membro e envia o código para o NÚMERO APROVADOR
 * (o dono do CRM), identificando quem está tentando entrar. O aprovador repassa
 * o código só a quem autorizar.
 */
export async function createAndSendOtp(member: { id: number; name?: string | null; email?: string | null }): Promise<
  | { ok: true; challengeId: number }
  | { ok: false; error: string }
> {
  const approver = await getApproverPhone();
  if (!approver) return { ok: false, error: "2FA sem número aprovador configurado. Contate o administrador." };

  const db = await getDb();
  if (!db) return { ok: false, error: "Banco indisponível" };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const rows = await db.insert(loginOtps).values({
    teamMemberId: member.id,
    codeHash: hashCode(code, member.id),
    expiresAt,
  }).returning({ id: loginOtps.id });
  const challengeId = rows[0]?.id;
  if (!challengeId) return { ok: false, error: "Falha ao criar o desafio" };

  const quem = [member.name, member.email].filter(Boolean).join(" · ") || `membro #${member.id}`;
  const text = `🔐 Auto Inova CRM — pedido de login\nUsuário: ${quem}\nCódigo: *${code}* (vale 5 min)\nRepasse este código SOMENTE se você autorizar este acesso.`;
  const sent = await sendOtpWhatsApp(approver, text);
  if (!sent) return { ok: false, error: "Não consegui enviar o código ao aprovador. Tente de novo ou contate o administrador." };

  return { ok: true, challengeId };
}

/**
 * Verifica o código de um desafio. Retorna o teamMemberId em caso de sucesso.
 */
export async function verifyOtp(challengeId: number, code: string): Promise<
  | { ok: true; teamMemberId: number }
  | { ok: false; error: string }
> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Banco indisponível" };

  const rows = await db.select().from(loginOtps).where(eq(loginOtps.id, challengeId)).limit(1);
  const otp = rows[0];
  if (!otp) return { ok: false, error: "Código inválido" };
  if (otp.consumedAt) return { ok: false, error: "Código já utilizado. Faça login de novo." };
  if (new Date(otp.expiresAt).getTime() < Date.now()) return { ok: false, error: "Código expirado. Faça login de novo." };
  if (otp.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Muitas tentativas. Faça login de novo." };

  const matches = hashCode(String(code).trim(), otp.teamMemberId) === otp.codeHash;
  if (!matches) {
    await db.update(loginOtps).set({ attempts: otp.attempts + 1 }).where(eq(loginOtps.id, challengeId));
    return { ok: false, error: "Código incorreto." };
  }

  await db.update(loginOtps).set({ consumedAt: new Date() }).where(eq(loginOtps.id, challengeId));
  return { ok: true, teamMemberId: otp.teamMemberId };
}

/** 2FA de login está ligado? (setting login_2fa_enabled = "true") */
export async function is2faEnabled(): Promise<boolean> {
  try {
    const { getSetting } = await import("./db");
    const raw = await getSetting("login_2fa_enabled");
    return String(raw).toLowerCase() === "true";
  } catch {
    return false;
  }
}
