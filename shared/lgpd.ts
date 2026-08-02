/**
 * Helpers de LGPD compartilhados (front + back) — PR #9.
 */

/**
 * Máscara de CPF: "***.***.**N-NN" (só o penúltimo bloco e o sufixo ficam).
 * "12345678900" / "123.456.789-00" → "***.***.**0-00"
 * Entrada sem 11 dígitos → "***" (nunca vaza dado parcial).
 */
export function maskCpf(cpf: string | null | undefined): string {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11) return "***";
  return `***.***.**${digits[8]}-${digits[9]}${digits[10]}`;
}

/** Formata CPF completo: "12345678900" → "123.456.789-00". */
export function formatCpf(cpf: string | null | undefined): string {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11) return String(cpf || "");
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}
