/**
 * Customers — pessoa canônica (PR #7).
 *
 * getOrCreateCustomer(phone) é a PORTA ÚNICA: dado qualquer formato de telefone,
 * devolve a linha da pessoa (criando se preciso). Leads/conversations/contacts
 * são vinculados progressivamente via customerId.
 *
 * Regras de ouro:
 * - NUNCA sobrescreve dado bom com ruim: campo preenchido no customer só é
 *   substituído por candidato melhor (ver pickBetter — puro, testado).
 * - Tudo best-effort: falha ao vincular NUNCA quebra atendimento.
 * - Backfill tem dry-run obrigatório (endpoint admin) antes de escrever.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { customers, leads, conversations, contacts } from "../drizzle/schema";
import { normalizePhone } from "@shared/phone";

// ─── Helpers puros (testados em customers.test.ts) ───────────────────────────

/** CPF canônico: só dígitos, 11 posições; senão null. */
export function cleanCpf(cpf: unknown): string | null {
  if (typeof cpf !== "string") return null;
  const digits = cpf.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

/** Data ISO (YYYY-MM-DD) a partir de formatos comuns; senão null. */
export function cleanBirthDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  // Já ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // DD/MM/YYYY
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/**
 * Escolhe o melhor valor entre o atual (customer) e um candidato novo.
 * Nunca troca dado bom por ruim: vazio só é preenchido por não-vazio.
 * Para strings, prefere o mais longo quando o atual está vazio.
 */
export function pickBetter(current: string | null | undefined, candidate: string | null | undefined): string | null {
  const cur = (current || "").trim();
  const cand = (candidate || "").trim();
  if (cur) return cur;        // já tem dado bom → mantém
  return cand || null;        // vazio → preenche se o candidato tem algo
}

export interface LeadLikeForGrouping {
  id: number;
  phone: string;
  conversationId: number;
}

export interface PhoneGroup {
  canonicalPhone: string;
  leadIds: number[];
  conversationIds: number[];
  phoneVariants: string[];
}

/**
 * Agrupa leads por telefone canônico — o coração do dry-run: mostra quantas
 * pessoas únicas existem e quais grupos têm duplicados (vários leads/variantes).
 */
export function groupLeadsByCanonicalPhone(rows: LeadLikeForGrouping[]): PhoneGroup[] {
  const map = new Map<string, PhoneGroup>();
  for (const row of rows) {
    const canonical = normalizePhone(row.phone || "");
    if (!canonical) continue;
    let g = map.get(canonical);
    if (!g) {
      g = { canonicalPhone: canonical, leadIds: [], conversationIds: [], phoneVariants: [] };
      map.set(canonical, g);
    }
    if (!g.leadIds.includes(row.id)) g.leadIds.push(row.id);
    if (!g.conversationIds.includes(row.conversationId)) g.conversationIds.push(row.conversationId);
    if (!g.phoneVariants.includes(row.phone)) g.phoneVariants.push(row.phone);
  }
  return Array.from(map.values());
}

// ─── Porta única ─────────────────────────────────────────────────────────────

export async function getCustomerByPhone(phone: string) {
  const db = await getDb();
  if (!db) return null;
  const canonical = normalizePhone(phone || "");
  if (!canonical) return null;
  const rows = await db.select().from(customers).where(eq(customers.canonicalPhone, canonical)).limit(1);
  return rows[0] || null;
}

export async function getOrCreateCustomer(
  phone: string,
  hints?: { name?: string | null; fullName?: string | null; email?: string | null; city?: string | null; cpf?: string | null; birthDate?: string | null },
) {
  const db = await getDb();
  if (!db) return null;
  const canonical = normalizePhone(phone || "");
  if (!canonical) return null;

  const existing = await getCustomerByPhone(phone);
  const clean = {
    name: hints?.name?.trim() || null,
    fullName: hints?.fullName?.trim() || null,
    email: hints?.email?.trim().toLowerCase() || null,
    city: hints?.city?.trim() || null,
    cpf: cleanCpf(hints?.cpf),
    birthDate: cleanBirthDate(hints?.birthDate),
  };

  if (existing) {
    // Completa campos vazios — nunca sobrescreve
    const updates: Record<string, unknown> = {};
    const better = {
      name: pickBetter(existing.name, clean.name),
      fullName: pickBetter(existing.fullName, clean.fullName),
      email: pickBetter(existing.email, clean.email),
      city: pickBetter(existing.city, clean.city),
      cpf: pickBetter(existing.cpf, clean.cpf),
      birthDate: pickBetter(existing.birthDate, clean.birthDate),
    };
    for (const [k, v] of Object.entries(better)) {
      if (v && v !== (existing as any)[k]) updates[k] = v;
    }
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(customers).set(updates).where(eq(customers.id, existing.id));
      return { ...existing, ...updates };
    }
    return existing;
  }

  const inserted = await db.insert(customers).values({
    canonicalPhone: canonical,
    ...clean,
  }).returning();
  return inserted[0];
}

// ─── Vínculo best-effort (chamado no fluxo de atendimento) ──────────────────

/**
 * Garante que lead + conversa têm customerId. Chamado no upsertLead (fire-and-
 * forget). NUNCA lança exceção.
 */
export async function linkLeadToCustomer(leadId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const lead = (await db.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0];
    if (!lead) return;
    if (lead.customerId) {
      // Já vinculado — só garante a conversa
      await db.update(conversations).set({ customerId: lead.customerId })
        .where(eq(conversations.id, lead.conversationId));
      return;
    }

    const customer = await getOrCreateCustomer(lead.phone, {
      name: lead.name,
      fullName: lead.fullName,
      email: lead.email,
      city: lead.city,
      cpf: lead.cpf,
      birthDate: lead.birthDate,
    });
    if (!customer) return;

    await db.update(leads).set({ customerId: customer.id }).where(eq(leads.id, leadId));
    await db.update(conversations).set({ customerId: customer.id })
      .where(eq(conversations.id, lead.conversationId));
  } catch (err) {
    console.error(`[Customers] Falha ao vincular lead ${leadId} (best-effort):`, err);
  }
}

// ─── Backfill com dry-run ────────────────────────────────────────────────────

export interface BackfillReport {
  dryRun: boolean;
  totalLeads: number;
  pessoasUnicas: number;
  gruposComDuplicados: number;
  duplicados: Array<{ canonicalPhone: string; leads: number; variantes: string[] }>;
  customersCriados?: number;
  leadsVinculados?: number;
  conversasVinculadas?: number;
  contatosVinculados?: number;
}

export async function backfillCustomers(opts: { dryRun: boolean; limitGroups?: number }): Promise<BackfillReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const allLeads = await db.select({
    id: leads.id,
    phone: leads.phone,
    conversationId: leads.conversationId,
    name: leads.name,
    fullName: leads.fullName,
    email: leads.email,
    city: leads.city,
    cpf: leads.cpf,
    birthDate: leads.birthDate,
  }).from(leads);

  const groups = groupLeadsByCanonicalPhone(allLeads);
  const dupGroups = groups.filter(g => g.leadIds.length > 1 || g.phoneVariants.length > 1);

  const report: BackfillReport = {
    dryRun: opts.dryRun,
    totalLeads: allLeads.length,
    pessoasUnicas: groups.length,
    gruposComDuplicados: dupGroups.length,
    duplicados: dupGroups.slice(0, opts.limitGroups ?? 20).map(g => ({
      canonicalPhone: g.canonicalPhone,
      leads: g.leadIds.length,
      variantes: g.phoneVariants,
    })),
  };

  if (opts.dryRun) return report;

  // ── Escrita: cria customers e vincula tudo ──
  let customersCriados = 0;
  let leadsVinculados = 0;
  let conversasVinculadas = 0;
  let contatosVinculados = 0;

  for (const g of groups) {
    // Melhor candidato de dados entre os leads do grupo (primeiro não-vazio por campo)
    const groupLeads = allLeads.filter(l => g.leadIds.includes(l.id));
    const hint = {
      name: groupLeads.map(l => l.name).find(Boolean) || null,
      fullName: groupLeads.map(l => l.fullName).find(Boolean) || null,
      email: groupLeads.map(l => l.email).find(Boolean) || null,
      city: groupLeads.map(l => l.city).find(Boolean) || null,
      cpf: groupLeads.map(l => l.cpf).find(Boolean) || null,
      birthDate: groupLeads.map(l => l.birthDate).find(Boolean) || null,
    };

    const before = await getCustomerByPhone(g.canonicalPhone);
    const customer = await getOrCreateCustomer(g.canonicalPhone, hint);
    if (!customer) continue;
    if (!before) customersCriados++;

    const leadRes = await db.update(leads).set({ customerId: customer.id })
      .where(eq(leads.id, g.leadIds[0])).returning({ id: leads.id });
    for (const leadId of g.leadIds.slice(1)) {
      const r = await db.update(leads).set({ customerId: customer.id }).where(eq(leads.id, leadId)).returning({ id: leads.id });
      leadRes.push(...r);
    }
    leadsVinculados += leadRes.length;

    for (const convId of g.conversationIds) {
      const r = await db.update(conversations).set({ customerId: customer.id })
        .where(eq(conversations.id, convId)).returning({ id: conversations.id });
      conversasVinculadas += r.length;
    }
  }

  // Contacts: vincula por telefone canônico + migra cpf/birthDate (não sobrescreve)
  const allContacts = await db.select({
    id: contacts.id, phone: contacts.phone, cpf: contacts.cpf, birthDate: contacts.birthDate,
  }).from(contacts);
  for (const c of allContacts) {
    const customer = await getCustomerByPhone(c.phone);
    if (!customer) continue;
    await db.update(contacts).set({ customerId: customer.id }).where(eq(contacts.id, c.id));
    contatosVinculados++;
    // Migra dados do contato para o customer (só preenche vazio)
    const cpf = cleanCpf(c.cpf);
    const bd = cleanBirthDate(c.birthDate);
    if ((cpf && !customer.cpf) || (bd && !customer.birthDate)) {
      await db.update(customers).set({
        ...(cpf && !customer.cpf ? { cpf } : {}),
        ...(bd && !customer.birthDate ? { birthDate: bd } : {}),
        updatedAt: new Date(),
      }).where(eq(customers.id, customer.id));
    }
  }

  return { ...report, customersCriados, leadsVinculados, conversasVinculadas, contatosVinculados };
}

// ─── Listagem básica (admin) ─────────────────────────────────────────────────

export async function listCustomers(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const { desc, sql } = await import("drizzle-orm");
  const [items, count] = await Promise.all([
    db.select().from(customers).orderBy(desc(customers.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(customers),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}
