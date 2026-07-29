#!/usr/bin/env bash
# Deploy na VPS em um comando só. Uso:  ./deploy.sh
# Faz: git pull -> build -> MIGRAÇÕES pendentes -> up -> status.
#
# As migrações ficam em drizzle/migrations_manual/*.sql e são aplicadas
# automaticamente, na ordem do nome do arquivo (por isso o prefixo de data).
# Uma tabela de controle (schema_migrations) registra o que já rodou, então
# nenhuma migração roda duas vezes.
#
# IMPORTANTE (só afeta a PRIMEIRA execução): na primeira vez que este script
# roda, a tabela schema_migrations é criada e TODAS as migrações que já existem
# no repo são marcadas como "já aplicadas" (baseline), porque no banco de
# produção elas já foram aplicadas manualmente. A partir daí, só migrações
# NOVAS (arquivos que aparecerem depois) rodam sozinhas.
set -uo pipefail
cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only || { echo "!! git pull falhou"; exit 1; }

echo "==> build"
docker compose -f docker-compose.prod.yml build || { echo "!! build falhou"; exit 1; }

echo "==> migrações de banco"
# carrega DATABASE_URL do .env
set -a; source .env 2>/dev/null; set +a
if [ -z "${DATABASE_URL:-}" ]; then
  echo "!! DATABASE_URL não definido no .env — abortando antes de subir código novo"
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "!! psql não encontrado no host — instale com: apt-get install -y postgresql-client"
  exit 1
fi

MIG_DIR="drizzle/migrations_manual"

# a tabela de controle já existe? (para decidir se é a primeira vez = baseline)
TABLE_EXISTS=$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL;")
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  'CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());' \
  || { echo "!! não consegui criar schema_migrations — abortando"; exit 1; }

if [ "$TABLE_EXISTS" != "t" ]; then
  echo "   (primeira execução) marcando migrações existentes como baseline..."
  for f in "$MIG_DIR"/*.sql; do
    [ -e "$f" ] || continue
    psql "$DATABASE_URL" -q -c \
      "INSERT INTO schema_migrations(filename) VALUES ('$(basename "$f")') ON CONFLICT DO NOTHING;" >/dev/null
  done
  echo "   baseline concluído — nada será re-aplicado."
fi

# aplica as pendentes, em ordem
APPLIED=0
for f in $(ls "$MIG_DIR"/*.sql 2>/dev/null | sort); do
  name=$(basename "$f")
  seen=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name';")
  if [ "$seen" = "1" ]; then
    continue
  fi
  echo "   + aplicando $name ..."
  # migração + registro na MESMA transação: ou aplica tudo, ou nada
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
        -f "$f" \
        -c "INSERT INTO schema_migrations(filename) VALUES ('$name');" >/dev/null; then
    echo "     ok"
    APPLIED=$((APPLIED+1))
  else
    echo "!! FALHA na migração $name — deploy abortado (código novo NÃO subiu)"
    exit 1
  fi
done
[ "$APPLIED" -eq 0 ] && echo "   nenhuma migração pendente."

echo "==> subindo (recria só o que mudou)"
# NÃO removemos o container manualmente — isso confundia o compose e derrubava o app.
# O compose recria sozinho o autoinova quando a imagem muda.
docker compose -f docker-compose.prod.yml up -d --remove-orphans || {
  echo "!! up falhou (conflito de nome). Removendo container antigo e recriando..."
  # container_name fixo (autoinova) impede o rolling-recreate: remove o antigo e sobe
  docker rm -f autoinova 2>/dev/null || true
  docker compose -f docker-compose.prod.yml up -d --remove-orphans
}

echo "==> status"
docker compose -f docker-compose.prod.yml ps

echo ""
echo "Pronto. Migrações pendentes foram aplicadas automaticamente antes de subir o código."
