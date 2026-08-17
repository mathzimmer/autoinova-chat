# Arquitetura Empresarial — Vendedor Virtual para Concessionárias

**Documento de arquitetura · v1.0 · 2026-07-30**
Contexto: CRM próprio (backend + PostgreSQL + WhatsApp Cloud API + Meta Ads + OpenAI), com `flowEngine` (fluxos determinísticos) e agente global (`ai.ts`) já em produção.

---

## 1. Crítica à arquitetura atual (sem rodeios)

Você diagnosticou certo, mas o problema é mais fundo do que "um único agente". São três erros estruturais:

### 1.1. A LLM está sendo usada como cérebro, quando deveria ser só sensor e voz

Hoje a LLM decide: o que perguntar, quando avançar, o que apresentar, quando transferir. Isso é o oposto de controle. LLM é um modelo probabilístico de linguagem — ela é excelente em **entender** o que o cliente disse e em **frasear** respostas naturais. Ela é péssima em **seguir processo** (a conversa do Celta reapresentado 3× é a prova: mesmo com prompt explícito, o modelo não seguiu).

> **Princípio central da nova arquitetura:**
> **A jornada pertence a uma máquina de estados determinística. A LLM só faz duas coisas: (1) transformar linguagem natural em estrutura (NLU) e (2) transformar estrutura em linguagem natural (NLG). Ela nunca decide o próximo passo.**

### 1.2. Vocês têm DOIS sistemas de atendimento competindo

Hoje existem o agente global (prompt de 3 camadas + tools) e o flowEngine (nós determinísticos) — e eles brigam pela mesma conversa. As correções que fizemos (bloco de continuidade, confirmação determinística, seleção numérica no nó) são remendos exatamente porque a fronteira entre os dois é difusa. Na arquitetura nova, **existe um único motor**: a máquina de estados. O "agente global" deixa de existir como entidade separada — ele vira apenas mais um handler de estado (o estado de conversa livre, com escopo e contrato de saída).

### 1.3. Comportamento está codificado em prompts e em código

Você quer "editar o comportamento sem alterar prompts" — correto. Prompt é o pior lugar possível para regra de negócio: não é versionável, não é testável, não é auditável, e o modelo pode ignorar. Regra de negócio vai para **dados** (tabelas de estados/transições), que são versionáveis, testáveis e editáveis via UI.

### 1.4. O que eu NÃO faria (crítica ao seu stack de referência)

- **Não colocaria LangGraph / OpenAI Agents SDK no caminho crítico.** São frameworks para orquestrar LLMs autônomas — exatamente o que você quer *evitar*. Você não precisa de um framework de agentes; precisa de uma **FSM (Finite State Machine) + um classificador**. Isso cabe no seu backend atual, com testes unitários, sem dependência nova.
- **n8n: só para automações periféricas** (sincronizar estoque, disparar webhook de anúncio, follow-up agendado). O atendimento em tempo real não pode depender de um workflow engine externo com latência e operação extras.
- **Não criaria "agentes" separados por domínio** (agente de financiamento, agente técnico...) como processos/prompts independentes. Isso recria o problema do agente único em escala menor, com o custo adicional de transferir contexto entre eles. O correto: **sub-máquinas de estado por domínio** (ver §5), que compartilham o mesmo estado e são deterministicamente acionáveis.

---

## 2. Visão geral da arquitetura

```
┌────────────────────────────────────────────────────────────────────┐
│                        CAMADA DE ENTRADA                            │
│  WhatsApp Cloud API · Meta Ads (CTWA) · Site · Instagram            │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  1. GATEWAY          │  normaliza canais → MessageEvent
                    │  (fila + idempotência)│  dedupe, rate limit, ordenação
                    └──────────┬───────────┘
                               ▼
                    ┌─────────────────────┐
                    │  2. CONTEXT LOADER   │  carrega: estado atual da conversa,
                    │                      │  lead, veículo em jogo, versão da
                    │                      │  jornada, resumo episódico
                    └──────────┬───────────┘
                               ▼
                    ┌─────────────────────┐
                    │  3. NLU ENGINE       │  LLM leve (ou regras) →
                    │  (classificador)     │  { intent, entities, confidence }
                    │                      │  SAÍDA 100% ESTRUTURADA (JSON schema)
                    └──────────┬───────────┘
                               ▼
                    ┌─────────────────────┐
                    │  4. POLICY ENGINE    │  (estado atual × intent × entidades
                    │  (roteador)          │  × dados do lead) → transição válida?
                    │                      │  PURO CÓDIGO. Zero LLM aqui.
                    └──────────┬───────────┘
                               ▼
                    ┌─────────────────────┐
                    │  5. JOURNEY ENGINE   │  máquina de estados: executa
                    │  (state machine)     │  transição, dispara ações do novo
                    │                      │  estado, atualiza contexto
                    └──────────┬───────────┘
                               ▼
                    ┌─────────────────────┐
                    │  6. ACTION EXECUTOR  │  único componente que fala com
                    │                      │  APIs: SEARCH_VEHICLE, SEND_PHOTOS,
                    │                      │  SCHEDULE_VISIT, TRANSFER_TO_HUMAN…
                    └──────────┬───────────┘
                               ▼
                    ┌─────────────────────┐
                    │  7. NLG / RESPONDER  │  template + dados → texto final.
                    │                      │  LLM opcional, constrained, só
                    │                      │  reescreve — nunca muda o conteúdo
                    └──────────┬───────────┘
                               ▼
                          cliente
```

Leitura em uma frase: **a mensagem entra, vira estrutura; a estrutura move a máquina de estados; a máquina emite ações; o executor realiza; a voz responde.**

---

## 3. Os 7 componentes em detalhe

### 3.1. Gateway

Responsabilidades:

- Receber webhook da Cloud API (e futuros canais) e **normalizar** para um envelope único:

```json
{
  "event": "MESSAGE_RECEIVED",
  "channel": "whatsapp_official",
  "conversationId": 1234,
  "messageId": "wamid.HBg...",
  "type": "text|image|audio|button_reply|list_reply",
  "text": "quero um suv",
  "buttonId": null,
  "timestamp": "2026-07-30T21:00:00Z",
  "adContext": { "campaignId": "...", "adId": "...", "vehicleId": 440336 }
}
```

- **Idempotência** por `messageId` (a Meta reenvia webhooks).
- **Enfileirar** (BullMQ/Redis ou fila PG) — nunca processar no request do webhook (a Meta dá timeout e reenvia; você já deve ter sentido isso).
- **Lock por conversa**: mensagens da mesma conversa processam em série (evita duas threads avançando o estado ao mesmo tempo). Conversas diferentes processam em paralelo — é assim que você atende milhares simultaneamente com estado consistente.

O `adContext` é capturado no clique do anúncio (CTWA traz `referral` no webhook) e resolve o seu caso 1: **cliente do anúncio do Compass já entra com `vehicleId` preenchido no contexto — a jornada começa no estado certo, sem perguntar nada.**

### 3.2. Context Loader

Monta o `ConversationContext` — o único objeto que todos os componentes leem:

```json
{
  "conversationId": 1234,
  "journeyId": "venda_veiculo",
  "journeyVersion": 7,
  "currentState": "APRESENTACAO",
  "stateData": {
    "vehicleId": 440336,
    "presentedIds": [440336, 852264, 769172],
    "photosSent": true,
    "videoSent": false
  },
  "lead": { "name": "Matheus", "city": null, "paymentMethod": null, "tradeVehicle": null },
  "funnel": { "stage": "interesse_definido", "temperature": "quente" },
  "episodicSummary": "Cliente veio do anúncio do Compass, pediu fotos…",
  "flags": { "handedOff": false, "sessionAge": "12m" }
}
```

Fontes: sessão da máquina de estados (estado + `stateData`), CRM (lead/funil), e **memória episódica** (resumo incremental da conversa — ver §8).

### 3.3. NLU Engine (classificador de intenção + extrator de entidades)

É aqui que a LLM trabalha — e só aqui ela "entende".

**Contrato de saída (JSON Schema estrito — structured output, nunca texto livre):**

```json
{
  "intent": "SELECT_VEHICLE | ASK_PHOTOS | ASK_VIDEO | ASK_TECHNICAL | REQUEST_FINANCING | HAS_TRADE | REQUEST_HUMAN | SCHEDULE_VISIT | GREETING | OFF_TOPIC | AFFIRM | DENY | PROVIDE_DATA | UNKNOWN",
  "entities": {
    "vehicleRef": "compass",
    "vehicleIndex": null,
    "priceMax": 150000,
    "fuel": "diesel",
    "bodyType": "picape",
    "downPayment": null,
    "termMonths": null,
    "tradeModel": null,
    "tradeYear": null,
    "tradeKm": null,
    "cpf": null
  },
  "confidence": 0.94,
  "sentiment": "neutral"
}
```

Regras de engenharia:

1. **Modelo pequeno e barato** (gpt-4o-mini / gpt-4.1-mini) — classificação não precisa de modelo grande.
2. **Atalhos determinísticos antes da LLM** (custo + latência + previsibilidade):
   - `button_reply` / `list_reply` → intent direto do `buttonId` (botões são intenções já classificadas — use-os sempre que possível);
   - mensagem `^\d{1,2}$` com veículos apresentados → `SELECT_VEHICLE` com `vehicleIndex` (o que implementamos no nó vira nativo aqui);
   - regex de CPF, placa, valor em R$, ano (4 dígitos), "sim/não" curtos.
3. **A LLM só roda quando os atalhos não resolvem.** Meta: 60-80% das mensagens nunca chegam na LLM.
4. **Confidence baixa → `UNKNOWN`** → a máquina de estados decide o fallback (nunca a LLM).
5. Intents são um **enum fechado**, versionado junto com a jornada. Adicionar intent novo = decisão de produto, não emergência do modelo.

### 3.4. Policy Engine (roteador) — zero LLM

Recebe `(currentState, intent, entities, context)` e resolve a transição consultando a **tabela de transições da jornada** (dados, não código):

```
TRANSIÇÃO = {
  from_state, intent, [condições sobre entidades/contexto],
  to_state, [ações a executar], priority
}
```

Exemplo real:

| from_state | intent | condição | to_state | ações |
|---|---|---|---|---|
| APRESENTACAO | SELECT_VEHICLE | vehicleIndex válido | VEICULO_ESCOLHIDO | `SET_VEHICLE`, `ASK_MEDIA_PREFERENCE` |
| VEICULO_ESCOLHIDO | ASK_PHOTOS | — | VEICULO_ESCOLHIDO | `SEND_PHOTOS` |
| VEICULO_ESCOLHIDO | ASK_VIDEO | — | VEICULO_ESCOLHIDO | `SEND_VIDEO` |
| VEICULO_ESCOLHIDO | REQUEST_FINANCING | — | FIN_ENTRADA | `ASK_DOWN_PAYMENT` |
| FIN_ENTRADA | PROVIDE_DATA | entities.downPayment | FIN_PRAZO | `SAVE_LEAD`, `ASK_TERM` |
| FIN_PRAZO | PROVIDE_DATA | entities.termMonths | FIN_CPF | `SAVE_LEAD`, `ASK_CPF` |
| * (qualquer) | REQUEST_HUMAN | — | HANDOFF | `TRANSFER_TO_HUMAN` |
| * (qualquer) | ASK_TECHNICAL | — | TECH_QA (scoped) | `TECH_ANSWER` → retorna ao estado anterior |

A ordem obrigatória que você pediu (entrada → prazo → CPF; modelo → ano → km → fotos) **nasce naturalmente da cadeia de estados** — não de um prompt implorando pro modelo seguir ordem. É impossível o FIN_CPF acontecer antes de FIN_PRAZO: não existe transição que pule.

**Wildcard states** (`*`): intents globais (falar com humano, dúvida técnica, mudança de assunto) têm transições de qualquer estado — é assim que o híbrido funciona (ver §6).

### 3.5. Journey Engine (máquina de estados)

Executa a transição resolvida pelo Policy Engine:

1. Valida a transição contra a definição da jornada (versão pinada da conversa).
2. Executa `on_exit` do estado antigo (ex.: limpar `stateData.presentedIds`).
3. Atualiza `currentState` + `stateData` (**transactional** no PG, junto com o action log).
4. Executa `on_enter` do novo estado: emite a lista de ações para o Action Executor.
5. Registra `STATE_TRANSITION` no decision log (auditoria completa: por que mudou, com qual intent, qual confidence).

### 3.6. Action Executor — o único que toca o mundo externo

A máquina de estados nunca chama API. Ela emite **ações estruturadas** e o executor realiza:

```json
{ "action": "SEARCH_VEHICLE", "params": { "bodyType": "picape", "fuel": "diesel", "priceMax": 150000 }, "into": "stateData.searchResults" }
{ "action": "SEND_PHOTOS", "params": { "vehicleId": 440336 } }
{ "action": "SEND_VIDEO", "params": { "vehicleId": 440336 } }
{ "action": "ASK_DOWN_PAYMENT", "params": {} }
{ "action": "SAVE_LEAD", "params": { "downPayment": 30000 } }
{ "action": "SCHEDULE_VISIT", "params": { "date": "...", "storeId": 2 } }
{ "action": "TRANSFER_TO_HUMAN", "params": { "reason": "requested", "assignRoundRobin": true } }
{ "action": "ASK_MEDIA_PREFERENCE", "params": { "buttons": ["Ver mais fotos", "Ver vídeo", "Seguir sem"] } }
```

Princípios:

- **Catálogo fechado de ações**, cada uma com schema de params e implementação testada. Adicionar ação = deploy de código (correto: comportamento novo de integração deve passar por release).
- **Resultados voltam para `stateData`** (`into`) — o estado seguinte lê de lá, não do histórico de texto. Isso mata de vez a classe de bugs "a IA não lembra o que mostrou".
- Ações de pergunta (`ASK_*`) renderizam via NLG/templates e preferem **botões** quando o conjunto de respostas é fechado (botão = intent grátis no retorno).

### 3.7. NLG / Responder (a voz)

Monta a mensagem final:

1. **Template primeiro**: `ASK_DOWN_PAYMENT` → `"Perfeito! Para simular o financiamento do {vehicle.title}, me diz: quanto você consegue dar de entrada? 💰"` — 90% das mensagens são templates com variáveis. Tom de voz editável **na jornada** (campo por template), não em prompt.
2. **LLM de reescrita (opcional, constrained)**: se quiser variação natural, a LLM recebe o template preenchido + tom de voz e só **reescreve**, com instrução curta e saída limitada a N caracteres. Ela não pode adicionar pergunta nova, remover pergunta obrigatória, ou citar dados que não vieram no input. Validação pós-geração: se a saída contém "?" onde o template não tinha, descarta e usa o template puro.
3. **Dados sempre vêm do contexto** (`stateData`, estoque via ação), nunca da "memória" da LLM — fim das alucinações de preço/ano.

---

## 4. Diagrama de estados da conversa (jornada principal de venda)

```mermaid
stateDiagram-v2
    [*] --> ENTRADA
    ENTRADA --> VEICULO_ESCOLHIDO: ad_click (vehicleId no contexto)
    ENTRADA --> DESCOBERTA: intent genérica / sem veículo
    DESCOBERTA --> APRESENTACAO: SEARCH_VEHICLE ok
    DESCOBERTA --> DESCOBERTA: refinar (sem resultados → relaxar filtros)
    APRESENTACAO --> VEICULO_ESCOLHIDO: SELECT_VEHICLE / AFFIRM
    APRESENTACAO --> DESCOBERTA: DENY / refinar
    VEICULO_ESCOLHIDO --> VEICULO_ESCOLHIDO: ASK_PHOTOS → SEND_PHOTOS
    VEICULO_ESCOLHIDO --> VEICULO_ESCOLHIDO: ASK_VIDEO → SEND_VIDEO
    VEICULO_ESCOLHIDO --> PAGAMENTO: AFFIRM (gostou)
    PAGAMENTO --> FIN_ENTRADA: REQUEST_FINANCING
    FIN_ENTRADA --> FIN_PRAZO: PROVIDE_DATA(downPayment)
    FIN_PRAZO --> FIN_CPF: PROVIDE_DATA(termMonths)
    FIN_CPF --> HANDOFF: PROVIDE_DATA(cpf) → SIMULATE_CREDIT
    PAGAMENTO --> TROCA_MODELO: HAS_TRADE
    TROCA_MODELO --> TROCA_ANO: PROVIDE_DATA(tradeModel)
    TROCA_ANO --> TROCA_KM: PROVIDE_DATA(tradeYear)
    TROCA_KM --> TROCA_FOTOS: PROVIDE_DATA(tradeKm)
    TROCA_FOTOS --> HANDOFF: image_received → SAVE_TRADE
    PAGAMENTO --> AGENDAMENTO: SCHEDULE_VISIT
    AGENDAMENTO --> POS_VENDA: visit scheduled
    VEICULO_ESCOLHIDO --> AGENDAMENTO: SCHEDULE_VISIT
    PAGAMENTO --> HANDOFF: dados completos / REQUEST_HUMAN
    note right of HANDOFF: qualquer estado → HANDOFF\nvia intent REQUEST_HUMAN (wildcard)
    note right of TECH_QA: qualquer estado → TECH_QA → volta ao estado anterior\n(scoped sub-machine)
```

Estados-chave para o seu requisito "depois de apresentar, SEMPRE perguntar fotos ou vídeo": o `on_enter` de `VEICULO_ESCOLHIDO` emite **sempre** `ASK_MEDIA_PREFERENCE` com botões. Não é pedido ao modelo — é código. A IA não tem como inventar outra pergunta porque **ela não gera a pergunta**.

---

## 5. "Agentes especialistas" → sub-máquinas de estado com escopo

Em vez de agentes independentes, cada domínio é um **módulo da jornada** (sub-FSM) com contrato de entrada e saída:

| Módulo | Entrada | Estados internos | Saída |
|---|---|---|---|
| **Apresentador** | filtros ou vehicleId | DESCOBERTA, APRESENTACAO | vehicleId escolhido |
| **Qualificador** | vehicleId | PAGAMENTO, coleta de perfil (cidade, nome) | lead qualificado |
| **Financiamento** | vehicleId | FIN_ENTRADA → FIN_PRAZO → FIN_CPF | simulação + dados p/ vendedor |
| **Troca** | vehicleId | TROCA_MODELO → ANO → KM → FOTOS | tradeVehicle completo |
| **Agendamento** | vehicleId + loja | AG_DATA → AG_CONFIRMA | visita marcada |
| **Técnico (Q&A)** | pergunta + vehicleId | TECH_QA (1 turno, RAG sobre ficha do veículo) | resposta + retorno automático ao estado interrompido |
| **Handoff** | qualquer | HANDOFF | conversa transferida, resumo estruturado |

O **agente técnico** é o único lugar onde a LLM responde livremente — e mesmo assim com escopo: RAG limitado à ficha do veículo em jogo, instrução de 10 linhas ("responda SÓ a dúvida; não venda; não mude de assunto"), e ao final a máquina **volta ao estado anterior** e reemite a pergunta pendente. O cliente perguntou "esse carro é 4x4?" no meio do financiamento → técnico responde → sistema repete "…como ia dizendo, quanto de entrada?" — experiência humana, controle de máquina.

O "agente global" atual (`ai.ts` com COMMERCIAL_PROMPT) vira o módulo **Conversa Livre** — handler do estado ENTRADA/DESCOBERTA para o que não se encaixa em nada, com contrato de saída: ele só pode classificar/coletar intenção inicial e chamar o roteador. Nunca apresenta, nunca fecha.

---

## 6. O modelo híbrido: determinístico × IA livre

A união se dá em 3 níveis:

**Nível 1 — Spine determinístico, bordas de LLM.** A jornada é sempre a FSM. A LLM entra só nas bordas: NLU na entrada de cada mensagem, NLG na saída, e Q&A técnico scoped.

**Nível 2 — Entradas ricas começam mais à frente.** A origem determina o estado inicial:
- Anúncio do Compass (CTWA com referral) → `VEICULO_ESCOLHIDO` direto (já sabe o carro; `on_enter`: apresenta com foto + pergunta de mídia);
- Botão do site → `DESCOBERTA`;
- "Tenho interesse numa Compass" → NLU extrai `vehicleRef: compass` → `SEARCH_VEHICLE` → `APRESENTACAO` já filtrada;
- "caminhonete diesel até 150 mil" → mesma coisa com 3 entidades.

Ou seja: **o "fluxo praticamente pronto" do anúncio e o "fluxo aberto" são a mesma jornada**, só muda o estado de entrada e o que já vem preenchido no contexto. Você não mantém dois sistemas — mantém uma FSM com múltiplos pontos de entrada.

**Nível 3 — Mudança de assunto é uma transição, não uma exceção.** "Cliente mudou completamente de assunto" → NLU classifica (nova intenção ou OFF_TOPIC) → Policy Engine resolve: se for intenção de compra diferente (`SELECT_VEHICLE` outro carro) → transição `VEICULO_ESCOLHIDO → DESCOBERTA` com `on_exit` que limpa o veículo anterior; se for OFF_TOPIC → estado `OFF_TOPIC_HANDLER` (1 resposta cordial) → retorna. Nada disso é improvisado pela LLM.

---

## 7. Catálogo de eventos (audit trail completo)

Tudo que acontece vira evento persistido — é isso que permite depuração, métricas de funil e replay:

```
MESSAGE_RECEIVED        { messageId, channel, text, type }
NLU_CLASSIFIED          { intent, entities, confidence, via: "shortcut|llm", latencyMs }
STATE_TRANSITION        { from, to, intent, journeyVersion }
ACTION_REQUESTED        { action, params }
ACTION_COMPLETED        { action, ok, resultSummary, latencyMs }
ACTION_FAILED           { action, error }
LEAD_UPDATED            { fields }
VEHICLE_PRESENTED       { vehicleIds, mode: "photo|text" }
HANDOFF_DONE            { sellerId, reason, summary }
SESSION_EXPIRED         { lastState, ageHours }     (o A6/TTL vira nativo)
FALLBACK_TRIGGERED      { state, intent, reason }
```

Com isso você responde em 1 query: "em qual estado os clientes mais abandonam?" / "quantas vezes o fallback disparou hoje?" / "qual intent a LLM mais erra?".

---

## 8. Memória (3 camadas, sem mágica)

1. **Working memory** = `stateData` da sessão da FSM. O que a máquina precisa para o passo atual: veículos apresentados, dados parciais de troca, flags. TTL de sessão (o A6 que você já tem) expira isso.
2. **Profile memory** = lead no CRM (tabela `leads` atual). Persistente, estruturada, editável pelo vendedor. A regra "nunca perguntar o que já tem" vira trivial: o template da pergunta só é emitido se o campo estiver vazio — verificação de dados, não de texto.
3. **Episodic memory** = resumo incremental da conversa (vocês já têm `upsertLeadSummary`). Serve para o vendedor no handoff e para a NLU ter contexto de conversas longas. Atualizado a cada K turnos ou no handoff.

**A "memória inteligente" que você pediu na prática = estado + dados, não histórico de texto.** O bug do Celta reapresentado só existe porque o sistema dependia do modelo ler o histórico; numa FSM, "já apresentei esse carro" é um fato em `stateData.presentedIds`.

---

## 9. Prompts (onde a LLM ainda existe — e como prendê-la)

Só 3 prompts no sistema inteiro:

**P1 — Classificador (NLU).** System prompt curto: lista do enum de intents + schema de entidades + 10-15 few-shots reais das suas conversas. Saída via **structured outputs** (JSON Schema enforced pela API — impossível sair do formato). Temperatura 0.

**P2 — Reescritor (NLG, opcional).** "Reescreva a mensagem abaixo mantendo TODAS as perguntas e dados, no tom {tomDaLoja}. Máx. 280 caracteres. Proibido adicionar perguntas, dados de veículos ou preços." Entrada: template já preenchido. Temperatura 0.4. Validação pós-geração.

**P3 — Técnico (Q&A scoped).** "Responda APENAS a dúvida usando SOMENTE os dados da ficha abaixo. Se a ficha não contém a resposta, diga que o vendedor confirma. Máx. 3 linhas. Não faça ofertas nem perguntas." Input: ficha do veículo (RAG trivial) + pergunta.

Anti-padrões eliminados: prompt de 1.600 linhas, regra de negócio em prompt, tool-calling livre, "a IA decide quando transferir".

---

## 10. Banco de dados — o fluxo como DADOS

Resposta direta à sua pergunta "banco, JSON, YAML, tabela, state machine?":

> **Grafo de estados/transições em tabelas (PostgreSQL), serializável para JSON, com versões imutáveis publicadas. YAML só como export opcional. State machine executada em código próprio no backend. Nada de comportamento em prompt.**

```sql
-- Jornada (ex.: "Venda de veículo", "Pós-venda", "Revisão de oficina")
journeys(id, key, name, status, created_at)

-- Versão imutável de uma jornada (conversas ficam pinadas nela)
journey_versions(id, journey_id, version, definition_json, published_at, published_by)
   -- definition_json: grafo completo compilado (estados, transições, ações, templates)
   -- imutável depois de publicado → reprodutibilidade total

-- Editor trabalha em tabelas normalizadas (fonte do draft)
journey_states(id, journey_id, draft_version, key, name, module,
               on_enter_actions jsonb, on_exit_actions jsonb, config jsonb)
journey_transitions(id, journey_id, draft_version,
                    from_state, intent, conditions jsonb,
                    to_state, actions jsonb, priority)

-- Runtime
conversation_sessions(id, conversation_id, journey_id, journey_version,
                      current_state, state_data jsonb, status, updated_at)
action_log(id, session_id, action, params, ok, result, created_at)
decision_log(id, session_id, event, payload jsonb, created_at)  -- §7
nlu_feedback(id, message_text, predicted_intent, correct_intent)  -- p/ melhorar P1
```

O que você já tem se encaixa: `chat_flow_nodes/edges` ≈ `journey_states/transitions`; `flow_sessions` ≈ `conversation_sessions`; `leads` e `vehicles` continuam; o decision/action log é o que falta e muda o jogo operacional.

**Editar comportamento sem alterar prompts nem código** vira: mudar textos dos templates, reordenar/encadear estados, ligar transições novas a intents existentes, trocar perguntas de `on_enter` — tudo via UI, publicando uma nova versão da jornada.

---

## 11. Versionamento de fluxos

- **Draft → Published → Archived.** Só uma published por jornada (ou por canal: whatsapp principal pode rodar v7 enquanto o site testa v8 — `journey_version` pinada por conversa no início).
- **Conversa pinada**: quem começou na v7 termina na v7. Migração opcional para conversas ativas: mapa de estados equivalentes (`v7.FIN_PRAZO → v8.FIN_PRAZO`) declarado na publicação.
- **Rollback = republicar a versão anterior.** Segundos, sem deploy.
- **Diff de versões** no editor (o que mudou: estados +3, transições −1, templates alterados).
- **Simulador**: rodar uma conversa-script contra um draft antes de publicar (é o "evals do A7" evoluído: fixtures de mensagens → asserções de estado/ação).

---

## 12. Construtor visual (seu "n8n de jornadas")

Vocês já têm o embrião (`FlowEditor.tsx`). O caminho:

1. **Nós = estados** (não "passos soltos"). Tipos: estado de pergunta, estado de ação, sub-máquina (referência a outro módulo), terminal (HANDOFF/POS).
2. **Edges = transições** com condição visual: `intent` (dropdown do enum) + condições sobre entidades/dados (builder de regra simples: `entities.downPayment exists`).
3. **Catálogo lateral**: ações disponíveis (`SEND_PHOTOS`, `ASK_*`…) arrastáveis para `on_enter` do estado.
4. **Lint de jornada** antes de publicar: estado órfão, transição sem destino, loop sem saída, estado terminal alcançável por todos os caminhos, intent sem nenhuma transição, template com variável inexistente.
5. **Painel de saúde da jornada**: funil por estado (dos eventos do §7), taxa de fallback, intents mais classificados errado (de `nlu_feedback`) → botão "adicionar few-shot" que alimenta o P1.

---

## 13. Fluxo de mensagens — dois exemplos completos

### Exemplo A: anúncio do Compass (entrada rica)

```
Cliente clica no anúncio → webhook CTWA com referral.adId
Gateway: adContext.vehicleId = 440336
Context Loader: nova sessão, jornada "venda_veiculo" v7, estado inicial VEICULO_ESCOLHIDO
Journey on_enter VEICULO_ESCOLHIDO:
  → SEARCH_VEHICLE(id=440336)         → stateData.vehicle
  → SEND_PHOTOS(440336)               → fotos + ficha na legenda
  → ASK_MEDIA_PREFERENCE              → botões [Ver mais fotos][Ver vídeo][Quero seguir]
Cliente toca [Quero seguir]           → intent AFFIRM (via buttonId, sem LLM)
Transição VEICULO_ESCOLHIDO → PAGAMENTO
on_enter PAGAMENTO → ASK_PAYMENT_METHOD → botões [À vista][Financiamento][Tenho troca]
Cliente toca [Financiamento]          → intent REQUEST_FINANCING
…cadeia FIN_ENTRADA → FIN_PRAZO → FIN_CPF (ordem imposta pela FSM)
→ SIMULATE_CREDIT → HANDOFF → vendedor recebe resumo estruturado completo
```

### Exemplo B: mudança de assunto no meio

```
Estado: FIN_PRAZO (sistema perguntou o prazo)
Cliente: "esse compass é 4x4?"
NLU → ASK_TECHNICAL { vehicleRef: null }        (veículo já está no contexto)
Transição wildcard FIN_PRAZO → TECH_QA (guarda returnTo=FIN_PRAZO)
TECH_QA: RAG na ficha → "Sim, essa versão Limited é 4x2…" (P3 scoped)
Retorno automático → FIN_PRAZO → reemite ASK_TERM: "…e aí, consegue me dizer o prazo?"
```

---

## 14. Escala: milhares de conversas simultâneas

- **Workers stateless** consumindo a fila; todo o estado no Postgres (sessão) + Redis (lock por conversa, cache de jornada publicada).
- **Lock por conversa** (chave `conv:{id}`, TTL curto) → paralelismo total entre conversas, serialização dentro de cada uma.
- **LLM só no classificador** (e olhe lá): custo por mensagem cai 5-10× vs. agente com prompt gigante + tool loop. Latência idem (atalhos resolvem a maioria).
- **Rate limiting** da Cloud API respeitado no executor (fila de saída com backoff).
- **Circuit breaker** para OpenAI: se a LLM cair, atalhos + templates mantêm o atendimento determinístico vivo (degradação graciosa — o agente atual morre inteiro se a OpenAI cai).
- **Testes**: a FSM é 100% testável unitariamente (estado × intent → estado); NLU tem fixtures (evals); NLG é cosmeticamente testada. Você ganha CI real — o que hoje é impossível com o comportamento dentro do prompt.

---

## 15. Roadmap de migração (do código atual para esta arquitetura)

| Fase | Entrega | Reaproveita |
|---|---|---|
| 1 | Formalizar `conversation_sessions` com `stateData` + decision/action log | `flow_sessions` atual |
| 2 | NLU Engine com structured outputs + atalhos (botões, números, regex) | a seleção numérica e confirmação determinística que acabamos de subir viram atalhos nativos |
| 3 | Transições do nó `vehicle_discovery` viram a FSM de DESCOBERTA/APRESENTACAO/VEICULO_ESCOLHIDO | lógica atual do `handleDiscoveryStep` |
| 4 | Action Executor com catálogo fechado (as tools de estoque viram ações server-side) | `searchVehiclesForAI`, `apresentar_veiculo`, curadoria de estoque |
| 5 | Cadeias FIN_* e TROCA_* | `collect_with_ai` vira estados com perguntas em `on_enter` |
| 6 | NLG por templates (+ reescrita opcional) | personalidade da loja migra para templates/tone config |
| 7 | Editor visual sobre `journey_states/transitions` + lint + simulador | `FlowEditor.tsx` |
| 8 | Agente global aposentado → vira handler scoped de ENTRADA | — |

Cada fase é deployável e convive com o sistema atual (strangler pattern): a FSM assume conversa a conversa, o agente antigo fica como fallback até a fase 8.

---

## 16. Resumo executivo

1. **A LLM sai do centro.** Ela classifica (NLU) e fraseia (NLG); a máquina de estados decide tudo. Isso elimina a classe inteira de bugs que você viveu essa semana.
2. **O fluxo vira dado versionado no PostgreSQL** (estados + transições + templates), publicável e reversível, editável por UI — nunca mais regra de negócio em prompt.
3. **Uma única jornada com múltiplos pontos de entrada** resolve o híbrido: anúncio rico entra no meio, curioso entra no começo, mudança de assunto é transição.
4. **"Agentes especialistas" viram sub-máquinas de estado** com contratos — não prompts independentes.
5. **Ações estruturadas + executor** isolam as APIs; intents são enum fechado; eventos dão auditoria e métricas de funil por estado.
6. Você já tem 60% disso construído (flowEngine, nós, tools, curadoria, TTL). A migração é incremental, não reescrita.
