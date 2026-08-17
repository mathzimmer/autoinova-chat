# Checklist de validação pós-deploy — PR #10 (routers extraídos)

Deploy: `cd /root/autoinova && git pull origin feat/unificacao-canais && ./deploy.sh`

⚠️ Não há migrations novas — se o deploy.sh rodar só migrações antigas, é normal.

## 0. Saúde geral (2 min)

- [ ] `./deploy.sh` termina sem erro e o pm2 sobe (`pm2 status` → online)
- [ ] `pm2 logs --lines 50` sem stack trace de boot (Cannot find module / undefined)
- [ ] App abre no navegador e login funciona (router `auth` ficou no routers.ts)

## 1. Atendimento (o miolo — testar PRIMEIRO)

- [ ] **Inbox abre** e lista conversas (`conversation.list`)
- [ ] **Abrir uma conversa** carrega mensagens (`message.list`)
- [ ] **Mandar mensagem de teste pelo WhatsApp** do cliente → chega no inbox, IA/fluxo responde (webhook + flow + agent — caminho mais crítico do sistema)
- [ ] **Responder manualmente** pelo inbox (`message.send`)
- [ ] **Kanban/lista de leads** abre com etapas do funil (`lead.list`)
- [ ] **Mover lead de etapa** ou editar um campo (`lead.update`)
- [ ] **Contatos** abre e busca por nome/número funciona (`contact.search/list`)

## 2. Fluxos e agentes

- [ ] **Editor de fluxo** abre com nós e arestas (`flow.list/nodes/edges`)
- [ ] Salvar uma edição pequena num fluxo (sem mudar nada, só salvar)
- [ ] **Página de agentes** lista os agentes (`agent.list`) e abre um pra editar
- [ ] Conferir que a conversa de teste do item 1 caiu no agente certo (`agent.resolve`)

## 3. Canais

- [ ] **Aba Evolution**: lista instâncias e status (`evolution.listInstances`)
- [ ] **Números WhatsApp**: lista números cadastrados (`whatsappNumber.list`)
- [ ] **Zernio** (se usado): instâncias listam (`zernio.listInstances`)

## 4. Marketing e vendas

- [ ] **Campanhas**: lista abre (`campaign.list`)
- [ ] **Meta Ads**: página de anúncios abre (`metaAds.listCampaigns`)
- [ ] **Vendedores**: lista + rodízio aparecem (`seller.list/storeLocations`)
- [ ] **Performance**: painel de vendedores carrega (`performance.*`)

## 5. Config e admin

- [ ] **Configurações** abrem e salvam (`settings.*`)
- [ ] **Equipe**: membros listam (`team.list`); login de membro funciona (`teamAuth.login`)
- [ ] **Notificações**: sino mostra contador (`notification.*`)
- [ ] **Templates WhatsApp**: lista templates (`whatsappTemplate.list`)
- [ ] **Rescue/Reengajamento**: páginas de config abrem (`rescue.getConfig`, `reengagement.getConfig`)
- [ ] **Dashboard** inicial carrega métricas (`dashboard.stats`)
- [ ] **Veículos**: estoque lista (`vehicle.list`)
- [ ] **Clientes (customers)**: `customers.list` responde (admin)
- [ ] **CAPI**: página de eventos abre (`capi.*`)
- [ ] **Respostas rápidas** "/" no inbox (`quickReply.list`)
- [ ] **Etiquetas** aplicam em conversa (`label.*`)
- [ ] **Lembretes/mensagens agendadas** listam (`reminder.*`, `scheduledMessage.*`)

## 6. Se algo falhar

1. `pm2 logs --lines 200 | grep -i error` → o erro dirá o módulo (ex.: `routers/lead.ts`)
2. Sintoma mais provável: `Cannot find name X` em runtime (escapou do typecheck) → me mandar o log
3. Rollback rápido se travar atendimento:
   ```
   cd /root/autoinova && git reset --hard 8d06e68 && ./deploy.sh
   ```
   (volta pra antes da fatia do miolo; o sistema inteiro funcionava nesse ponto)

## Dica de prioridade

Se só puder testar 3 coisas: **item 1 completo** (mensagem real de WhatsApp ponta a ponta),
**editor de fluxo abrindo**, **página de agentes abrindo**. Esses três cobrem
webhook → conversation → message → flow → agent → lead — 80% do risco do refactor.
