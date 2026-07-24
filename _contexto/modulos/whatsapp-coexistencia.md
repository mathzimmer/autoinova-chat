# Módulo: Conexão de WhatsApp (Cadastro Incorporado + API Oficial + Coexistência)

Objetivo: conectar números WhatsApp a um sistema, via fluxo oficial da Meta
(Embedded Signup), rodando **em coexistência** com o app WhatsApp Business, e
gerenciar vários números com **um token de provedor (System User)** compartilhado.
Documentado para ser **reaproveitado em outro sistema** com o mínimo de mudança.

## Ideia central (o modelo de provedor)

- Seu app é um **Tech Provider** verificado num portfólio da Meta.
- Cada número de cliente é onboardado via **Embedded Signup**, escolhendo um
  portfólio que **não** seja o dono do app (o dono fica bloqueado — é regra da Meta).
- O envio/recebimento de TODOS os números usa **um único token de System User**
  do provedor (`WHATSAPP_SYSTEM_USER_TOKEN`). Não há token por número.
- Ao conectar, o app **assina a WABA** no webhook (`POST /{waba_id}/subscribed_apps`)
  para as mensagens chegarem.

## Peças (arquivos neste projeto)

Frontend (React):
- `client/src/pages/Settings.tsx` → componente `WhatsAppConnectCard`:
  - Carrega o SDK do Facebook de forma robusta (detecta bloqueador/timeout).
  - `FB.login` com `config_id` e `featureType: whatsapp_business_app_onboarding`
    (o fluxo de COEXISTÊNCIA). **Callback tem de ser função comum, não `async`.**
  - Escuta o evento `WA_EMBEDDED_SIGNUP` → pega `waba_id` + `phone_number_id`.
  - Chama `whatsappNumber.connectFromSignup` → salva e assina em 1 clique.

Backend (Node/tRPC):
- `server/whatsappMultiNumber.ts` → coração do módulo:
  - `getTokenForNumber()` cai no `WHATSAPP_SYSTEM_USER_TOKEN` quando o número
    não tem token próprio (é o token do provedor).
  - `subscribeWabaToApp(wabaId, token?)` → `POST /{waba_id}/subscribed_apps`.
  - `connectNumberFromSignup({wabaId, phoneNumberId, ...})` → assina + salva.
  - `createWhatsappNumber()` (upsert por phoneNumberId), envio de texto/mídia/
    botões/lista por número.
- `server/officialInstance.ts` → `handleOfficialMessage()`: processa o webhook da
  Meta (mensagens recebidas), espelha no inbox, dispara IA/fluxos.
- `server/routers.ts` → `whatsappNumberRouter`: `listInstances`, `createInstance`,
  `connectFromSignup`, `deleteInstance`.
- `server/_core/index.ts` → rota do webhook da Meta que roteia para o número certo
  por `phone_number_id` e chama `handleOfficialMessage`.

Banco:
- Tabela `whatsappNumbers` (drizzle/schema.ts): `phoneNumberId` (único), `wabaId`,
  `displayName`, `phoneDisplay`, `accessToken` (opcional), `isActive`, etc.

## Variáveis de ambiente

- `META_APP_ID` / `META_CONFIG_ID` — id do app e da config do Embedded Signup.
- `WHATSAPP_SYSTEM_USER_TOKEN` — token de System User do provedor (envio + assinatura).
- (opcional) `META_APP_SECRET` — só se for usar a troca de código (não usada no
  modelo de provedor).

## Fluxo ponta a ponta

1. Usuário clica "Conectar WhatsApp" → popup da Meta (Embedded Signup, coexistência).
2. Escolhe portfólio (≠ dono do app) e o número.
3. Front recebe `waba_id` + `phone_number_id` via `postMessage`.
4. `connectFromSignup` → `subscribeWabaToApp` (webhook) + `createWhatsappNumber` (salva).
5. Meta manda as mensagens no webhook do app → `handleOfficialMessage` → inbox + IA.
6. Envio usa o token do provedor + `phone_number_id`.

## Para portar a outro sistema (checklist)

- [ ] Copiar `whatsappMultiNumber.ts` e `officialInstance.ts` (adaptar imports de db/media/ai).
- [ ] Criar a tabela `whatsappNumbers` equivalente.
- [ ] Expor as rotas: listar, connectFromSignup, deletar.
- [ ] Adaptar o `WhatsAppConnectCard` (React) — trocar `META_APP_ID`/`META_CONFIG_ID`.
- [ ] Rota de webhook da Meta que roteia por `phone_number_id`.
- [ ] Setar `WHATSAPP_SYSTEM_USER_TOKEN` no ambiente.
- [ ] No app da Meta: configurar o webhook (URL + verify token) e as permissões
      `whatsapp_business_messaging` + `whatsapp_business_management`.

## Armadilhas que já resolvemos (não repetir)

- Callback do `FB.login` **não pode ser `async`** ("Expression is of type
  asyncfunction, not function"). Use função comum + IIFE async dentro.
- O SDK do Facebook (`connect.facebook.net`) é **bloqueado por adblock/rastreamento**
  — tratar com onerror/timeout e mostrar aviso, senão fica em spinner infinito.
- O portfólio **dono do app** fica bloqueado no seletor — escolha outro.
- No modelo de provedor, **não** troque o `code` por token (dá erro de redirect_uri
  e não é necessário) — use o token de System User.
- Lembrar de rodar a migração da coluna `wabaId` antes de salvar números.
