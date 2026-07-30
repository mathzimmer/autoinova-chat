/**
 * Normalização de telefone & deduplicação de contato (FONTE ÚNICA).
 *
 * Módulo PURO (sem dependências de DB) para ser usado tanto pelo servidor
 * quanto pelo frontend. É a única implementação de `normalizePhone` do projeto
 * — server/phoneNormalize.ts re-exporta daqui; o frontend importa de "@shared/phone".
 *
 * Trata números brasileiros: 9º dígito, código do país, formatação.
 *   +55 (51) 9228-1203  →  555192281203
 *   +55 (51) 99228-1203 →  5551992281203
 */

/** Remove tudo que não for dígito. */
export function stripPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Normaliza um telefone brasileiro para a forma canônica.
 * 1. Remove não-dígitos  2. Adiciona 55 se faltar  3. Adiciona o 9º dígito em celular
 * Resultado: 55 + DDD(2) + 9 + número(8) = 13 dígitos (celular) ou 12 (fixo).
 */
export function normalizePhone(phone: string): string {
  if (!phone) return "";

  let digits = stripPhone(phone);

  // Remove + ou 0 à esquerda
  if (digits.startsWith("0")) digits = digits.substring(1);

  // Adiciona código do país se faltar
  if (!digits.startsWith("55")) {
    if (digits.length === 11) {
      digits = "55" + digits;
    } else if (digits.length === 10) {
      digits = "55" + digits;
    } else if (digits.length === 8 || digits.length === 9) {
      digits = "55" + digits;
    }
  }

  // Celular sem o 9º dígito: 55 + DDD(2) + [6-9]XXXXXXX = 12 dígitos → insere o 9
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.substring(2, 4);
    const localNumber = digits.substring(4);
    const firstDigit = localNumber.charAt(0);
    if (["6", "7", "8", "9"].includes(firstDigit)) {
      digits = "55" + ddd + "9" + localNumber;
    }
  }

  return digits;
}

/**
 * Gera todas as variações plausíveis de um número (com/sem 9º dígito,
 * com/sem código do país) para procurar contatos/conversas em formatos diferentes.
 */
export function phoneVariations(phone: string): string[] {
  const canonical = normalizePhone(phone);
  if (!canonical || canonical.length < 10) return [canonical].filter(Boolean);

  const variations = new Set<string>();
  variations.add(canonical);

  // 13 dígitos (55 + DDD + 9 + 8) → também sem o 9
  if (canonical.length === 13 && canonical.startsWith("55")) {
    const ddd = canonical.substring(2, 4);
    const ninthDigit = canonical.charAt(4);
    const rest = canonical.substring(5);
    if (ninthDigit === "9") {
      variations.add("55" + ddd + rest);
      variations.add(ddd + "9" + rest);
      variations.add(ddd + rest);
    }
  }

  // 12 dígitos → também com o 9
  if (canonical.length === 12 && canonical.startsWith("55")) {
    const ddd = canonical.substring(2, 4);
    const localNumber = canonical.substring(4);
    const firstDigit = localNumber.charAt(0);
    if (["6", "7", "8", "9"].includes(firstDigit)) {
      variations.add("55" + ddd + "9" + localNumber);
      variations.add(ddd + localNumber);
      variations.add(ddd + "9" + localNumber);
    }
  }

  const stripped = stripPhone(phone);
  if (stripped) variations.add(stripped);

  return Array.from(variations);
}

/** Diz se dois telefones representam a mesma pessoa. */
export function isSamePhone(phone1: string, phone2: string): boolean {
  if (!phone1 || !phone2) return false;
  const n1 = normalizePhone(phone1);
  const n2 = normalizePhone(phone2);
  if (n1 === n2) return true;
  const v1 = phoneVariations(phone1);
  const v2 = phoneVariations(phone2);
  return v1.some(v => v2.includes(v));
}
