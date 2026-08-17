# Proposta de refatoração — autoinova-chat

> Análise técnica e plano de implementação em PRs pequenos.
> Base verificada diretamente no código (não no enunciado).

---

## 0. Correções de premissa (ler antes de tudo)

Antes de aceitar o diagnóstico, dois pontos do enunciado estão **factualmente errados** e mudam decisões técnicas:

1. **O banco é PostgreSQL, não MySQL.** O schema usa `pgTable`, `pgEnum` e `drizzle-orm/pg-core`. Consequências:
   - Item 5 (jobs com lock): **não existe `GET_LOCK`**. O equivalente é **`pg_advisory_lock` / `pg_try_advisory_lock`** (lock por sessão) ou um lock em tabela com `SELECT ... FOR UPDATE SKIP LOCKED`.
   - Migrations de enum seguem o padrão que já usamos: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (idempotente; e atenção: `ADD VALUE` não roda dentro de transação em versões < PG 12).
   - Backfill numérico usa `regexp_replace(...)::int`, não funções MySQL.

2. **Já existe identidade canônica por telefone.** A função `getCanonicalLead(phone)` (server/db.ts:1119) já agrupa lead pelo telefone e é usada em 3+ lugares. Então o item 3 **não é greenfield** — é "extrair/formalizar o conceito que já existe em `leads` para uma entidade `customers`", com menos risco do que o enunciado sugere.

O restante do diagnóstico foi confirmado no código:
- `followUp.ts` e `rescueJob.ts` usam `setInterval` e **hardcodam** "Auto Inova - Matriz"/"Ivoti-RS".
- `normalizePhone` aparece em `phoneNormalize.ts`, `_core/index.ts`, `metaConversions.ts` e `client/src/pages/Contacts.tsx`.
- `aiLogs` e `aiDecisions` coexistem (observabilidade duplicada).
- `leads.status` (enum inglês) **e** `leads.funnelStatus` (enum português) coexistem.
- `tradeYear`/`tradeKm`/`downPayment` são `varchar`; `cpf` `varchar(14)` e `birthDate` `varchar(10)` sem validação.

---

## 1. Análise crítica do diagnóstico

**Concordo com a prioridade macro**, mas reordeno por **risco × esforço × valor imediato**:

| Item | Concordo? | Ajuste |
|---|---|---|
| 1. Validação Zod na tool | ✅ Máxima | Manter em 1º. É barato e para o sangramento de dados sujos hoje. |
| 2. Unificar normalizePhone | ✅ | Subir para 2º (é pré-requisito de qualidade dos itens 1 e 3). |
| 7. Extração estruturada | ⚠️ Repriorizar | O enunciado põe em 7º, mas é o que **mais** melhora qualidade de dado. Fazer logo após 1/2, antes da tabela `customers`. |
| 3. Tabela `customers` | ✅ com ressalva | Alto risco de migração. Fazer **depois** de 1/2/7 estarem estáveis. Reusar `getCanonicalLead` no backfill. |
| 8. Score/temperatura | ✅ | Barato e determinístico; pode vir junto com o 7. |
| 4/6. Reengajamento único + usar flowEngine | ✅ | Bom, mas é o de maior superfície. Fazer 6 (resgate usa flowEngine) **antes** de 4 (unificar tabelas), pra não migrar duas vezes. |
| 5. Jobs com lock | ✅ corrigido | `pg_advisory_lock`, não `GET_LOCK`. Endpoint/CLI idempotente é ótimo. |
| 9. Qualidade de schema | ✅ | Quebrar em sub-PRs (índices/FK primeiro — zero risco; tipos numéricos depois). |
| 10. Multi-loja + LGPD | ✅ | LGPD (máscara de CPF + consentimento) tem risco legal — não deixar por último. Máscara no front é trivial e entra cedo. |
| 11. Quebrar god files | ✅ por último | Incremental, testes verdes a cada passo. |

**O que eu adicionaria:**
- **Índices e FKs (parte do item 9) deveriam ser o PR #0** — risco ~zero, ganho imediato de performance e integridade, e destrava tudo.
- **Limpeza de lixo**: há `server/.fuse_hidden*` versionados (artefato de edição). Remover.
- **`await import()` dinâmicos** (item 2): confirmam acoplamento; alguns são de-fato "lazy load" intencional para quebrar ciclo — trocar por import estático exige mover tipos/funções puras para um módulo sem dependências de DB.

**O que eu removeria/adiaria:**
- **BullMQ/Redis (item 5)**: só se já houver Redis na infra. Para 1 instância, `pg_advisory_lock` + cron externo resolve com muito menos peça móvel. Não introduzir Redis só por isso.

---

## 2. Detalhamento por item

### PR #0 — Índices, FKs e limpeza (pré-requisito, risco ~0)
**Arquivos:** `drizzle/schema.ts`, nova migration, remover `server/.fuse_hidden*`.
**Esboço:** adicionar índices e FKs sem alterar dados.
```sql
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages("conversationId","createdAt");
CREATE INDEX IF NOT EXISTS idx_leads_conversation ON leads("conversationId");
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
-- FKs: só depois de checar órfãos (SELECT ... WHERE conversationId NOT IN ...)
ALTER TABLE messages
  ADD CONSTRAINT fk_messages_conv FOREIGN KEY ("conversationId")
  REFERENCES conversations(id) ON DELETE CASCADE;
```
**Testes:** nenhum novo de lógica; smoke de que a app sobe e `drizzle` valida o schema. Rodar suíte existente (~298).
**Riscos:** FK falha se houver órfãos → rodar auditoria antes; aplicar FK em PR separado do índice se necessário.
**Esforço:** 0,5 dia.

---

### PR #1 — Validação server-side na tool `atualizar_lead` (prioridade máxima)
**Arquivos:** `server/ai.ts` (handler da tool), novo `server/leadValidation.ts`, `server/phoneNormalize.ts` (reuso).
**Esboço:**
```ts
// server/leadValidation.ts
import { z } from "zod";
import { normalizePhone } from "./phoneNormalize";

const cpfValido = (cpf: string) => { /* dígitos verificadores */ };

export const leadUpdateSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  cpf: z.string().transform(s => s.replace(/\D/g,"")).refine(cpfValido, "CPF inválido").optional(),
  ano_troca: z.coerce.number().int().gte(1950).lte(2100).optional(),
  km_troca: z.coerce.number().int().gte(0).optional(),
  entrada: z.coerce.number().int().gte(0).optional(), // já em centavos
  cidade: z.string().trim().optional(),
  etapa_funil: z.enum(FUNNEL_VALUES).optional(),
  // ...
});

export function validateLeadUpdate(raw: unknown) {
  const r = leadUpdateSchema.safeParse(raw);
  if (!r.success) return { ok: false, errorForModel: r.error.issues.map(i=>`${i.path}: ${i.message}`).join("; ") };
  return { ok: true, data: r.data };
}
```
No handler da tool: se `!ok`, **retornar o erro como tool result** para o modelo se autocorrigir (não gravar). Telefone sempre por `normalizePhone` antes de persistir.
**Migration:** nenhuma (validação é de código). `downPayment`/`tradeKm` ainda são varchar até o PR #7-schema; por ora grava string normalizada.
**Testes (Vitest):** `leadValidation.test.ts` — CPF válido/ inválido, e-mail, coerção de km/ano, enum fora de domínio, retorno de erro pro modelo. ~12 casos.
**Riscos:** a IA pode entrar em loop se sempre falhar → limitar re-tentativas; log de rejeições.
**Esforço:** 1 dia.

---

### PR #2 — Unificar `normalizePhone`
**Arquivos:** manter `server/phoneNormalize.ts`; criar `shared/phone.ts` (puro, sem imports de DB) OU exportar de `phoneNormalize`; deletar cópia em `server/_core/index.ts`; `client/src/pages/Contacts.tsx` importa de `shared/` (via alias Vite) ou chama endpoint `trpc.util.normalizePhone`.
**Esboço:** mover a função pura para `shared/phone.ts`; `server/*` e `client/*` importam do mesmo módulo; trocar `await import("./phoneNormalize")` por import estático (a circularidade some quando a função não depende de `db`).
**Migration:** nenhuma.
**Testes:** consolidar em `phone.test.ts` (já há `metaAds.test.ts` tocando nisso) — 9º dígito, variações, `isSamePhone`, DDI. Garantir paridade com o comportamento atual (snapshot dos casos hoje).
**Riscos:** divergência sutil entre as 3 versões — congelar a de `phoneNormalize.ts` como fonte da verdade e cobrir com testes os casos que as outras tratavam.
**Esforço:** 1 dia.

---

### PR #3 — Extração estruturada automática (repriorizado p/ cedo)
**Arquivos:** novo `server/leadExtraction.ts`, chamada em `server/ai.ts` (pós-mensagem do cliente), reuso do validador do PR #1.
**Esboço:**
```ts
// structured output (gpt-4o-mini) com JSON schema
const extracted = await extractLeadData(recentMessages); // timeout 4s, try/catch → null
if (extracted) {
  const merged = mergeWithConfidence(currentLead, extracted); // só sobrescreve se novo mais completo/confiança alta
  const v = validateLeadUpdate(merged);                       // MESMO Zod do PR #1
  if (v.ok) await upsertLead(v.data);
}
```
**Migration:** opcional — coluna `leads.extractionConfidence jsonb` para auditar.
**Testes:** `leadExtraction.test.ts` com mock do modelo (fixtures de conversa → JSON esperado), merge por confiança, fallback silencioso em timeout/erro.
**Riscos:** custo/latência (roda a cada msg) → só disparar quando houver sinal (mensagem do cliente com conteúdo novo), debounce junto do fluxo existente; nunca bloquear o atendimento.
**Esforço:** 2 dias.

---

### PR #4 — Score/temperatura determinísticos
**Arquivos:** novo `server/leadScore.ts`, usado em `upsertLead`/pós-extração. Já existe `calculateTemperature(funnelStatus)` em `db.ts` — generalizar.
**Esboço:**
```ts
export function scoreLead(l: Lead): number {
  let s = 0;
  if (l.vehicleInterest) s += 25;
  if (l.paymentMethod)   s += 20;
  if (l.hasTrade)        s += 15;
  if (l.city && l.name)  s += 15;
  if (/hoje|urgente|essa semana/i.test(l.notes||"")) s += 25;
  return Math.min(100, s);
}
export const tempFromScore = (s:number) => s>=75?"muito_quente":s>=50?"quente":s>=25?"morno":"frio";
```
IA só ajusta em ambiguidade (sinal de urgência textual).
**Migration:** nenhuma (usa colunas existentes `score`/`temperature`).
**Testes:** `leadScore.test.ts` — tabela de completude → score → faixa.
**Riscos:** baixo. Alinhar faixas com o CRM config dinâmico que já existe (`ai_crm_config`).
**Esforço:** 0,5 dia.

---

### PR #5 — Resgate usando `flowEngine` (item 6 antes do 4)
**Arquivos:** `server/rescueJob.ts` (remover `executeRescueForLead`), `server/flowEngine.ts` (suporte a `{{tentativa_resgate}}` no `replaceVariables`, e criar sessão tipo `rescue`).
**Esboço:** resgate deixa de reimplementar nós; cria `flowSession` no fluxo de resgate e chama `processFlowMessage`/`executeFromNode`. Variável nova no `replaceVariables` (já tem o padrão `{{...}}`).
**Migration:** talvez `flowSessions.kind` ('normal'|'rescue') para telemetria.
**Testes:** estender `flowEngine.test.ts` — sessão rescue executa nós reais; `{{tentativa_resgate}}` resolve.
**Riscos:** paridade de comportamento com o resgate atual — cobrir os node types que o resgate usava hoje.
**Esforço:** 2 dias.

---

### PR #6 — Motor único de reengajamento (item 4)
**Arquivos:** nova tabela `reengagementAttempts`, `server/reengagement.ts` (novo), migrar `followUp.ts`/`rescueJob.ts` para consumir a máquina de estados.
**Esboço:** máquina por lead: `nextAttemptAt`, `attemptNumber`, `strategy` (`ai_message`|`flow`|`template`), regras de escalonamento em config única (30min→fluxo, 24h→IA, 48h→template). **Um lock por lead** garante que não saem duas mensagens concorrentes.
**Migration:**
```sql
CREATE TABLE reengagement_attempts (
  id serial PRIMARY KEY,
  lead_id int REFERENCES leads(id) ON DELETE CASCADE,
  attempt_number int NOT NULL DEFAULT 0,
  strategy varchar(20) NOT NULL,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'pending'
);
-- backfill de followUpLogs + rescueAttempts (best-effort) para histórico
```
**Testes:** `reengagement.test.ts` — escalonamento por tempo, não-duplicação concorrente (dois workers, um lock), transições de estado.
**Riscos:** o mais alto do plano. Fazer com feature flag: rodar novo motor em paralelo lendo/escrevendo a nova tabela, e só cortar os jobs antigos quando estável.
**Esforço:** 3–4 dias.

---

### PR #7 — Jobs robustos com lock (Postgres, não MySQL)
**Arquivos:** `server/jobRunner.ts` (novo), `followUp.ts`/`rescueJob.ts`/`reengagement.ts` expõem `run()` idempotente; `index.ts` deixa de usar `setInterval`.
**Esboço:**
```ts
// lock por advisory lock — 1 execução por vez, mesmo com N processos
export async function withLock(key: number, fn: () => Promise<void>) {
  const got = await db.execute(sql`SELECT pg_try_advisory_lock(${key}) AS ok`);
  if (!got.rows[0].ok) return; // outro worker já roda
  try { await fn(); } finally { await db.execute(sql`SELECT pg_advisory_unlock(${key})`); }
}
```
Cada job vira **endpoint/CLI** (`POST /internal/jobs/reengagement`) chamado por cron externo — sem estado em memória, sobrevive a restart.
**Migration:** opcional `job_runs` para auditoria.
**Testes:** `jobRunner.test.ts` — dois `withLock` concorrentes só um executa (mock do advisory lock).
**Riscos:** advisory lock é por sessão/conexão — garantir mesma conexão no try/finally (pool!). Preferir `SELECT ... FOR UPDATE SKIP LOCKED` numa tabela de fila se o pool reciclar conexões.
**Esforço:** 1,5 dia.

---

### PR #8 — Tabela `customers` canônica
**Arquivos:** `drizzle/schema.ts` (+`customers`, +`customerId` em `leads`/`conversations`/`contacts`), `server/customers.ts` (`getOrCreateCustomer`), pontos de entrada (webhooks, campanhas, import Excel).
**Esboço:** `getOrCreateCustomer(phone)` reusa `getCanonicalLead`/`isSamePhone` no backfill.
```sql
CREATE TABLE customers (
  id serial PRIMARY KEY,
  canonical_phone varchar(20) UNIQUE NOT NULL,
  name varchar(255), full_name varchar(255), email varchar(255),
  cpf varchar(11), birth_date date, city varchar(120),
  consent_at timestamptz, consent_source varchar(50),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE leads ADD COLUMN customer_id int REFERENCES customers(id);
-- backfill: agrupar leads por normalizePhone → 1 customer → set customer_id
```
**Testes:** `customers.test.ts` — get-or-create idempotente, merge de duplicados por `isSamePhone`, vínculo de leads.
**Riscos:** **migração de dados** é o risco central. Rodar backfill em transação, com dry-run que reporta quantos grupos/duplicados, antes de aplicar FK `NOT NULL`.
**Esforço:** 3 dias.

---

### PR #9 — Qualidade de schema (tipos + unificação de status)
**Arquivos:** `drizzle/schema.ts`, migration com backfill; ajustar `atualizar_lead` e leitura no front.
**Esboço:**
```sql
ALTER TABLE leads ADD COLUMN trade_km_int int, ADD COLUMN trade_year_int int, ADD COLUMN down_payment_cents int;
UPDATE leads SET trade_km_int = NULLIF(regexp_replace(coalesce("tradeKm",''),'\D','','g'),'')::int;
-- ... backfill best-effort; manter colunas antigas 1 release para rollback
```
Unificar `status`↔`funnelStatus`: manter `funnelStatus`, marcar `status` deprecado (parar de escrever, remover depois). Enum compartilhado de `leadStatus` para `evolutionConversations`/`whatsappNumberConversations`.
**Testes:** migração idempotente; leitura numérica; nada quebra na tool.
**Riscos:** dados sujos no backfill (km "150 mil") → best-effort + log dos não convertidos.
**Esforço:** 2 dias.

---

### PR #10 — Multi-loja + LGPD
**Arquivos:** nova `stores` ou `settings` por loja; remover hardcodes em `followUp.ts`/`rescueJob.ts`/`ai.ts`; front mascara CPF; endpoint de anonimização.
**Esboço:** `getStoreConfig(storeLocation)` → nome/cidade/assinatura. CPF exibido `***.***.***-NN` salvo permissão. `DELETE /customers/:id/anonymize` zera PII e marca `anonymizedAt`.
**Migration:** `customers.anonymized_at`, `stores`.
**Testes:** máscara de CPF (unit no util), anonimização remove PII e mantém métricas agregadas.
**Riscos:** legal — priorizar máscara + consentimento; anonimização precisa preservar integridade referencial (soft-anonymize, não delete).
**Esforço:** 2 dias.

---

### PR #11 — Quebrar god files (por último, incremental)
**Arquivos:** `routers.ts` → `routers/{leads,conversations,campaigns,flows,agents,sellers}.ts`; camada `services/` entre routers e `db.ts`.
**Esboço:** mover um router de domínio por vez, re-exportando do índice; suíte verde a cada movimento.
**Testes:** os existentes servem de rede de segurança; não reescrever lógica, só mover.
**Riscos:** merge conflicts com trabalho em andamento — fazer em janelas curtas.
**Esforço:** 3–5 dias (incremental).

---

## 3. Sequenciamento em PRs

```
PR#0  Índices/FKs/limpeza        (destrava, risco ~0)
  └─ PR#1  Validação Zod tool     (para o sangramento)
       └─ PR#2  normalizePhone único
            └─ PR#3  Extração estruturada  ─┐
            └─ PR#4  Score determinístico  ─┴─ (usam o validador do #1)
  PR#5  Resgate via flowEngine
    └─ PR#6  Motor de reengajamento único   (feature-flag)
         └─ PR#7  Jobs com pg_advisory_lock + cron
  PR#8  customers canônica        (após dados já limpos por #1/#3)
    └─ PR#9  Tipos numéricos + status unificado
         └─ PR#10 Multi-loja + LGPD
              └─ PR#11 Quebrar god files (contínuo)
```

Regra: **cada PR mantém os ~298 testes verdes** e adiciona os seus. Nada de PR que toca schema + lógica + front ao mesmo tempo.

## 4. Estimativa de esforço

| PR | Esforço | Risco |
|---|---|---|
| #0 Índices/FK/limpeza | 0,5 d | Baixo |
| #1 Validação Zod | 1 d | Baixo |
| #2 normalizePhone | 1 d | Médio |
| #3 Extração estruturada | 2 d | Médio |
| #4 Score determinístico | 0,5 d | Baixo |
| #5 Resgate via flowEngine | 2 d | Médio |
| #6 Reengajamento único | 3–4 d | **Alto** |
| #7 Jobs com lock | 1,5 d | Médio |
| #8 customers canônica | 3 d | **Alto** (migração) |
| #9 Tipos + status | 2 d | Médio |
| #10 Multi-loja + LGPD | 2 d | Médio (legal) |
| #11 God files | 3–5 d | Médio (contínuo) |
| **Total** | **~22–25 dias** | — |

Ganho de valor mais rápido pelo menor risco: **#0 → #1 → #2 → #4 → #3**. Isso já resolve a maior parte de "dado sujo/perdido" (Seção A e C do diagnóstico) em cerca de 5 dias.
