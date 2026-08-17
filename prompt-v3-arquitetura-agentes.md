# PROMPT — Simplificação da arquitetura de agentes de IA (E1–E7)

> Para enviar ao Claude. Branch: `feat/unificacao-canais` (NÃO a main).
> Stack: TypeScript, tRPC, Drizzle ORM **PostgreSQL**, Vitest (~298 testes).

---

## CONTEXTO

CRM de WhatsApp para concessionária com agentes de IA configuráveis. Hoje a seleção
de "quem responde uma mensagem" tem **8 níveis** e 3 modos de operação, o que torna
impossível para o usuário prever qual agente atenderá um lead.

### Cadeia atual (routers.ts, callback do debounce, ~linhas 130–340)

```
1. Flow Engine roda PRIMEIRO (se flows_global_enabled). Se flowResult.handled → fim.
2. Freios: conversation.aiActive && isConnectionAiAllowed()
3. Seleção de agente (mais específico → geral):
   ① sessionCtx.nodeAgentId (agente do nó ai_response em sessão ativa)
   ② chatFlows.agentId (agente do fluxo)
   ③ chatFlows.aiPrompt (PROMPT LEGADO — sequestra a cadeia)
   ④ conversations.agentId (fixado manualmente)
   ⑤ setting instance_<nome>_agent_id (por número)
   ⑥ setting channel_<canal>_agent_id (por canal)
   ⑦ setting default_agent_id (padrão da loja)
   ⑧ MODO LIVRE: não é agente — 3 prompts em settings
     (CORE_PROMPT + COMMERCIAL_PROMPT + personality) + setting ai_free_tools
```

### Dentro de processAIMessage (server/ai.ts ~linha 706)

- `options.agentId` → AGENT MODE (agent.systemPrompt + camadas core opcionais
  via agent.includeCoreLayers + agent.enabledTools)
- `options.flowPrompt` → FLOW MODE legado (prompt solto do fluxo)
- nenhum → FREE MODE (camadas globais + ai_free_tools)
- `options.onlyTools` (nó "Coletar com IA") tem precedência sobre tudo e
  restringe tools (ex.: só ["atualizar_lead"])

### Funções existentes (server/db.ts)

`listAiAgents`, `getAiAgentById`, `createAiAgent`, `updateAiAgent`, `deleteAiAgent`,
`getActiveAiAgents`, `getAiAgentForChannel` (2131+), `getAiAgentForInstance`,
`getDefaultAiAgent`, `getAiAgentForFlow`, `getCanonicalLead`, `updateLeadFunnelStatus`,
`logTimeline`, `isConnectionAiAllowed`. Schema: `aiAgents` (pgTable) com
systemPrompt, includeCoreLayers, model, temperature, maxTokens, enabledTools (json),
active.

---

# OBJETIVO

Reduzir a cadeia para 4 níveis previsíveis e fazer **tudo que responde ser um agente**:

```
① Agente fixado na conversa (exceção manual)
② Agente do nó/fluxo em sessão ativa
③ Agente da instância (número) — vínculo principal
④ Agente padrão da loja (aiAgents.isDefault)
```

Regra: cada PR mantém os ~298 testes verdes e adiciona os seus. SQL em dialeto
PostgreSQL. Nada de PR misturando schema + lógica + front.

---

# TAREFAS (uma por PR, nesta ordem)

## PR A1 — `aiAgents.isDefault`: o modo livre vira um agente de verdade
**Arquivos:** `drizzle/schema.ts`, `server/db.ts`, `server/ai.ts`, migration.
- Adicionar `aiAgents.isDefault boolean default false` (migration; garantir no máximo
  1 default via lógica no update — unique parcial ou check na aplicação).
- `getDefaultAiAgent()`: ler primeiro `isDefault=true`; fallback para o setting
  legado `default_agent_id` (compatibilidade); log de deprecação quando usar o setting.
- **FREE MODE morre:** em `processAIMessage`, se nenhum agente foi resolvido, usar o
  agente default (com suas tools e prompt). As camadas CORE_PROMPT/COMMERCIAL_PROMPT
  continuam existindo como constantes do sistema, aplicadas via `includeCoreLayers`.
- Migrar o setting `ai_free_tools` para o `enabledTools` do agente default (migration
  de dados: criar/atualizar o agente default a partir dos settings atuais).
**Testes:** resolução usa isDefault; fallback para setting legado funciona; sem
nenhum default configurado → IA não responde (comportamento já documentado no schema).
**Riscos:** conversas que hoje usam modo livre mudam de comportamento se o agente
default tiver prompt diferente → a migration de dados deve copiar a personality
atual (settings) para o systemPrompt do agente default criado.

## PR A2 — Remover `chatFlows.aiPrompt` (legado) e `channel_<canal>_agent_id`
**Arquivos:** `server/routers.ts`, `server/db.ts`, `drizzle/schema.ts`, migration,
telas de Flows/Agentes.
- Migrar fluxos que têm `aiPrompt` preenchido e `agentId` nulo: criar agente
  "Legado — <nome do fluxo>" com systemPrompt = aiPrompt, includeCoreLayers=false,
  e setar `flow.agentId`. Depois dropar a coluna `aiPrompt`.
- Remover o nível ⑥ da cadeia: `getAiAgentForChannel` deixa de ser consultada no
  debounce; settings `channel_*_agent_id` migrados para `instance_*` onde fizer
  sentido (script de migração reporta conflitos) — se uma instância já tem agente,
  o de canal é descartado com log.
**Testes:** fluxo com aiPrompt migrado responde via agente criado; cadeia não
consulta mais canal.
**Riscos:** fluxos em produção dependendo do prompt legado — por isso a migração
cria agentes equivalentes em vez de apagar. Fazer backup da tabela chatFlows antes.

## PR A3 — Tool `transferir_para_vendedor`
**Arquivos:** `server/ai.ts` (definição da tool + handler), `server/db.ts`,
client (badge de conversa "transferida"), testes.
- Nova tool disponível no catálogo (AVAILABLE_TOOLS do routers.ts) com args:
  `resumo` (obrigatório), `motivo` (enum: pediu_humano | negociacao | agendamento |
  dados_completos | sem_solucao), `atribuir_rodizio` (bool, default false).
- Handler atômico (transação):
  1. `updateLeadFunnelStatus(conversationId, "encaminhado_vendedor")`
  2. Append estruturado em `leads.notes` (formato fixo com motivo + resumo)
  3. `logTimeline` (action: "handoff_ia")
  4. Se `atribuir_rodizio`: reusar a lógica de assign_seller do flowEngine
     (extrair para função compartilhada — não duplicar rodízio)
  5. `updateConversation(id, { routingState: "handed_off" })`
  6. Notificar time (createTeamNotification para vendedores da loja)
- No debounce: se `routingState === "handed_off"` e a última mensagem é do cliente,
  a IA responde em modo "pós-handoff" (breve, sem vender, sem tools de veículo) —
  implementar como onlyTools=["atualizar_lead"] + instrução fixa de pós-handoff.
**Testes:** handler executa as 5 ações atomicamente; conversa em handed_off não
recebe pitch novo; rodízio não duplica atribuição.
**Riscos:** atendentes assumem manualmente hoje desligando aiActive — manter esse
caminho funcionando (handed_off ≠ aiActive=false; são compatíveis).

## PR A4 — Endpoint/tela "Quem responde esta conversa?"
**Arquivos:** `server/routers.ts` (query protegida), nova página ou painel no client.
- `agentes.resolvePreview(conversationId)` → retorna a cadeia avaliada passo a passo:
  `{ fluxoAtivo: {...} | null, nodeAgentId, agenteFixado, agenteInstancia,
  agenteDefault, vencedor: { tipo, id, nome, motivo } }` — sem enviar mensagem.
- Na tela de Agentes: para cada agente, listar vínculos (instâncias, fluxos,
  conversas fixadas) + alerta "sem vínculo — não responde nada".
**Testes:** preview bate com a cadeia real do debounce (extrair a lógica de
resolução para função compartilhada `resolveAgentForConversation` usada pelos dois
lados — é isso que garante que o preview nunca mente).
**Riscos:** baixo; o principal é não duplicar a lógica de resolução.

## PR A5 — Extração da resolução para função única (refactor de suporte)
**Arquivos:** `server/routers.ts`, novo `server/agentResolver.ts`.
- Mover TODA a cadeia (freios → sessão de fluxo → fixado → instância → default)
  para `resolveAgentForConversation(conversationId): Promise<Resolution>`.
- Debounce e preview (A4) consomem a mesma função. Zerar `await import()` dinâmico
  nesse caminho (imports estáticos; quebrar ciclos movendo tipos puros).
**Testes:** tabela de decisão cobrindo os 4 níveis + precedência + flows desligados.
**Nota:** fazer ANTES ou JUNTO do A4; A1/A2 mudam a cadeia, então A5 deve vir
depois deles para não reescrever duas vezes.

## PR A6 — Sessão de fluxo com TTL e saída limpa de nó IA
**Arquivos:** `server/flowEngine.ts`, `drizzle/schema.ts` (opcional), config.
- `flow_session_ttl_hours` (setting, default 24): sessão `active` mais velha que o
  TTL é marcada `cancelled` no início do processamento, e a conversa segue a cadeia
  normal (fluxo pode re-disparar pelo gatilho se fizer sentido).
- Ao sair de um nó `ai_response` para nó de outro tipo, limpar `nodeAgentId`/
  `aiInstruction`/`collectMode` do contexto da sessão.
**Testes:** sessão expirada não segura agente; transição de nó limpa contexto;
fluxo re-dispara após TTL.
**Riscos:** fluxos longos legítimos (cliente responde 2 dias depois) — por isso o
TTL é configurável e o cancelamento loga em timeline.

## PR A7 — Evals do agente no CI
**Arquivos:** novo `server/evals/` (fixtures + runner), `vitest.config.ts` ou
script separado, docs.
- 12+ conversas-fixture cobrindo o playbook do Atendente Principal: interesse
  direto, veículo inexistente, ID de anúncio, pechincha, pedido de humano, áudio,
  retorno após dias, LGPD, dois assuntos, fora de horário, cliente irritado,
  pós-handoff.
- Runner chama `processAIMessage` com LLM mockado OU com modelo real em modo
  "julga saída" (LLM-as-judge opcional, fora do CI por custo).
- Assertions: tool calls esperadas (buscar_veiculos chamada antes de falar preço;
  atualizar_lead com etapa correta no handoff), proibições (sem desconto, sem
  inventar veículo, sem markdown).
**Testes:** os próprios evals; CI roda a versão mockada.
**Riscos:** evals com LLM real são flaky — por isso CI usa mock; versão real roda
sob demanda.

---

# FORMATO DA RESPOSTA ESPERADO

1. Validação: a cadeia descrita bate com o código da branch? Apontar divergências
   com arquivo:linha.
2. Por PR: arquivos, esboço de implementação, migration Postgres, testes, riscos,
   estimativa em dias.
3. Dependências entre PRs (A5 depende de A1/A2; A4 depende de A5) e o que
   paraleliza.
4. Plano de rollback por PR (o que desfaz se algo quebrar em produção).
5. O que muda na experiência do USUÁRIO final (dono da loja) em cada PR — em
   linguagem não técnica, 1 frase por PR.
