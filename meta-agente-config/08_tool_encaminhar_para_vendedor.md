# Ferramenta `encaminhar_para_vendedor` (handoff estruturado)

Em vez de adivinhar o carro pelo texto de despedida do agente, o **próprio agente**
chama esta ferramenta no handoff e manda dado **estruturado**. O CRM então roteia
pro **vendedor certo pela loja do carro** (`vehicle_id` → loja → vendedor ativo em
rodízio), grava o lead (nome, troca, pagamento, resumo), notifica o vendedor e
encaminha as fotos que o cliente mandou.

## O que o CRM já expõe (precisa de deploy)
- `POST /api/agent/encaminhar` (aceita GET também, pra teste).
  - Params: `telefone` (obrigatório), `vehicle_id`, `nome`, `cidade`, `intencao`
    (`vendas`|`compras`|`posvenda`), `tem_troca`, `troca`, `pagamento`, `entrada`, `resumo`.
  - Autenticação: a mesma `AGENT_API_KEY` — aceita `?key=`, header `x-api-key`,
    **`X-Agent-Key`** (é o que o connector usa) ou `Authorization: Bearer`.
  - Idempotente: um handoff por conversa.
  - Resposta: `{ ok, seller, store, vehicle, mensagem }`.

> ⚠️ O connector `Auto_Inova_Estoque_CRM` tem `base_url = https://autoinovacrm.com.br/api/agent`,
> então o **path da tool é `/encaminhar`** (relativo), e a chave vai no header
> `X-Agent-Key` automaticamente — o JSON da tool não precisa declarar auth.
> CONNECTOR_ID (estoque, produção):
> `pfbid05PCgLezaQ7WFG7VEPgKrNyYoLG4weCmrx6374VF3YepV1GaMf2dt5kSKNhwGnadU7kEYfK5kWEEewm5iTGZipzEs1VvngBDtqErkl`

## Teste rápido (depois do deploy)
```
curl -X POST "https://autoinovacrm.com.br/api/agent/encaminhar?key=SEU_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"telefone":"5551999887766","vehicle_id":525466,"nome":"Justino","intencao":"vendas","pagamento":"financiado","resumo":"Quer a Belina 1985, financiado"}'
```
Deve retornar o vendedor/loja escolhidos e criar a notificação no chat da conversa.

## Registrar a ferramenta no conector (mesmo conector do estoque)
Use o `CONNECTOR_ID` do estoque (o mesmo do `buscar_veiculos`):
```
curl -X POST \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "X-API-Version: 2.0.0" \
  -H "Content-Type: application/json" \
  -d @tool_encaminhar_para_vendedor.json \
  "https://api.facebook.com/1281722165024667/agent_connectors/CONNECTOR_ID/tools"
```
> O `base_url` do conector já é `https://autoinovacrm.com.br` e a chave `?key=`
> é anexada automaticamente — então a tool só precisa do `path`.

## Dica de skill
Reforce no texto do agente (habilidades): "Quando o cliente confirmar interesse em um
carro, pedir para falar com um vendedor, quiser visitar/negociar, ou quiser vender/
consignar o carro dele, **chame a ferramenta `encaminhar_para_vendedor`** com o
`vehicle_id` do carro e os dados do cliente — não apenas se despeça."
