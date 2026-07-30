/**
 * Validação server-side dos dados que a IA propõe via tool `atualizar_lead`.
 *
 * Princípio: a IA PROPÕE, o código VALIDA. Campos válidos são sanitizados e
 * gravados; campos inválidos NÃO são gravados e voltam como erro no tool result
 * para o modelo se autocorrigir (pedir o dado de novo ao cliente).
 *
 * PR #1 do roadmap. NÃO altera semântica de armazenamento (colunas ainda são
 * varchar): números viram string limpa. A conversão de `entrada` para centavos
 * e de km/ano para colunas inteiras fica para o PR #8, junto da migração de tipo.
 */
import { z } from "zod";
import { normalizePhone } from "./phoneNormalize";

// ── Domínios de enum aceitos pela tool ──────────────────────────
export const FUNNEL_VALUES = [
  "novo", "interesse_definido", "pagamento_definido", "dados_pessoais",
  "dados_troca", "encaminhado_vendedor", "negociando", "fechado", "perdido",
] as const;
export const INTENTION_VALUES = ["compra", "troca", "informacao", "test_drive", "financiamento"] as const;
export const PAYMENT_VALUES = ["financiamento", "a_vista", "consorcio", "troca"] as const;
export const STATUS_VALUES = ["qualifying", "qualified"] as const;

// ── CPF: dígitos verificadores ──────────────────────────────────
export function isValidCPF(input: string): boolean {
  const cpf = String(input || "").replace(/\D/g, "");
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos iguais (000..., 111...)
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  if (d2 !== parseInt(cpf[10], 10)) return false;
  return true;
}

const currentYear = new Date().getFullYear();

// ── Schemas Zod por campo ───────────────────────────────────────
const nomeSchema = z.string().trim().min(1, "vazio");
const emailSchema = z.string().trim().toLowerCase().email("formato inválido");
const cidadeSchema = z.string().trim().min(1, "vazia");
const cpfSchema = z.string()
  .transform(s => String(s).replace(/\D/g, ""))
  .refine(isValidCPF, "dígitos verificadores não conferem");
const anoTrocaSchema = z.coerce.number().int("não é inteiro")
  .gte(1950, "ano muito antigo").lte(currentYear + 1, "ano no futuro");
const kmTrocaSchema = z.coerce.number().int("não é inteiro").gte(0, "negativo");
// `entrada`: valida que há um valor monetário plausível; mantém string limpa
// (a conversão para centavos é do PR #8, quando a coluna vira integer).
const entradaSchema = z.string()
  .transform(s => String(s).trim())
  .refine(s => /\d/.test(s), "sem valor numérico");
const funnelSchema = z.enum(FUNNEL_VALUES);
const intentionSchema = z.enum(INTENTION_VALUES);
const paymentSchema = z.enum(PAYMENT_VALUES);
const statusSchema = z.enum(STATUS_VALUES);
const veiculoIdSchema = z.coerce.number().int().positive("id inválido");

export interface LeadValidationResult {
  /** Campos válidos e sanitizados, com as MESMAS chaves da tool (pt-BR).
   *  Tipado como `any` (igual ao args cru de JSON.parse) para consumo direto no handler. */
  cleaned: Record<string, any>;
  /** Campos rejeitados, com motivo — devolvidos ao modelo para autocorreção. */
  errors: { field: string; message: string }[];
}

/**
 * Valida e sanitiza os argumentos da tool `atualizar_lead`.
 * Campos ausentes são ignorados; presentes-e-válidos entram em `cleaned`;
 * presentes-e-inválidos entram em `errors` (e NÃO são gravados).
 */
export function validateLeadArgs(args: Record<string, any>): LeadValidationResult {
  const cleaned: Record<string, any> = {};
  const errors: { field: string; message: string }[] = [];
  const a = args || {};

  const run = (key: string, schema: z.ZodType, storeKey = key, transform?: (v: unknown) => unknown) => {
    if (a[key] === undefined || a[key] === null || a[key] === "") return;
    const r = schema.safeParse(a[key]);
    if (r.success) cleaned[storeKey] = transform ? transform(r.data) : r.data;
    else errors.push({ field: key, message: r.error.issues[0]?.message || "inválido" });
  };

  run("nome", nomeSchema);
  run("email", emailSchema);
  run("cidade", cidadeSchema);
  run("cpf", cpfSchema);
  // km/ano: guardamos como string limpa (coluna ainda é varchar)
  run("ano_troca", anoTrocaSchema, "ano_troca", v => String(v));
  run("km_troca", kmTrocaSchema, "km_troca", v => String(v));
  run("entrada", entradaSchema);
  run("etapa_funil", funnelSchema);
  run("intencao", intentionSchema);
  run("forma_pagamento", paymentSchema);
  run("status", statusSchema);

  // veiculo_id: aceita null explícito (limpar vínculo) OU inteiro positivo
  if (a.veiculo_id === null) {
    cleaned.veiculo_id = null;
  } else if (a.veiculo_id !== undefined && a.veiculo_id !== "") {
    const r = veiculoIdSchema.safeParse(a.veiculo_id);
    if (r.success) cleaned.veiculo_id = r.data;
    else errors.push({ field: "veiculo_id", message: r.error.issues[0]?.message || "inválido" });
  }

  // Campos de texto livre (sem enum): apenas trim, sempre passam
  for (const k of ["veiculo_interesse", "veiculo_troca", "notas"]) {
    if (typeof a[k] === "string" && a[k].trim()) cleaned[k] = a[k].trim();
  }
  if (typeof a.tem_troca === "boolean") cleaned.tem_troca = a.tem_troca;

  return { cleaned, errors };
}

/** Monta a mensagem de erro para devolver ao modelo (autocorreção). */
export function formatValidationErrors(errors: { field: string; message: string }[]): string {
  if (!errors.length) return "";
  const list = errors.map(e => `${e.field} (${e.message})`).join("; ");
  return `Não gravei estes dados por estarem inválidos: ${list}. Peça novamente ao cliente de forma natural.`;
}

/** Normaliza telefone antes de gravar (usado nos pontos de entrada de identidade). */
export function cleanPhone(phone: string | undefined | null): string | undefined {
  if (!phone) return undefined;
  return normalizePhone(phone) || phone;
}
