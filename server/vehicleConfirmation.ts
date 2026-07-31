/**
 * Detecção DETERMINÍSTICA de confirmação de veículo (anti-reapresentação).
 *
 * Extraída de ai.ts para ser pura e testável (PR A7). Reproduz o bug do "Celta":
 * o cliente respondia "sim" após a apresentação e o agente reapresentava o mesmo
 * carro em loop. Aqui, uma confirmação curta logo após o bot apresentar
 * exatamente UM veículo é detectada sem LLM — e o chamador injeta a diretiva
 * de avanço (registrar lead + perguntar troca/pagamento) no contexto.
 *
 * Verificada em server/evals/vehicleConfirmation.test.ts.
 */

/** Confirmações curtas aceitas (mensagem inteira, até 30 chars). */
export const SHORT_CONFIRM = /^(sim|s|isso|quero|gostei|esse|essa|pode ser|bora|fechado|ok|okay|beleza|topo|top|claro|com certeza|tenho interesse|interessa|adorei|curti|show|perfeito)[.!\s]*$/i;

/** Mensagem de bot que "apresenta veículo": tem link /carros/ ou linha "Ano: XXXX". */
export function isVehiclePresentationMessage(content: unknown): boolean {
  if (typeof content !== "string") return false;
  return content.includes("/carros/") || /(^|\n)\s*(Ano|ano)\s*:\s*\d{4}/.test(content);
}

/** Conta quantos veículos distintos uma mensagem apresenta (linhas "Ano: XXXX"). */
export function countPresentedVehicles(content: string): number {
  return (content.match(/Ano\s*:\s*\d{4}/gi) || []).length;
}

/** Extrai o título do veículo apresentado (linha acima de "Ano:"). */
export function extractPresentedTitle(content: string): string {
  const lines = String(content).split("\n");
  const anoIdx = lines.findIndex(l => /^\s*(Ano|ano)\s*:\s*\d{4}/.test(l));
  let title = anoIdx > 0 ? lines[anoIdx - 1].trim() : "";
  if (!title || title.length < 4) title = "o veículo apresentado";
  return title;
}

export interface VehicleConfirmation {
  /** Título do veículo confirmado (extraído da apresentação). */
  vehicleTitle: string;
  /** Mensagem de confirmação do cliente, normalizada. */
  message: string;
}

export interface RecentMessageLike {
  id?: number | null;
  senderType: string;
  content?: unknown;
}

/**
 * Retorna a confirmação detectada ou null.
 * Só confirma quando: mensagem curta de confirmação + última apresentação do bot
 * continha EXATAMENTE um veículo (listas com 2+ são ambíguas → null).
 */
export function detectVehicleConfirmation(
  customerMessage: string,
  recentMessages: RecentMessageLike[],
): VehicleConfirmation | null {
  const msgNorm = (customerMessage || "").trim();
  if (msgNorm.length === 0 || msgNorm.length > 30 || !SHORT_CONFIRM.test(msgNorm)) return null;

  const sorted = [...(recentMessages || [])].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const lastVehicleMsg = [...sorted].reverse().find(m =>
    m.senderType === "bot" && isVehiclePresentationMessage(m.content),
  );
  if (!lastVehicleMsg || typeof lastVehicleMsg.content !== "string") return null;

  if (countPresentedVehicles(lastVehicleMsg.content) !== 1) return null;

  return { vehicleTitle: extractPresentedTitle(lastVehicleMsg.content), message: msgNorm };
}
