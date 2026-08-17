# ROADMAP MESTRE — autoinova-chat (consolidado v1+v2+v3)

> Documento único para o Claude executar. Consolida: qualidade de dados (v2),
> automações/jobs (v2) e arquitetura de agentes de IA (v3).
> **Branch de trabalho: `feat/unificacao-canais`** (a main está defasada — NÃO usar).

---

## 0. CONTEXTO VERIFICADO

CRM de WhatsApp para concessionária (Auto Inova, Ivoti-RS) com IA integrada.

**Stack:** TypeScript, Node.js, Express + tRPC, React (Vite), Drizzle ORM com
**PostgreSQL** (pgTable/pgEnum; migração MySQL→PG concluída nesta branch),
Vitest (~298 testes), WhatsApp Cloud API (Meta), Evolution API, Zernio,
OpenAI (gpt-4o-mini).

**Arquivos centrais:** `drizzle/schema.ts` (59KB), `server/routers.ts` (313KB),
`server/ai.ts` (79KB), `server/db.ts` (128KB), `server/flowEngine.ts` (103KB).

### Já existe nesta branch (não reinventar)

- `getCanonicalLead(phone)` (db.ts:1119) — agrupa lead por telefone
- `calculateTemperature(funnelStatus)` (db.ts:1139)
- `leads.isLead`, `conversations.leadId`, tabela `leadOpportunities` (ciclos open/won/lost)
- `server/jobLock.ts` — `withJobLock()` com `pg_try_advisory_xact_lock` (usado pelo scheduler)
- `server/scheduler.ts` — lembretes + mensagens agendadas com claim atômico
- `server/autoQualify.ts` + `conversationIntelligence.ts` — IA avança funil (nunca regride,
  teto "negociando"; "fechado" manual), escreve no lead canônico, loga timeline
- `server/staleLeads.ts` — lead parado 14d vira "perdido"
- `server/channelAdapter.ts` — ChannelSender único (Zernio/Multi-Number/Evolution/Matriz)
- Módulos: metaConversions (CAPI), csat, sellerPerformance, knowledgeBase, quickReplies,
  labels, conversationReminders, scheduledMessages

### Gaps confirmados (arquivo:evidência)

| # | Gap | Evidência |
|---|---|---|
| G1 | Tool `atualizar_lead` sem validação server-side | ai.ts sem Zod/safeParse |
| G2 | `normalizePhone` em 4 cópias divergentes | phoneNormalize.ts, _core/index.ts, metaConversions.ts, client Contacts.tsx |
| G3 | Sem tabela `customers`; PII duplicada | contacts ganhou cpf/birthDate próprios (schema ~694) |
| G4 | Tipos fracos | leads.cpf varchar(14), birthDate varchar(10), tradeKm/tradeYear/downPayment varchar |
| G5 | Taxonomias duplas | leads.status (EN) + funnelStatus (PT) coexistem; leadOpportunities.funnelStatus é varchar solto |
| G6 | 5 jobs periódicos, followUp/rescueJob sem jobLock | followUp.ts com setInterval + hardcode "Auto Inova - Matriz"/"Ivoti-RS" |
| G7 | Extração da IA não grava campos estruturados | fluxos gravam "Nome\|CPF\|Nascimento\|Cidade" em `notas` |
| G8 | God files | routers.ts 313KB, db.ts 128KB, flowEngine.ts 103KB |
| G9 | Observabilidade fragmentada | aiLogs + aiDecisions + conversationInsights + capiEvents |
| G10 | Lixo commitado | server/.fuse_hidden0000000f00000001 |
| G11 | LGPD | CPF em claro em 2 tabelas, sem consentimento/anonização |
| G12 | Seleção de agente com 8 níveis e 3 modos | routers.ts ~130-340, ai.ts ~706; ver §3 |

---

## 1. REGRAS GLOBAIS DE EXECUÇÃO

1. Cada PR mantém os ~298 testes verdes e adiciona os seus.
2. SQL sempre dialeto PostgreSQL.
3. Nenhum PR mistura schema + lógica + front.
4. Todo PR tem plano de rollback declarado.
5. Migrações de dados SEMPRE com dry-run antes de aplicar constraints.

---

## 2. SEQUENCIAMENTO GLOBAL (5 ondas)

```
ONDA 0 — Fundação (risco ~0)
  #0 Índices, FKs, limpeza (.fuse_hidden)

ONDA 1 — Qualidade de dados na fonte
  #1 Validação Zod na tool atualizar_lead
  #2 normalizePhone único
  #3 Extração estruturada de campos (estender conversationIntelligence)
  #4 Score por completude + temperatura

ONDA 2 — Arquitetura de agentes (paralelizável com Onda 1)
  A1 Modo livre vira agente (aiAgents.isDefault)
  A2 Mata chatFlows.aiPrompt legado + nível de canal
  A5 agentResolver.ts único        (depende de A1/A2)
  A4 "Quem responde esta conversa?" (depende de A5)
  A3 Tool transferir_para_vendedor (paralelo)
  A6 Sessão de fluxo com TTL       (paralelo)
  A7 Evals no CI                   (contínuo, cresce a cada PR)

ONDA 3 — Reengajamento unificado
  #5 jobLock em followUp + rescueJob
  #6 Motor único de reengajamento (feature flag) + resgate via flowEngine

ONDA 4 — Estrutura de dados profunda
  #7 Tabela customers canônica + backfill
  #8 Tipos numéricos + taxonomias unificadas

ONDA 5 — Escala e conformidade
  #9 Multi-loja + LGPD
  #10 Quebrar god files (contínuo)
```

Ordem de valor rápido (primeiras 2 semanas): **#0 → #1 → #2 → A1 → #3 → A3**.

---

## 3. ONDA 2 em detalhe — o problema dos agentes

### Cadeia atual de seleção (routers.ts, callback do debounce)

```
1. Flow Engine roda PRIMEIRO (se flows_global_enabled). handled → fim.
2. Freios: conversation.aiActive && isConnectionAiAllowed()
3. Seleção (específico → geral):
   ① sessionCtx.nodeAgentId (nó ai_response em sessão ativa)
   ② chatFlows.agentId
   ③ chatFlows.aiPrompt (LEGADO — sequestra a cadeia)
   ④ conversations.agentId (fixado manualmente)
   ⑤ setting instance_<nome>_agent_id
   ⑥ setting channel_<canal>_agent_id
   ⑦ setting default_agent_id
   ⑧ MODO LIVRE: não é agente — prompts em settings + ai_free_tools
```

### Cadeia-alvo (4 níveis)

```
① Agente fixado na conversa (exceção manual)
② Agente do nó/fluxo em sessão ativa
③ Agente da instância (número) — vínculo principal
④ Agente padrão (aiAgents.isDefault)
```

O agente de produção alvo ("Atendente Principal") já está especificado em
`agente-atendente-principal.md` (jornada de 5 estágios, playbook de 15 situações,
handoff com protocolo) — usar como referência de comportamento nos evals (A7).

---

## 4. DETALHAMENTO DOS PRs

### ONDA 0

**PR #0 — Índices, FKs, limpeza** (0,5d, risco baixo)
Índices: messages(conversationId,createdAt), leads(conversationId), leads(phone),
conversations(phone), contacts(phone), conversations(leadId). Auditoria de órfãos
antes das FKs. Deletar `server/.fuse_hidden0000000f00000001` + gitignore.
Rollback: drop index/constraint.

### ONDA 1

**PR #1 — Validação Zod na tool `atualizar_lead`** (1d, risco baixo) — resolve G1/G4-parcial
Novo `server/leadValidation.ts`: telefone via normalizePhone, CPF com dígitos
verificadores, email trim+lowercase, coerção int tradeKm/tradeYear, downPayment em
centavos, enums restritos. Erro retorna como TOOL RESULT ao modelo (autocorreção,
limite de retentativas, log de rejeições). ~12 testes.
Rollback: flag de desligar validação.

**PR #2 — `normalizePhone` único** (1d, risco médio) — resolve G2
Fonte da verdade: phoneNormalize.ts (mover a `shared/` para o frontend usar sem dep
de DB). Deletar cópias em _core/index.ts, metaConversions.ts, Contacts.tsx.
Eliminar `await import()` dinâmicos. Testes de paridade com snapshot dos casos atuais.

**PR #3 — Extração estruturada de campos** (2d, risco médio) — resolve G7
Estender conversationIntelligence para extrair: nome completo, cpf, data_nascimento,
cidade, email, troca {modelo,ano,km}, entrada. Merge com confidence (não sobrescreve
dado bom com ruim). Passa pelo validador do PR #1. Fallback silencioso — nunca quebra
atendimento. Corrigir fluxos: wait_input que grava "Nome|CPF|Nascimento|Cidade" em
`notas` passa a popular colunas.

**PR #4 — Score por completude** (0,5d, risco baixo)
`server/leadScore.ts`: pontos por completude (veículo, pagamento, troca, dados
pessoais, urgência). Integrar com calculateTemperature existente SEM duplicar —
decidir qual vence e documentar; alinhar com autoQualify.

### ONDA 2

**PR A1 — Modo livre vira agente** (1,5d) — resolve G12-parcial
`aiAgents.isDefault` (máx 1). getDefaultAiAgent: isDefault → fallback setting legado
(com log de deprecação). FREE MODE morre em processAIMessage. Migration copia
personality/ai_free_tools dos settings para o agente default criado (comportamento
inalterado para conversas atuais).

**PR A2 — Mata aiPrompt legado + nível de canal** (1,5d)
Fluxos com aiPrompt e sem agentId → cria agente "Legado — <fluxo>"
(includeCoreLayers=false) e vincula. Dropar coluna aiPrompt. Remover nível ⑥
(channel_*_agent_id migrados para instance_*; conflitos reportados). Backup de
chatFlows antes.

**PR A5 — `agentResolver.ts` único** (1d) — depois de A1/A2
Toda a cadeia (freios → sessão → fixado → instância → default) em
`resolveAgentForConversation()`. Debounce e preview consomem a mesma função.
Imports estáticos. Testes de tabela de decisão.

**PR A4 — "Quem responde esta conversa?"** (1d) — depois de A5
Query protegida retornando a cadeia avaliada passo a passo + vencedor e motivo.
Tela de Agentes mostra vínculos de cada agente + alerta "sem vínculo".

**PR A3 — Tool `transferir_para_vendedor`** (2d, paralelo)
Args: resumo (obrigatório), motivo (enum), atribuir_rodizio (bool). Handler atômico
em transação: etapa → encaminhado_vendedor, notes estruturadas, logTimeline, rodízio
(reusar lógica de assign_seller extraída — não duplicar), routingState=handed_off,
notificação. Pós-handoff: IA responde breve sem tools de veículo. Manter caminho
manual (aiActive=false) compatível.

**PR A6 — Sessão de fluxo com TTL** (1d, paralelo)
`flow_session_ttl_hours` (default 24): sessão active expirada → cancelled + timeline.
Sair de nó ai_response limpa nodeAgentId/aiInstruction/collectMode do contexto.

**PR A7 — Evals no CI** (2d inicial, contínuo)
`server/evals/` com 12+ fixtures do playbook (interesse direto, veículo inexistente,
pechincha, pedido de humano, áudio, retorno após dias, LGPD, pós-handoff...).
CI com LLM mockado; LLM-as-judge sob demanda. Assertions: tool calls corretas,
proibições (sem desconto, sem inventar veículo, sem markdown).

### ONDA 3

**PR #5 — jobLock em followUp + rescueJob** (1d) — resolve G6-parcial
Envolver run() em withJobLock; expor endpoint/CLI idempotente para cron externo.
Comportamento inalterado, só robustez.

**PR #6 — Motor único de reengajamento** (3–4d, risco ALTO)
Tabela reengagement_attempts + máquina de estados (nextAttemptAt, attemptNumber,
strategy: flow|ai_message|template), config única de escalonamento (30min→fluxo,
24h→IA, 48h→template). Backfill de followUpLogs+rescueAttempts. Resgate passa a usar
flowEngine direto (eliminar executeRescueForLead; {{tentativa_resgate}} no
replaceVariables). FEATURE FLAG: novo motor em paralelo, cutover quando estável.
Garantia: 1 lead nunca recebe 2 reengajamentos concorrentes.

### ONDA 4

**PR #7 — `customers` canônica** (3d, risco ALTO) — resolve G3
customers: canonical_phone UNIQUE, name, fullName, email, cpf char(11),
birthDate date, city, consentAt, consentSource. customerId FK em leads/conversations/
contacts. getOrCreateCustomer(phone) reusando getCanonicalLead + isSamePhone no
backfill. DRY-RUN reportando grupos/duplicados antes de constraints. contacts.cpf/
birthDate migram para customers.

**PR #8 — Tipos e taxonomias** (2d) — resolve G4/G5
trade_km/trade_year → integer, down_payment → down_payment_cents (colunas novas +
backfill best-effort com regexp_replace + log; manter antigas 1 release). Deprecar
leads.status (funnelStatus vence). leadOpportunities.funnelStatus → enum compartilhado.

### ONDA 5

**PR #9 — Multi-loja + LGPD** (2d) — resolve G6-parcial/G11
getStoreConfig(storeLocation); remover hardcodes de followUp/rescueJob.
customers.consentAt/consentSource; máscara de CPF no front (***.***.**-NN) salvo
permissão; endpoint de anonização (soft-anonymize preservando métricas).

**PR #10 — God files** (3–5d, contínuo)
routers.ts → routers/{leads,conversations,campaigns,flows,agents,sellers,...}.ts;
camada services/ entre routers e db.ts. Um domínio por PR, suíte verde a cada passo.

---

## 5. ESTIMATIVAS E RISCOS

| Onda | PRs | Esforço | Risco |
|---|---|---|---|
| 0 Fundação | #0 | 0,5d | Baixo |
| 1 Dados | #1–#4 | 4,5d | Baixo-Médio |
| 2 Agentes | A1–A7 | ~10d | Médio |
| 3 Reengajamento | #5–#6 | 4–5d | **Alto** (#6) |
| 4 Estrutura | #7–#8 | 5d | **Alto** (#7 migração) |
| 5 Escala | #9–#10 | 5–7d | Médio |
| **Total** | 18 PRs | **~29–33d** | — |

Riscos específicos desta branch: migração MySQL→PG recente (validar se há resíduos),
5 jobs periódicos concorrentes, god files de 300KB+ dificultando diffs.

---

## 6. FORMATO DA RESPOSTA ESPERADO

1. Validação dos gaps G1–G12 e da cadeia de agentes contra o código da branch,
   com arquivo:linha (apontar o que já foi resolvido ou está errado).
2. Começar pelo PR #0 e seguir as ondas. Para CADA PR: arquivos afetados, esboço
   de implementação, migration Postgres, testes, riscos, plano de rollback.
3. Se só puder executar uma parte: executar Onda 0 + Onda 1 completas e deixar
   plano detalhado das demais.
4. Ao final de cada PR: 1 frase em linguagem não técnica explicando o que mudou
   para o dono da loja.
