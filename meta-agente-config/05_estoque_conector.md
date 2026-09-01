# Estoque — Conector + Skill de fotos (carrossel)

O feed do estoque é este JSON (público, sem autenticação):
`https://autoconf-prod.s3.sa-east-1.amazonaws.com/carros-na-serra/642av2OVG5XVCHO5GK8IvGGM5Pqo1JwOYe8swwXv.json`

Estrutura: `ADS.AD[]` (130 veículos). Campos por carro:

| Campo no JSON | Uso |
|---|---|
| `TITLE` | Título do carro (marca/modelo/versão/ano) |
| `PRICE` | Preço (ex.: "138990.00") |
| `YEAR` / `FABRIC_YEAR` | Ano modelo / fabricação |
| `MILEAGE` | KM |
| `FUEL`, `COLOR`, `gear` | Combustível, cor, câmbio |
| `URL` | Link do anúncio (autoinovars.com.br) |
| `IMAGES[].IMAGE_URL` | **Fotos** (URLs públicas — pro carrossel) |
| `DESCRIPTION` | Descrição completa |
| `ID` | Identificador do anúncio |

## Como as fotos são enviadas
O agente manda as fotos **na conversa do WhatsApp** via **UI Skill de carrossel** (`carousel_url`), usando as URLs de `IMAGES`. As URLs vêm da **resposta da ferramenta** (o conector) — o agente não inventa.

## Conector

**Passo 1 — criar o conector** (base URL + auth). Troque `{PHONE_NUMBER_ID}` e o token:

```
curl -X POST "https://api.facebook.com/{PHONE_NUMBER_ID}/agent_connectors" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "X-API-Version: 2.0.0" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Estoque Auto Inova",
    "description": "Feed de estoque de veiculos da Auto Inova (JSON). Buscar carros disponiveis: marca, modelo, ano, preco, km, cor, combustivel, link do anuncio e fotos.",
    "base_url": "https://autoconf-prod.s3.sa-east-1.amazonaws.com",
    "auth_type": "NONE"
  }'
```

A resposta traz o **`id`** do conector (guarde — chamaremos de `CONNECTOR_ID`).

**Passo 2 — criar a ferramenta (tool)** `buscar_veiculos` no conector. Troque
`{PHONE_NUMBER_ID}` e `{CONNECTOR_ID}` (o id que voltou no Passo 1):

```
curl -X POST "https://api.facebook.com/{PHONE_NUMBER_ID}/agent_connectors/{CONNECTOR_ID}/tools" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "X-API-Version: 2.0.0" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "buscar_veiculos",
    "description": "Busca o estoque de veiculos disponiveis da Auto Inova. Use sempre que o cliente quiser ver carros ou perguntar por modelo, marca, faixa de preco ou ano. Retorna a lista em ADS.AD, cada carro com TITLE, MAKE, MODEL, YEAR, MILEAGE (km), PRICE, FUEL, COLOR, URL (link do anuncio), DESCRIPTION e IMAGES (fotos com IMAGE_URL). Filtre voce mesmo os que combinam com o pedido do cliente e mostre em carrossel com foto.",
    "request_definition": {
      "method": "GET",
      "path": "/carros-na-serra/642av2OVG5XVCHO5GK8IvGGM5Pqo1JwOYe8swwXv.json"
    },
    "user_auth_required": false
  }'
```

Retorna o **`id`** da tool. Mapeamento pro agente: título=`TITLE`, preço=`PRICE`,
ano=`YEAR`, km=`MILEAGE`, cor=`COLOR`, combustível=`FUEL`, link=`URL`,
fotos=`IMAGES[].IMAGE_URL`, descrição=`DESCRIPTION`.

**Passo 3 — testar a tool** (opcional, confirma que o feed vem certo):

```
curl -X POST "https://api.facebook.com/{PHONE_NUMBER_ID}/agent_connectors/{CONNECTOR_ID}/tools/{TOOL_ID}/run" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "X-API-Version: 2.0.0" \
  -H "Content-Type: application/json" \
  -d '{"input":"{}"}'
```

Depois é só cadastrar a **UI Skill do carrossel** (abaixo) que o agente passa a mandar as
fotos usando o resultado da `buscar_veiculos`.

> ⚠️ Limitação: esse arquivo devolve os **130 carros de uma vez** (pesado). Serve pra testar, mas o ideal é um endpoint de **busca** que já filtra e devolve poucos carros — ver "Recomendado" no fim.

## UI Skill — carrossel de veículos (cole em Habilidades de UI)
Tipo: **carousel_url**

Instrução:
> Quando o cliente pedir para ver carros, ou perguntar por um modelo/faixa de preço, use a ferramenta buscar_veiculos, selecione até 10 veículos que combinam com o pedido e envie um **carrossel**. Em cada cartão: use a **primeira imagem** de IMAGES (IMAGE_URL) como imagem; no texto do cartão coloque o TITLE, o PRICE formatado em reais e o MILEAGE (ex.: "CHERY Tiggo 8 2022 · R$ 138.990 · 68.800 km"); o botão abre a URL do anúncio com o rótulo "Ver detalhes". Nunca invente carros nem fotos — use apenas o que a ferramenta retornou. Se não houver veículo compatível, diga que no momento não há e ofereça alternativas parecidas.

## UI Skill — foto única (opcional, tipo image)
> Quando o cliente pedir "manda foto do [carro]", envie a primeira imagem (IMAGE_URL) daquele veículo com uma legenda curta (TITLE + preço).

## Recomendado (produção): endpoint de busca no CRM
Em vez de servir os 130 de uma vez, o ideal é um endpoint no seu CRM (ex.: `GET /api/agent/veiculos?q=corolla&max=90000`) que já **filtra** e devolve poucos carros num formato enxuto (title, price, year, km, url, 3 primeiras fotos). Aí o conector aponta pra ele — mais rápido e o agente acerta mais. Posso construir esse endpoint reaproveitando o seu estoque (stockSync) — é rápido.
