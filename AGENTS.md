# AGENTS.md — Guia do projeto (autoinova-chat)

Contexto para agentes de IA que forem trabalhar neste repositório. Leia antes de editar.

## O que é
CRM de WhatsApp para a **Auto Inova** (revenda de seminovos — Ivoti/RS e Estância Velha).
Atende leads pelo WhatsApp com IA, apresenta veículos do estoque, qualifica o lead e faz
handoff para vendedor. Inclui inbox, funil, campanhas, Meta Ads, coach de vendas e copiloto.

## Stack
- **Backend:** TypeScript + tRPC + Drizzle ORM + PostgreSQL. Entrada em `server/_core/index.ts` (Express + tRPC + webhooks).
- **Frontend:** React + Vite + wouter (rotas) + Tailwind + shadcn/ui. Em `client/src`.
- **Testes:** Vitest (`*.test.ts`). Typecheck: `npx tsc --noEmit` (sempre rodar antes de dar por pronto).
- **LLM:** hoje o CRM usa o LLM nativo (Forge, `server/_core/llm.ts`) via `openaiLLM.ts` (cai pra OpenAI se houver `OPENAI_API_KEY`). O agente novo (v2) usa **OpenRouter** se houver `OPENROUTER_API_KEY`, senão o mesmo caminho do CRM.

## Deploy (importante)
Fluxo por git, dois scripts na raiz:
- No Mac: `./ship.sh "mensagem"` → `git add -A` + commit + push (branch atual).
- Na VPS (`~/autoinova`): `./deploy.sh` → `git pull` + build Docker + **migrações** + up.
- Migrações ficam em `drizzle/migrations_manual/*.sql` (aplicadas em ordem por data; tabela `schema_migrations` controla). **Só crie migração se mudar o schema.** Mudanças que usam apenas `settings` ou `conversation.metadata` NÃO precisam de migração.
- Container: `autoinova`. Logs: `docker logs autoinova --tail N`.

## Fluxo de uma mensagem recebida
1. Webhook Meta chega em `POST /api/webhook/whatsapp` (`server/_core/index.ts`).
2. Assinatura verificada com **múltiplos App Secrets** (qualquer env que comece com `META_APP_SECRET`, ex.: `META_APP_SECRET`, `META_APP_SECRET_filial`). Suporta números em apps Meta diferentes.
3. Roteia por `phone_number_id` → instância registrada (`whatsappNumbers`). `mode`:
   - `normal` → atendimento normal (fluxo/IA).
   - `meta_agent` → `handleMetaAgentWebhook` (observa/handoff; o agente da Meta responde).
4. Instâncias/canais: Matriz (env default, desativável via `isMatrizActive`), Zernio (`zernio:`), Oficial (`official:`), Evolution. Cada número guarda **wabaId + accessToken + mode** próprios (`server/whatsappMultiNumber.ts`). Resolução de quem responde: `server/agentResolver.ts` (fixado → instância → padrão).

## Os DOIS agentes (atenção)
### 1) Agente atual (legado, em produção) — `server/ai.ts`
- `processAIMessage()` monta prompt em 4 camadas: CORE + COMMERCIAL + PERSONALITY + CONTEXTO, roda um loop de tool-calls e devolve texto + mensagens interativas (botões/lista/foto).
- Prompt: camadas editáveis por setting (`ai_core_prompt`, `ai_commercial_prompt`, `ai_personality_prompt`) com defaults nas constantes `CORE_PROMPT`/`COMMERCIAL_PROMPT`/`DEFAULT_PERSONALITY_PROMPT`. Editadas na tela **Agentes** e **Configurações**.
- Tools (array `TOOLS` em `ai.ts`): `buscar_veiculos`, `resumo_estoque`, `atualizar_lead`, `buscar_veiculo_por_id`, `enviar_botoes`, `apresentar_veiculo`, `enviar_lista`, `transferir_para_vendedor`.
- **Correções recentes (importantes):**
  - Memória de veículos mostrados em `conversation.metadata.shownVehicles` + injeção no contexto (funciona no modo agente, não só fluxo). Antes o `[ID:X]` se perdia entre turnos → "apresenta e diz que não tem".
  - Confirmação determinística: `resolveConfirmedVehicleId()` grava `lead.vehicleId` sem chutar.
  - Anti-invenção: bloco **"INFORMAÇÕES OFICIAIS DA LOJA"** sempre injetado (setting `ai_business_info`, default `DEFAULT_BUSINESS_INFO` com as 3 lojas). Tela: Configurações → Informações da loja.
  - `apresentar_veiculo` configurável por setting `apresentar_veiculo_config` (campos + template). Tela: Configurações.
- Observabilidade: cada tool-call é gravada em `aiDecisions` (`createAiDecisionsBatch`) → router `aiDecision` → tela **Auditoria IA**. Também nos logs `[AI] Tool calls:`.

### 2) Agente v2 (NOVO, isolado, em construção) — `server/agentV2.ts`
- Objetivo: reconstruir o agente do zero (limpo), afinar no **simulador** e depois plugar no sistema, substituindo o `ai.ts`.
- Isolado: NÃO toca webhook/conversas/fluxo. Estoque do CRM **somente leitura** (`getAllCuratedVehicles`, `getVehicleById`).
- LLM: OpenRouter (`OPENROUTER_API_KEY`) → senão cai no `invokeAgentLLM` (OpenAI/Forge).
- Tools: `buscar_veiculos` (busca RICA: filtra tipo/categoria com sinônimos SUV/sedan/hatch/picape/4x4/moto, cor, câmbio, combustível, **opcionais** via `features`+descrição, preço, ano; **flexibilidade**: sem match exato devolve alternativas na mesma faixa), `apresentar_veiculo` (foto + opcionais), `transferir_para_vendedor` (simulado).
- Config editável AO VIVO (settings, sem deploy): `agentv2_model`, `agentv2_persona`, `agentv2_rules`, `agentv2_temperature`, `agentv2_tools` (descrição + on/off por ferramenta). Memória de veículos por sessão fica na RAM (`SESSIONS` Map).
- Router: `server/routers/agentV2.ts` (`chat`, `reset`, `getConfig`/`setConfig`, `getTools`/`setTools`).
- Tela: `client/src/pages/AgentSandbox.tsx` (menu **Simulador IA**, rota `/agente-simulador`). Mostra conversa + fotos + **trace das ferramentas**.
- Próximos passos previstos: ligar num número de WhatsApp de teste (rota isolada) e, quando aprovado, plugar no sistema. Nível 2 pendente: builder de ferramentas HTTP (conectores) pela tela.

## Estoque — `server/stockSync.ts`
- Sincroniza do feed JSON do **Autocon** (S3) → tabela `vehicles`. Mapeia: brand, model, version, title, year, price/regularPrice/promotionPrice, mileage, **color**, **transmission** (auto/manual), fuel, **category** (CATEGORY), **vehicleType** (BODY), condition, doors, **description**, **features** (opcionais), images[], url, locationCity.
- `passesStockCuration()` esconde lixo (barco, sem preço/foto). `getAllCuratedVehicles()` = todos disponíveis+curados. `searchVehiclesStructured()` = busca estruturada com fotos (usada pelo endpoint do agente Meta).
- Config de curadoria/campos: tela **Estoque IA** (`getStockAiConfig`).
- Endpoints públicos: `GET /api/agent/vehicles` (JSON, pro conector Meta) e `GET /api/catalog/facebook.csv` (feed do catálogo Facebook — `server/catalogFeed.ts`, formato Vehicles, várias fotos, endereço por loja via `locationCity`).

## Meta Business Agent — `server/metaAgent.ts` + `meta-agente-config/`
- Opção A: agente da Meta é o respondedor primário; o CRM **observa (standby)** e assume no **handoff**.
- Config (skills, UI skills, conector, arquivos, site) via scripts em `meta-agente-config/` (`setup_meta_agent.sh`).
- Bloqueios conhecidos (lado Meta): **billing** (agente não entrega sem forma de pagamento na conta faturável) e **conector 400** (provável verificação de domínio). Não são bugs do código.

## Copiloto e Coach
- `server/sellerCopilot.ts` (sugestões ao vendedor, faixa acima do input) e `server/salesCoach.ts` (dicas ao vivo + avaliação início/meio/fim + aprendizado). Telas: conversa (faixa) + **Coach**. Config em Configurações.

## Convenções
- Sempre `npx tsc --noEmit` verde antes de finalizar. Rode testes relevantes quando houver.
- **Vitest é instável neste sandbox** (esbuild EPIPE ao carregar config). Alternativa p/ smoke test de funções puras: `node --experimental-strip-types arquivo.ts` (o código só pode ter tipos, sem enums/decorators).
- Settings: use `getSetting`/`upsertSetting` (router `settings.save`/`getAll` genéricos existem). Prefira endpoints dedicados quando precisar de default.
- Telas de config seguem o padrão de `client/src/pages/Settings.tsx` (Card + trpc query/mutation + toast).
- Não exponha caminhos internos ao usuário. Mensagens de UI em PT-BR.

## Segurança (LEIA)
- **Nunca** commitar tokens/segredos. Segredos vão só no `.env` da VPS (`META_APP_SECRET*`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `DATABASE_URL`, etc.).
- O usuário já colou tokens/senha reais em conversas no passado — se encontrar algum exposto, **oriente a rotacionar** e não repita/eco o valor.
- Ações destrutivas ou de terceiros (deletar, enviar em nome do usuário, publicar) exigem confirmação explícita.

## Pendências / ideias em aberto
- Plano do agente v2 completo: `PLANO_AGENTE_IA_V2.md`.
- Ligar o agentV2 num número de teste; depois substituir o `ai.ts` em produção.
- Builder de ferramentas HTTP (conectores) pela tela (Nível 2).
- Enriquecer estoque quando o feed não trouxer `BODY`/`FEATURES` em alguns carros.
