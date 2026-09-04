#!/usr/bin/env bash
# Configura o Meta Business Agent inteiro de uma vez, num número novo.
# Uso:  ./setup_meta_agent.sh  PHONE_NUMBER_ID  TOKEN
# Rode DENTRO da pasta meta-agente-config (onde estão os .json).
# Antes: edite conector_estoque_crm.json e troque SEU_DOMINIO_DO_CRM pelo dominio real.

ENTITY_ID="${1:?Uso: ./setup_meta_agent.sh PHONE_NUMBER_ID TOKEN}"
TOKEN="${2:?Informe o token como 2o argumento}"
BASE="https://api.facebook.com/${ENTITY_ID}"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "X-API-Version: 2.0.0" -H "Content-Type: application/json")

echo "== 1) Skill de comportamento (atendente) =="
curl -s -X POST "${AUTH[@]}" -d @skill_atendente.json "${BASE}/agent_config/skills"; echo; echo

echo "== 2) UI Skill: carrossel de veiculos =="
curl -s -X POST "${AUTH[@]}" -d @uiskill_carrossel.json "${BASE}/agent-ui-skills"; echo; echo

echo "== 3) UI Skill: foto unica =="
curl -s -X POST "${AUTH[@]}" -d @uiskill_foto.json "${BASE}/agent-ui-skills"; echo; echo

echo "== 4) Conector: estoque ao vivo (CRM) =="
CONN=$(curl -s -X POST "${AUTH[@]}" -d @conector_estoque_crm.json "${BASE}/agent_connectors")
echo "$CONN"; echo
CID=$(printf '%s' "$CONN" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

if [ -n "$CID" ]; then
  echo "== 5) Ferramenta buscar_veiculos (connector ${CID}) =="
  curl -s -X POST "${AUTH[@]}" -d @tool_buscar_veiculos.json "${BASE}/agent_connectors/${CID}/tools"; echo; echo
else
  echo "!! Conector nao criou (provavel 403 'connectors not enabled' ou dominio nao editado)."
  echo "   Sem conector, o agente atende por texto; as fotos ao vivo dependem dele."
fi

echo "== (opcional) Estoque como arquivo CSV =="
echo "   Se NAO usar o conector, suba o CSV:"
echo "   curl -X POST ${AUTH[*]} -F 'file_name=estoque_autoinova.csv' -F 'file=@estoque_autoinova.csv' ${BASE}/agent_config/files"
echo
echo "PRONTO. Falta cadastrar Informacoes da empresa e FAQs (pela tela do painel,"
echo "ou pelas APIs de agent-knowledge quando voce me mandar a referencia)."
