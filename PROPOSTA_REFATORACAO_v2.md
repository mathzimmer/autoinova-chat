# Proposta de refatoração v2 — branch `feat/unificacao-canais`

> Verificado diretamente no código da branch (não na `main`, não no enunciado).
> Banco confirmado: **PostgreSQL** (`pgTable`/`pgEnum`/`drizzle-orm/pg-core`). SQL sempre dialeto PG.

---

## 1. Validação dos gaps G1–G11 (contra o código da branch)

| Gap | Veredito | Evidência / correção |
|---|---|---|
| **G1** Tool `atualizar_lead` sem validação | ✅ **Confirmado** | `server/ai.ts` não tem `safeParse`/`z.object`/`leadValidation` no handler. A IA grava string crua. |
| **G2** `normalizePhone` duplicada | ⚠️ **Confirmado com nuance** | Cópias reais da geral: `phoneNormalize.ts` (fonte), `_core/index.ts`, `client/.../Contacts.tsx` = **3**, não 4. `metaConversions.ts:60` é `normalizePhoneForHash` (E.164 p/ hash CAPI) — **função de outro propósito**, não duplicata. `await import("./phoneNormalize")` dinâmico em `db.ts` (847,1123,1201,2527,2562) e `routers.ts` (952,1014,2508,5450,5587) — acoplamento real. |
| **G3** Sem tabela `customers` | ✅ **Confirmado** | Não existe `customers` no schema. PII duplicada: `leads.cpf/birthDate` (schema:176-177) **e** `contacts.cpf/birthDate` (694-695). Telefone sem `unique` canônico. Porém `getCanonicalLead` (db.ts:1119) já dá a identidade lógica p/ o backfill. |
| **G4** Tipos fracos | ✅ **Confirmado** | `leads.cpf varchar(14)`, `birthDate varchar(10)`, `tradeYear/tradeKm/downPayment varchar`. |
| **G5** Taxonomias espalhadas | ✅ **Confirmado + achado extra** | `leads.status` (enum `lead_status`) e `leads.funnelStatus` (enum `funnel_status`) coexistem. `leadOpportunities.funnelStatus` é `varchar(50)` **fora do enum** (schema:362). **Extra:** `leadOpportunities.leadId` é `integer().notNull()` **sem FK** (361) — órfão possível. |
| **G6** followUp/rescueJob sem lock | ❌ **Parcialmente errado** | `rescueJob.ts` **já usa** `withJobLock("rescue_job", ...)` (439-440). Entre os 5 jobs: **com lock** = `scheduler`, `rescueJob`; **sem lock** = `followUp`, `autoQualify`, `staleLeads`. O único que **envia mensagem ao cliente** sem lock é o `followUp`. `autoQualify`/`staleLeads` só mexem no funil (risco menor). Hardcode "Auto Inova - Matriz"/"Ivoti-RS" confirmado em ambos. Todos ainda usam `setInterval` (não sobrevivem a restart). |
| **G7** Extração não grava estruturado | ❌ **Parcialmente errado** | O `flowEngine` **já mapeia** campos estruturados: `fieldMap` (nome_completo→fullName, cpf→cpf, data_nascimento→birthDate, entre outros) e whitelist `validFields` incluindo cpf/birthDate/fullName (`flowEngine.ts:484-496`). O gap real é (a) **fluxos configurados** com um `wait_input` único despejando em `notas`, e (b) `conversationIntelligence` não extrai PII (só funil/temperatura/objeções). É correção de **config + escopo de extração**, não de incapacidade do motor. |
| **G8** God files | ✅ **Confirmado** | `routers.ts` 313KB, `db.ts` 128KB, `flowEngine.ts` 103KB. |
| **G9** Observabilidade fragmentada | ✅ **Confirmado** | `aiLogs` (244), `aiDecisions` (425), `capiEvents` (1031), `conversationInsights` (1070) — 4 tabelas, propósitos sobrepostos. |
| **G10** Lixo commitado | ✅ **Confirmado** | `server/.fuse_hidden0000000f00000001` **rastreado no git** (`git ls-files`). |
| **G11** LGPD | ✅ **Confirmado** | CPF em claro em `leads` e `contacts`, sem consentimento/retenção/anonização. |

**Resumo:** G1, G3, G4, G5, G8, G9, G10, G11 confirmados. G2 confirmado com nuance (3 cópias, não 4). **G6 e G7 exagerados** — parte já resolvida na branch; isso reduz o escopo dos PRs #5 e #3.

---

## 2. Detalhe por PR

### PR #0 — Índices, FKs e limpeza (risco ~0)
**Arquivos:** `drizzle/schema.ts`, migration, deletar `server/.fuse_hidden0000000f00000001`, `.gitignore`.
**Migration (PG):**
```sql
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages("conversationId","createdAt");
CREATE INDEX IF NOT EXISTS idx_leads_conversation   ON leads("conversationId");
CREATE INDEX IF NOT EXISTS idx_leads_phone          ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_phone  ON conversations(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_lead   ON conversations("leadId");
CREATE INDEX IF NOT EXISTS idx_contacts_phone       ON contacts(phone);
-- FK só após auditoria de órfãos:
--   SELECT count(*) FROM leadOpportunities lo LEFT JOIN leads l ON l.id=lo."leadId" WHERE l.id IS NULL;
ALTER TABLE "leadOpportunities"
  ADD CONSTRAINT fk_opp_lead FOREIGN KEY ("leadId") REFERENCES leads(id) ON DELETE CASCADE;
```
`.gitignore`: `server/.fuse_hidden*`; `git rm --cached server/.fuse_hidden0000000f00000001`.
**Testes:** smoke (app sobe, `drizzle-kit` valida). Suíte existente verde.
**Riscos:** FK falha com órfãos → auditar antes; índice `CONCURRENTLY` se a tabela `messages` for grande (fora de transação).
**Esforço:** 0,5 d.

### PR #1 — Validação Zod em `atualizar_lead` (máxima)
**Arquivos:** novo `server/leadValidation.ts`; `server/ai.ts` (handler da tool); reuso `phoneNormalize.ts`.
**Esboço:** schema Zod (CPF com DV, email trim+lower, `z.coerce.number().int()` p/ km/ano, entrada→centavos, enums restritos ao `funnel_status`). Se `!ok`, **retornar erro como tool result** p/ o modelo autocorrigir; limitar re-tentativas; logar rejeição em `aiDecisions`.
```ts
const r = leadUpdateSchema.safeParse(raw);
if (!r.success) return { role:"tool", content:`Dados inválidos: ${issues}`}; // NÃO grava
await upsertLead(r.data);
```
**Migration:** nenhuma.
**Testes:** `leadValidation.test.ts` (~12): CPF válido/inválido/DV, email, coerção km/ano, entrada centavos, enum fora de domínio, telefone normalizado, retorno de erro.
**Riscos:** loop de re-tentativa da IA → cap de N; garantir que campos válidos parciais ainda gravam.
**Esforço:** 1 d.

### PR #2 — `normalizePhone` único
**Arquivos:** criar `shared/phone.ts` (puro, sem `db`); `phoneNormalize.ts` re-exporta; deletar cópia de `_core/index.ts` e a de `Contacts.tsx` (front importa de `shared/` via alias Vite ou endpoint tRPC). **Não** tocar `normalizePhoneForHash` (propósito distinto). Trocar `await import("./phoneNormalize")` por import estático nos 10 pontos.
**Migration:** nenhuma.
**Testes:** consolidar `phone.test.ts` — 9º dígito, variações, `isSamePhone`, DDI; snapshot dos casos que `_core` e `Contacts` tratavam (garantir paridade).
**Riscos:** ciclo `db ↔ phoneNormalize` — por isso mover a função **pura** p/ `shared/` sem importar `db`.
**Esforço:** 1 d.

### PR #3 — Extração estruturada (estender, não criar)
**Arquivos:** `server/conversationIntelligence.ts` (ampliar o structured output), reuso validador do #1; **corrigir os fluxos** que usam `wait_input` único → `notas`.
**Esboço:** adicionar ao JSON schema: `fullName, cpf, data_nascimento, cidade, email, troca{modelo,ano,km}, entrada`. Merge por confiança (só sobrescreve se novo mais completo/confiança alta) → **passa pelo Zod do #1** → persiste. Falha/timeout = fallback silencioso. O `fieldMap` do flowEngine (484-496) já existe; ajustar os **flows** (config) pra mapear cada campo à coluna, não a `notas`.
**Migration:** opcional `leads.extractionConfidence jsonb` (auditoria).
**Testes:** `conversationIntelligence.test.ts` — fixtures conversa→JSON, merge por confiança, fallback; teste de fluxo mapeando p/ colunas.
**Riscos:** custo/latência (roda por mensagem) — reaproveitar o gatilho de análise já existente (1 análise/pessoa/ciclo), não uma chamada nova por token.
**Esforço:** 2 d (menor que o estimado, porque a infra de análise já existe).

### PR #4 — Score por completude + temperatura
**Arquivos:** novo `server/leadScore.ts`; integrar com `calculateTemperature` (db.ts:1139) e `autoQualify` (que hoje usa `insight.temperature` da IA).
**Decisão a documentar:** **score determinístico vence** como base; a IA só ajusta em ambiguidade (urgência textual). `calculateTemperature(funnelStatus)` continua como piso derivado do funil; o score refina dentro da faixa.
**Migration:** nenhuma (usa `score`/`temperature`).
**Testes:** `leadScore.test.ts` — completude→score→faixa; conflito IA×regra resolve pela regra salvo urgência.
**Riscos:** divergência com `ai_crm_config` dinâmico — ler as faixas de lá.
**Esforço:** 0,5 d.

### PR #5 — `withJobLock` em `followUp` (escopo reduzido)
**Arquivos:** `server/followUp.ts` (só ele falta entre os que enviam msg). Opcional: `autoQualify`/`staleLeads` por consistência.
**Esboço:** espelhar `rescueJob.ts:439-440`:
```ts
export async function startFollowUpJob(){ /* ... */
  followUpInterval = setInterval(()=> withJobLock("follow_up_job", runFollowUpJob), ms);
}
```
Expor `runFollowUpJob()` idempotente via endpoint interno/CLI p/ cron externo.
**Migration:** nenhuma.
**Testes:** `followUp.test.ts` — dois runs concorrentes, um só executa (mock do lock).
**Riscos:** baixo — padrão já validado no `rescueJob`/`scheduler`.
**Esforço:** 0,5 d.

### PR #6 — Motor único de reengajamento
**Arquivos:** nova `reengagement_attempts`; `server/reengagement.ts`; `followUp.ts`/`rescueJob.ts` passam a consumir a máquina de estados; **resgate usa flowEngine** (eliminar `executeRescueForLead`), `+{{tentativa_resgate}}` no `replaceVariables` (flowEngine.ts:~80-120, onde estão os `{{...}}`).
**Migration (PG):**
```sql
CREATE TABLE reengagement_attempts (
  id serial PRIMARY KEY,
  lead_id int REFERENCES leads(id) ON DELETE CASCADE,
  attempt_number int NOT NULL DEFAULT 0,
  strategy varchar(20) NOT NULL,            -- flow | ai_message | template
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX uq_reeng_active_lead ON reengagement_attempts(lead_id) WHERE status='pending';
```
O índice parcial único **garante 1 tentativa ativa por lead** (anti-duplicação estrutural). Claim atômico via `UPDATE ... WHERE status='pending' RETURNING` (padrão já usado no scheduler.ts).
**Testes:** `reengagement.test.ts` — escalonamento por tempo, não-duplicação concorrente, transições; paridade do resgate via flowEngine.
**Riscos:** **maior do plano.** Feature-flag: rodar em paralelo, cutover só quando estável; backfill best-effort de `followUpLogs`/`rescueAttempts`.
**Esforço:** 3–4 d.

### PR #7 — Tabela `customers` canônica
**Arquivos:** `drizzle/schema.ts` (+`customers`, +`customerId` FK em `leads`/`conversations`/`contacts`); `server/customers.ts` (`getOrCreateCustomer` reusando `getCanonicalLead`+`isSamePhone`); pontos de entrada (webhooks, campanhas, import Excel).
**Migration (PG):**
```sql
CREATE TABLE customers (
  id serial PRIMARY KEY,
  canonical_phone varchar(20) UNIQUE NOT NULL,
  name varchar(255), full_name varchar(255), email varchar(255),
  cpf char(11), birth_date date, city varchar(120),
  consent_at timestamptz, consent_source varchar(50),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE leads         ADD COLUMN customer_id int REFERENCES customers(id);
ALTER TABLE conversations ADD COLUMN customer_id int REFERENCES customers(id);
ALTER TABLE contacts      ADD COLUMN customer_id int REFERENCES customers(id);
-- backfill: agrupar por normalizePhone → 1 customer → set customer_id; contacts.cpf/birthDate migram
```
**Dry-run obrigatório** reportando nº de grupos e duplicados antes de aplicar `NOT NULL`/constraints.
**Testes:** `customers.test.ts` — get-or-create idempotente, merge por `isSamePhone`, vínculo.
**Riscos:** **migração de dados** é o risco central; transação + rollback; `contacts.cpf/birthDate` deprecadas 1 release.
**Esforço:** 3 d.

### PR #8 — Tipos e taxonomias
**Arquivos:** `drizzle/schema.ts`, migration com backfill; `ai.ts` (tool) e leitura no front.
**Migration (PG):**
```sql
ALTER TABLE leads ADD COLUMN trade_km_int int, ADD COLUMN trade_year_int int, ADD COLUMN down_payment_cents int;
UPDATE leads SET trade_km_int = NULLIF(regexp_replace(coalesce("tradeKm",''),'\D','','g'),'')::int; -- best-effort + log dos NULL
-- leadOpportunities.funnelStatus varchar → usar enum funnel_status:
ALTER TABLE "leadOpportunities" ALTER COLUMN "funnelStatus" TYPE funnel_status USING "funnelStatus"::funnel_status;
```
Deprecar `leads.status` (parar de escrever; `funnelStatus` vence). Manter colunas antigas 1 release p/ rollback.
**Testes:** migração idempotente; leitura numérica; enum aceita só domínio.
**Riscos:** dados sujos ("150 mil") → best-effort + log; cast de enum falha se houver valor fora do domínio em `leadOpportunities` → sanear antes.
**Esforço:** 2 d.

### PR #9 — Multi-loja + LGPD
**Arquivos:** `getStoreConfig(storeLocation)` (settings ou nova `stores`); remover hardcodes de `followUp.ts`/`rescueJob.ts`/`ai.ts`; front mascara CPF; endpoint de anonização.
**Migration:** `customers.anonymized_at`; `stores` (opcional).
**Esboço:** CPF exibido `***.***.***-NN` salvo permissão; `POST /customers/:id/anonymize` = **soft-anonymize** (zera PII, mantém métricas/FK).
**Testes:** máscara (unit), anonimização remove PII e preserva agregados.
**Riscos:** legal — priorizar máscara + consentimento; não deletar (quebra FK/histórico).
**Esforço:** 2 d.

### PR #10 — Quebrar god files (contínuo)
**Arquivos:** `routers.ts` → `routers/{leads,conversations,campaigns,flows,agents,sellers}.ts`; `services/` entre routers e `db.ts`. Um domínio por PR, re-export do índice, suíte verde a cada passo.
**Riscos:** conflitos de merge com trabalho em andamento (a branch está ativa) — janelas curtas.
**Esforço:** 3–5 d incremental.

---

## 3. Dependências e paralelização

```
PR#0 (índices/FK)  ── independente, faz já
PR#1 (Zod)         ── independente ──┐
PR#2 (phone único) ── independente ──┤ (podem ir em paralelo)
                                     ├─> PR#3 (extração) depende de #1
                                     ├─> PR#4 (score) independente, casa com #3
PR#5 (lock followUp) ── independente, faz já
PR#6 (reengajamento) ── depende de #5 estável (feature-flag)
PR#7 (customers)   ── depende de #1/#2/#3 (dados limpos) e usa getCanonicalLead
PR#8 (tipos)       ── depende de #7 (ou pode ir antes, sem customerId)
PR#9 (LGPD)        ── depende de #7 (consentAt em customers)
PR#10 (god files)  ── contínuo, por último
```

**Paralelizáveis com segurança:** #0, #1, #2, #5 (times/pessoas diferentes, superfícies distintas). **Serializar obrigatoriamente:** #6 e #7 (maior risco, tocam dados vivos) — nunca simultâneos.

**Caminho de maior valor / menor risco:** #0 → #1 → #2 → #4 → #5 (~3,5 dias) já resolve dado sujo na entrada + trava o único job de mensagem sem lock.

---

## 4. Riscos específicos desta branch

1. **Migração MySQL→PG recente:** revisar se sobraram tipos/consultas herdados (ex.: `bigint` mode "number", `timestamp` sem timezone). Todo SQL novo em dialeto PG; enums via `ALTER TYPE ... ADD VALUE` (não roda em transação em PG<12) — separar de outras migrations transacionais.
2. **5 jobs periódicos, 2 sem lock que importam:** `followUp` (envia msg) é o risco imediato de duplicação; `autoQualify`/`staleLeads` sem lock podem correr 2x mas só reescrevem funil (idempotente-ish). PR#5 fecha o buraco crítico barato.
3. **God files 300KB+ em branch ativa:** qualquer refactor grande (#10) colide com features em voo. Fazer por domínio, curto, e só depois que #1–#9 estabilizarem.
4. **PII em 2 tabelas antes de `customers`:** enquanto #7 não roda, cada novo ponto de escrita de CPF aumenta o custo do backfill — congelar novas colunas de PII fora de `customers` a partir de agora.
5. **`leadOpportunities` sem FK + funnelStatus solto:** risco de órfão e de valor fora do enum; sanear em #0 (FK) e #8 (enum) antes de qualquer relatório confiar nesses campos.
6. **Acoplamento circular via `await import()`:** 10 pontos. Resolver junto do #2 (função pura em `shared/`) evita regressão silenciosa de ordem de carregamento.

---

### Estimativa consolidada
| PR | Esforço | Risco |
|---|---|---|
| #0 índices/FK/limpeza | 0,5 d | Baixo |
| #1 Zod tool | 1 d | Baixo |
| #2 phone único | 1 d | Médio |
| #3 extração (estende) | 2 d | Médio |
| #4 score | 0,5 d | Baixo |
| #5 lock followUp | 0,5 d | Baixo |
| #6 reengajamento único | 3–4 d | **Alto** |
| #7 customers | 3 d | **Alto** |
| #8 tipos/taxonomia | 2 d | Médio |
| #9 multi-loja + LGPD | 2 d | Médio |
| #10 god files | 3–5 d | Médio |
| **Total** | **~19–22 d** | — |

(Menor que a v1 porque G6/G7 já estão parcialmente resolvidos nesta branch.)
