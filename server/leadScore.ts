/**
 * Score de lead por COMPLETUDE (determinístico) + temperatura derivada.
 *
 * Decisão de projeto (PR #4):
 *  - `score` (0–100) = quão qualificado/completo está o lead, calculado por REGRAS
 *    (não pela "sensação" do modelo). Reprodutível e explicável.
 *  - `temperature` = a MAIS QUENTE entre: a faixa do score, o piso do estágio do
 *    funil (calculateTemperature) e um empurrão da IA quando há sinal claro de
 *    urgência/fechamento. A IA só AJUSTA para cima; não decide sozinha.
 *
 * Módulo puro (sem dependências de DB) — testável isoladamente.
 */

export type Temperature = "frio" | "morno" | "quente" | "muito_quente";

/** Campos do lead usados no cálculo (subconjunto). */
export interface ScorableLead {
  vehicleInterest?: string | null;
  paymentMethod?: string | null;
  hasTrade?: boolean | null;
  tradeVehicle?: string | null;
  name?: string | null;
  fullName?: string | null;
  city?: string | null;
  cpf?: string | null;
  email?: string | null;
  downPayment?: string | null;
}

const filled = (v: unknown): boolean =>
  v != null && String(v).trim() !== "" && String(v).trim().toLowerCase() !== "não definido";

/**
 * Pontua a completude do lead (0–100). Pesos por relevância comercial:
 * veículo (25), pagamento (20), troca (15), nome (10), cidade (10),
 * CPF (10), e-mail (5), entrada (5).
 */
export function scoreLead(lead: ScorableLead): number {
  let s = 0;
  if (filled(lead.vehicleInterest)) s += 25;
  if (filled(lead.paymentMethod)) s += 20;
  if (lead.hasTrade === true || filled(lead.tradeVehicle)) s += 15;
  if (filled(lead.name) || filled(lead.fullName)) s += 10;
  if (filled(lead.city)) s += 10;
  if (filled(lead.cpf)) s += 10;
  if (filled(lead.email)) s += 5;
  if (filled(lead.downPayment)) s += 5;
  return Math.min(100, s);
}

/** Faixa de temperatura a partir do score de completude. */
export function temperatureFromScore(score: number): Temperature {
  if (score >= 75) return "muito_quente";
  if (score >= 50) return "quente";
  if (score >= 25) return "morno";
  return "frio";
}

const TEMP_RANK: Record<Temperature, number> = { frio: 0, morno: 1, quente: 2, muito_quente: 3 };
const TEMPS: Temperature[] = ["frio", "morno", "quente", "muito_quente"];

/** Retorna a temperatura mais quente entre as informadas. */
export function hottestTemperature(...temps: Temperature[]): Temperature {
  let best = 0;
  for (const t of temps) best = Math.max(best, TEMP_RANK[t] ?? 0);
  return TEMPS[best];
}

/**
 * Temperatura final: a mais quente entre a faixa do score e o piso do funil;
 * a IA pode empurrar para "muito_quente" quando detecta urgência/fechamento.
 */
export function combineTemperature(
  scoreTemp: Temperature,
  funnelTemp: Temperature,
  aiUrgent: boolean,
): Temperature {
  const base = hottestTemperature(scoreTemp, funnelTemp);
  return aiUrgent ? hottestTemperature(base, "muito_quente") : base;
}
