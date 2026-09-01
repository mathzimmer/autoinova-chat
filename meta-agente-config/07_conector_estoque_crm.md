# Estoque AO VIVO via CRM (conector do Meta Agent)

Isto substitui o CSV estático: o agente passa a buscar o **estoque atual** direto no
seu CRM, com as **fotos** vindas de uma ferramenta — que é o que faz o carrossel/imagem
funcionar de verdade.

## O que já foi feito no CRM (deploy necessário)
- Endpoint público: **`GET /api/agent/vehicles`**
  - Parâmetros: `q` (termo livre: modelo/marca/tipo), `max_price`, `min_price`, `year_min`, `fuel`, `limit`.
  - Retorna: `{ total, vehicles: [{ id, titulo, marca, modelo, ano, km, preco, cor, combustivel, cambio, link, fotos: [urls] }] }`.
  - Curadoria do estoque aplicada (esconde barco, sem preço/foto, etc.).
  - Chave opcional: se definir `AGENT_API_KEY` no `.env`, exija `?key=...` (ou header `x-api-key`).

Teste depois do deploy (troque o domínio):
```
curl "https://SEU_DOMINIO_DO_CRM/api/agent/vehicles?q=corolla&max_price=170000"
```

## Passo 1 — criar o conector (aponta pro seu CRM)
Edite `conector_estoque_crm.json` e troque `https://SEU_DOMINIO_DO_CRM` pelo domínio real
do seu CRM. Depois:
```
curl -X POST -H "Authorization: Bearer SEU_TOKEN" -H "X-API-Version: 2.0.0" -H "Content-Type: application/json" -d @conector_estoque_crm.json "https://api.facebook.com/1175003809040816/agent_connectors"
```
Guarde o `id` retornado = `CONNECTOR_ID`.

## Passo 2 — criar a ferramenta buscar_veiculos
```
curl -X POST -H "Authorization: Bearer SEU_TOKEN" -H "X-API-Version: 2.0.0" -H "Content-Type: application/json" -d @tool_buscar_veiculos.json "https://api.facebook.com/1175003809040816/agent_connectors/CONNECTOR_ID/tools"
```

## Passo 3 — as UI Skills já criadas passam a usar a ferramenta
As skills `carrossel-veiculos` e `foto-veiculo` já existem. Com a ferramenta ativa, o
agente pega as fotos do campo `fotos` da resposta da `buscar_veiculos` → **envia as fotos**.
(Se precisar, ajusto o texto das UI skills pra citar a ferramenta explicitamente.)

## Observações
- **Conector precisa estar habilitado** no número. No número de teste deu 403
  ("connectors not enabled"); no **número real/produção** costuma liberar (às vezes após
  configurar forma de pagamento). Sem conector, o agente atende por texto/arquivo, mas
  não envia foto de forma confiável.
- Quando ligar o conector do CRM, **remova o arquivo CSV** do conhecimento (pra não ter
  estoque duplicado/desatualizado) — deixe só a ferramenta ao vivo.
- O endpoint é público como o site. Se quiser fechar, defina `AGENT_API_KEY` e use
  `auth_type: API_KEY` no conector (eu ajusto o JSON).
