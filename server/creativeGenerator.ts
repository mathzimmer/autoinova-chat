/**
 * Gerador de criativos de anúncio para veículos.
 *
 * Produz as 3 proporções que a Meta usa (1:1 feed, 4:5 feed vertical, 9:16
 * stories/reels), sem cortar o carro:
 *  - 1:1 e 4:5: uma foto (cover).
 *  - 9:16: DUAS fotos empilhadas (fotos 1 e 2 do estoque) — evita o corte do
 *    formato alto. Se só houver uma foto, usa foto única (cover).
 *
 * Sobre a foto vão: a faixa inferior (preço + specs, com faixa da marca) e os
 * SELOS posicionáveis (texto + ✓), cada um numa posição relativa (0..1) definida
 * pelo usuário no editor.
 *
 * Renderização: sharp compõe as fotos no canvas e sobrepõe um overlay em SVG
 * (faixa, textos e selos). Retorna o buffer JPEG (subido ao S3 por quem chama).
 */
import sharp from "sharp";

export type Selo = { text: string; x: number; y: number }; // x,y em fração 0..1 (canto sup-esq do selo)
export type CreativeStyle = {
  bandColor?: string;   // faixa inferior
  accentColor?: string; // stripe e detalhes
  checkColor?: string;  // ✓ dos selos
};
export type CreativeInput = {
  photoUrls: string[];  // fotos do estoque na ordem (1ª, 2ª, ...)
  price: string;        // ex.: "R$ 98.990"
  specs: string;        // ex.: "Toyota Corolla XEi 2.0 · 2018 · 62.000 km"
  selos: Selo[];
  style?: CreativeStyle;
};

export type AspectRatio = "9x16" | "1x1" | "4x5";
const DIMS: Record<AspectRatio, [number, number]> = {
  "9x16": [1080, 1920],
  "1x1": [1080, 1080],
  "4x5": [1080, 1350],
};

function esc(s: string): string {
  return String(s || "").replace(/[<>&'"]/g, (c) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" } as any
  )[c]);
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`falha ao baixar foto ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function coverResize(buf: Buffer, w: number, h: number): Promise<Buffer> {
  return sharp(buf).resize(w, h, { fit: "cover", position: "centre" }).toBuffer();
}

/** Overlay SVG com faixa (preço/specs) + selos posicionados. */
function buildOverlaySvg(W: number, H: number, input: CreativeInput): string {
  const band = input.style?.bandColor || "#141416";
  const accent = input.style?.accentColor || "#c81420";
  const check = input.style?.checkColor || "#25d366";
  const isTall = H > W;
  const bandH = Math.round(isTall ? H * 0.135 : H * 0.19);
  const stripeH = Math.round(H * 0.006);
  const priceSize = Math.round(W * 0.08);
  const specSize = Math.round(W * 0.03);

  // Selos (largura estimada pelo tamanho do texto — o preview confirma)
  const chipFont = Math.round(W * 0.03);
  const chipH = Math.round(W * 0.055);
  const selosSvg = (input.selos || []).map((s) => {
    const x = Math.round(s.x * W);
    const y = Math.round(s.y * H);
    const tw = Math.round((s.text?.length || 0) * chipFont * 0.55);
    const cw = tw + Math.round(W * 0.095);
    const cy = y + chipH / 2;
    const cx = x + chipH / 2;
    const r = Math.round(W * 0.015);
    return `
      <g>
        <rect x="${x}" y="${y}" width="${cw}" height="${chipH}" rx="${chipH / 2}" fill="${band}" fill-opacity="0.88"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${check}"/>
        <path d="M ${cx - r * 0.45} ${cy} L ${cx - r * 0.1} ${cy + r * 0.4} L ${cx + r * 0.55} ${cy - r * 0.45}"
              stroke="#fff" stroke-width="${Math.max(2, Math.round(W * 0.004))}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="${x + chipH}" y="${cy}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${chipFont}"
              font-weight="bold" fill="#fff" dominant-baseline="central">${esc(s.text)}</text>
      </g>`;
  }).join("");

  const bandY = H - bandH;
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${bandY}" width="${W}" height="${bandH}" fill="${band}"/>
    <rect x="0" y="${bandY}" width="${W}" height="${stripeH}" fill="${accent}"/>
    <text x="${Math.round(W * 0.055)}" y="${bandY + Math.round(bandH * 0.42)}"
          font-family="DejaVu Sans, Arial, sans-serif" font-size="${priceSize}" font-weight="bold"
          fill="#fff" dominant-baseline="central">${esc(input.price)}</text>
    <text x="${Math.round(W * 0.058)}" y="${bandY + Math.round(bandH * 0.78)}"
          font-family="DejaVu Sans, Arial, sans-serif" font-size="${specSize}"
          fill="#cdcdd2" dominant-baseline="central">${esc(input.specs)}</text>
    ${selosSvg}
  </svg>`;
}

/** Gera UMA proporção. Retorna buffer JPEG. */
export async function generateCreative(input: CreativeInput, aspect: AspectRatio): Promise<Buffer> {
  const [W, H] = DIMS[aspect];
  const band = input.style?.bandColor || "#141416";
  const isTall = H > W;
  const bandH = Math.round(isTall ? H * 0.135 : H * 0.19);
  const area = H - bandH; // área das fotos (acima da faixa)

  const urls = (input.photoUrls || []).filter(Boolean);
  if (urls.length === 0) throw new Error("veículo sem fotos");

  const canvas = sharp({ create: { width: W, height: H, channels: 3, background: band } });

  const composites: sharp.OverlayOptions[] = [];
  if (aspect === "9x16" && urls.length >= 2) {
    // duas fotos empilhadas (fotos 1 e 2)
    const half = Math.floor(area / 2);
    const [b0, b1] = await Promise.all([fetchBuffer(urls[0]), fetchBuffer(urls[1])]);
    const top = await coverResize(b0, W, half);
    const bot = await coverResize(b1, W, area - half);
    composites.push({ input: top, top: 0, left: 0 });
    composites.push({ input: bot, top: half, left: 0 });
    // divisória branca fina
    composites.push({ input: { create: { width: W, height: 4, channels: 3, background: "#ffffff" } }, top: half - 2, left: 0 });
  } else {
    // foto única (cover) na área acima da faixa
    const b0 = await fetchBuffer(urls[0]);
    const img = await coverResize(b0, W, area);
    composites.push({ input: img, top: 0, left: 0 });
  }

  // overlay (faixa + preço/specs + selos)
  composites.push({ input: Buffer.from(buildOverlaySvg(W, H, input)), top: 0, left: 0 });

  return canvas.composite(composites).jpeg({ quality: 88 }).toBuffer();
}

/** Gera as 3 proporções de uma vez. */
export async function generateAllCreatives(
  input: CreativeInput,
): Promise<{ aspect: AspectRatio; buffer: Buffer }[]> {
  const aspects: AspectRatio[] = ["1x1", "4x5", "9x16"];
  const out: { aspect: AspectRatio; buffer: Buffer }[] = [];
  for (const a of aspects) {
    out.push({ aspect: a, buffer: await generateCreative(input, a) });
  }
  return out;
}
