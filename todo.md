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
