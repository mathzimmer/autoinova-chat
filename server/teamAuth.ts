import { getDb } from "./db";
import { teamMembers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

/**
 * Hash password with salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify password
 */
export function verifyPassword(password: string, hash: string): boolean {
  const [salt, storedHash] = hash.split(":");
  const computedHash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return computedHash === storedHash;
}

/**
 * Create a new team member
 */
export async function createTeamMember(
  name: string,
  email: string,
  password: string,
  cargo: "admin" | "gerente" | "vendedor" | "suporte" = "vendedor"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const passwordHash = hashPassword(password);

  const result = await db
    .insert(teamMembers)
    .values({
      name,
      email,
      passwordHash,
      cargo,
      status: "ativo",
    })
    .execute();

  return result;
}

/**
 * Authenticate team member
 */
export async function authenticateTeamMember(email: string, password: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const member = await db.select().from(teamMembers).where(eq(teamMembers.email, email)).limit(1);
  if (member.length === 0) return null;
  const memberData = member[0];

  if (!verifyPassword(password, memberData.passwordHash)) {
    return null;
  }

  if (memberData.status !== "ativo") {
    return null;
  }

  return memberData;
}

/**
 * Get team member by ID
 */
export async function getTeamMember(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(teamMembers).where(eq(teamMembers.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

/**
 * List all team members
 */
export async function listTeamMembers() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.select().from(teamMembers);
}

/**
 * Update team member
 */
export async function updateTeamMember(
  id: number,
  updates: {
    name?: string;
    email?: string;
    cargo?: "admin" | "gerente" | "vendedor" | "suporte";
    status?: "ativo" | "inativo";
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.update(teamMembers).set(updates).where(eq(teamMembers.id, id)).execute();
}

/**
 * Deactivate team member
 */
export async function deactivateTeamMember(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .update(teamMembers)
    .set({ status: "inativo" })
    .where(eq(teamMembers.id, id))
    .execute();
}

/**
 * Check permission for action
 */
export function hasPermission(
  cargo: "admin" | "gerente" | "vendedor" | "suporte",
  action: string
): boolean {
  const permissions: Record<string, string[]> = {
    admin: ["view_all", "assign_conversation", "transfer_conversation", "manage_users", "view_reports"],
    gerente: ["view_all", "assign_conversation", "transfer_conversation", "view_reports"],
    vendedor: ["view_own", "respond_conversation"],
    suporte: ["respond_conversation"],
  };

  return permissions[cargo]?.includes(action) || false;
}
