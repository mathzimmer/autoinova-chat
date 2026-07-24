#!/usr/bin/env bash
# Deploy na VPS em um comando só. Uso:  ./deploy.sh
# Faz: git pull -> build -> remove containers fantasma -> up -> status.
set -uo pipefail
cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only || { echo "!! git pull falhou"; exit 1; }

echo "==> build"
docker compose -f docker-compose.prod.yml build || { echo "!! build falhou"; exit 1; }

echo "==> removendo containers fantasma (se houver)"
docker rm -f $(docker ps -aq --filter "name=autoinova") 2>/dev/null || true

echo "==> subindo"
docker compose -f docker-compose.prod.yml up -d

echo "==> status"
docker compose -f docker-compose.prod.yml ps

echo ""
echo "Pronto. Se houve migração de banco nova, rode-a manualmente:"
echo "  set -a; source .env; set +a"
echo "  psql \"\$DATABASE_URL\" -f drizzle/migrations_manual/ARQUIVO.sql"
