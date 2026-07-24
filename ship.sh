#!/usr/bin/env bash
# Enviar alterações em um comando só (rode no seu Mac). Uso:
#   ./ship.sh "mensagem do commit"
# Faz: git add -A -> commit -> push para o branch atual.
set -uo pipefail
cd "$(dirname "$0")"

msg="${1:-atualizacoes}"
branch="$(git branch --show-current)"

# Remove trava presa, se houver (sobra de processo git interrompido)
[ -f .git/index.lock ] && rm -f .git/index.lock

echo "==> arquivos alterados:"
git status --short

git add -A
git commit -m "$msg" || { echo "(nada para commitar)"; }
git push origin "$branch"

echo ""
echo "Enviado para origin/$branch. Agora na VPS rode:  ./deploy.sh"
