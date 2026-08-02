/**
 * Parsers PUROS dos campos de lead — PR #8 do roadmap.
 *
 * As colunas legadas `tradeYear` / `tradeKm` / `downPayment` (varchar) continuam
 * sendo escritas pela tool `atualizar_lead` (via leadValidation). Aqui elas são
 * convertidas para as colunas tipadas novas:
 *   - tradeYearInt      (integer, ano 1950..anoAtual+1)
 *   - tradeKmInt        (integer, km)
 *   - downPaymentCents  (integer, centavos de BRL)
 *
 * Também centraliza o mapeamento funnelStatus → leads.status (deprecação prática
 * do leads.status: funnelStatus vence e status fica sincronizado).
 *
 * Sem I/O, sem drizzle — fácil de testar e de reutilizar em backfills.
 */

// ── Ano do veículo de troca ──────────────────────────────────────
export function parseTradeYear(raw: unknown): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/(19|20)\d{2}/);
  if (!m) return null;
  const year = parseInt(m[0], 10);
  const max = new Date().getFullYear() + 1;
  return year >= 1950 && year <= max ? year : null;
}

// ── Km do veículo de troca ───────────────────────────────────────
// "150 mil" / "150mil" → 150000 ; "179.544 km" → 179544 ; lixo → null
export function parseTradeKm(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw);
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  // "mil" com número pequeno → multiplica (150 mil → 150000)
  if (/mil/i.test(s) && n < 1000) return n * 1000;
  return n;
}

// ── Entrada (down payment) em centavos ───────────────────────────
// Regras:
//   "R$ 1.500,00"  → termina com ,\d{1,2} → dígitos já são centavos → 150000
//   "20 mil"       → /mil/i e n < 1000     → n × 100000             → 2000000
//   "R$ 20.000"    → dígitos × 100                                  → 2000000
//   "500"          → 50000 (R$ 500)
//   sem dígitos    → null
export function parseMoneyToCents(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  if (/,\d{1,2}\s*$/.test(s)) return n;              // dígitos já incluem centavos
  if (/mil/i.test(s) && n < 1000) return n * 100000; // "20 mil" → R$ 20.000,00
  return n * 100;
}

// ── funnelStatus → leads.status (deprecação prática do status) ───
export function funnelToLeadStatus(funnel: string): string {
  switch (funnel) {
    case "novo":
      return "new";
    case "interesse_definido":
    case "pagamento_definido":
    case "dados_pessoais":
    case "dados_troca":
      return "qualifying";
    case "encaminhado_vendedor":
    case "negociando":
      return "contacted";
    case "fechado":
      return "converted";
    case "perdido":
      return "lost";
    default:
      return "new";
  }
}
