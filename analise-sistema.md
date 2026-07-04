# AutoInova CRM — Análise Profunda do Sistema

*Análise de código, branch `feat/supabase` — 04/07/2026*

## 1. Visão geral da arquitetura

React + Vite + tRPC + Express + Drizzle/PostgreSQL (Supabase) + MinIO + Socket.io, rodando em 1 container Docker no VPS. Monólito bem integrado, adequado ao tamanho da operação. Os problemas não são de escolha de stack — são de segurança de borda (webhooks/socket), fragmentação de dados de conversa e falta de paginação/observabilidade.

---

## 2. FRAGILIDADES — em ordem de gravidade

### 🔴 Críticas (corrigir esta semana)

**F1. Webhooks sem verificação de assinatura.**
`POST /api/webhook/whatsapp`, `/meta-ads`, `/instagram` aceitam qualquer payload de qualquer origem. A Meta assina cada webhook com `X-Hub-Signature-256` (HMAC do `META_APP_SECRET`) e o código não valida. Qualquer pessoa que descubra a URL pode: injetar mensagens falsas, criar conversas/leads falsos, disparar a IA (custo de tokens) e poluir o funil/CAPI.
*Correção:* middleware que valida `X-Hub-Signature-256` antes de processar; rejeitar com 401 se inválida.

**F2. `POST /api/webhook/generic` totalmente aberto.**
Sem autenticação, sem assinatura, sem rate limit — cria conversas e aciona a IA com um curl. É a porta de spam mais fácil do sistema.
*Correção:* exigir um header `X-Api-Key` conferido contra a tabela `vendorApiKeys` (já existe!) ou desativar se não estiver em uso.

**F3. Socket.io sem autenticação e CORS `origin: "*"`.**
Qualquer navegador pode conectar em `/api/socket.io`, dar `join_conversation(N)` e **receber em tempo real as mensagens dos seus clientes** (vazamento de dados pessoais — LGPD). 
*Correção:* validar o cookie de sessão no handshake (`io.use(...)`) e restringir CORS ao domínio do CRM.

**F4. `POST /api/whatsapp/exchange-token` sem autenticação.**
Endpoint troca `code` por token usando seu `META_APP_SECRET` — é um proxy aberto do seu app Meta. 
*Correção:* exigir sessão de admin.

**F5. Segredos expostos em conversas/documentos.**
O `META_APP_SECRET` circulou em texto plano (inclusive nesta conversa). Considere-o comprometido.
*Correção:* rotacionar no painel Meta (Configurações do App → Básico → Redefinir chave secreta) e atualizar o `.env`.

### 🟠 Importantes (próximas 2–4 semanas)

**F6. Hash de senha fraco no login do time.** `pbkdf2` com **1.000 iterações** (OWASP recomenda ≥ 210.000 para SHA-512). Com a tabela vazada, senhas caem em minutos. *Correção:* subir iterações e re-hash no próximo login, ou migrar para bcrypt.

**F7. `express.json({ limit: "50mb" })` global + sem rate limiting.** Qualquer endpoint aceita corpo de 50 MB; sem limite de requisições nos webhooks públicos. Vetor de DoS barato. *Correção:* limite padrão 1 MB, 50 MB só nas rotas de upload; `express-rate-limit` nos webhooks.

**F8. Mídia no MinIO com URL pública permanente.** Áudios e fotos de clientes ficam acessíveis para sempre a quem tiver o link. *Correção:* presigned URLs com expiração, ou pelo menos keys com UUID forte.

**F9. Sem migrações versionadas.** `drizzle-kit push` direto em produção não tem histórico nem rollback; um push errado pode dropar coluna com dados. *Correção:* `drizzle-kit generate` + `migrate` no deploy.

**F10. Jobs em `setInterval` sem lock distribuído.** rescue, followUp, campanhas, scheduler, stockSync e tokenMonitor rodam no mesmo processo. Com 1 container funciona; se subir uma 2ª réplica (ou o Docker recriar o container durante um deploy sem parar o antigo), **tudo duplica** — o bug das mensagens agendadas 2x foi um sintoma disso. *Correção:* advisory lock do Postgres (`pg_advisory_lock`) por job.

**F11. Bug tRPC pendente.** `Expression is of type asyncfunction, not function` no console — alguma procedure usa `.refine()` async em contexto síncrono (pendência antiga). Localizar com `grep -n "refine(async" server/routers.ts`.

### 🟡 Estruturais (planejar)

**F12. TRÊS modelos de conversa paralelos.** `conversations` (Cloud API/IG/FB), `evolutionConversations` (instâncias vendedores) e `whatsappNumberConversations` — três tabelas, três UIs de chat, três lógicas de mensagens. Consequências: cliente que fala com a matriz E com vendedor vira 2 registros sem vínculo; métricas fragmentadas; cada feature nova (etiquetas, lembretes...) só existe na matriz. A caixa única implementada agora resolve a *navegação*; a unificação de *dados* (tabela única com `channel` + `instanceId`) é o próximo passo estrutural.

**F13. Contato duplicado.** `contactName/Email/Notes` vivem em `conversations`, separados da tabela `contacts`. Já mapeado no roadmap (P6) — segue pendente e piora com multi-instância.

**F14. `routers.ts` com ~4.900 linhas e `EvolutionInbox.tsx` com ~1.350.** Custo de manutenção crescente e conflitos de merge. *Correção:* dividir routers por domínio (`routers/lead.ts`, `routers/inbox.ts`...) — mecânico, sem risco.

**F15. Sem paginação.** `conversation.list` e `lead.listWithDetails` trazem tudo; `listMessages` corta em 500. Com 10k+ conversas o inbox vai arrastar. *Correção:* cursor pagination (por `lastMessageAt`) + infinite scroll.

**F16. Estado em memória que se perde no restart.** `messageDebounce` (mensagens agrupadas aguardando IA) e reactions locais do chat somem em deploy/restart. Debounce em tabela ou Redis se virar problema real.

**F17. Zero testes no client** (25 arquivos de teste no server — bom!). O inbox, peça mais crítica da UI, não tem cobertura.

---

## 3. ANÁLISE POR MÓDULO — estado e oportunidades

**Inbox / Chat** — Forte após as últimas entregas (quick replies, etiquetas, lembretes, agendadas, notas, fotos do estoque, sugestão IA, fluxo por conversa, caixa única). Oportunidades: busca dentro da conversa (Ctrl+F), reactions persistidas no banco (hoje são locais), carência pós-fechamento (evita bot reiniciar quando cliente responde "obrigado"), mesclagem de conversas duplicadas (9º dígito — mesma dor relatada no roadmap do Z-PRO).

**Leads / Funil** — Dados ricos (atribuição completa, temperatura, score). Oportunidade nº 1: **kanban visual do funil** com drag-and-drop entre etapas (cada arrasto já dispararia o CAPI). Falta também: motivo de perda estruturado (hoje "perdido" não diz por quê — dado valioso p/ anúncios) e alerta de lead quente parado >24h.

**Dashboard** — Básico. Faltam as métricas que gerenciam a operação: tempo de 1ª resposta, TMA, taxa de conversão por etapa do funil, ranking de vendedores, ROI por campanha (CAPI já registra valor). Os dados existem; é agregação + UI.

**Campanhas** — Sólido (agendamento, filtro por tags, tracking de entrega). Oportunidades: relatório de resposta por template, teste A/B simples (2 templates, 50/50), respeitar janela de horário comercial no disparo.

**Fluxos** — Motor completo (17 tipos de nó). Oportunidades vindas do benchmark Z-PRO: **nó de horário** (dentro/fora do expediente), nó de etiqueta, transferência sem exigir resposta do cliente. Fragilidade: sem versionamento — editar fluxo com sessões ativas pode quebrar sessões no meio.

**IA / Agentes / Auditoria** — Diferencial do sistema. Oportunidades: medir taxa de handoff (IA→humano) no dashboard; feedback 👍/👎 por resposta da IA para calibrar prompts; a sugestão de resposta (✨) pode evoluir para 3 variações.

**Veículos / StockSync** — Sync a cada 30 min ok. Oportunidades: destacar promoções (`promotionPrice`) automaticamente em campanha; avisar leads interessados quando o veículo baixar de preço (matar duas: automação + recompra de atenção).

**Meta Ads / CAPI** — Recém-completo (CTWA + Lead Ads + funil + valor). Próximo: painel "ROI por anúncio" cruzando `capiEvents` × `metaAds` (gasto → leads → vendas → R$).

**Contatos** — Import Excel bom. Falta: dedup por telefone normalizado no import, merge de contatos, e o vínculo `contactId` nas conversas (F13).

**Equipe / Auth** — Cargos funcionam. Faltas: F6 (hash), sem auditoria de login, sem expiração de sessão configurável. CSAT pós-atendimento daria métrica por atendente.

**Vendedores / Evolution** — Funcional. Fragilidade: instância caída só é percebida abrindo a tela — alerta automático (notificação/WhatsApp da matriz para o gerente) quando `status != connected` por >5 min.

**Resgate / FollowUp** — Bem resolvido. Oportunidade: usar etiquetas como critério de resgate (ex.: "Aguardando financiamento" há 3 dias → mensagem específica).

---

## 4. Priorização recomendada

| # | Item | Tipo | Esforço |
|---|------|------|---------|
| 1 | F1+F2+F4: assinatura de webhooks + fechar endpoints abertos | Segurança | 1 dia |
| 2 | F3: autenticação no Socket.io | Segurança | ½ dia |
| 3 | F5: rotacionar META_APP_SECRET | Segurança | 10 min |
| 4 | F6: hash de senha forte | Segurança | ½ dia |
| 5 | Kanban do funil de leads | Produto | 2–3 dias |
| 6 | Dashboard com TMA / 1ª resposta / conversão / ROI por anúncio | Produto | 2–3 dias |
| 7 | Carência pós-fechamento + CSAT | Produto | 1–2 dias |
| 8 | F9: migrações versionadas + F10: lock nos jobs | Infra | 1 dia |
| 9 | Paginação no inbox/leads (F15) | Performance | 1–2 dias |
| 10 | Unificação de dados das conversas (F12) + contato único (F13) | Estrutural | 1 semana |

---

## 5. O que já foi resolvido nesta rodada

Caixa de entrada **única** com seletor de instância no topo (Matriz oficial + cada instância Evolution com status de conexão), menu "Inbox Vendedores" removido, painel lateral unificado (atendimento/funil/origem/fluxo), e a race condition do scheduler corrigida com claim atômico.
