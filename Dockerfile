# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# ffmpeg: conversão de áudio; tzdata: fuso America/Sao_Paulo (horário de Brasília)
# fontconfig + font-dejavu: FONTES para o sharp desenhar texto nos criativos (SVG).
# Sem isso, o Alpine não tem fonte e o texto (preço/specs/selos) não aparece.
RUN apk add --no-cache ffmpeg tzdata fontconfig font-dejavu && fc-cache -f
ENV TZ=America/Sao_Paulo

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
