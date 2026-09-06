# Plano — Agente de IA v2 (modelo Meta Business Agent, na sua LLM)

Objetivo: reestruturar o agente que responde no WhatsApp seguindo a **arquitetura do Meta Business Agent** (Conhecimento, Skills, Conectores, Ferramentas, Handoff, Testes), porém rodando na **sua própria LLM via OpenRouter** (um endpoint compatível com OpenAI, dezenas de modelos — troca de modelo sem mexer no código).

Decisões já tomadas:
- **LLM:** OpenRouter (OpenAI-compatible). O campo `aiAgents.model` passa a valer de verdade.
- **Fluxos:** o `flowEngine` **continua existindo como opção**. O agente-LLM vira o padrão; o fluxo fica para casos de script rígido (ex.: campanha).
- **Restrição mantida:** nada de **ativar agente automaticamente em conversas já existentes** — rollout controlado.

---

## 1. Diagnóstico do código atual (manter × refazer)

| Área | Onde está hoje | Veredito |
| --- | --- | --- |
| Roteamento "quem responde" | `agentResolver.ts` (fixado→instância→padrão) | **Manter** |
| Loop agêntico (LLM→tool→resultado) | `ai.ts` `processAIMessage` (while sobre `tool_calls`) | **Manter o esqueleto**, generalizar execução |
| Ferramentas de venda | `ai.ts` `TOOLS` (buscar_veiculos, apresentar_veiculo, atualizar_lead, enviar_botoes/lista, transferir_para_vendedor…) | **Manter como tools nativas** |
| Estoque | `stockSync.ts` (`searchVehiclesStructured`, curadoria) | **Manter** |
| Handoff | `transferir_para_vendedor` + rodízio + `routingState` + `metaAgent.ts` | **Manter** |
| Copiloto / Coach | `sellerCopilot.ts`, `salesCoach.ts` | **Manter** (reaproveitar nos testes/eval) |
| Config do agente | tabela `aiAgents` (systemPrompt, model, temperature, enabledTools, isDefault) | **Manter e estender** |
| **Camada LLM** | `openaiLLM.ts` — **fixo em `gpt-4o-mini`**, ignora `aiAgents.model` | **Refazer** (multi-provedor via OpenRouter) |
| **Conhecimento** | só `knowledgeBase` (categoria/título/conteúdo) + `getKnowledgeBaseContext` | **Refazer** (tipos Meta: Empresa, FAQ, Arquivos, Sites) |
| **Prompt** | 4 camadas hardcoded em `ai.ts` + remendos determinísticos inline | **Reestruturar** (Conhecimento + Skills), preservando os remendos bons como regras/skills |
| **Conectores/ferramentas do usuário** | não existe (só as tools fixas em código) | **Criar** (registro de conectores + ferramentas HTTP) |
| **Testes/Eval do agente** | evals pontuais (`server/evals`) | **Estender** (sandbox "Agent Test" + cenários "Agent Eval") |

Resumo: o **motor** (roteamento, loop, tools de venda, handoff, estoque) é bom e fica. O que muda é **como o agente é configurado e alimentado** — sai o prompt monolítico, entram Conhecimento + Skills + Ferramentas parametrizáveis, e a LLM passa a ser trocável.

---

## 2. Mapa de capacidades Meta → CRM

| Capacidade Meta | Implementação no CRM v2 |
| --- | --- |
| Business Info | tabela `agentBusinessInfo` (texto livre por seção) + injeção no prompt |
| FAQs | tabela `agentFaqs` (pergunta/resposta) + recuperação por similaridade |
| Files | tabela `agentFiles` (arquivo + texto extraído) + recuperação (RAG) |
| Websites | tabela `agentWebsites` (URL + conteúdo ingerido + última sync) |
| Agent Skills | tabela `agentSkills` (instrução de tom/comportamento) |
| UI Skills | mapeadas para as tools nativas `enviar_botoes` / `enviar_lista` / `apresentar_veiculo` (+ novo `enviar_carrossel`) |
| Connectors | tabela `agentConnectors` (base_url, auth) |
| Connector tools | tabela `agentTools` (método, path, schema de parâmetros) → viram tools no loop |
| Agent settings (status, audiência, handoff msg) | campos em `aiAgents` + `settings` |
| Handoff / thread control | já existe (`transferir_para_vendedor` + `metaAgent.ts`) — reaproveitar |
| Language | automático (a própria LLM detecta/responde no idioma) |
| Agent events | **Fase futura** — endpoint para disparar aviso ao cliente (ex.: status do pedido) |
| Testing / Eval | tela "Testar" (sandbox) + cenários de avaliação reaproveitando o Coach |

---

## 3. Arquitetura nova

### 3.1 Camada LLM multi-provedor (`server/llmClient.ts` — novo)
Substitui `openaiLLM.ts`. Como OpenRouter é compatível com o formato OpenAI, o cliente atual quase não muda — o que muda é ser **parametrizável por agente**:
- `baseURL` (default `https://openrouter.ai/api/v1`), `apiKey` (env `OPENROUTER_API_KEY`), `model` (vem de `aiAgents.model`, ex.: `openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, `google/gemini-flash-1.5`).
- Mantém `tools`, `tool_choice`, `response_format`, `temperature`, `max_tokens`.
- Fallback: se `OPENROUTER_API_KEY` ausente, cai no OpenAI direto (compat) e depois no Forge (como hoje).
- **Sem segredo no código**: chave só no `.env`.

### 3.2 Modelo de dados (novas tabelas + migrações)
Todas com vínculo opcional a `agentId` (conhecimento por agente) **ou** global (`agentId NULL` = vale para todos). Isso permite "conhecimento da loja" compartilhado + ajustes por agente.

- `agentBusinessInfo(id, agentId?, section, content, isActive)`
- `agentFaqs(id, agentId?, question, answer, isActive)`
- `agentFiles(id, agentId?, fileName, mimeType, storageUrl, extractedText, isActive)`
- `agentWebsites(id, agentId?, url, lastCrawledAt, extractedText, status, isActive)`
- `agentSkills(id, agentId?, title, instruction, priority, isActive)`
- `agentConnectors(id, agentId?, name, baseUrl, authType, authRef, isActive)` — `authRef` aponta pra env, nunca guarda o segredo em claro.
- `agentTools(id, connectorId, name, description, httpMethod, path, paramsSchema jsonb, isActive)`
- Estender `aiAgents`: `provider` (default `openrouter`), `handoffMessage`, `aiAudience` (`EVERYONE`/`ALLOWLISTED_ONLY`), `status` (`draft`/`active`).

### 3.3 Recuperação de conhecimento (RAG)
- **Fase 1 (keyword):** busca por palavras-chave em `agentFaqs`, `agentBusinessInfo`, `agentFiles.extractedText`, `agentWebsites.extractedText` (reaproveita a ideia de `getKnowledgeBaseContext`). Simples e sem custo.
- **Fase 2 (embeddings):** coluna de embedding + similaridade (pgvector ou cálculo em memória) para acerto melhor em bases grandes. Opcional, ligável depois.
- Injeção: um bloco `=== CONHECIMENTO RELEVANTE ===` montado a cada turno com os N trechos mais relevantes.

### 3.4 Skills e UI
- **Agent Skills:** cada `agentSkills.instruction` entra como regra no prompt (tom, prioridades, políticas). Substitui o "PERSONALITY" hardcoded, agora editável e versionável.
- **UI Skills:** o agente já sabe mandar botões/lista/foto via tools. Adicionamos `enviar_carrossel` (várias fotos) reutilizando o feed/estoque. As "instruções de UI" viram descrição dessas tools.

### 3.5 Registro de ferramentas (`server/agentTools/registry.ts` — novo)
- **Tools nativas:** estoque (buscar/apresentar), lead (atualizar), UI (botões/lista/carrossel), handoff (transferir_para_vendedor). Migradas do `ai.ts` para módulos por tool.
- **Tools dinâmicas:** geradas a partir de `agentConnectors` + `agentTools` — cada uma vira uma função no `tools` do LLM; ao ser chamada, o runtime faz o HTTP (método/path/params/auth) e devolve o resultado ao modelo. É o equivalente do "connector tools" do Meta, mas na sua LLM.
- O loop deixa de ter `switch` gigante: executa via registry (`registry.execute(name, args, ctx)`).

### 3.6 Montagem do prompt (novo `server/agentPrompt.ts`)
Ordem: **Regras base** (formato WhatsApp, anti-alucinação) → **Skills** (tom/políticas) → **Conhecimento relevante** (RAG) → **Contexto dinâmico** (lead, histórico, continuidade). Os "remendos" bons de hoje (confirmação determinística, anti-reapresentação, próximo passo) viram **regras nativas** reaproveitáveis, não texto solto.

### 3.7 Handoff
Reaproveita o que existe. O agente novo dispara `transferir_para_vendedor`; no número Meta Agent, o handoff/thread-control continua via `metaAgent.ts`. A "mensagem de handoff" passa a ser configurável (`aiAgents.handoffMessage`).

### 3.8 Testes / Eval
- **Testar (sandbox):** tela que manda mensagem ao agente sem afetar conversa real (usa `processAgentMessage` com um contexto fake).
- **Eval:** conjunto de cenários (pergunta → resposta esperada / tool esperada) rodando no CI, reaproveitando os fixtures do Coach.

---

## 4. Telas (UI) — página "Agente" com abas
Uma página só, abas no topo (espelhando o painel do Meta):
1. **Empresa** — textos de business info (endereços, formas de pagamento, políticas, garantia).
2. **FAQs** — pares pergunta/resposta.
3. **Habilidades** — skills de tom/comportamento (o "playbook") + prioridade.
4. **Arquivos** — upload (extrai texto) para conhecimento.
5. **Sites** — URLs para ingerir (ex.: `autoinovars.com.br`).
6. **Conectores & Ferramentas** — cadastrar API externa + operações (ex.: estoque ao vivo, simulação de financiamento).
7. **Handoff** — quando transferir, mensagem de transferência, rodízio.
8. **Modelo/LLM** — provedor (OpenRouter), modelo, temperature, max tokens, tools ativas.
9. **Testar** — sandbox de conversa + rodar eval.

---

## 5. Compatibilidade e migração (sem quebrar o que roda)
- O `processAIMessage` atual **continua funcionando** durante a transição; o agente v2 entra como novo caminho (`processAgentMessage`) selecionável por instância/agente.
- **Fluxos preservados:** `flowEngine` intacto; quando uma conversa está em fluxo, segue no fluxo.
- **Sem ativação automática** em conversas existentes: o v2 só assume onde for explicitamente ligado (por instância ou agente padrão novo), respeitando a regra que você já definiu.
- Migração do conteúdo: o `knowledgeBase` atual é importado para `agentBusinessInfo`/`agentFaqs` num script único.

---

## 6. Fases de entrega (PRs incrementais, cada um com typecheck + testes)

- **PR 1 — Camada LLM multi-provedor:** `llmClient.ts` (OpenRouter), `aiAgents.provider`, model realmente aplicado. Sem mudança de comportamento visível.
- **PR 2 — Schema de conhecimento:** tabelas + migrações + CRUD (routers) de Empresa/FAQ/Arquivos/Sites. Importar `knowledgeBase` atual.
- **PR 3 — Recuperação (RAG fase 1):** montar o bloco "Conhecimento relevante" por keyword e injetar no prompt.
- **PR 4 — Skills:** tabela + CRUD + injeção; migrar o "PERSONALITY" atual para skills.
- **PR 5 — Registro de ferramentas:** extrair tools nativas para módulos + executor por registry (sem mudar comportamento).
- **PR 6 — Conectores/ferramentas dinâmicas:** cadastrar API externa + tool HTTP no loop.
- **PR 7 — UI "Agente" (abas):** telas de todas as seções.
- **PR 8 — Testar/Eval + handoff configurável.**
- **PR 9 (futuro) — Agent events + embeddings (RAG fase 2).**

Cada PR é atômico, com `npx tsc --noEmit` verde e testes; nada quebra o atendimento atual.

---

## 7. Riscos / decisões abertas
- **Onde guardar arquivos** (extractedText no banco vs. storage tipo MinIO que você já tem) — sugiro MinIO para o binário + texto no banco.
- **Custo/latência do modelo** via OpenRouter — deixar `model` por agente permite testar barato (mini/flash) vs. qualidade (sonnet).
- **RAG:** começar keyword (grátis) e só ir pra embeddings se a base crescer.
- **Segurança:** chaves de conector e `OPENROUTER_API_KEY` só via `.env`/refs — nunca no banco em claro.

---

### Próximo passo
Se aprovar, começo pelo **PR 1 (camada LLM/OpenRouter)** — é o que destrava a troca de modelo e não muda nada visível — e sigo na ordem acima. Posso ajustar qualquer fase antes de codar.
