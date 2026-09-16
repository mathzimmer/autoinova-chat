/**
 * Feed de catálogo VEHICLES (inventário) para o Facebook/Meta Commerce.
 *
 * Gera um CSV no formato oficial de catálogo de veículos da Meta, direto do
 * estoque do CRM — com VÁRIAS fotos por anúncio e campos completos (ano, km,
 * câmbio, combustível, cor, etc.), ao contrário do feed simples do Autocon.
 *
 * O Facebook agenda e re-processa a URL sozinho, então o catálogo fica sempre
 * atualizado com o estoque real.
 *
 * Referência de campos:
 * https://developers.facebook.com/docs/marketplace/vehicles/listings/
 */
/** Lojas da Auto Inova. O endereço do anúncio é escolhido pelo locationCity do veículo. */
const STORES = {
  matriz: {
    name: "Auto Inova Ivoti - Matriz",
    addr1: "Av. Castro Alves, 1655 - Sete de Setembro",
    city: "Ivoti", region: "RS", postal_code: "93900-000", country: "BR",
  },
  estanciaVelha: {
    name: "Auto Inova Estância Velha",
    addr1: "Rua Portão, 2405 - Das Quintas",
    city: "Estância Velha", region: "RS", postal_code: "93615-740", country: "BR",
  },
} as const;

/** Escolhe a loja pelo locationCity do veículo (default = Matriz Ivoti). */
function pickStore(v: any) {
  const city = (v.locationCity || "").toLowerCase();
  if (city.includes("estância") || city.includes("estancia")) return STORES.estanciaVelha;
  return STORES.matriz;
}

const DEALER = STORES.matriz; // usado só em textos/fallback

const MAX_IMAGES = 10;
const SITE = "https://autoinovars.com.br";

function esc(val: any): string {
  const s = val == null ? "" : String(val);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function mapFuel(fuel?: string): string {
  const f = (fuel || "").toLowerCase();
  if (!f) return "OTHER";
  if (f.includes("flex")) return "FLEX";
  if (f.includes("diesel")) return "DIESEL";
  if (f.includes("elétr") || f.includes("eletr")) return "ELECTRIC";
  if (f.includes("híbr") || f.includes("hibr")) return "HYBRID";
  if (f.includes("gasol")) return "GASOLINE";
  if (f.includes("álco") || f.includes("alco") || f.includes("etanol")) return "FLEX";
  return "OTHER";
}

function mapTransmission(t?: string): string {
  const s = (t || "").toLowerCase();
  if (s.includes("auto") || s.includes("cvt") || s.includes("automát")) return "AUTOMATIC";
  return "MANUAL";
}

function mapBodyStyle(category?: string, vehicleType?: string): string {
  const s = `${category || ""} ${vehicleType || ""}`.toLowerCase();
  if (s.includes("hatch")) return "HATCHBACK";
  if (s.includes("sedã") || s.includes("seda")) return "SEDAN";
  if (s.includes("suv") || s.includes("utilitário esport")) return "SUV";
  if (s.includes("picape") || s.includes("pickup") || s.includes("caminhon")) return "PICKUP";
  if (s.includes("van") || s.includes("furgão") || s.includes("furgao")) return "VAN";
  if (s.includes("coup")) return "COUPE";
  if (s.includes("perua") || s.includes("wagon") || s.includes("sw")) return "WAGON";
  if (s.includes("convers")) return "CONVERTIBLE";
  return "OTHER";
}

function mapState(condition?: string): string {
  const c = (condition || "").toLowerCase();
  if (c.includes("nov") || c === "0km" || c.includes("zero")) return "NEW";
  return "USED";
}

function imagesOf(v: any): string[] {
  const out: string[] = [];
  const push = (u: any) => {
    if (typeof u === "string" && /^https?:\/\//i.test(u.trim())) out.push(u.trim());
  };
  if (Array.isArray(v.images)) v.images.forEach(push);
  if (out.length === 0 && v.imageUrl) push(v.imageUrl);
  // dedup mantendo ordem
  return Array.from(new Set(out)).slice(0, MAX_IMAGES);
}

const HEADERS = [
  "vehicle_id",
  "title",
  "description",
  "url",
  "make",
  "model",
  "year",
  "mileage.value",
  "mileage.unit",
  "price",
  "state_of_vehicle",
  "availability",
  "condition",
  "exterior_color",
  "fuel_type",
  "transmission",
  "body_style",
  "vehicle_registration_plate",
  "address",
  ...Array.from({ length: MAX_IMAGES }, (_, i) => `image[${i}].url`),
];

/**
 * Gera o CSV completo do catálogo Vehicles a partir do estoque do CRM.
 * `injectedRows` permite injetar linhas em testes; em produção lê do banco.
 */
export async function buildFacebookVehiclesCsv(injectedRows?: any[]): Promise<string> {
  const rows = injectedRows ?? (await (await import("./stockSync")).getAllCuratedVehicles());

  const lines: string[] = [HEADERS.join(",")];

  for (const v of rows) {
    const imgs = imagesOf(v);
    if (imgs.length === 0) continue; // Facebook exige ao menos 1 foto

    const store = pickStore(v);
    const addressJson = JSON.stringify({
      addr1: store.addr1,
      city: store.city,
      region: store.region,
      postal_code: store.postal_code,
      country: store.country,
    });

    const title = (v.title || `${v.brand} ${v.model} ${v.version || ""}`).trim().slice(0, 150);
    const description = (v.description ||
      `${v.brand} ${v.model} ${v.version || ""} ${v.year || ""} - ${v.mileage != null ? v.mileage + " km" : ""} - ${store.name}, ${store.city}/${store.region}.`)
      .replace(/\s+/g, " ").trim().slice(0, 5000);
    const url = v.url || SITE;
    const priceNum = Number(v.promotionPrice || v.price || 0);

    const state = mapState(v.condition);
    const cols = [
      v.externalId ?? v.id,                       // vehicle_id
      title,                                       // title
      description,                                 // description
      url,                                         // url
      v.brand || "",                               // make
      v.model || "",                               // model
      v.year || "",                                // year
      v.mileage != null ? v.mileage : "",          // mileage.value
      "KM",                                        // mileage.unit
      priceNum > 0 ? `${priceNum} BRL` : "",       // price
      state,                                       // state_of_vehicle
      "available",                                 // availability
      state === "NEW" ? "NEW" : "EXCELLENT",       // condition
      v.color || "",                               // exterior_color
      mapFuel(v.fuel),                             // fuel_type
      mapTransmission(v.transmission),             // transmission
      mapBodyStyle(v.category, v.vehicleType),     // body_style
      "",                                          // vehicle_registration_plate (placa mascarada -> vazio)
      addressJson,                                 // address
      ...Array.from({ length: MAX_IMAGES }, (_, i) => imgs[i] || ""),
    ];

    lines.push(cols.map(esc).join(","));
  }

  return lines.join("\n");
}

// ─── Feed E-COMMERCE (produto) ────────────────────────────────────────────────
// O WhatsApp Business só vincula catálogo do tipo "E-commerce" (produtos), não
// o tipo "Veículos". Este feed gera cada carro como PRODUTO, no formato oficial
// do catálogo de produtos da Meta, pra ser usado como fonte de conhecimento do
// Meta Business Agent (e vitrine de produtos na conversa).
// Ref: https://www.facebook.com/business/help/120325381656392
const PRODUCT_HEADERS = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "additional_image_link",
  "brand",
  "product_type",
  "custom_label_0", // ano
  "custom_label_1", // km
  "custom_label_2", // câmbio
  "custom_label_3", // combustível
  "custom_label_4", // loja
];

function mapProductCondition(condition?: string): string {
  return mapState(condition) === "NEW" ? "new" : "used";
}

/**
 * Gera o CSV de PRODUTOS (catálogo e-commerce) a partir do estoque do CRM.
 * `injectedRows` permite injetar linhas em testes; em produção lê do banco.
 */
export async function buildFacebookProductsCsv(injectedRows?: any[]): Promise<string> {
  const rows = injectedRows ?? (await (await import("./stockSync")).getAllCuratedVehicles());

  const lines: string[] = [PRODUCT_HEADERS.join(",")];

  for (const v of rows) {
    const imgs = imagesOf(v);
    if (imgs.length === 0) continue; // Meta exige ao menos 1 imagem por produto

    const store = pickStore(v);
    const title = (v.title || `${v.brand || ""} ${v.model || ""} ${v.version || ""} ${v.year || ""}`)
      .replace(/\s+/g, " ").trim().slice(0, 150);

    // Descrição limpa: specs + opcionais do veículo (sem telefone/endereço cru).
    const opcionais = (Array.isArray(v.features) ? v.features.filter(Boolean) : []) as string[];
    const specs = [
      v.year ? `Ano ${v.year}` : "",
      v.mileage != null ? `${Number(v.mileage).toLocaleString("pt-BR")} km` : "",
      mapTransmission(v.transmission) === "AUTOMATIC" ? "Câmbio automático" : "Câmbio manual",
      v.fuel ? `Combustível ${v.fuel}` : "",
    ].filter(Boolean).join(". ");
    const opcTxt = opcionais.length ? ` Opcionais: ${Array.from(new Set(opcionais)).slice(0, 20).join(", ")}.` : "";
    const description = `${title}. ${specs}.${opcTxt} ${store.name}, ${store.city}/${store.region}.`
      .replace(/\s+/g, " ").trim().slice(0, 5000);

    const url = v.url || SITE;
    // Preço COM TROCA (valor de tabela / "De") — é o que o atendimento usa.
    const priceNum = Number(v.price || v.promotionPrice || 0);
    if (!(priceNum > 0)) continue; // produto sem preço não entra

    const productType = [v.category, v.vehicleType].filter(Boolean).join(" > ") || "Veículos";

    const cols = [
      v.externalId ?? v.id,                                   // id
      title,                                                  // title
      description,                                            // description
      "in stock",                                             // availability
      mapProductCondition(v.condition),                       // condition
      `${priceNum.toFixed(2)} BRL`,                           // price ex.: 64990.00 BRL
      url,                                                    // link
      imgs[0],                                                // image_link (principal)
      imgs.slice(1).join(","),                                // additional_image_link
      v.brand || "",                                          // brand
      productType,                                            // product_type
      v.year || "",                                           // custom_label_0 (ano)
      v.mileage != null ? `${v.mileage} km` : "",             // custom_label_1 (km)
      mapTransmission(v.transmission) === "AUTOMATIC" ? "Automático" : "Manual", // custom_label_2
      v.fuel || "",                                           // custom_label_3 (combustível)
      store.name,                                             // custom_label_4 (loja)
    ];

    lines.push(cols.map(esc).join(","));
  }

  return lines.join("\n");
}
