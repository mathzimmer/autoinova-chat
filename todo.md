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
