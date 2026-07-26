# Revisão Técnica e Parecer de Segurança — Unificação de Canais

Este documento registra o parecer técnico do Claude e do Gemini sobre a arquitetura de unificação de canais de WhatsApp, validando a segurança do banco de dados e delineando os passos para deploy seguro na VPS.

---

## 🛡️ Parecer de Segurança (Validação Técnica)

Todas as quatro peças críticas foram analisadas e validadas com sucesso:

1. **Escrita Dupla com Isolamento**: Os webhooks continuam salvando prioritariamente nas tabelas legadas (`evolutionConversations`, `evolutionMessages`, etc.) e emitindo sockets originais. A inserção nas tabelas unificadas ocorre dentro de um bloco `try-catch` isolado. **Risco de perda de mensagens = Zero.**
2. **Leitura Consolidada**: O Inbox do frontend lê exclusivamente das tabelas unificadas `conversations` e `messages`. A listagem é filtrada por aba no frontend de forma limpa. **Risco de duplicidade na tela = Zero.**
3. **Idempotência no Backfill**: O script de carga histórica (`backfill-conversations.ts`) utiliza os mesmos prefixos de ID externo (`evo_` / `wn_`) que os webhooks ao vivo usam, garantindo que o histórico antigo e as mensagens novas não se dupliquem.
4. **Retrocompatibilidade de Banco**: A migração de banco apenas adiciona colunas opcionais às tabelas principais, permitindo que a branch estável (`main`) continue rodando sem problemas mesmo com a migração aplicada.

---

## 📈 Valor Estratégico (ROI)

* **Redução de Custo de Manutenção (Escala de Feature 4x)**: Antes, qualquer melhoria na UI do chat (anotações, lembretes, tags, IA) exigia implementações duplicadas em quatro lugares. Com a unificação, construímos uma única vez em `conversations` e `messages` e funciona para todos.
* **Plugabilidade de Novos Canais**: Integrar um nov canal (ex: Instagram, Telegram, outros agregadores) se torna trivial: basta escrever um webhook que chame a função `mirror` correspondente e assinale o `connectionType`.
* **Centralização de Métricas e IA**: Dashboard, timeline do lead, motor de IA e Meta Conversions API leem uma única fonte confiável de dados, eliminando divergências.
* **Prontidão para SaaS (Multi-Cliente)**: Unificar a base é o alicerce fundamental para empacotar o AutoInova CRM como produto escalável para outras concessionárias.

---

## 🚀 Roteiro de Rollout Seguro para a VPS

Para subir as alterações em produção com segurança máxima, siga rigorosamente esta sequência:

1. **Backup do Banco**: Efetue um dump/backup completo do banco de produção (Supabase) antes de iniciar.
2. **Aplicar Migração SQL**: Execute o DDL de migração manual `2026-07-26_unified_columns.sql` contra o banco da VPS para criar as novas colunas e as colunas ausentes do schema.
3. **Deploy do Código**: Atualize e reinicie a aplicação na VPS na branch `feat/unificacao-canais` (o modo escrita dupla com rede de segurança garante que o fluxo normal continue estável).
4. **Monitoramento**: Deixe rodar por alguns dias. Compare as contagens de registros das tabelas legadas com as tabelas unificadas para garantir consistência.
5. **Executar Backfill**: Rode o script `scripts/backfill-conversations.ts` fora do horário de pico para migrar as conversas legadas históricas.
6. **Aposentar Legado**: Com tudo estabilizado e batendo por semanas, altere os webhooks para desativar a escrita legada e dropar as tabelas antigas.
