/**
 * Phone Normalization & Contact Deduplication Module
 *
 * Handles Brazilian phone number normalization, detecting duplicates
 * across different formatting variations (with/without 9th digit,
 * with/without country code, with formatting characters, etc.)
 *
 * Example duplicates this catches:
 *   +55 (51) 9228-1203  →  555192281203
 *   +55 (51) 99228-1203 →  5551992281203
 *   Both map to the same canonical: 5551992281203
 */

/**
 * Strip all non-digit characters from a phone string.
 */
export function stripPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Normalize a Brazilian phone number to its canonical form.
 *
 * Rules:
 * 1. Remove all non-digit characters
 * 2. Add country code 55 if missing
 * 3. For mobile numbers (DDD + 8 digits), add the 9th digit
 * 4. Result is always: 55 + DDD(2) + 9 + number(8) = 13 digits for mobile
 *    or 55 + DDD(2) + number(8) = 12 digits for landline
 */
export function normalizePhone(phone: string): string {
  if (!phone) return "";

  let digits = stripPhone(phone);

  // Remove leading + or 0
  if (digits.startsWith("0")) digits = digits.substring(1);

  // Add country code if missing
  if (!digits.startsWith("55")) {
    if (digits.length === 11) {
      // DDD(2) + 9 + number(8) — already has 9th digit
      digits = "55" + digits;
    } else if (digits.length === 10) {
      // DDD(2) + number(8) — missing 9th digit for mobile
      digits = "55" + digits;
    } else if (digits.length === 8 || digits.length === 9) {
      // No DDD — can't normalize reliably, return as-is with 55
      digits = "55" + digits;
    }
  }

  // Now we should have 55 + rest
  // Check if it's a mobile number missing the 9th digit
  // Brazilian mobile: 55 + DDD(2) + 9 + XXXX-XXXX = 13 digits
  // Brazilian landline: 55 + DDD(2) + XXXX-XXXX = 12 digits
  // Old mobile (without 9): 55 + DDD(2) + [6-9]XXX-XXXX = 12 digits
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.substring(2, 4);
    const localNumber = digits.substring(4);

    // If the local number starts with 6, 7, 8, or 9, it's likely a mobile
    // that's missing the 9th digit prefix
    const firstDigit = localNumber.charAt(0);
    if (["6", "7", "8", "9"].includes(firstDigit)) {
      // Add the 9th digit
      digits = "55" + ddd + "9" + localNumber;
    }
  }

  return digits;
}

/**
 * Generate all possible phone variations for a given number.
 * Used to search for existing contacts/conversations that might
 * have the number stored in a different format.
 */
export function phoneVariations(phone: string): string[] {
  const canonical = normalizePhone(phone);
  if (!canonical || canonical.length < 10) return [canonical].filter(Boolean);

  const variations = new Set<string>();
  variations.add(canonical);

  // If canonical is 13 digits (55 + DDD + 9 + 8digits), also generate without the 9
  if (canonical.length === 13 && canonical.startsWith("55")) {
    const ddd = canonical.substring(2, 4);
    const ninthDigit = canonical.charAt(4);
    const rest = canonical.substring(5);
    if (ninthDigit === "9") {
      // Without country code, without 9th digit
      const without9 = "55" + ddd + rest;
      variations.add(without9);
      // Without country code
      variations.add(ddd + "9" + rest);
      variations.add(ddd + rest);
    }
  }

  // If canonical is 12 digits, also generate with the 9
  if (canonical.length === 12 && canonical.startsWith("55")) {
    const ddd = canonical.substring(2, 4);
    const localNumber = canonical.substring(4);
    const firstDigit = localNumber.charAt(0);
    if (["6", "7", "8", "9"].includes(firstDigit)) {
      const with9 = "55" + ddd + "9" + localNumber;
      variations.add(with9);
      variations.add(ddd + localNumber);
      variations.add(ddd + "9" + localNumber);
    }
  }

  // Add the original stripped version
  const stripped = stripPhone(phone);
  if (stripped) variations.add(stripped);

  return Array.from(variations);
}

/**
 * Check if two phone numbers represent the same person.
 */
export function isSamePhone(phone1: string, phone2: string): boolean {
  if (!phone1 || !phone2) return false;
  const n1 = normalizePhone(phone1);
  const n2 = normalizePhone(phone2);
  if (n1 === n2) return true;

  // Also check variations
  const v1 = phoneVariations(phone1);
  const v2 = phoneVariations(phone2);
  return v1.some(v => v2.includes(v));
}
