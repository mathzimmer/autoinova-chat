/**
 * Taxonomia de OPCIONAIS/CARACTERÍSTICAS (Vehicle Knowledge Layer — Fase 2).
 *
 * O feed traz `FEATURES` como texto livre com grafia variável ("Teto solar",
 * "Ar-condicionado digital", "Câmera de ré / re", etc.). Aqui normalizamos tudo
 * para um conjunto CANÔNICO de tags (ex: "teto_solar", "camera_re"), permitindo
 * filtros exatos e confiáveis — em vez de LIKE frágil na descrição.
 *
 * Módulo PURO (sem DB) — usado no sync e testável isoladamente.
 */

/** Tag canônica → rótulo amigável (para exibir ao SDR/cliente). */
export const FEATURE_LABELS: Record<string, string> = {
  ar_condicionado: "Ar-condicionado",
  ar_digital: "Ar-condicionado digital",
  bancos_couro: "Bancos em couro",
  teto_solar: "Teto solar",
  teto_panoramico: "Teto panorâmico",
  camera_re: "Câmera de ré",
  sensor_estacionamento: "Sensores de estacionamento",
  multimidia: "Central multimídia",
  carplay: "Apple CarPlay",
  android_auto: "Android Auto",
  controle_cruzeiro: "Controle de cruzeiro",
  cruzeiro_adaptativo: "Controle de cruzeiro adaptativo",
  chave_presencial: "Chave presencial",
  partida_botao: "Partida por botão",
  farol_led: "Farol de LED",
  piloto_automatico: "Piloto automático",
  tracao_4x4: "Tração 4x4",
  blindado: "Blindado",
  sete_lugares: "Sete lugares",
  vidro_eletrico: "Vidros elétricos",
  direcao_eletrica: "Direção elétrica/assistida",
  rodas_liga: "Rodas de liga leve",
  airbag: "Airbags",
  abs: "Freios ABS",
  banco_eletrico: "Bancos elétricos",
  volante_multifuncional: "Volante multifuncional",
  farol_neblina: "Faróis de neblina",
  start_stop: "Start/Stop",
  isofix: "Fixação Isofix",
};

/**
 * Cada tag → lista de padrões (substrings normalizadas). Se QUALQUER padrão
 * aparecer no texto do opcional/descrição, a tag é atribuída. Ordem não importa.
 * Os padrões já vêm sem acento e em minúsculo (comparados contra texto normalizado).
 */
const TAXONOMY: Record<string, string[]> = {
  ar_digital: ["ar digital", "ar-condicionado digital", "ar condicionado digital", "climatizador", "dual zone", "duas zonas"],
  ar_condicionado: ["ar condicionado", "ar-condicionado", "ar cond"],
  bancos_couro: ["couro", "bancos em couro", "revestimento em couro", "leather"],
  teto_panoramico: ["teto panoramico", "teto panorâmico", "panoramic"],
  teto_solar: ["teto solar", "sunroof", "teto eletrico solar"],
  camera_re: ["camera de re", "câmera de ré", "camera re", "camera traseira", "camera 360", "camera de estacionamento"],
  sensor_estacionamento: ["sensor de estacionamento", "sensores de estacionamento", "sensor de re", "sensor traseiro", "sensor dianteiro", "park assist"],
  cruzeiro_adaptativo: ["cruzeiro adaptativo", "acc", "adaptive cruise"],
  controle_cruzeiro: ["controle de cruzeiro", "piloto de velocidade", "cruise control"],
  carplay: ["carplay", "apple carplay"],
  android_auto: ["android auto"],
  multimidia: ["multimidia", "multimídia", "central multimidia", "tela", "mylink", "uconnect", "sync", "media nav", "infotainment"],
  chave_presencial: ["chave presencial", "presence key", "keyless", "smart key", "entrada sem chave"],
  partida_botao: ["partida por botao", "start button", "botao de partida", "start/stop button", "ligar por botao"],
  farol_led: ["farol de led", "farois de led", "led headlight", "iluminacao led", "farol full led"],
  farol_neblina: ["neblina", "farol de milha", "foglight"],
  piloto_automatico: ["piloto automatico", "autopilot", "conducao autonoma", "direcao autonoma"],
  tracao_4x4: ["4x4", "awd", "4wd", "tracao integral", "4 motion", "quattro", "all wheel"],
  blindado: ["blindado", "blindagem", "blindada"],
  sete_lugares: ["7 lugares", "sete lugares", "7 assentos", "terceira fileira"],
  vidro_eletrico: ["vidro eletrico", "vidros eletricos", "vidraceria eletrica"],
  direcao_eletrica: ["direcao eletrica", "direcao assistida", "direcao hidraulica", "power steering"],
  rodas_liga: ["roda de liga", "rodas de liga", "liga leve", "aro de liga", "alloy"],
  banco_eletrico: ["banco eletrico", "bancos eletricos", "ajuste eletrico do banco"],
  volante_multifuncional: ["volante multifuncional", "volante com comandos", "comandos no volante"],
  airbag: ["airbag", "air bag", "air-bag"],
  abs: ["abs", "freios abs"],
  start_stop: ["start stop", "start/stop", "start-stop"],
  isofix: ["isofix"],
};

const norm = (s: any): string => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Recebe opcionais crus + (opcional) descrição/título e devolve as tags canônicas.
 * Ex: ["Teto solar", "Câmera de ré", "Ar digital"] → ["teto_solar","camera_re","ar_digital"].
 */
export function canonicalizeFeatures(rawFeatures: string[] = [], extraText = ""): string[] {
  const haystack = norm([...(rawFeatures || []), extraText].join(" | "));
  const tags = new Set<string>();
  for (const [tag, patterns] of Object.entries(TAXONOMY)) {
    if (patterns.some((p) => haystack.includes(p))) tags.add(tag);
  }
  // "ar_digital" implica "ar_condicionado".
  if (tags.has("ar_digital")) tags.add("ar_condicionado");
  return Array.from(tags);
}

/**
 * Traduz um pedido em texto livre do cliente ("teto solar e couro", "com câmera
 * de ré") para as tags canônicas correspondentes. Usa a mesma taxonomia.
 */
export function tagsFromRequest(text: string): string[] {
  const n = norm(text);
  const tags = new Set<string>();
  for (const [tag, patterns] of Object.entries(TAXONOMY)) {
    if (patterns.some((p) => n.includes(p))) tags.add(tag);
  }
  return Array.from(tags);
}

/** Rótulos amigáveis a partir das tags (para exibir). */
export function labelsForTags(tags: string[] = []): string[] {
  return (tags || []).map((t) => FEATURE_LABELS[t] || t);
}
