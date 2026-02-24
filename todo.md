# Auto Inova Chat - TODO

## Banco de Dados
- [x] Schema: tabela conversations (id, phone, name, channel, status, ai_active, assigned_to, last_message_at, created_at, updated_at)
- [x] Schema: tabela messages (id, conversation_id, content, sender_type, message_type, status, metadata, created_at)
- [x] Schema: tabela leads (id, conversation_id, phone, name, intention, vehicle_interest, has_trade, trade_vehicle, trade_year, trade_km, payment_method, down_payment, status, created_at, updated_at)
- [x] Schema: tabela ai_logs (id, conversation_id, prompt_tokens, completion_tokens, cost_estimate, response_time_ms, tool_used, created_at)
- [x] Schema: tabela vehicles (id, brand, model, year, price, mileage, color, transmission, fuel, category, description, image_url, available)
- [x] Migração e push do schema

## Backend API (tRPC)
- [x] Router: conversations (list, getById, updateStatus, assignAgent, toggleAI, markAsRead)
- [x] Router: messages (listByConversation, send)
- [x] Router: leads (list, getByConversation, update)
- [x] Router: dashboard (getMetrics com stats de IA)
- [x] Router: webhook (verify, receive com processamento de texto e áudio)
- [x] Router: vehicles (list, search, create)

## WebSocket (Tempo Real)
- [x] Configurar Socket.IO no servidor Express
- [x] Eventos: new_message, conversation_updated, typing_indicator
- [x] Integração com frontend para atualizações em tempo real
- [x] Broadcast de mensagens para atendentes conectados

## Agente de IA
- [x] Sistema de decisão (ai_active check antes de responder)
- [x] Prompt de pré-venda para concessionária de veículos
- [x] Extração estruturada de dados do lead (JSON)
- [x] Tool: buscar veículos no estoque
- [x] Qualificação automática de lead via extração de dados
- [x] Integração com invokeLLM do template

## Handoff Humano/IA
- [x] Botão "Assumir Conversa" (desativa IA)
- [x] Botão "Reativar IA" (ativa IA)
- [x] Pausa automática da IA quando humano envia mensagem
- [x] Indicador visual de quem está atendendo (IA ou humano)

## Webhook WhatsApp
- [x] Endpoint POST para receber mensagens do WhatsApp Cloud API
- [x] Endpoint GET para validação de webhook (verify token)
- [x] Processamento de mensagens de texto
- [x] Processamento de mensagens de áudio
- [x] Endpoint genérico compatível com Chatwoot/n8n
- [x] Envio de respostas via WhatsApp Cloud API

## Transcrição de Áudio
- [x] Integração com Whisper API (transcribeAudio do template)
- [x] Processamento de mensagens de voz recebidas
- [x] Armazenamento da transcrição junto à mensagem

## Frontend - Layout e Design
- [x] Design system: tema escuro SaaS com cores verdes da marca
- [x] Layout principal: sidebar compacta + inbox + chat + painel lateral
- [x] Responsividade para diferentes tamanhos de tela
- [x] Fonte Inter do Google Fonts
- [x] Scrollbar customizada para tema escuro

## Frontend - Inbox
- [x] Lista de conversas em tempo real
- [x] Ordenação por última mensagem
- [x] Indicador de status (aberta, pendente, resolvida)
- [x] Indicador se IA está ativa (ícone de bot)
- [x] Indicador de mensagens não lidas (badge)
- [x] Busca/filtro de conversas por status e texto

## Frontend - Chat
- [x] Histórico completo de mensagens
- [x] Diferenciação visual: cliente (esquerda), bot (verde), atendente (azul)
- [x] Timestamps em cada mensagem
- [x] Campo de envio de mensagem com Enter para enviar
- [x] Indicador de digitação (animação de pontos)
- [x] Scroll automático para última mensagem

## Frontend - Painel de Controle
- [x] Dados do cliente/lead (telefone, nome, canal)
- [x] Controles de handoff (Assumir/Reativar IA)
- [x] Status da conversa (select dropdown)
- [x] Informações do lead qualificado (intenção, veículo, troca, pagamento)

## Frontend - Dashboard
- [x] Métricas: total conversas, abertas, leads qualificados, veículos
- [x] Métricas IA: interações, tokens, tempo médio resposta
- [x] Conversas ativas em tempo real
- [x] Leads recentes

## Frontend - Veículos
- [x] Grid de veículos do estoque
- [x] Formulário para adicionar veículo (admin only)
- [x] Cards com informações: marca, modelo, ano, preço, km, câmbio

## Frontend - Leads
- [x] Lista de leads com filtros por status
- [x] Cards com dados qualificados pela IA
- [x] Badge de status do lead

## Autenticação e Segurança
- [x] Autenticação via Manus OAuth
- [x] Roles: admin e user
- [x] Proteção de rotas por role (adminProcedure, protectedProcedure)

## Testes
- [x] Testes unitários para routers principais (16 testes passando)
- [x] Teste de integração do webhook (verify)
- [x] Teste do sistema de autenticação e autorização

## Integração WhatsApp Business Cloud API (Meta)
- [x] Criar módulo de envio de mensagens via WhatsApp Cloud API
- [x] Integrar envio automático de respostas da IA ao cliente via WhatsApp
- [x] Integrar envio de mensagens do atendente humano ao cliente via WhatsApp
- [x] Adicionar secrets: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN
- [x] Marcar mensagens como lidas no WhatsApp (mark_as_read)
- [x] Credenciais validadas: +55 51 3191-9081
- [x] Documentação/guia de configuração no Meta Business

## Integração Estoque Externo (S3 JSON)
- [x] Analisar estrutura do JSON do estoque externo (111 veículos, 32 marcas)
- [x] Criar endpoint de sincronização do estoque externo com o banco de dados
- [x] Sincronização automática a cada 30 minutos
- [x] Botão manual para forçar sincronização no painel
- [x] Agente de IA usar dados do estoque real para responder clientes (tool buscar_veiculos + resumo_estoque)
- [x] Exibir estoque real na página de veículos do CRM (com imagens, promoções, filtros)
- [x] Marcar veículos removidos do feed como indisponíveis
- [x] 32 testes passando

## Personalização do Prompt da IA
- [x] Criar tabela settings no banco de dados para armazenar configurações
- [x] Criar endpoint tRPC para ler e salvar o prompt personalizado
- [x] Integrar prompt personalizado no agente de IA (usar do banco se existir, senão usar padrão)
- [x] Criar página de Configurações no frontend com editor de texto para o prompt
- [x] Adicionar botão "Restaurar Padrão" para voltar ao prompt original
- [x] Adicionar rota de Configurações na sidebar de navegação
- [x] Testes para os novos endpoints (37 testes passando)

## Bugs
- [x] IA retorna "instabilidade no momento" ao invés de buscar veículos no estoque quando cliente pergunta "Tem Corolla?" (CORRIGIDO: normalizeMessage não preservava tool_calls + IDs com caracteres inválidos)

## Melhorias Solicitadas
- [x] Corrigir rolagem da página de Configurações (overflow-y-auto + pb-12)
- [x] Adicionar opção de editar contato na conversa (nome, email, notas)
- [x] Adicionar campo para informações do contato (contactEmail + contactNotes no schema)
- [x] Agente de IA com memória: lembrar nome do cliente (contextBlock no system prompt)
- [x] Agente de IA com contexto: seguir lógica da conversa conforme interação (lead data + 30 msgs)
- [x] Agente de IA entender escolha de veículo e continuar conversa sobre ele (vehicleInterest no contexto)

## Bugs e Melhorias - Rodada 2
- [x] IA atualiza automaticamente dados do lead via tool atualizar_lead (intenção, veículo de interesse, troca, forma de pagamento)
- [x] IA detecta quando cliente escolhe um veículo e chama atualizar_lead com essa escolha
- [x] IA usa dados atualizados do lead para seguir o atendimento contextualizado
- [x] Atendente humano pode editar todos os campos do lead no painel lateral (intenção, veículo, troca, pagamento, status)
- [x] Dashboard com rolagem corrigida (overflow-auto no AppLayout + pb-16)
- [x] Página de Veículos com rolagem corrigida (pb-16)

## Bugs e Melhorias - Rodada 3
- [x] IA não busca veículos no estoque quando cliente pede um modelo - CORRIGIDO: forceSearch com retry automático
- [x] IA SEMPRE chama buscar_veiculos antes de responder sobre qualquer veículo (prompt reforçado + retry)
- [x] Quando cliente pede um modelo, mostra TODOS os disponíveis no estoque (até 10)
- [x] Vincular lead ao veículo específico do estoque (vehicleId na tabela leads + schema atualizado)
- [x] Tool atualizar_lead inclui vehicleId do estoque (usa [ID:X] da busca)
- [x] 37 testes passando

## Bugs e Melhorias - Rodada 4 (Imagens e Áudio)
- [x] IA se perde quando cliente envia imagem — CORRIGIDO: visão multimodal (image_url detail:low)
- [x] Cliente pode enviar fotos do veículo de troca — armazenadas no S3
- [x] Armazenar imagens no S3 e vincular à conversa (metadata.mediaUrl)
- [x] IA entende conteúdo da imagem (foto de carro, documento, etc.) via visão LLM
- [x] Player de áudio funcional no chat com play/pause, seek e duração
- [x] Armazenar áudio no S3 e exibir player + transcrição no chat
- [x] Exibir imagens recebidas no chat (thumbnail clicável para abrir)
- [x] Módulo media.ts para download do WhatsApp e upload para S3
- [x] 37 testes passando

## Bugs e Melhorias - Rodada 5 (Áudio e Imagem - Comportamento IA)
- [x] IA entende áudio — transcrição é passada como texto normal, IA responde ao conteúdo
- [x] IA não analisa imagem visualmente — apenas confirma recebimento contextualmente
- [x] IA usa contexto da conversa para entender imagens (ex: fotos da troca)
- [x] Removida visão multimodal (image_url) — imagens tratadas como texto contextual
- [x] 37 testes passando

## Bugs - Rodada 6 (Transcrição de Áudio)
- [x] Transcrição de áudio funciona corretamente (testado: "Boa noite meu amigo, você tem uma Sprinter aí pra venda, você financia?")
- [x] Problema era no servidor publicado com código antigo — precisa republicar
- [x] Melhorado fallback: se transcrição falhar, IA pede gentilmente para cliente digitar
- [x] Adicionado logging detalhado para diagnóstico
- [x] 37 testes passando

## Bugs - Rodada 7 (Transcrição de Áudio - Persistente)
- [x] Transcrição corrigida: mime type 'audio/ogg; codecs=opus' não era tratado corretamente
- [x] Corrigido voiceTranscription.ts: getFileExtension agora strip codec params
- [x] Corrigido voiceTranscription.ts: normaliza mime type do Blob para Whisper API
- [x] Corrigido voiceTranscription.ts: passa language no FormData para melhor precisão
- [x] Corrigido media.ts: getExtension e contentType agora strip codec params
- [x] Testado com áudio real: "Você não entende os meus áudios." - transcrito com sucesso
- [x] 37 testes passando
- [x] IMPORTANTE: Republicar para que correções entrem em produção

## Bugs - Rodada 8 (Comportamento da IA)
- [x] IA confunde veículos quando cliente muda de interesse (Sprinter -> Vectra) - CORRIGIDO: prompt reescrito com regras de foco
- [x] IA pede preferências desnecessárias quando há apenas 1 resultado no estoque - CORRIGIDO: regra "se 1 resultado, apresente direto"
- [x] IA diz "não consigo visualizar" quando recebe imagem - CORRIGIDO: prompt instrui a NUNCA dizer isso
- [x] IA não atualiza lead quando cliente muda veículo de interesse - CORRIGIDO: regra explícita de atualizar lead ao mudar
- [x] Melhorar prompt para manter foco no veículo atual da conversa - CORRIGIDO: seção REGRAS DE FOCO NA CONVERSA
- [x] Reduzir keywords que ativam forceSearch desnecessariamente - CORRIGIDO: separado em model keywords e search keywords
- [x] 52 testes passando (15 novos testes para IA)

## Bugs - Rodada 9 (Comportamento da IA - Persistente)
- [x] IA menciona Fusca mesmo depois do cliente dizer que vendeu - CORRIGIDO: prompt agora diz "CONFIE na mensagem recente"
- [x] IA volta a falar de Sprinter quando cliente quer Hilux - CORRIGIDO: REGRA 2 prioridade da conversa recente
- [x] IA interpreta "2" como Sprinter ao invés de opção 2 - CORRIGIDO: REGRA 3 respostas numéricas + forceSearch ignora msgs curtas
- [x] IA usa formatação markdown - CORRIGIDO: REGRA 1 proibe explícitamente + strip de markdown na resposta
- [x] Mensagem duplicada quando cliente envia mesmo áudio - CORRIGIDO: dedup por externalId no webhook
- [x] Contexto do lead antigo dominando - CORRIGIDO: lead data marcado como "podem estar desatualizados"
- [x] Reforçar prioridade de mensagens recentes - CORRIGIDO: REGRA 2 com exemplos concretos
- [x] Dedup de mensagens WhatsApp por externalId - CORRIGIDO: getMessageByExternalId + check no webhook
- [x] forceSearch não dispara para msgs de troca ("vendi meu fusca, tenho um gol") - CORRIGIDO
- [x] 56 testes passando (19 testes de IA)

## Bugs - Rodada 10
- [x] Busca retorna veículos inventados - CORRIGIDO: resultado agora diz "Copie EXATAMENTE" + formato compacto
- [x] IA ainda usa formatação markdown - CORRIGIDO: strip agressivo (bold, italic, headers, bullets, links)
- [x] Implementar resumo automático da conversa - CORRIGIDO: campo "notas" no atualizar_lead
- [x] Resposta muito longa - CORRIGIDO: limitado a 5 resultados + filtro de motos/barcos
- [x] Keywords de busca por faixa de preço ("até 100 mil") adicionadas
- [x] 66 testes passando (29 testes de IA + 9 de markdown)

## Melhorias - Rodada 11 (Enviadas pelo usuário)
- [x] Regra 2 reescrita: prioridade da mensagem atual com marcação [MENSAGEM ATUAL]
- [x] Contexto do lead marcado como "(ANTIGO, pode ter mudado)"
- [x] Retry inteligente: detecta mudança de interesse e instrui atualizar lead antes de buscar
- [x] veiculo_id aceita null para limpar vínculo ao mudar de interesse
- [x] Keywords de mudança de interesse: "mudei de ideia", "prefiro", "na verdade quero"
- [x] Fluxo de mudança de interesse documentado no prompt (atualizar → buscar → apresentar)
- [x] upsertLead permite null explícito para limpar campos (não apenas undefined)
- [x] Notas do lead exibidas no contexto
- [x] 67 testes passando (30 testes de IA incluindo interest change keywords)

## Bugs - Rodada 12
- [x] IA diz "vou verificar" sem resultados - CORRIGIDO: prompt proíbe frases de espera + detecção automática de resposta vazia
- [x] Tool call não completa - CORRIGIDO: re-injeção de resultados quando resposta é só "vou verificar"
- [x] IA volta a falar de Kia Soul - CORRIGIDO: [MENSAGEM ATUAL] + prioridade da conversa recente (já no código)
- [x] IA responde "?" com assunto aleatório - CORRIGIDO: prompt mais claro sobre manter foco
- [x] 67 testes passando

## Feature - Rodada 13
- [x] Adicionar campo de notas/resumo da conversa visível na interface do Lead (ConversationPanel + Leads page)
- [x] Permitir visualizar e editar o resumo gerado pela IA na tela de leads
- [x] Campo notes adicionado ao lead.update no router
- [x] 67 testes passando

## Feature - Rodada 14 (Envio de Fotos)
- [x] Investigar estrutura de dados dos veículos e URLs de imagens
- [x] Implementar envio automático de fotos após IA apresentar veículos
- [x] Integrar com WhatsApp API para enviar imagens (sendImageMessage)
- [x] Testar envio de múltiplas imagens em sequência (com delay de 500ms)
- [x] Extrair IDs [ID:X] da resposta da IA e buscar imagens
- [x] 67 testes passando

## Bugs - Rodada 15 (Envio de Fotos)
- [x] IA estava colocando [FOTO] no texto - CORRIGIDO: prompt proíbe explicitamente + strip de [FOTO], [ID:X]
- [x] Remover marcações de foto da resposta - CORRIGIDO: regex remove [FOTO], [IMAGEM], [IMAGE], [ID:X]
- [x] Garantir envio automático sem texto [FOTO] - CORRIGIDO: fotos enviadas assincronamente, resposta limpa
- [x] Validar recebimento no WhatsApp - CONFIRMADO: cliente recebe foto + resposta limpa
- [x] 67 testes passando

## Feature - Rodada 16 (Seleu00e7u00e3o de Veu00edculo do Estoque)
- [x] Adicionar campo de seleu00e7u00e3o de veu00edculo do estoque na interface de Lead
- [x] Implementar dropdown/select com veu00edculos disponíveis
- [x] Permitir vincular veu00edculo específico ao lead como "veu00edculo de interesse"
- [x] Atualizar API para suportar seleu00e7u00e3o de veu00edculo do estoque
- [x] 67 testes passando
## Feature - Rodada 17 (Sistema de Usuários + Atribuição de Conversas - Chatwoot-like)

### Módulo 1 - Sistema de Usuários
- [x] Criar tabela teamMembers com campos completos
- [x] Implementar cargos: admin, gerente, vendedor, suporte
- [x] Implementar permissões por cargo (teamAuth.ts)
- [x] Autenticação segura com PBKDF2 hash
- [x] Login/logout via tRPC

### Módulo 2 - Atribuição de Conversas
- [x] Campo assignedTo na tabela conversations
- [x] Dropdown "Atribuir" no ConversationPanel
- [x] Etiqueta "Agente está atendendo" com nome
- [x] Reatribuir e remover atribuição (value="none")

### Módulo 3 - Filtros por Responsável
- [x] Filtro "Todas" conversas
- [x] Filtro "Sem agente" (não atribuídas)
- [x] Filtro "IA ativa"

### Módulo 4 - Bloqueio de IA ao Assumir
- [x] Desativar IA automaticamente ao atribuir agente
- [x] Reativar IA ao remover atribuição
- [x] Registrado via assignAgent mutation

### Módulo 5 - Indicador Visual de Atendente
- [x] Badge na lista: Bot (verde) / User (azul) / Sem ícone
- [x] Nome do agente atribuído na lista de conversas

### Módulo 6 - Histórico de Ações
- [x] Tabela activityLogs criada
- [x] Funções createActivityLog e getActivityLogs implementadas

### Módulo 7 - Transferir Conversa
- [x] Transferência via dropdown de atribuição (selecionar outro agente)
- [ ] Mensagem automática no chat ao transferir

### Módulo 8 - Modo Supervisor
- [x] Admins/gerentes veem todas as conversas
- [x] Podem atribuir/reatribuir qualquer conversa

### Módulo 9 - Notificações Internas
- [x] Tabela teamNotifications criada
- [x] Notificação criada ao receber mensagem em conversa atribuída
- [ ] Interface de notificações no frontend
- [ ] Som opcional

### Módulo 10 - Painel de Administração
- [x] Página Team.tsx com lista de membros
- [x] Formulário para criar novo membro
- [x] Edição de cargo e status
- [x] Desativar membro (toggle ativo/inativo)

### Extra - Indicadores de Performance
- [x] Tabela teamPerformance criada
- [ ] Implementar cálculo de métricas de performance

## Bugs - Rodada 18
- [x] Erro Select.Item com value="" - CORRIGIDO: usa value="__none__" com tratamento especial
- [x] Revisados todos os Select.Item do projeto
- [x] 67 testes passando

## Feature - Rodada 19 (Login Team Members + Melhorias Leads)
- [x] Login de team members com email/senha (/team-login)
- [x] Usuários logados veem apenas conversas atribuídas (vendedor/suporte filtrado)
- [x] Botão para excluir veículo vinculado ao lead (Trash2 icon)
- [x] Mostrar veículo vinculado no painel de Leads (nome, ano, preço)
- [x] Mostrar agente/usuário vinculado no painel de Leads (badge com nome)
- [x] Navegação adaptada por cargo (vendedor/suporte não veem Dashboard, Veículos, Equipe, Config)
- [x] 67 testes passando

## Feature - Rodada 20 (Envio de Fotos e Áudios no Chat) - IMPLEMENTADO
- [x] Botão de upload de foto na interface de chat (ImagePlus icon)
- [x] Upload de foto para S3 e envio via WhatsApp API (sendImageMessage)
- [x] Botão de gravação de áudio na interface de chat (Mic icon)
- [x] Gravação de áudio no navegador e envio via WhatsApp API (sendAudioMessage)
- [x] Preview de foto antes de enviar (com legenda opcional)
- [x] Indicador visual de gravação de áudio (timer + botão cancelar)
- [x] Salvar mensagens de mídia no banco de dados (messageType: image/audio)
- [x] Mutation sendMedia no messageRouter com upload S3
- [x] 67 testes passando

## Bugs - Rodada 21 (Áudio e Fotos)
- [x] Áudio gravado pelo atendente não é entregue ao cliente via WhatsApp - CORRIGIDO: conversão webm→ogg no servidor via ffmpeg-static
- [x] Campo de fotos deve permitir selecionar múltiplas fotos de uma vez - CORRIGIDO: input multiple + grid de previews + envio sequencial
- [x] Módulo audioConverter.ts criado: convertWebmToOgg + needsConversionForWhatsApp
- [x] sendMedia mutation atualizada: detecta webm, converte para ogg, faz upload da versão convertida para WhatsApp
- [x] ChatView reescrito: suporte a múltiplas fotos com grid de thumbnails, remoção individual, contador de envio
- [x] 79 testes passando (12 novos testes para audioConverter)

## Bugs - Rodada 22 (Envio de fotos e áudio não funciona)
- [x] Envio de fotos pelo atendente não funciona - CORRIGIDO: handleImageSelect reescrito com Promise.all para leitura assíncrona confiável
- [x] Envio de áudio pelo atendente não funciona - CORRIGIDO: ffmpeg-static movido de ignoredBuiltDependencies para onlyBuiltDependencies
- [x] AudioPlayer mostrava "Infinity:NaN" - CORRIGIDO: tratamento de duration N/A em arquivos webm
- [x] audioConverter.ts atualizado com fallback para ffmpeg do sistema
- [x] Logs detalhados adicionados ao sendMedia para monitorar entregas WhatsApp
- [x] 79 testes passando
