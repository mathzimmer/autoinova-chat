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

## Bugs - Rodada 23 (Áudio webm não chega no WhatsApp)
- [x] Áudio webm nunca deve ser enviado ao WhatsApp — CORRIGIDO: bloqueio estrito com isWebmAudio()
- [x] Conversão webm→ogg obrigatória antes de chamar sendAudioMessage — CORRIGIDO: se conversão falhar, envio é BLOQUEADO
- [x] Se conversão falhar, registrar erro e NÃO enviar — CORRIGIDO: audioConversionFailed flag bloqueia envio
- [x] Logs detalhados: formato original, formato convertido, URL final enviada — CORRIGIDO: logs em cada etapa
- [x] Verificar se ffmpeg-static está funcionando no deploy — CORRIGIDO: onlyBuiltDependencies + fallback sistema
- [x] Garantir que o MIME enviado ao WhatsApp seja audio/ogg — CORRIGIDO: só envia ogg convertido
- [x] Função isWebmAudio() adicionada ao audioConverter
- [x] audioConverter com verificação de magic bytes OggS no output
- [x] 88 testes passando (21 testes de audioConverter)

## Bugs - Rodada 24 (Áudio ainda não chega no WhatsApp do cliente)
- [x] Áudio grava e aparece no chat do atendente mas NÃO chega no WhatsApp do cliente
- [x] Causa raiz: ffmpeg não disponível no deploy, conversão falhava silenciosamente
- [x] Solução: conversão Pure JS usando prism-media (WebmDemuxer) + OGG muxer manual
- [x] Sem dependência de ffmpeg no deploy — conversão 100% JavaScript
- [x] FFmpeg mantido como fallback se Pure JS falhar
- [x] prism-media adicionado como dependência
- [x] 88 testes passando

## Bugs - Rodada 25 (Áudio chega no WhatsApp mas não reproduz)
- [x] Áudio OGG gerado pela conversão Pure JS não reproduz no WhatsApp do cliente
- [x] Causa: PreSkip errado (3840 vs 312) e segment table incorreta (frames concatenados vs packets separados)
- [x] Corrigido: PreSkip extraído do OpusHead original do WebM
- [x] Corrigido: cada frame Opus é um packet separado no segment table
- [x] Corrigido: vendor string compatível (Lavf61.1.100)
- [x] OGG gerado validado pelo ffmpeg: Duration 2.01s, opus 48kHz mono
- [x] 88 testes passando

## Bugs - Rodada 26 (Áudio no WhatsApp diz "não disponível")
- [x] Cliente recebe áudio no WhatsApp mas diz "não está mais disponível, peça para reenviar"
- [x] Causa: WhatsApp não conseguia baixar o arquivo da URL do S3 (link hospedado)
- [x] Solução: Upload direto para WhatsApp Media API (recomendado pela Meta)
- [x] uploadMedia() criada em whatsapp.ts com multipart/form-data manual (sem dependência extra)
- [x] sendAudioMessage agora aceita audioBuffer para upload direto + voice:true
- [x] sendMedia mutation passa o buffer OGG convertido para sendAudioMessage
- [x] Fallback para link hospedado se upload falhar
- [x] 88 testes passando

## Feature - Rodada 27 (Arquitetura de Prompt em 4 Camadas + Reativação Automática)
- [x] Separação do prompt em 4 camadas: CORE (imutável), COMMERCIAL (imutável), PERSONALITY (editável), CONTEXT (dinâmico)
- [x] CORE_PROMPT: regras de formato, prioridade, limpeza, áudio, imagens — protegido contra edição
- [x] COMMERCIAL_PROMPT: busca de veículos, fluxo de qualificação — protegido contra edição
- [x] DEFAULT_PERSONALITY_PROMPT: tom de voz, estratégia, dados da loja — editável pelo admin
- [x] getPersonalityPrompt(): carrega do DB (ai_personality_prompt) com fallback para legado (ai_prompt)
- [x] Migração automática: prompt legado monolítico é detectado e usado como personalidade
- [x] processAIMessage() monta as 4 camadas na ordem correta com log de tamanho
- [x] Reativação automática: conversa resolved/closed → status "open" + aiActive true quando cliente manda nova mensagem
- [x] Contexto dinâmico inclui estado "REATIVADA" para IA cumprimentar pelo retorno
- [x] Settings.tsx reescrito: mostra as 4 camadas com Núcleo e Motor Comercial em modo leitura (collapsible)
- [x] Camada Personalidade editável com destaque visual (ring-1 ring-primary/20)
- [x] settingsRouter atualizado: salva em "ai_personality_prompt", limpa legado na migração
- [x] 88 testes passando

## Feature - Rodada 28 (Todas as camadas do prompt editáveis pelo admin)
- [x] Tornar camada Núcleo editável pelo admin (salvar/carregar do DB via ai_core_prompt)
- [x] Tornar camada Motor Comercial editável pelo admin (salvar/carregar do DB via ai_commercial_prompt)
- [x] Manter camada Personalidade editável (já funciona via ai_personality_prompt)
- [x] Atualizar Settings.tsx para mostrar todas as camadas como editáveis com textarea individual
- [x] Botão "Restaurar padrão" individual para cada camada
- [x] Atualizar routers.ts: savePrompt e resetPrompt aceitam layer (core/commercial/personality)
- [x] Atualizar ai.ts: getCorePrompt() e getCommercialPrompt() carregam do DB com fallback
- [x] Camada 4 (Contexto) permanece automática (apenas informativa)
- [x] 90 testes passando (incluindo novos testes para camadas)

## Bugs - Rodada 29 (IA inventando veículos e links)
- [x] IA inventa veículos que não existem no estoque - CORRIGIDO
- [x] IA inventa links/URLs que não existem - CORRIGIDO
- [x] Paginação adicionada: buscar_veiculos aceita pagina (1, 2, 3...) com 10 por página
- [x] REGRA 7 (CORE): Proibição absoluta de inventar veículos adicionada
- [x] PAGINAÇÃO (COMMERCIAL): Instruções para usar pagina: 2 quando cliente pedir mais
- [x] DEFAULT_SYSTEM_PROMPT legado: Regra 4B anti-invenção adicionada
- [x] searchVehiclesForAI: paginação com offset, 10 por página, mensagens claras
- [x] 90 testes passando

## Bugs - Rodada 30 (IA não busca veículo quando cliente muda de interesse)
- [x] IA diz "vou buscar" mas não chama buscar_veiculos quando cliente muda de veículo de interesse - CORRIGIDO
- [x] Cenário: lead já qualificado até vendedor, cliente muda de carro, IA não busca - CORRIGIDO
- [x] AUTO-SEARCH: após loop de tool calls, detecta se atualizar_lead foi chamado com novo veiculo_interesse sem buscar_veiculos
- [x] Se detectado, força busca automática pelo novo veículo e injeta resultados para o LLM apresentar
- [x] Detector de "wait response" expandido para 300 chars (antes 200)
- [x] 90 testes passando

## Bugs - Rodada 31 (Busca de veículos muito específica)
- [x] Busca não encontra veículos quando o texto é muito específico - CORRIGIDO
- [x] Busca fuzzy por keywords: extrai palavras significativas, ignora números/versões
- [x] Fallback progressivo: todas keywords → primeira keyword → qualquer keyword
- [x] Busca em brand + model + version + title (antes só model)
- [x] SIMPLIFICAÇÃO DA BUSCA no prompt: instruções para IA usar termos simples
- [x] Adicionados 15+ modelos clássicos à lista de keywords (belina, corcel, opala, etc)
- [x] 90 testes passando

## Feature - Rodada 32 (Scroll na conversa + Painel lateral retrátil)
- [x] Área de conversa com rolagem automática conforme mensagens aumentam
- [x] Scroll automático para a última mensagem (scrollTop = scrollHeight)
- [x] Painel "Gerenciar Atendimento" retrátil com botão no header do chat
- [x] Botão toggle PanelRightOpen/PanelRightClose com tooltip
- [x] Painel começa fechado, abre com animação slide-in-from-right
- [x] panelToggle prop adicionada ao ChatView
- [x] 90 testes passando

## Bugs - Rodada 33 (Busca sem filtro de tipo/câmbio + scroll agressivo)
- [x] Busca não filtra por tipo de veículo (picape, hatch, sedan, SUV, camionete, moto) - CORRIGIDO: mapeamento fuzzy de categorias (picape→Picapes, hatch→Hatch, sedan→Sedã, suv→SUV/Utilitário Esportivo, etc.)
- [x] Busca não filtra por câmbio (automático/manual) - CORRIGIDO: mapeamento fuzzy de transmissão (automatico/automático→automatic+automatizado, manual→manual)
- [x] Busca não filtra por tração (4x4, 4x2) - PARCIAL: tração é filtrada via keywords no model/version/title
- [x] IA mostra Gol, Biz, Palio quando cliente pede picape - CORRIGIDO: tool description e prompt instruem uso obrigatório de categoria
- [x] Atualizar tool buscar_veiculos com parâmetros tipo, cambio - CORRIGIDO: descrições detalhadas com valores aceitos e exemplos
- [x] Atualizar searchVehiclesForAI para filtrar por esses campos - CORRIGIDO: categoryMap e transmissionMap com 20+ termos mapeados
- [x] Prompt da IA atualizado com seção FILTROS DE CATEGORIA E CÂMBIO (OBRIGATÓRIO) com exemplos concretos
- [x] Resultados da busca agora incluem tipo de câmbio e categoria em cada veículo
- [x] Scroll automático volta para última mensagem quando usuário está lendo mensagens antigas - CORRIGIDO: smart auto-scroll
- [x] Scroll deve ser automático só quando nova mensagem chega E usuário está no final do chat - CORRIGIDO: isNearBottom detection + hasNewMessages indicator
- [x] Botão "Novas mensagens" aparece quando usuário está scrollado para cima e chega nova mensagem
- [x] 107 testes passando (17 novos testes para filtros de categoria e transmissão)

## Feature - Rodada 34 (Tabela de Decisões da IA - Auditoria)
- [x] Criar tabela aiDecisions no schema com 17 colunas (conversationId, messageId, toolName, toolArgs, toolResultSummary, resultCount, success, errorMessage, responseTimeMs, promptTokens, completionTokens, totalTokens, model, customerMessage, aiResponse, createdAt)
- [x] Migrar schema com pnpm db:push (migration 0007_ambiguous_kate_bishop.sql)
- [x] Implementar logging automático de cada tool call no ai.ts (buscar_veiculos, atualizar_lead, rotear_para_vendedor, resumo_estoque)
- [x] Registrar argumentos/filtros usados em cada busca de veículos (marca, modelo, categoria, câmbio, preço, km, ano, cor, combustível)
- [x] Registrar resultado resumido (quantos veículos encontrados, texto truncado a 500 chars)
- [x] Criar helpers createAiDecision(), createAiDecisionsBatch(), listAiDecisions(), getAiDecisionsByConversation(), getAiDecisionStats() em db.ts
- [x] Criar endpoint tRPC aiDecision.list (admin, com filtros por conversa, tool, paginação), aiDecision.byConversation (protegido), aiDecision.stats (admin)
- [x] Criar página Auditoria IA (/ai-audit) com cards de stats, distribuição por tool, tabela filtrável com paginação
- [x] Adicionar ícone Brain na sidebar (admin only)
- [ ] Exibir decisões da IA no painel lateral da conversa (histórico de tools chamadas) - PENDENTE para próxima rodada
- [x] 15 testes para aiDecisions (schema, data structure, batch creation, result count extraction, UI mapping)
- [x] 122 testes passando no total (9 arquivos de teste)

## Feature - Rodada 35 (Meta Ads + Follow-Up Automático)
- [x] Criar server/metaAds.ts (módulo de automação Meta Ads API v21.0)
- [x] Criar server/followUp.ts (job de follow-up automático a cada 6h)
- [x] Adicionar tabelas metaAds e followUpLogs ao schema
- [x] Migrar schema com pnpm db:push (migration 0008_even_sinister_six.sql)
- [x] Adicionar metaAdsRouter ao routers.ts (isConfigured, list, createAd, createBatch, activate, pause, syncInsights, syncAllInsights)
- [x] Adicionar webhooks /api/webhook/meta-ads (GET + POST) ao index.ts
- [x] Adicionar startFollowUpJob() ao index.ts
- [x] Criar client/src/pages/MetaAds.tsx (página de gerenciamento de anúncios)
- [x] Adicionar rota /meta-ads ao App.tsx
- [x] Adicionar ícone Megaphone no sidebar do AppLayout.tsx
- [x] Solicitar variáveis de ambiente Meta Ads
- [x] Escrever testes para os novos módulos (20 testes: buildMetaConfig, env check, schema, phone normalization, follow-up)
- [x] 141 testes passando (1 falha pré-existente em whatsapp.validate — PHONE_NUMBER_ID inválido, não relacionado)

## Feature - Rodada 36 (Follow-Up Panel + WhatsApp Templates + Meta Ads Métricas + IA Ads)

### Painel de Follow-Up
- [x] Criar página /follow-up com configurações do job (3 abas: Config, Histórico, Templates)
- [x] Configurar intervalo entre tentativas (horas)
- [x] Configurar número máximo de tentativas (1-10)
- [x] Configurar tempo de inatividade mínimo (horas)
- [x] Editar mensagens de cada tentativa (instruções para IA por tentativa)
- [x] Ativar/desativar follow-up automático (switch)
- [x] Exibir histórico de follow-ups enviados (tabela com paginação)
- [x] Salvar configurações em settings do banco
- [x] Botão "Executar agora" para rodar follow-up manualmente
- [x] Cards de estatísticas (total, 24h, 7d, status)
- [x] Ícone Zap na sidebar (/follow-up)

### WhatsApp Message Templates (pós-24h)
- [x] Criar módulo server/whatsappTemplates.ts para API de templates
- [x] Listar templates aprovados da conta WhatsApp Business
- [x] Enviar mensagem usando template aprovado (pós-24h)
- [x] Integrar com follow-up: usar template quando janela 24h expirou (config useTemplateAfter24h)
- [x] UI para selecionar template no painel de follow-up (aba Templates)

### Meta Ads Métricas no Painel
- [x] Sincronização de métricas (impressões, cliques, leads, gastos) via syncInsights/syncAllInsights
- [x] Exibir métricas em cards totalizadores no topo (Ativos, Impressões, Cliques, Leads, Gasto)
- [x] Exibir métricas por anúncio no card (CPL, impressões, cliques, leads, gasto)
- [x] Botão "Sincronizar Métricas" manual (sync all)
- [x] Botão sync individual por anúncio

### Criação de Anúncios com IA
- [x] Gerar texto do anúncio via LLM usando dados do veículo (generateAdText endpoint)
- [x] Gerar headline e description otimizados para conversão (JSON schema com limites)
- [x] Preview e edição do anúncio antes de criar (AiAdModal com campos editáveis)
- [x] Opção de regenerar texto com IA (botão "Gerar novamente")
- [x] Criar anúncio com texto gerado pela IA (createAdWithText endpoint)
- [x] Botão "Criar com IA" (roxo) na página Meta Ads
- [x] 141 testes passando (1 falha pré-existente em whatsapp.validate)

## Bugs/Melhorias - Rodada 37 (Verificação Integração Meta Ads)
- [x] Verificar credenciais Meta Ads configuradas nos secrets — Token válido, conta "01- AutoInova -Nova" ACTIVE, moeda BRL
- [x] Testar conectividade com Meta Ads API — 7 campanhas, 20+ anúncios, página "Auto Inova" (5.494 fãs)
- [x] Importar anúncios existentes da conta de anúncios — 61 anúncios importados com thumbnails e métricas
- [x] Sincronizar métricas dos anúncios já rodando na conta — 491.003 impressões, 13.730 cliques, 228 leads, R$ 4.062,57
- [x] Verificar fluxo de criação de anúncios — AiAdModal e CreateAdModal funcionais
- [x] Corrigir problemas encontrados:
  - Schema atualizado: vehicleId agora nullable, adSetId/adCreativeId nullable, adName/thumbnailUrl/source adicionados
  - Função importAdsFromMeta() criada para importar todos os anúncios da conta
  - Endpoint syncAll combina importação + atualização de métricas
  - AdCard atualizado para exibir thumbnails e nomes de anúncios importados
  - Filtros por status (Todos/Ativos/Pausados/Importados) adicionados
  - 144 testes passando (1 falha pré-existente em whatsapp.validate)

## Bugs - Rodada 38 (Templates Meta não sincronizam no Follow-Up)
- [x] Diagnosticar por que templates da Meta não estão sincronizando — token antigo sem permissão whatsapp_business_management
- [x] Testar conectividade com WhatsApp Business API de templates — WABA ID: 1367492694331179 (Auto Inova Fixo)
- [x] Corrigir a sincronização de templates — reescrito whatsappTemplates.ts para usar WHATSAPP_SYSTEM_USER_TOKEN + WHATSAPP_BUSINESS_ACCOUNT_ID
- [x] Verificar no browser que templates aparecem corretamente — 2 templates (lead + hello_world) exibidos com badge Aprovado
- [x] Adicionado endpoint isConfigured ao whatsappTemplateRouter
- [x] 9 testes novos para whatsappTemplates (153 passando total)

## Bugs/Melhorias - Rodada 39 (Layout lista de conversas + janela 24h)
### Layout da lista de conversas
- [x] Corrigir rolagem da lista de conversas (sidebar) — reescrito ConversationList com layout fixo
- [x] Fixar altura dos itens da lista (h-[72px]) para evitar redimensionamento
- [x] Melhorar organização visual da sidebar (header fixo, filtros compactos, busca, lista com scroll independente)
- [x] Garantir que a sidebar tenha scroll independente (flex-1 overflow-y-auto)
- [x] Tempo relativo formatado (minutos, horas, dias)
- [x] Badges de status (IA ativa, Sem agente, Agente atribuído)

### Janela de 24h do WhatsApp
- [x] Detectar se a janela de 24h expirou (baseado em lastCustomerMessageAt + windowExpired flag)
- [x] Mostrar banner amarelo quando a janela está expirada
- [x] Exibir botão "Enviar Template" no banner de janela expirada
- [x] Permitir selecionar e enviar template aprovado pela Meta (dialog com preview e parâmetros)
- [x] Detectar erro 131047 da API e mostrar toast de janela expirada

### Layout geral do chat
- [x] Melhorar organização geral do layout de mensagens
- [x] Garantir responsividade e consistência visual

## Feature - Rodada 39b (Rastreamento de Entrega WhatsApp + Janela 24h via API)

### Rastreamento de Status de Entrega
- [x] Campo deliveryError adicionado ao schema de messages
- [x] Campo lastCustomerMessageAt adicionado ao schema de conversations
- [x] Campo windowExpired (tinyint) adicionado ao schema de conversations
- [x] Webhook handler atualiza status (sent→delivered→read→failed) sem downgrade
- [x] Webhook handler salva wamid no externalId quando IA envia mensagem
- [x] message.send salva wamid e detecta erro 131047
- [x] updateLastCustomerMessageAt chamado quando cliente envia mensagem

### Indicadores Visuais no Chat
- [x] ✓ (enviado), ✓✓ (entregue), ✓✓ azul (lido), ✗ vermelho (falhou) em cada mensagem
- [x] Tooltip com detalhes do erro quando mensagem falha
- [x] Mensagens do sistema (delivery errors) exibidas como pill centralizada amarela

### Detecção de Janela 24h via API
- [x] Cálculo local da janela 24h como indicador visual (lastCustomerMessageAt)
- [x] Detecção de erro 131047 da API quando janela expira
- [x] Banner amarelo com botão "Enviar Template" quando janela expira
- [x] Dialog para selecionar template aprovado, ver preview e preencher parâmetros
- [x] Envio de template via whatsappTemplate.send endpoint

### Notificações de Falha
- [x] Toast de erro quando mensagem falha na entrega
- [x] Toast específico para janela 24h expirada
- [x] 169 testes passando (16 novos para delivery tracking)

## Bugs - Rodada 40 (Token WhatsApp invalidado)
- [x] WHATSAPP_ACCESS_TOKEN invalidado — sessão expirada por mudança de senha
- [x] Testar se WHATSAPP_SYSTEM_USER_TOKEN pode enviar mensagens — SIM: permissões whatsapp_business_messaging + whatsapp_business_management, nunca expira
- [x] Atualizar whatsapp.ts para usar WHATSAPP_SYSTEM_USER_TOKEN como token principal (getConfig prioriza SYS_TOKEN)
- [x] Implementar fallback: se SYSTEM_USER_TOKEN não disponível, usa WHATSAPP_ACCESS_TOKEN com warning
- [x] Atualizar teste whatsapp.validate para usar o token correto — agora passa com System User Token
- [x] Atualizar whatsapp.test.ts para testar prioridade de tokens (9 testes)
- [x] 172 testes passando, 0 falhas

## Rodada 41 - Monitoramento de Tokens + Templates na Conversa

### Monitoramento de Tokens
- [x] Job periódico que verifica saúde dos tokens (WhatsApp System User Token, Meta Ads Token)
- [x] Verificação via chamada real à API (ex: GET /me ou /phone_numbers)
- [x] Notificação ao admin via notifyOwner() quando token falha
- [x] Banner visual no dashboard quando algum token está inválido
- [x] Endpoint tRPC para verificar status dos tokens manualmente
- [x] Log de cada verificação com resultado (ok/falha/erro)

### Templates Enviados Visíveis na Conversa
- [x] Ao enviar template, salvar como mensagem na conversa (role: assistant, tipo: template)
- [x] Exibir template enviado no chat com formatação adequada (nome do template + parâmetros)
- [x] Mostrar status de entrega do template (✓ enviado, ✓✓ entregue, ✓✓ azul lido)
- [x] Indicar "Aguardando resposta do cliente" após envio do template

## Rodada 42 - Simplificação Meta Ads: Criar Anúncios em Campanha/AdSet Existente

### Backend
- [x] Endpoint para listar campanhas existentes na conta Meta Ads
- [x] Endpoint para listar conjuntos de anúncios (adsets) de uma campanha
- [x] Endpoint para gerar título e descrição via IA a partir de veículo do estoque
- [x] Refatorar criação de anúncio: usar campanha e adset existentes (não criar novos)
- [x] Upload de imagem do veículo para Meta e criação do criativo
- [x] Criar anúncio dentro do adset selecionado (iniciar pausado)

### Frontend
- [x] Nova UI de criação de anúncio: selecionar campanha existente
- [x] Selecionar conjunto de anúncios existente
- [x] Selecionar veículo do estoque para anunciar
- [x] Gerar título/descrição automaticamente via IA com botão
- [x] Permitir editar título/descrição gerados antes de criar
- [x] Upload/seleção de fotos do veículo para o anúncio
- [x] Preview do anúncio antes de criar
- [x] Simplificar página Meta Ads removendo fluxo de criação de campanha/adset

## Bug Fix - instagram_actor_id inválido

- [x] Tornar instagram_actor_id opcional na criação de anúncios (não enviar se inválido)
- [x] Validar instagram_actor_id antes de incluir no object_story_spec

## Bug Fix - Criativo incompatível com objetivo da campanha

- [x] Detectar objetivo da campanha selecionada (Engajamento, Tráfego, Leads, etc.)
- [x] Adaptar CTA e object_story_spec conforme o objetivo da campanha
- [x] Para campanhas de Engajamento/Mensagens: usar WHATSAPP_MESSAGE CTA
- [x] Para campanhas de Tráfego/Leads: usar LEARN_MORE com link
- [x] Passar objetivo da campanha para o endpoint de criação de anúncio

## Rodada 43 - Meta Ads: Preço, Carrossel e IA

- [x] Corrigir exibição de preço dos veículos no módulo Meta Ads (valores em centavos vs reais)
- [x] Mostrar preço formatado corretamente (ex: R$ 389.000 em vez de R$ 3.900)
- [x] Suporte a anúncio carrossel: selecionar múltiplas fotos do veículo
- [x] Backend: criar criativo carrossel no Meta Ads API
- [x] Frontend: UI para selecionar múltiplas imagens para carrossel
- [x] Mais personalizações da IA: tom, estilo, público-alvo, destaques
- [x] Opção de regenerar textos com diferentes estilos
- [x] Campo para instruções adicionais à IA

## Bug Fix - Welcome message excede 300 caracteres

- [x] Limitar welcome message a 300 caracteres em campanhas de Engajamento/WhatsApp
- [x] Truncar texto principal quando usado como page_welcome_message
- [x] Instruir IA a gerar texto principal mais curto para campanhas de mensagem

## Rodada 44 - Meta Ads: Instagram, Pixel, Advantage+ e Legendas Carrossel

- [x] Adicionar instagram_actor_id ao criativo para veicular no Instagram também
- [x] Usar o META_ADS_INSTAGRAM_ID do env para o instagram_actor_id
- [x] Adicionar rastreamento com Pixel do Facebook (ID: 587774608991001)
- [x] Configurar tracking_specs no nível do anúncio com o Pixel
- [x] Habilitar Advantage+ (enhancements) no anúncio
- [x] Adicionar legendas individuais em cada foto do carrossel
- [x] Frontend: campo para editar legenda de cada imagem do carrossel
- [x] IA gerar legendas automáticas para cada foto do carrossel

## Bug Fix - Instagram Actor ID fallback

- [x] Tentar criar criativo com instagram_actor_id
- [x] Se falhar com erro #100 instagram_actor_id, recriar automaticamente sem Instagram
- [x] Logar aviso quando fallback for acionado

## Bug Fix - instagram_actor_id deprecated → instagram_user_id

- [x] Substituir instagram_actor_id por instagram_user_id em todas as ocorrências do metaAds.ts
- [x] Campo instagram_actor_id foi deprecated na v22.0 do Meta API

## Bug Fix - Invalid parameter ao criar anúncio

- [x] Adicionar logging detalhado do payload enviado ao Meta Ads API
- [x] Identificar e corrigir o parâmetro inválido (standard_enhancements deprecated + welcome message > 300 chars) (call_to_action nos child_attachments do carrossel)

## Bug Fix - Rolagem da conversa volta automaticamente

- [x] Detectar quando o usuário está rolando para cima (lendo mensagens anteriores)
- [x] Não fazer auto-scroll quando o usuário não está no fundo da conversa
- [x] Auto-scroll apenas quando: nova mensagem enviada pelo próprio usuário OU já estava no fundo
- [x] Adicionar botão "Novas mensagens" para voltar ao fundo quando há mensagens novas

## Bug Fix - Rodada 45 (Correção envio de áudio WhatsApp)

- [x] Atualizar whatsapp.ts: uploadMedia com validação OGG magic bytes, MIME "audio/ogg; codecs=opus", multipart manual, logs detalhados
- [x] Atualizar whatsapp.ts: sendAudioMessage com 3 estratégias (media_id+voice, link_no_voice fallback, link_no_buffer)
- [x] Atualizar audioConverter.ts: extractOpusHeaderFromWebm lê channels/preSkip/sampleRate reais do OpusHead
- [x] Atualizar audioConverter.ts: forçar mono para WhatsApp, filtrar frames inválidos (<2 bytes), timeout 15s
- [x] Verificar dependência prism-media instalada
- [x] Rodar testes e verificar que tudo passa — 185 testes passando (13 arquivos)

## Bug Fix - Rodada 46 (Áudio diz "não está mais disponível" no WhatsApp do cliente)

- [x] Diagnosticar qual estratégia de envio está sendo usada em produção (media_id ou link)
- [x] Identificar causa raiz: PreSkip=0 no OpusHead faz WhatsApp rejeitar o áudio como "não disponível"
- [x] Corrigir: PreSkip mínimo de 312 quando browser reporta 0 (extractOpusHeaderFromWebm)
- [x] Testar e validar — 185 testes passando, teste manual com ffmpeg OGG confirmou reprodução

## Bug Fix - Rodada 47 (Áudio ainda indisponível + mensagens não aparecem na tela)

- [x] Investigar logs do servidor para entender erros recentes
- [x] Corrigir mensagens não aparecendo na tela do atendente — LIMIT 100→500 + ORDER DESC com reverse
- [x] Corrigir áudio — PreSkip fix já estava no código, faltava publicar. Confirmado que último envio foi antes do restart
- [x] Testar e validar — 185 testes passando

## Feature - Rodada 48 (Mini CRM - API para vendedores externos via extensão Chrome)

- [x] Adicionar tabela vendorApiKeys no drizzle/schema.ts
- [x] Rodar pnpm db:push para criar a tabela
- [x] Implementar getVendorByApiKey e vendorKeyProcedure no routers.ts
- [x] Implementar vendorRouter com endpoints: me, myLeads, updateLeadStatus, addNote, updateLeadData, getWhatsappLink, createApiKey, listApiKeys, revokeApiKey
- [x] Integrar vendor: vendorRouter no appRouter
- [x] Rodar testes e validar — 192 testes passando (14 arquivos)

## Feature - Rodada 49 (Gerenciamento de API Keys para vendedores)

- [x] Consultar vendedores existentes no banco (teamMembers) — 2 vendedores: Matheus Zimmer (admin) e Sirlei Fritz (vendedor)
- [x] Criar chaves API para cada vendedor — chaves criadas para ambos
- [x] Criar página de gerenciamento de API Keys (VendorApiKeys.tsx) com criar/revogar/listar
- [x] Integrar rota /vendor-keys no App.tsx + link na sidebar (Key icon, admin only)
- [x] Rodar testes e validar — 192 testes passando (14 arquivos)

## Bug Fix - Rodada 50 (Extensão Chrome não conecta - precisa de endpoints REST)

- [x] Diagnóstico: extensão usa tRPC mas sem ?batch=1, servidor retorna objeto ao invés de array
- [x] Corrigir extensão Chrome: adicionar ?batch=1 nas chamadas GET e POST (popup.js, content.js, background.js)
- [x] Testar com curl e validar — endpoint vendor.me retorna dados corretos com batch=1

## Bug Fix - Rodada 51 (Erro ao salvar no mini CRM da extensão Chrome)

- [x] Investigar logs do servidor — endpoints funcionam via curl em dev e produção, problema é na extensão Chrome (CORS ou versão desatualizada)
- [x] Endpoints vendor.updateLeadData, vendor.updateLeadStatus, vendor.addNote — funcionam corretamente
- [x] Alterações feitas pela extensão reflitam no CRM principal — confirmado via curl
- [ ] Pendente: usuário verificar console da extensão Chrome para erro exato

## Feature - Rodada 52 (Mensagem pré-preenchida nos anúncios Meta Ads)

- [x] Analisar o módulo de criação de anúncios e como o modelo de mensagem é configurado
- [x] Implementar mensagem pré-preenchida com nome do veículo e ID (Ref: X) no buildWelcomeMessage e waMsg
- [x] Garantir que o agente de IA consiga extrair o veículo — regra MENSAGENS DE ANÚCIOS adicionada ao COMMERCIAL_PROMPT
- [x] Testar e validar — 192 testes passando

## Bug Fix - Rodada 53 (Modelo de mensagem com ID do carro não funciona nos anúncios)

- [x] Investigar como buildWelcomeMessage e waMsg são construídos e passados ao Meta Ads API
- [x] Identificar causa: anúncio foi criado com código antigo (antes do fix ser publicado) + erro temporário da Meta API
- [x] Testado via curl: criativo com page_welcome_message personalizado funciona (ID: 26132689613085248)
- [x] Melhorado logging de erros da Meta API (error details completo)

## Ajuste - Rodada 53b (Mensagem pré-preenchida anúncios)

- [x] Ajustar autofill para: "Olá, tenho interesse no veículo: [nome] [ID]"
- [x] Ajustar waMsg (link wa.me) com mesmo formato (ambas as funções: quickCreateAd e createAdInExistingAdSet)
- [x] Ajustar greeting text para "Olá! Bem-vindo à Auto Inova! 👋"
- [x] Testar e validar — 192 testes passando + regra IA atualizada para reconhecer IDX

## Feature - Rodada 54 (Tema Claro / Light Mode)

- [x] Analisar CSS atual e ThemeProvider
- [x] Criar variáveis CSS para tema claro (:root) e escuro (.dark) com OKLCH
- [x] Substituir cores hardcoded em MetaAds.tsx (~72 substituições) e FollowUp.tsx (~20 substituições)
- [x] Adicionar botão de alternância Sol/Lua na sidebar do AppLayout
- [x] Habilitar switchable no ThemeProvider (defaultTheme="dark", persistência via localStorage)
- [x] Scrollbar adaptável ao tema (claro/escuro)
- [x] Testar e validar — 192 testes passando, 0 erros TypeScript

## Feature - Rodada 55 (Debounce/Agrupamento de Mensagens)

- [x] Analisar o fluxo atual de processamento de mensagens recebidas no webhook
- [x] Implementar sistema de debounce com timer por conversa (messageDebounce.ts)
- [x] Agrupar mensagens recebidas no período de espera e processar como uma só
- [x] Garantir que áudios e imagens também sejam agrupados corretamente (messageType preservado)
- [x] Adicionar campo ajustável de tempo de espera na página de Configurações (Slider 1-30s)
- [x] Testar e validar — 192 testes passando, 0 erros TypeScript

- [x] Bug: Respostas da IA não estão chegando ao cliente via WhatsApp após implementação do debounce — CORRIGIDO: faltava sendTextMessage no callback do debounce
- [x] Bug: Erro "Rate exceeded" ao acessar ambiente de produção — Rate limit temporário da infraestrutura (HTTP 429), resolvido automaticamente. Adicionada proteção contra intervalos duplicados no StockSync e TokenMonitor
- [x] Integração Instagram Messaging - receber e enviar mensagens do Instagram Direct
- [x] Integração Facebook Messenger - receber e enviar mensagens do Messenger
- [x] Atualizar schema do banco para suportar campo de plataforma (whatsapp/instagram/facebook)
- [x] Webhook unificado para Instagram e Facebook (/api/webhook/instagram)
- [x] Ícones visuais de plataforma (WhatsApp/Instagram/Facebook) na lista de conversas
- [x] Ícones visuais de plataforma no painel de chat (header + badge de canal)
- [x] Envio de respostas pela plataforma correta (Instagram/Facebook/WhatsApp) — debounce + agente
- [x] 199 testes passando, 0 erros TypeScript
- [x] Bug: Webhook Instagram/Facebook falha na validação do Meta App Dashboard — CORRIGIDO: aceita múltiplos verify tokens (META_ADS_VERIFY_TOKEN, WHATSAPP_VERIFY_TOKEN, default)
- [x] Bug: Envio de mensagem Instagram falha com erro "Object with ID 'me' does not exist" — CORRIGIDO: mudado de /me/messages para /{PAGE_ID}/messages + messaging_type + access_token como query param
- [x] Bug: Nome e foto do perfil do Instagram não aparecem na conversa — CORRIGIDO: adicionado campo contactPhoto no schema + busca de perfil no webhook + exibição no frontend
- [ ] Bug: Envio Instagram retorna "An unknown error has occurred" mesmo após fix do endpoint
- [x] Bug: Links dos anúncios do Instagram não abrem conversa corretamente — CORRIGIDO: todas as funções de criação de anúncio agora usam WHATSAPP_MESSAGE com page_welcome_message em vez de LEARN_MORE com link wa.me
- [x] Bug: Erro "instagram_actor_id must be a valid Instagram account id" — CORRIGIDO: campo depreciado na v22.0, substituído por instagram_user_id em todas as funções de criação de anúncio
- [x] Bug: Link WhatsApp não funciona em anúncios carrossel — CORRIGIDO: cada child_attachment agora tem link e call_to_action individuais para Click to WhatsApp + link principal mudado para api.whatsapp.com/send
- [x] Bug: Descrição não aparece em anúncios de foto única — CORRIGIDO: adicionados campos message (primaryText) e description em todas as funções de criação de anúncio (createAdCreative, createAdInExistingAdSet, createAdWithText)
- [x] Usar REGULAR_PRICE como preço principal quando disponível — campo `price` agora = REGULAR_PRICE || PRICE
- [x] Agente de IA envia REGULAR_PRICE ao cliente — formato: "R$ 112.990 (promoção: R$ 108.990)" quando há desconto
- [x] Módulo de anúncios usa REGULAR_PRICE no texto do anúncio — usa v.price que agora é REGULAR_PRICE
- [x] Sincronização de estoque importa ambos os preços (regular e promoção) — já funcionava, agora price = regularPrice
- [x] Bug: Agente de IA informa preço errado para Mercedes — CORRIGIDO: 1) preço no banco já atualizado para REGULAR_PRICE (R$ 112.990), 2) prompt reforçado com regras críticas de preço e ano para evitar alucinação do LLM. Producão precisa ser republicada.
- [x] Configurar chave OpenAI como secret do projeto
- [x] Atualizar agente de IA para usar GPT-4o-mini da OpenAI em vez da LLM integrada do Manus — com fallback automático para Manus Forge se OpenAI falhar
- [ ] Opção no painel de configurações para escolher provedor de LLM (Manus/OpenAI) — futuro

## Feature - Rodada 56 (Módulo de Leads - Reformulação Completa)
- [x] Resumo automático de conversa por dia (gerado pela IA, atualizado a cada interação)
- [x] Histórico de resumos separado por dias (como anotações)
- [x] Preview de 3 linhas do resumo no painel de leads
- [x] Painel expandido ao clicar no lead com resumo completo e opções
- [x] Botão "Ir para conversa" no lead
- [x] Nome do cliente e telefone formatado (sem 55 na frente, ex: 51997566259)
- [x] Botão copiar lead (nome, telefone, cidade, veículo interesse, veículo troca, pagamento)
- [x] Botão copiar resumo completo
- [x] Botão editar informações do lead manualmente (status, dados)
- [x] Personalização avançada do módulo de leads (status customizados, campos extras)
- [x] Campo cidade adicionado ao lead (schema + IA tool + frontend)
- [x] Gerar resumo IA via botão manual (usa LLM para resumir mensagens do dia)
- [x] Tabela leadSummaries no banco de dados (migração aplicada)
- [x] 214 testes passando, 0 erros TypeScript

## Feature - Rodada 57 (Melhorias nos Prompts e Fluxo de ID)
- [x] Criar função getVehicleByIdForAI no stockSync.ts para busca direta por ID
- [x] Implementar pré-processamento de mensagens com ID (detectar IDX antes do LLM)
- [x] Injetar dados do veículo no contexto quando ID detectado
- [x] Atualizar lead automaticamente com veiculo_id quando ID detectado
- [x] Adicionar tool buscar_veiculo_por_id para fallback do LLM
- [x] Condensar COMMERCIAL_PROMPT (remover duplicações, hierarquia de prioridade)
- [x] Adicionar hierarquia de prioridade de ações no prompt
- [x] Melhorar contexto do lead (recência inteligente em vez de tudo desatualizado)
- [x] Testes Vehicle ID Detection adicionados e 239 testes passando

## Feature - Rodada 58 (Reestruturação Completa dos Prompts)
- [x] Condensar CORE_PROMPT de ~2100 para ~1253 chars (~40% menor)
- [x] Reescrever COMMERCIAL_PROMPT com motor de etapas/cenários robusto (4 etapas + cenários especiais)
- [x] Definir 20+ cenários: primeiro contato, veículo específico, categoria, preço, anúncio, troca, pagamento, fechamento
- [x] Criar fluxo de qualificação por etapas (ETAPA 1→2→3→4: contato → apresentação → qualificação → fechamento)
- [x] Migração automática de prompts legados (ai_prompt → ai_personality_prompt, limpa ai_prompt)
- [x] Atualizar DEFAULT_SYSTEM_PROMPT legado para formato condensado
- [x] 230 testes passando, 0 erros TypeScript

## Feature - Rodada 59 (Reply Buttons + List Messages - Abordagem Híbrida)
- [x] Criar funções sendReplyButtons e sendListMessage no whatsapp.ts
- [x] Criar funções sendListMessage no whatsapp.ts (validação de 1-10 rows, seções)
- [x] Criar tools enviar_botoes e enviar_lista no agente de IA
- [x] Processar respostas interativas (button_reply, list_reply) no webhook Express
- [x] Enviar mensagens interativas após texto no debounce callback (800ms delay)
- [x] Salvar mensagens interativas no banco para exibição no dashboard
- [x] Integrar ao COMMERCIAL_PROMPT (seção MENSAGENS INTERATIVAS com regras)
- [x] 241 testes passando, 0 erros TypeScript

## Feature - Rodada 60 (Módulo de Fluxos de Conversa - Estilo ManyChat)
- [x] Schema do banco: tabelas chatFlows, chatFlowNodes, chatFlowEdges, chatFlowSessions
- [x] Backend: CRUD completo de fluxos, nós e conexões (tRPC) + saveFlow + duplicate
- [x] Editor visual: canvas React Flow com drag-and-drop para posicionar nós
- [x] 10 tipos de nós: Início, Mensagem, Botões (Reply Buttons), Lista (List Message), Imagem, Condição, IA Livre, Atualizar Lead, Transferir, Delay, Fim
- [x] Painel de propriedades: configurar texto, botões (até 3), seções de lista (até 10 itens), condições, variáveis de template
- [x] Conexões visuais entre nós (edges animadas com setas)
- [x] Motor de execução (flowEngine.ts): processar fluxo ativo durante conversa real
- [x] Integração com debounce callback: fluxo tem prioridade sobre IA livre
- [x] Ativar/desativar fluxos, 7 gatilhos (primeiro contato, palavra-chave, clique em botão, anúncio, manual, reativação, categoria)
- [x] Lista de categorias como nó de lista com seções e itens
- [x] Salvar e carregar fluxos do banco com posições dos nós
- [x] Variáveis de template: {{nome}}, {{telefone}}, {{veiculo}}, {{cidade}}, {{troca}}, {{pagamento}}
- [x] Proteção contra loops infinitos (depth > 20)
- [x] 261 testes passando, 0 erros TypeScript

## Feature - Rodada 61 (Manual de Fluxos + Correções de Conexão)
- [x] Verificar mecânica de conexão entre nós (handles de saída por botão/opção)
- [x] Verificar continuação do fluxo após clique em botão do WhatsApp
- [x] Mecânica correta: cada botão/item tem handle individual, FlowEngine faz matchResponseToEdge
- [x] Criar manual completo de como usar o editor de fluxos (manual-fluxos-conversa.md)

## Feature - Rodada 62 (Pausa de Fluxos + Exibição Visual de Botões/Listas no Chat)
- [x] Endpoint de pausa manual de sessão de fluxo ativa por conversa (flow.pauseSession)
- [x] Ao inativar um fluxo, pausar automaticamente todas as sessões ativas desse fluxo (pauseAllActiveSessionsByFlow)
- [x] Botão de pausar fluxo visível na interface de conversa (header com indicador violeta + botão Pausar)
- [x] Salvar dados de botões/listas (interactiveData) nas mensagens do banco (metadata com interactiveType, buttons, sections)
- [x] Exibir botões e listas visualmente no chat (botões numerados + listas com seções e descrições)
- [x] Endpoint getActiveSession para verificar fluxo ativo na conversa
- [x] 261 testes passando, 0 erros TypeScript

## Feature - Rodada 63 (Botão Global Ativar/Desativar Robô e Fluxos)
- [x] Setting global no banco: ai_global_enabled e flows_global_enabled (via getSetting/upsertSetting)
- [x] Verificar setting global antes de processar IA no debounce callback
- [x] Verificar setting global antes de executar fluxos no debounce callback (if globalFlowsEnabled)
- [x] Pausar todas as sessões de fluxo ativas ao desativar globalmente (setGlobalFlows)
- [x] Botão Power na sidebar com dropdown: toggle IA, toggle Fluxos, Desativar/Ativar Tudo
- [x] Indicador de status colorido (verde=tudo ativo, vermelho=tudo inativo, amarelo=parcial)
- [x] Toast de confirmação ao ativar/desativar
- [x] 261 testes passando, 0 erros TypeScript

## Bug - Rodada 64 (Botão Power não abre dropdown)
- [x] Corrigir botão Power na sidebar - removido Tooltip aninhado dentro do DropdownMenuTrigger que bloqueava o clique

## Bug - Rodada 65 (Fluxo não continua após nó IA Livre)
- [x] Corrigir FlowEngine: após nó IA Livre responder, o fluxo avança automaticamente via continueFlowAfterAI()
- [x] Nó ai_response salva pendingNextNodeId no contexto da sessão
- [x] Debounce callback chama continueFlowAfterAI após processAIMessage para executar nó pendente
- [x] Quando cliente envia nova msg e está no nó ai_response, passa para IA normalmente
- [x] 266 testes passando (novos testes para continueFlowAfterAI), 0 erros TypeScript

## Feature - Rodada 66 (Prompt por Fluxo + Nó Aguardar Resposta)
- [x] Separar IA de fluxo da IA livre: processAIMessage aceita flowPrompt que substitui os 3 prompts globais
- [x] Campo aiPrompt na tabela chatFlows (migração aplicada)
- [x] Botão "Prompt IA" no toolbar do editor visual para editar prompt do fluxo
- [x] Nó ai_response dentro do fluxo usa apenas o prompt do fluxo + instrução do nó
- [x] Criar nó "Aguardar Resposta" (wait_input) com pergunta e variável de destino
- [x] Nó wait_input salva resposta em 9 campos do lead (nome, cidade, veiculo, troca, pagamento, etc.)
- [x] FlowEngine processa wait_input: envia pergunta, pausa, salva resposta, avança
- [x] Editor visual com painel de propriedades para wait_input e ai_response
- [x] 266 testes passando, 0 erros TypeScript

## Bug - Rodada 67 (wait_input não aceito no saveFlow)
- [x] Adicionar wait_input à validação Zod do nodeType no saveFlow do backend

## Feature - Sistema de Múltiplos Agentes de IA
- [x] Criar tabela aiAgents no schema (nome, prompt, tools habilitadas, modelo, temperatura, ativo)
- [x] Adicionar campo agentId na tabela chatFlows (referência ao agente)
- [x] Adicionar settings channel_whatsapp_agent_id e channel_instagram_agent_id
- [x] Migrar banco (pnpm db:push)
- [x] Criar helpers CRUD de agentes no db.ts (create, list, getById, update, delete)
- [x] Criar router tRPC para agentes (list, create, update, delete, getById)
- [x] Alterar processAIMessage para carregar configurações do agente (prompt, tools, modelo, temperatura)
- [x] Alterar roteamento no debounce: buscar agente do fluxo ativo ou agente do canal
- [x] Se nenhum agente configurado, usa prompts globais (fallback para compatibilidade)
- [x] Criar página /agents no frontend: lista de agentes com cards e toggle ativar/desativar
- [x] Criar formulário de criação/edição de agente (nome, prompt, tools, modelo, temperatura)
- [x] Integrar seletor de agente no flow builder (dropdown no lugar do campo de prompt)
- [x] Criar seção de seleção de agente por canal na página de Agentes (WhatsApp e Instagram)
- [x] Testes para CRUD de agentes e roteamento (10 testes passando, 276 total)

## Feature - Agente por Nó (ai_response)
- [x] Cada nó ai_response armazena agentId no campo data do nó
- [x] flowEngine passa agentId do nó ao processAIMessage (via session context nodeAgentId)
- [x] FlowEditor: seletor de agente no painel de edição do nó ai_response
- [x] Manter seletor de agente no nível do fluxo como fallback (se nó não tiver agente, usa do fluxo)
- [x] Testes e verificação (276 testes passando)

## Bug - Fluxo "Mostrar o veículo" + Agente ID Anuncio
- [x] Agente "Agente ID Anuncio" não segue o prompt definido (corrigido: race condition no updateConfig + agentId faltando no data do nó)
- [x] Botão de confirmar interesse é enviado duplicado (corrigido: skip interactiveMessages da IA quando fluxo continua)

## Bug (persistente) - Conversa Matheus: agente global + botões duplicados
- [x] Agente do nó ai_response não está sendo usado (logs detalhados adicionados para diagnóstico)
- [x] Botões duplicados: causa raiz = flowEngine envia via API + routers.ts envia novamente. Fix: routers.ts agora só salva no banco/socket

## Feature - Envio de foto do veículo com informações
- [x] Criar tool 'apresentar_veiculo' na IA que envia imagem + dados formatados
- [x] Usar sendImageMessage do WhatsApp com caption contendo as informações do veículo
- [x] Integrar com dados do estoque (foto do anúncio + campos selecionados)
- [x] Adicionar tool ao painel de agentes para seleção

## Bug - Agente ID não envia foto do veículo no fluxo
- [x] Tool apresentar_veiculo habilitada no agente (confirmado)
- [x] Causa raiz: corePrompt mínimo não mencionava apresentar_veiculo + tool_choice era 'auto' (IA ignorava a tool)
- [x] Fix 1: corePrompt mínimo agora instrui a usar ferramentas disponíveis
- [x] Fix 2: tool_choice='required' quando agente tem 1-3 tools específicas
- [x] Fix 3: prompt do agente reescrito para ser explícito sobre chamar a tool

## Bug - Foto do veículo não enviada mesmo com tool chamada
- [x] Tool apresentar_veiculo foi chamada mas imagem não apareceu no WhatsApp
- [x] Causa raiz: flowContinued=true bloqueava TODOS os interactiveMessages, incluindo imagens
- [x] Fix: imagens são enviadas SEMPRE (independente de flowContinued), apenas botões/listas são pulados

## Fix - Ordem de envio: imagem antes dos botões
- [x] Mover envio de imagens da IA para ANTES do flow continuation para que a foto chegue antes dos botões

## Feature - Categoria (carro/moto) e Tipo de veículo (sedan, SUV, hatch, esportiva, naked)
- [x] Adicionar campo vehicleType na tabela vehicles do schema + migrar banco
- [x] Mapear CATEGORY do JSON externo para campo category (carros/motos)
- [x] Mapear BODY do JSON externo para campo vehicleType (hatch, sedan, SUV, naked, esportiva, etc.)
- [x] Atualizar searchVehiclesForAI para filtrar por category e vehicleType
- [x] Atualizar tool buscar_veiculos na IA para incluir parâmetros categoria e tipo
- [x] Excluir motos por padrão (só mostrar quando cliente pedir especificamente)
- [x] Atualizar testes (276 passando, incluindo novos testes de motos/naked/esportiva)

## Bug - Fluxo de seleção de motos: veículo errado + escolha não gravada
- [ ] Após cliente escolher BMW R 1200 GS Adventure (moto), agente envia foto do Mercedes C-180 (carro errado)
- [ ] A escolha do cliente no fluxo não está sendo passada corretamente ao agente de apresentação
- [ ] Gravar a escolha do veículo no lead (vehicleInterest + vehicleId)

## Feature - Sistema de Subfluxos (goto_flow)
- [x] Adicionar tipo de nó 'goto_flow' no schema (nodeType enum) + migração
- [x] Implementar execução de goto_flow no flowEngine (encerrar sessão atual, iniciar nova sessão no fluxo destino)
- [x] Dados do lead são mantidos entre fluxos (lead é vinculado à conversa, não ao fluxo)
- [x] Adicionar nó goto_flow no FlowEditor (UI) com seletor de fluxo destino
- [x] Nó sem output handles (terminal como 'end') + display do nome do fluxo destino
- [x] Testes (276 passando)

## Feature - Sistema de Distribuição de Atendimento (Fila de Vendedores por Loja)
- [x] Criar tabela 'sellers' no banco (id, name, phone, storeLocation, isActive, createdAt)
- [x] Criar tabela 'sellerQueues' para controle de rodízio por loja (storeLocation, currentIndex)
- [x] Criar tabela 'sellerAssignments' para histórico de atribuições (sellerId, conversationId, assignedAt)
- [x] Migrar banco com pnpm db:push
- [x] Backend: CRUD de vendedores (listar, criar, editar, excluir, ativar/desativar)
- [x] Backend: Lógica de fila round-robin por loja (próximo vendedor da fila)
- [x] Backend: Rota de atribuição automática (identifica loja pelo veículo do lead)
- [x] Frontend: Página /sellers para gestão de vendedores por loja
- [x] Frontend: Cadastro com nome e telefone, filtro por loja
- [x] Novo tipo de nó 'assign_seller' no flow builder
- [x] FlowEngine: executar nó assign_seller (identificar loja, selecionar vendedor, enviar contato)
- [x] Envio de contato do vendedor via WhatsApp (vCard)
- [x] Mensagem automática ao cliente com dados do vendedor
- [x] Integração com transferência para humano (handoff via pausa do fluxo)
- [x] Testes Vitest para o sistema de vendedores (12 testes passando)

## Feature - Foto no Contato e Notificação Personalizável ao Vendedor
- [x] Adicionar campo photoUrl no schema sellers
- [x] Migrar banco com pnpm db:push
- [x] Upload de foto do vendedor para S3 (rota seller.uploadPhoto)
- [x] Incluir foto no vCard (sendContactCard com photoUrl)
- [x] Função sendSellerNotification no whatsapp.ts
- [x] Envio via template WhatsApp (funciona fora da janela de 24h) com fallback para texto
- [x] Mensagem ao vendedor personalizável com variáveis ({vendedor}, {cliente}, {telefone}, {veiculo}, {resumo}, {loja})
- [x] Frontend: upload de foto no cadastro de vendedores (com preview e remoção)
- [x] Frontend: exibir foto do vendedor na tabela de listagem
- [x] Frontend: campo de mensagem personalizável no nó assign_seller do FlowEditor
- [x] Frontend: checkbox para ativar/desativar notificação ao vendedor no fluxo
- [x] Testes Vitest (15 testes sellers, 291 total passando)

## Bug - Foto do vendedor não aparece no contato WhatsApp
- [x] Investigar sendContactCard: foto não aparece no vCard enviado ao cliente (WhatsApp Cloud API NÃO suporta foto no contacts message)
- [x] Corrigido: foto agora é enviada como mensagem de imagem separada antes do cartão de contato

## Feature - Nó de Fluxo: Enviar Fotos do Veículo com Legendas Personalizáveis
- [x] Analisar estrutura de fotos dos veículos no schema/estoque (campo images: array de URLs, até 22 fotos)
- [x] Adicionar tipo de nó 'send_vehicle_photos' no schema e migrar banco
- [x] Backend: query getVehicleById para buscar fotos do veículo de interesse do lead
- [x] FlowEngine: handler do nó send_vehicle_photos (envio de múltiplas fotos com legendas personalizáveis)
- [x] FlowEditor: configuração do nó com slots de fotos (posição + legenda), mensagem intro e fallback
- [x] Testes Vitest para o novo nó (7 testes, 298 total passando)

## Melhoria - Delay entre Fotos e Botões Travando Fluxo
- [x] Delay configurável entre envio de cada foto no nó send_vehicle_photos (0.5s a 10s, padrão 1s)
- [x] Campo de delay (segundos) no FlowEditor para o nó send_vehicle_photos
- [x] Corrigir flowEngine: botões/listas agora exigem clique exato (sem fallback para texto livre)
- [x] Quando cliente envia texto em vez de clicar botão, re-envia os botões com mensagem de orientação
- [x] Testes Vitest: 298 testes passando (21 arquivos)

## Melhoria - Nó Aguardar Resposta com Agrupamento de Mensagens
- [x] Implementar timeout configurável no wait_input para aguardar múltiplas mensagens (0-120s)
- [x] Agrupar mensagens do cliente enviadas dentro do período de timeout em uma única resposta
- [x] Campo de timeout (segundos) no FlowEditor para o nó wait_input
- [x] Salvar todas as mensagens agrupadas no campo do lead
- [x] Testes Vitest: 298 testes passando (21 arquivos)

## Melhoria - Variáveis de Template e Campos do Lead
- [x] Adicionar campos faltantes no schema: email, cpf, birthDate (data de nascimento)
- [x] Adicionar variáveis faltantes no replaceVariables: {{cpf}}, {{email}}, {{entrada}}, {{data_nascimento}}, {{notas}}
- [x] Adicionar novos campos no fieldMap do wait_input: data_nascimento
- [x] Adicionar novas opções no select do FlowEditor: Data de Nascimento
- [x] Migrar banco com pnpm db:push
- [x] Testes Vitest: 298 testes passando (21 arquivos)

## Melhoria - Upload de Foto e Link wa.me no Vendedor
- [x] Verificar upload de foto no cadastro de vendedores (já funcional: preview, trocar, remover, S3)
- [x] Adicionar opção no nó assign_seller: escolher entre cartão de contato (vCard) OU link wa.me
- [x] Link wa.me com mensagem pré-configurada e personalizável com variáveis ({vendedor}, {loja}, {{veiculo}}, {{troca}}, etc.)
- [x] Atualizar FlowEditor com select de modo (cartão vs link) e campo de template do link
- [x] Atualizar flowEngine para enviar conforme modo escolhido + variável {link} na mensagem ao cliente
- [x] Testes Vitest: 298 testes passando (21 arquivos)

## Melhoria - Editor de Fluxos (UX)
- [x] Copiar e colar nós (Ctrl+C/Ctrl+V + botão de duplicar no painel de propriedades)
- [x] Alterar forma de ativação (trigger type) do fluxo depois de criado (botão "Gatilho" na toolbar)
- [x] Novo nó aparece na viewport atual (centro da tela visível) em vez de ir para o final do fluxo
- [x] Testes Vitest: 298 testes passando (21 arquivos)

## Bug - Variáveis não substituídas nas mensagens do fluxo
- [x] Investigar: ctx.leadData era undefined porque não era carregado do banco no processFlowMessage
- [x] Corrigido: leadData agora é recarregado do banco em 3 pontos: processFlowMessage, executeFromNode e continueFlowAfterAI
- [x] Testes: 298 passando

## Melhoria - Diferenciar Nome WhatsApp vs Nome Completo
- [x] Adicionar campo fullName no schema de leads (nome completo fornecido pelo cliente)
- [x] Manter campo name como nome do WhatsApp (perfil) → {{nome}}
- [x] Criar variável {{nome_completo}} no replaceVariables
- [x] Atualizar fieldMap do wait_input para mapear nome_completo → fullName
- [x] Adicionar opção "Nome Completo" no select do FlowEditor wait_input
- [x] Adicionar fullName no select de condições e nas linkVars do assign_seller
- [x] Notificação ao vendedor agora usa fullName quando disponível
- [x] Migrar banco com pnpm db:push
- [x] Testes Vitest: 298 testes passando (21 arquivos)

## Feature - Nó Apresentação do Veículo (vehicle_presentation)
- [x] Adicionar tipo vehicle_presentation no enum nodeType do schema
- [x] Migrar banco com pnpm db:push
- [x] Backend: getVehicleById retorna todos os campos do veículo
- [x] FlowEngine: handler vehicle_presentation (buscar veículo, substituir 16 variáveis, enviar mensagem + fotos)
- [x] 16 variáveis: {{v_marca}}, {{v_modelo}}, {{v_ano}}, {{v_km}}, {{v_preco}}, {{v_cor}}, {{v_cambio}}, {{v_combustivel}}, {{v_preco_normal}}, {{v_preco_promo}}, {{v_loja}}, {{v_tipo}}, {{v_portas}}, {{v_titulo}}, {{v_versao}}, {{v_descricao}}
- [x] FlowEditor: NODE_TYPES_CONFIG com ícone Car e cor indigo
- [x] FlowEditor: painel VehiclePresentationConfig com tabela de variáveis, mensagem, fotos com legendas e delay
- [x] FlowEditor: preview do nó no canvas
- [x] Testes Vitest: 298 testes passando (21 arquivos)

## Feature - Sistema de Status/Temperatura do Lead + Gatilho de Resgate

### Status/Temperatura do Lead
- [x] Adicionar campo funnelStatus no schema de leads (enum: novo, interesse_definido, pagamento_definido, dados_pessoais, dados_troca, encaminhado_vendedor, negociando, fechado, perdido)
- [x] Adicionar campo temperature no schema de leads (enum: frio, morno, quente, muito_quente)
- [x] Calcular temperatura automaticamente baseado no status (novo=frio, interesse=morno, pagamento/dados=quente, encaminhado/negociando=muito_quente)
- [x] Novo nó update_lead_status no FlowEditor e FlowEngine
- [x] Nó permite selecionar status da etapa do funil
- [x] Temperatura é calculada automaticamente ao mudar status
- [x] Exibir status e temperatura na lista de leads (badges coloridos)
- [x] Exibir status e temperatura na lista de conversas (indicador visual)
- [ ] Filtrar leads por status e temperatura (pendente - pode ser adicionado futuramente)

### Gatilho de Tempo (Resgate de Leads Inativos)
- [x] Criar tabela rescueAttempts no schema (leadId, conversationId, flowId, attemptNumber, sentAt, respondedAt)
- [ ] Job periódico que verifica leads inativos (sem resposta há X minutos)
- [ ] Configuração: tempo de inatividade mínimo (minutos)
- [ ] Configuração: número máximo de tentativas de resgate (1-5)
- [ ] Configuração: intervalo entre tentativas (minutos)
- [ ] Não disparar resgate se lead estiver com status fechado ou perdido
- [ ] Não disparar resgate se conversa estiver resolvida
- [ ] Não disparar resgate se lead estiver atribuído a vendedor (encaminhado_vendedor)
- [ ] Fluxo de resgate com contexto do histórico (variáveis do lead + último assunto)
- [x] Novo trigger type: 'rescue' para fluxos de resgate no schema e FlowEditor
- [ ] Frontend: configuração do gatilho de resgate na página de configurações ou fluxos

### IA Tool - etapa_funil
- [x] Adicionar campo etapa_funil na tool atualizar_lead (enum com 9 etapas)
- [x] Handler da IA processa etapa_funil e calcula temperatura automaticamente
- [x] Prompt comercial atualizado com instruções de etapa_funil por etapa da conversa
- [x] Contexto do lead inclui funnelStatus e temperature para a IA
- [x] Edit dialog de leads permite alterar etapa do funil manualmente
- [x] 316 testes passando (22 arquivos)

## Feature - Gatilho de Tempo (Resgate de Leads Inativos) - Implementação Completa
- [x] Backend: job periódico (setInterval) que verifica leads inativos a cada 2 minutos
- [x] Backend: lógica de detecção de inatividade (última mensagem do cliente > X minutos)
- [x] Backend: respeitar limite de tentativas configurável (1-10)
- [x] Backend: respeitar intervalo entre tentativas (minutos)
- [x] Backend: não disparar se lead fechado/perdido ou conversa resolvida
- [x] Backend: não disparar se lead encaminhado a vendedor
- [x] Backend: executar fluxo de resgate com contexto do lead (variáveis)
- [x] Backend: registrar tentativas na tabela rescueAttempts
- [x] Backend: marcar respondedAt quando cliente responde após resgate
- [x] Settings: configurações de resgate (ativo, tempo inatividade, max tentativas, intervalo, fluxo)
- [x] UI: página dedicada de Resgate com configuração, histórico e variáveis
- [x] UI: seletor de fluxo de resgate (apenas fluxos com trigger rescue)
- [x] UI: toggle ativo/inativo, inputs numéricos para tempos e limites
- [x] FlowEngine: variáveis de contexto do lead no fluxo de resgate (14 variáveis)
- [x] Testes: cobertura do job de resgate e lógica de tentativas (348 testes passando)

## Bug - Gatilho "Resgate" não aparece no Editor de Fluxos
- [x] Corrigir opção "Resgate" no seletor de trigger do FlowEditor e Flows.tsx

## Feature - Nó Apresentar Veículo buscar por ID dinamicamente
- [x] Nó vehicle_presentation deve buscar veículo por ID a cada execução
- [x] Permitir que cliente clique em diferentes anúncios e veja veículos diferentes
- [x] Identificar o ID do veículo do contexto da conversa (anúncio clicado)

## Bug - vehicleInterest não atualiza quando vehicleId é vinculado
- [x] Quando vehicleId é atualizado (via IA ou fluxo), sincronizar vehicleInterest com o título do veículo vinculado
- [x] Quando fluxo inicia por ad_click e extrai vehicleId, atualizar vehicleInterest também

## Feature - Melhorias na Página de Leads
- [x] Etapa do funil ao vivo (badge colorido atualizado em tempo real)
- [x] Resumo da conversa completa (não separado por dia, mas com opção de consultar por dia)
- [x] Botão "Ir para conversa" abre a conversa correspondente do lead
- [x] Filtro por etapa do funil
- [x] Filtro por temperatura do lead
- [x] Exibir se o lead caiu em resgate e quantas vezes foi acionado
- [x] Exibir se o lead foi transferido para vendedor, qual vendedor e data/hora

## Feature - Melhorias no Módulo de Conversas
### Foto do contato nos chats
- [x] Exibir foto do contato na lista de conversas (já implementado)
- [x] Exibir foto do contato no header do chat (já implementado)
- [x] Exibir foto do contato nas mensagens recebidas (já implementado)

### Fotos enviadas pelo agente
- [x] Exibir imagens/fotos enviadas pelo agente dentro da conversa (salvar no banco com mediaUrl)
- [x] Suporte a preview de imagem com lightbox/zoom (já implementado - abre em nova aba)

### Agenda de Contatos
- [x] Schema: tabela contacts (nome, telefone, email, tags, notas, createdAt) + tabela templateSends
- [x] Backend: CRUD de contatos (listar, criar, editar, excluir)
- [x] Backend: importação de contatos por Excel/CSV (bulkImport)
- [x] Frontend: página de Agenda de Contatos com busca e filtros
- [x] Frontend: formulário de adicionar/editar contato
- [x] Frontend: importação por upload de Excel (xlsx)
- [x] Frontend: botão "Enviar template" com seleção de template (individual e em massa)
- [x] Backend: buscar templates aprovados do WhatsApp Business API (já existente)
- [x] Backend: enviar template de marketing para contato(s) (sendTemplate + sendTemplateBulk)
- [x] Frontend: seletor de template com preview e envio em massa

## Bug - Rate exceeded ao acessar site publicado
- [x] Investigar e corrigir erro "Rate exceeded" - adicionado retry com backoff exponencial + página amigável com auto-redirect

## Bug - Variável {{pagamento}} não funciona no fluxo
- [x] Verificado: mapeamento correto (pagamento → paymentMethod). Usuário confirmou que funciona.

## Bug/Feature - Debounce de mensagens para evitar fluxo duplicado
- [x] Debounce já existente no sistema - usuário ajustou o delay nas configurações

## Feature - Auto-sync contatos na agenda
- [x] Auto-sync: quando nova conversa é criada no webhook, criar contato na agenda automaticamente
- [x] Importar contatos existentes via botão "Sincronizar Conversas" na página de Contatos
- [x] Vincular contato à conversa e ao lead (conversationId, leadId)
- [x] Enriquecer contato com dados do lead (nome, email, notas)

## Feature - Melhorar botão copiar lead
- [x] Incluir dados da troca (veículo de troca) no texto copiado
- [x] Incluir dados pessoais completos (cidade, nome completo, CPF, nascimento, email) no texto copiado

## Feature - Módulo de Envio em Massa (substituir Follow-up)
- [x] Remover módulo Follow-up existente (página, router, serviço)
- [x] Schema: tabela campaigns (nome, template, filtros, agendamento, fluxo vinculado, tag)
- [x] Schema: tabela campaignDispatches (campanha, contato, status entrega, data envio)
- [x] Backend: CRUD de campanhas com seleção de contatos (individual/massa/filtros)
- [x] Backend: serviço de disparo em massa via WhatsApp templates aprovados Meta
- [x] Backend: agendamento recorrente (enviar a cada X dias)
- [x] Backend: acionamento de fluxo específico quando cliente responde ao disparo)
- [x] Backend: tag automática nas conversas criadas por disparos
- [x] Frontend: página de Campanhas com criação, edição, listagem
- [x] Frontend: seletor de contatos (checkboxes, selecionar todos, filtros por tag)
- [x] Frontend: seletor de template Meta aprovado
- [x] Frontend: configuração de agendamento recorrente
- [x] Frontend: seletor de fluxo para respostas
- [x] Frontend: histórico de disparos com status de entrega
- [x] Frontend: dashboard com métricas (enviados, entregues, respondidos)

## Feature - Agrupamento Automático de Contatos Duplicados
- [x] Criar função de normalização de telefone (remover formatação, tratar 9 dígito)
- [x] Detectar contatos duplicados por número normalizado
- [x] Merge automático de contatos duplicados (manter dados mais completos)
- [x] Integrar detecção no webhook: agrupar quando cliente manda nova mensagem
- [x] Integrar detecção na criação de contatos (manual e importação)
- [x] Interface: indicador visual de contatos agrupados/duplicados
- [x] Testes vitest para normalização e merge

## Feature - Renomear Auto Inova para Auto Inova - Matriz
- [x] Localizar todas as referências a "Auto Inova" no código
- [x] Atualizar nome da loja no banco de dados (tabela de configurações/vendedores)
- [x] Atualizar referências no código frontend e backend
- [x] Atualizar ficha de vendedor

## Feature - Atualizar Veículo da Troca no Nó Atualizar Lead
- [x] Adicionar campos de veículo da troca no nó Atualizar Lead (frontend)
- [x] Atualizar backend para processar atualização de veículo da troca
- [x] Testar a funcionalidade no editor de fluxos

## Feature - Função {{troca_completa}} no Nó Atualizar Lead
- [x] Implementar função {{troca_completa}} que consolida todos os dados de troca (veículo, ano, km)
- [x] Adicionar opção "Dados da Troca (Consolidado)" no nó Atualizar Lead
- [x] Integrar dados de troca consolidados no botão Copiar Lead para vendedor
- [x] Testar {{troca_completa}} com dados de troca completos

## Feature - Restaurar Seletor de Estado da Conversa
- [x] Restaurar seletor de estado (Aberta, Pendente, Resolvida, Fechada) no ConversationPanel

## Feature - Refatoração de Campanhas (Seleção de Contatos no Módulo de Contatos)
- [x] Refatorar página de Campanhas para apenas parâmetros (remover seletor de contatos)
- [x] Adicionar interface de seleção de contatos no módulo de Contatos
- [x] Adicionar ícone de campanha ativa nos contatos
- [ ] Adicionar histórico de campanhas que o contato participou (TODO: backend)
- [ ] Backend: endpoints para vincular/desvincular contatos de campanhas

## Feature - Seleção de Campanhas para Contatos
- [x] Backend: endpoints para vincular/desvincular contatos de campanhas (addContact, removeContact)
- [x] Frontend: implementar seleção de campanhas no dialog de contatos individuais
- [x] Frontend: implementar seleção em massa de contatos para uma campanha

## Feature - Filtro e Exibição de Campanhas na Lista de Contatos
- [x] Adicionar filtro "Em Campanhas Ativas" no módulo de Contatos
- [x] Exibir nome da campanha na tabela de contatos com badge visível
- [x] Mostrar múltiplas campanhas se contato estiver em mais de uma

## Feature - Integração Evolution API (Multi-Número Vendedores)
- [x] Verificar conexão com Evolution API e listar instâncias
- [x] Schema: tabela evolutionInstances (nome, número, status, vendedor vinculado)
- [x] Schema: tabela evolutionMessages (instância, contato, mensagem, direção, timestamp)
- [x] Backend: CRUD de instâncias (criar, conectar via QR, desconectar, deletar)
- [x] Backend: webhook para receber mensagens da Evolution API
- [x] Backend: envio de mensagens via Evolution API
- [x] Frontend: página de gerenciamento de instâncias com QR code
- [x] Frontend: inbox por vendedor (filtrado por instância)
- [x] Frontend: visão consolidada para gestor (todas as instâncias)
- [ ] Frontend: CRM integrado com ferramentas para vendedores (próxima fase)

## Feature - Painel de Conversa Completo para Vendedores (Evolution Inbox)
- [x] Backend: endpoint para envio de texto via Evolution
- [x] Backend: endpoint para envio de imagem/vídeo/documento via Evolution (upload S3 + envio)
- [x] Backend: endpoint para envio de sticker via Evolution
- [x] Backend: endpoint para envio de áudio via Evolution
- [x] Backend: endpoint para criar nova conversa (iniciar chat com número)
- [x] Backend: endpoint para buscar mensagens de uma conversa com paginação
- [x] Backend: endpoint para salvar/criar contato a partir da conversa
- [x] Backend: buscar foto de perfil do contato via Evolution
- [x] Frontend: reescrever EvolutionInbox com painel completo (lista + chat)
- [x] Frontend: exibir fotos/imagens nas mensagens
- [x] Frontend: exibir stickers nas mensagens
- [x] Frontend: exibir áudios com player
- [x] Frontend: exibir documentos com download
- [x] Frontend: input de mensagem com emoji picker
- [x] Frontend: botão de anexar (foto, vídeo, documento)
- [x] Frontend: botão de sticker
- [x] Frontend: botão de gravar áudio
- [x] Frontend: dialog para iniciar nova conversa
- [x] Frontend: dialog para salvar/criar contato
- [x] Frontend: exibir nome e foto do contato no chat
- [x] Frontend: status de mensagem (enviado, entregue, lido)
- [x] Frontend: scroll automático para última mensagem
- [x] Frontend: indicador de digitando

## Bug Fix - JID @lid Evolution Inbox
- [x] Corrigir parseWebhookMessage para extrair número real quando JID é @lid (linked-device mode)
- [x] Corrigir upsertEvolutionConversation para preservar contactName existente (não sobrescrever com undefined)
- [x] Adicionar getEvolutionConversationById no db.ts
- [x] Corrigir sendMessage para resolver @lid -> @s.whatsapp.net antes de enviar (evitar erro 400)
- [x] Adicionar formatPhone() helper no EvolutionInbox (formata número brasileiro com máscara)
- [x] Adicionar getDisplayName() helper no EvolutionInbox (prioriza contactName, fallback para número formatado)
- [x] Atualizar lista de conversas, header do chat e painel de informações para usar helpers
- [x] Corrigir banco de dados: phone sem @lid, contactName do pushName inbound (SQL UPDATE)

## Feature - Resolução de Número Real @lid Evolution Inbox
- [x] Endpoint backend resolveContactPhone: busca número real via Evolution API /contact/findContacts
- [x] Endpoint backend syncContacts: sincroniza todos os contatos da instância (resolve @lid em lote)
- [x] Endpoint backend updateConversation: suporta atualização de phone + remoteJid
- [x] Frontend: botão "Sincronizar contatos" no header da sidebar (ícone Users)
- [x] Frontend: auto-resolução ao abrir conversa @lid (chamada em background)
- [x] Frontend: botão "Buscar número real" no painel de informações (visível apenas para @lid)
- [x] Frontend: edição manual do telefone no painel de informações (ícone lápis)
- [x] Frontend: número @lid exibido em amarelo com aviso ⚠️ quando não resolvido
- [x] evolutionCheckWhatsAppNumber e evolutionFetchAllContacts adicionados ao evolutionService.ts

## Feature - Lista de Contatos Melhorada
- [x] Aumentar limite da lista de contatos para 1000
- [x] Adicionar filtro de contatos que já participaram de campanhas

## Feature - Vinculação Automática Conversas ↔ Contatos (Estilo Chatwoot)
- [x] Adicionar campo contactId na tabela evolutionConversations
- [x] Auto-criar contato ao receber nova conversa (webhook)
- [x] Mesclar contato se número já existir no módulo de contatos
- [x] Exibir contato vinculado no painel de informações do inbox
- [x] Ao salvar contato manualmente, vincular à conversa e atualizar módulo
- [x] Fundo claro nas conversas (área de mensagens)
- [x] Badge @lid na lista de conversas
- [x] Mostrar nome/número do contato vinculado no header do chat
