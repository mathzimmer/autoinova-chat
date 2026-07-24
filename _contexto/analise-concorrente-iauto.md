# Análise do concorrente — iAuto Brasil (mapa de funções + backlog)

Mapa completo das funções do iAuto (app2.iautobrasil.com.br) para servir de
referência do que incluir no AutoInova CRM. O agente de IA deles se chama **Nexora**
(com personas nomeadas — "Sofia", "Sara"). Layout limpo, rápido e intuitivo, com
busca global (⌘K), Tutoriais, Suporte nativo, Chat Interno e modo escuro.

Módulos: **Dashboard, Chat, CRM, Leads, Calendário, Mensagens em Massa, Automações,
Estoque, Minha Loja, Integrações, Roadmap, Configurações**.

---

## 1. Dashboard

Filtro por período (Mês atual / range), **Filtros**, seletor de **Workspace** e
**Personalizar** (dashboard configurável). Cards de métrica **clicáveis** que abrem
um modal com o detalhamento:

- **Novos Leads** (contatos únicos no período — mesmo contato conta 1x). Modal lista
  os leads com status e data.
- **Conversas Ativas**.
- **Mensagens** (total + ↑enviadas ↓recebidas). Modal lista por contato com
  enviadas/recebidas e **tag de canal** (Instagram, Mercado Livre, etc.).
- **Leads em Aberto** (mini-gráfico de tendência).
- **Oportunidades Ganhas / Perdidas**, **Taxa de Conversão**, **Novas Oportunidades**.
- **SLA de atendimento** por faixa (< 5 / 15 / 30 min, < 1 h).
- **Relatório de Vendas**: Faturamento, Vendas, "Com valor", **Ticket médio**;
  **Vendas por dia**, **Ranking** de vendedores, **Últimas vendas**.
- **Metas** de venda (criar e acompanhar).

## 2. Chat (atendimento)

- Aviso de **WhatsApp desconectado** + Reconectar.
- **Filtros salvos** com múltiplas condições (ex.: "Status do lead contém Aberto" +
  "Responsável é Sem responsável"). Abas: Abertas, Não lidas, Minhas, **Sem resposta**,
  Arquivadas, **Grupos**.
- **Assistente de IA do workspace** dentro do chat: linguagem natural, resolve
  entidade (lead por telefone/nome/cidade), links /chat /automations, **@menção** de
  lead/atendente, insights e diagnóstico de automações.
- Mensagens com **botões (quick replies)** e tratamento de **resposta de botão**.
- **Painel lateral do lead** (na conversa) com seções expansíveis: Valor, CPF, Nasc.,
  Criado; **Outras conversas**, **Origem**, **Etiquetas**, **Interesses**, **Funil**,
  **Transferir**, **Notas** (Apenas eu / Workspace + **Gerar Resumo com IA**),
  **Campos**, **Pendentes**, **Automações**, **Chamadas**, **Atribuir responsáveis**.

## 3. CRM (pipeline Kanban)

- **Pipeline comercial** com seletor de pipeline; colunas: **Inbox, Prospectando,
  Sem resposta, Em atendimento** (contadores por coluna). "Novo lead", alternar
  **kanban/lista**, ordenar, filtros ("Adicionar condição").
- Cartão do lead: nome, **localização (cidade/UF)**, telefone, responsável, etiqueta,
  tempo na etapa ("agora", "55 m", "17 h").
- **Arrastar cartão** para mudar de etapa; ao arrastar aparece barra inferior de
  **ações em massa**: Mensagem, Atribuir, **Ganho**, **Perdido**, Etiquetar, Mover,
  **Abandonado**, Arquivar, **Duplicar**, **Exportar**, Excluir.
- Ficha do lead (modal) com abas: **Visão geral, Ficha, Conversas, Atividades,
  Histórico**.
  - Visão geral: **Próxima ação** ("Nenhuma atividade pendente" + **Agendar
    atividade** para não esfriar), Etapa atual, Responsável, Última mensagem,
    **Tempo na etapa**, Contato (Copiar / WhatsApp), Localização, Canal principal.
  - Conversas: por **Canais / Chamadas**, com Pipeline e Etapa, últimas mensagens.
  - Histórico: **Linha do tempo / Análise**, filtro Todos/Lead/Contato, eventos
    (Lead criado, Nome alterado, Status alterado) marcados como Sistema.

## 4. Leads

- Tabela: **Nome, Telefone, Email, Etiquetas, Responsável, Funil/Etapa, Status,
  Criado em**. **Colunas** configuráveis. Abas **Ativos / Arquivados**.
- **Importar**, **Exportar**, **Relatório cohort**. Busca e "Adicionar condição".
- Mesmo modal de ficha do CRM (Visão geral/Ficha/Conversas/Atividades/Histórico),
  com **CSV/PDF** e **"Estado em data"** (auditoria do estado num ponto no tempo).

## 5. Calendário / Agenda

- Visão mês/semana; eventos por tipo (**Mensagem, Ligação, Lembrete, Visita,
  Falha**) com cores. Filtro por canal, "Novo agendamento".
- **Criar Lembrete** com título, tipo, descrição e **variáveis** (contato:
  nome/telefone/email/cpf/nascimento; conversa: atendente/origem/crm; sistema:
  loja/empresa/endereço/horários...). "Quem deve ver" (Apenas eu / equipe).

## 6. Mensagens em Massa (disparos)

- Assistente: **Destinatários → Mensagem → Agendamento → Configuração (anti-ban)**.
- Segmentação por condições: atividade agendada/recente, datas (**Ganho em, Perdido
  em, Entrada no funil, Mudança de status**), etc. Resumo (contatos/mensagens).
- Conteúdo multi-item: **Texto, Foto, Vídeo, Áudio, Documento, Catálogo**.
- **Variáveis** ({{nome}}, {{coluna.x}}) com **pré-visualização** estilo WhatsApp.
- **Anti-ban** como etapa dedicada.

## 7. Automações — o diferencial mais forte

Três abas: **Gatilho / Ação**, **Automações 2.0** (construtor visual de fluxo),
**Nexora AI** (agente), **Logs**.

### 7a. Automações 2.0 (fluxo visual)
Rascunho → ativar. Nós encadeados no canvas com painel de detalhe à direita:
- **Quando** (gatilho): ex. "Palavra-chave na mensagem".
- **Enviar texto** (com variáveis), enviar mídia/catálogo.
- **Aguardar resposta do contato** (timeout em dias/horas + "Se não responder →
  Encerrar a automação").
- **Ramificar** (caminhos condicionais), **Adicionar ação**.

### 7b. Nexora AI (agente de IA), configurado por áreas
Checklist de setup (% de progresso, "essenciais pendentes"), Atalhos, **Testar
agente**, **Ver logs**, **Simulador**.
- **AGENTE**: Personalidade (nome, tom, restrições), Conhecimento (FAQ e políticas).
- **COMPORTAMENTO**: Regras (quando → o que fazer), **Qualificação (Funil e Kanban)**,
  **Restrições de leads** (quando a IA NÃO responde — regras globais como horários
  sem resposta / ignorar grupos; filtros por etiqueta, status, etapa, data de
  criação), Operação (horário e áudio), **Follow-up** (retomar após silêncio).
- **AÇÕES**: **Ferramentas** (o que a IA pode fazer), **APIs externas** (CEP,
  consultas HTTP), **Estoque** (catálogo + envio WhatsApp), **Automações** (gatilhos),
  **Transferência**.
- **Caminhos condicionais por IA**: "Se a IA retornar X → executar ações Y"; a IA
  analisa as últimas N mensagens e classifica em categorias definidas pelo usuário.
- Ação **"Identificar estoque com IA"**: acha o veículo mencionado no catálogo, envia
  texto + fotos (entrega sequencial), com máx. fotos/veículo, máx. veículos
  (carrossel), mensagem de "não encontrei" e instruções extras à IA.
- Ação **"Adicionar etiqueta"** (Aguardando Retorno, Financiamento, Interessado,
  Negociando, Perdido, Venda Fechada, Visita Agendada).

## 8. Estoque / Minha Loja

- **Estoque**: catálogo usado pela IA e para envio no WhatsApp. Visões lista/grade.
- **Cadastrar Veículo** (wizard 3 passos): tipo, placa, marca, modelo, versão, ano,
  quilometragem, transmissão, combustível... **Adicionar manualmente** ou via
  integração/sincronização.
- **Minha Loja**: vitrine/loja online.

## 9. Integrações (amplo — ponto forte)

- **Captura de leads de portais** (webhook em tempo real): **Chaves na Mão**,
  **OLX / Mercado Livre**, e-mail, Facebook, etc. (assistente de config passo a passo).
- **Sincronização de estoque** de muitos sistemas/portais: Webmotors, Mobiauto,
  iCarros, Autocarro, **Car System (Dealernet)**, Boom Sistemas, E-Completo Autos,
  Loja Conectada, Chaves na Mão, AutoAvaliar, **AutoCerto API**, **XML/API
  personalizada** (importa via XML/API/JSON).
- **Telefonia (PSTN)**: **API4COM** (click-to-call), **Wavoip** (dispositivos e
  atendentes) — alternativa ao WhatsApp.
- **Chat**: **OLX Chat** (responder direto).
- **Agendas**: **Google Agenda**. **Contatos**: **Google Contatos**.
- **IA de voz**: **ElevenLabs** (texto → áudio para automações/atendimento).

## 10. Configurações

- **Visão Geral** com **progresso de implantação (%)** e alerta de SLA não configurado.
- **Equipe**: Usuários e Equipes, **Atribuição de Conversas**.
- **Canais**: Conexões WhatsApp.
- **Personalização**: **Etiquetas** (sincronizar, No CRM/Duplicatas/**Sem uso**),
  **Origens**, **Campos Personalizados**, **Respostas Rápidas**, **Template de
  Catálogo**.
- **IA e Automações**. **Notificações por membro e por canal** (tela/som/push/
  WhatsApp/e-mail, com herança da config global). **Roadmap** público.

---

## Backlog priorizado para incluir no AutoInova

Ordem sugerida por **impacto x esforço** (o que já temos base pronta primeiro).

### Rápidas (temos base — alto impacto)
1. **SLA de atendimento por faixa de tempo** no dashboard (<5/15/30 min, <1h).
2. **Métricas do dashboard clicáveis** (abrir detalhamento por contato/canal).
3. **Gerar Resumo do lead com IA** no painel lateral (já temos IA de análise).
4. **Etiquetas: detectar duplicadas / sem uso / sincronizar**.
5. **Exportar ficha do lead (CSV/PDF)** e **Respostas Rápidas**.

### Médias (muito valor competitivo)
6. **Metas de vendas** com acompanhamento.
7. **"Estado do lead em data"** (auditoria do histórico).
8. **Ações em massa no Kanban** (barra ao selecionar: ganho/perdido/etiquetar/mover/
   exportar) + **arrastar para ganho/perdido**.
9. **Notificações por membro e por canal** (tela/som/push/WhatsApp/e-mail).
10. **Assistente de disparo em massa com etapa anti-ban** + segmentação por eventos
    de funil (ganho/perdido/entrada/mudança de status).

### Maiores (diferenciais de plataforma)
11. **Construtor de automações 2.0** visual (nós: gatilho, enviar, aguardar resposta
    com timeout, ramificar, adicionar etiqueta) — evolui o que já temos de fluxos.
12. **Caminhos condicionais por IA** ("se a IA classificar em X → ações").
13. **Integrações de captação de leads de portais** (OLX, Mercado Livre, Webmotors,
    Chaves na Mão) por webhook, com assistente de configuração.
14. **Sincronização de estoque** via XML/API de portais/ERPs (AutoCerto, Dealernet...).
15. **Assistente de IA do workspace no chat** (copiloto que consulta seus dados).
16. **Telefonia (click-to-call / PSTN)** e **IA de voz (ElevenLabs)**.

### Vantagens que o AutoInova JÁ tem (e o iAuto não mostrou)
- **Atribuição CTWA de anúncios de volta à Meta** (com valor da venda) — otimização
  por quem compra. É o maior diferencial seu.
- Lead canônico por telefone, coexistência WhatsApp via **provedor próprio**
  (Embedded Signup 1-clique), análise comercial (temperatura/objeções/crédito),
  performance de vendedores.

---

_Levantamento a partir das capturas em Concorrentes/iAuto + walkthrough narrado.
Detalhes podem variar em telas não amostradas._
