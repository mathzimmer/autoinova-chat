# Manual Oficial de Variáveis, Automações e IA — AutoInova CRM

Este manual é o **documento oficial de referência** sobre o funcionamento unificado de variáveis, parametrização do CRM por IA, motor de fluxos visuais, etiquetas e a base de conhecimento RAG no **AutoInova CRM**.

---

## 📌 1. Dicionário Unificado de Variáveis (Tags do Sistema)

Todas as variáveis abaixo foram **unificadas e harmonizadas** no backend. Isso significa que você pode usar tanto o nome curto quanto o descritivo em qualquer lugar (Agentes de IA, Fluxos Visuais ou Mensagens de Resgate).

| Tag Principal | Aliases Suportados | Origem dos Dados (Banco/CRM) | Exemplo de Valor | Onde Usar |
| :--- | :--- | :--- | :--- | :--- |
| `{{cliente_nome}}` | `{{nome}}`, `{{cliente}}` | `conversations.contactName` / `leads.name` | *Mateus Zimmer* | IA, Fluxos, Resgate |
| `{{nome_completo}}` | - | `leads.fullName` | *Mateus Zimmer de Oliveira* | IA, Fluxos, Resgate |
| `{{cliente_telefone}}` | `{{telefone}}` | `conversations.phone` | *5551999998888* | IA, Fluxos, Resgate |
| `{{vendedor_nome}}` | `{{vendedor}}`, `{{atendente_nome}}`, `{{atendente}}` | Usuário atribuído à conversa (`users.name`) | *João Silva* | IA, Fluxos, Resgate |
| `{{loja_nome}}` | `{{loja}}` | Configuração global `store_name` | *Auto Inova Matriz* | IA, Fluxos, Resgate |
| `{{loja_endereco}}` | - | Configuração global `store_address` | *Av. das Américas, 1000* | IA, Fluxos, Resgate |
| `{{horario_funcionamento}}`| `{{horario}}` | Configuração global `business_hours` | *Seg a Sex, 8h às 18h* | IA, Fluxos, Resgate |
| `{{veiculo_interesse}}` | `{{veiculo}}` | `leads.vehicleInterest` | *Toyota Hilux 2022* | IA, Fluxos, Resgate |
| `{{cidade}}` | - | `leads.city` | *Porto Alegre* | IA, Fluxos, Resgate |
| `{{veiculo_troca}}` | `{{troca}}` | `leads.tradeVehicle` | *VW Gol 1.0 2018* | IA, Fluxos, Resgate |
| `{{troca_completa}}` | - | Consolidado: Modelo, Ano e KM do usado | *Veículo: Gol \| Ano: 2018 \| KM: 60.000* | IA, Fluxos, Resgate |
| `{{forma_pagamento}}` | `{{pagamento}}` | `leads.paymentMethod` | *financiamento* / *a_vista* | IA, Fluxos, Resgate |
| `{{entrada}}` | - | `leads.downPayment` | *R$ 20.000* | IA, Fluxos, Resgate |
| `{{email}}` | - | `leads.email` | *cliente@email.com* | IA, Fluxos, Resgate |
| `{{cpf}}` | - | `leads.cpf` | *123.456.789-00* | IA, Fluxos, Resgate |
| `{{data_nascimento}}` | - | `leads.birthDate` | *15/08/1990* | IA, Fluxos, Resgate |
| `{{etapa_funil}}` | - | `leads.funnelStatus` | *interesse_definido* | IA, Fluxos, Resgate |
| `{{temperatura}}` | - | `leads.temperature` | *quente* / *muito_quente* | IA, Fluxos, Resgate |
| `{{intencao}}` | - | `leads.intention` | *compra* / *troca* / *financiamento* | IA, Fluxos, Resgate |
| `{{notas}}` | - | `leads.notes` | *Cliente quer financiamento sem entrada* | IA, Fluxos, Resgate |
| `{{tentativa_resgate}}` | - | `rescueAttempts.attemptNumber` | *1*, *2*, *3* | Fluxos de Resgate |

---

## ⚙️ 2. Parametrização da IA que Comanda o CRM

Na tela de **Automações ➔ Parametrização CRM** (`http://localhost:3000/automation?tab=crm_ai`), você configura visualmente as regras que a IA executa em tempo real:

### 2.1. Mapeamento de Funil e Temperatura (`temperatureMap`)
A IA move o lead entre as 9 etapas do funil de vendas. Cada etapa calcula a temperatura automaticamente:
- **`novo`** ➔ Etapa inicial de primeiro contato (*Padrão: Frio ❄️*).
- **`interesse_definido`** ➔ Cliente mencionou marca/modelo de interesse (*Padrão: Morno 🌤️*).
- **`pagamento_definido`** ➔ Cliente informou se deseja financiamento, à vista ou troca (*Padrão: Quente 🔥*).
- **`dados_pessoais`** ➔ Cliente forneceu nome, cidade ou CPF (*Padrão: Quente 🔥*).
- **`dados_troca`** ➔ Cliente forneceu detalhes do veículo usado (*Padrão: Quente 🔥*).
- **`encaminhado_vendedor`** ➔ Chat transferido para atendimento humano (*Padrão: Muito Quente 💥*).
- **`negociando`** ➔ Proposta enviada ou em negociação ativa (*Padrão: Muito Quente 💥*).
- **`fechado`** ➔ Venda concluída com sucesso (*Padrão: Muito Quente 💥*).
- **`perdido`** ➔ Desistência ou lead sem perfil (*Padrão: Frio ❄️*).

*Nota: Você pode alterar a temperatura atribuída a qualquer etapa a qualquer momento pelo painel visual!*

### 2.2. Auto-Etiquetagem por Palavra-Chave (`autoTags`)
Você pode criar regras de etiquetas aplicadas **automaticamente** quando o cliente usa certas palavras no WhatsApp:
- Exemplo: Palavra **"financiamento"** ou **"simulação"** ➔ Aplica a etiqueta **`Simulação`**.
- Exemplo: Palavra **"troca"** ou **"usado"** ➔ Aplica a etiqueta **`Com Troca`**.
- Exemplo: Palavra **"visita"** ou **"loja"** ➔ Aplica a etiqueta **`Agendamento`**.

**Efeito em Cadeia:** Quando a IA aplica uma etiqueta automática na conversa:
1. A etiqueta é salva no banco (`conversationLabels`).
2. O painel do operador atualiza na hora via Socket.io.
3. Se houver um Fluxo de Automação configurado com gatilho **"Etiqueta adicionada"**, ele é disparado na hora!

### 2.3. Linha do Tempo & Resumos Automáticos (`timelineLogging`)
- **`logStageChange`**: Escreve um registro no histórico (`activityLogs`) toda vez que a IA avança o funil.
- **`logDataCollected`**: Salva um resumo parcial ao coletar dados relevantes (entrada, cidade, usado).
- **`logOnSellerTransfer`**: Gera uma nota consolidada em `leads.notes` com o resumo do atendimento antes de passar o chat para o vendedor humano.

---

## 🔄 3. Motor de Fluxos Visuais (Flow Engine)

Os fluxos visuais aceitam **condições, gatilhos de CRM e vínculo por instância**:

### 3.1. Vinculação por Instância / Canal
- **Global**: O fluxo vale para qualquer número/conexão do sistema.
- **Instância Específica**: O fluxo é aplicado **exclusivamente** às conversas que entrarem pela instância informada (ex: `vendedor_sp`). Se houver um fluxo específico para a instância, ele tem prioridade sobre o global.

### 3.2. Gatilhos de Disparo
- **`first_contact`**: Dispara no primeiro contato de um novo número.
- **`keyword`**: Dispara se a mensagem contiver palavras-chave cadastradas (separadas por vírgula).
- **`tag_added` / `tag_removed`**: Dispara quando uma etiqueta específica é adicionada ou removida da conversa.
- **`funnel_stage_entered`**: Dispara quando o lead entra em uma etapa do funil (ex: `encaminhado_vendedor`).
- **`ad_click`**: Dispara quando o lead veio de um anúncio com ID de veículo.
- **`rescue`**: Dispara por inatividade (lead sem resposta há mais de X minutos).

### 3.3. Condições "Somente Se" (Grupos E/OU)
Você pode adicionar travas antes de executar o fluxo:
- **Dentro de um grupo (E)**: Todas as condições precisam ser verdadeiras.
- **Entre grupos (OU)**: Basta um dos grupos ser verdadeiro.
- Exemplo: *(Etapa do Funil = `novo` E Temperatura = `quente`)* **OU** *(Canal = `evolution`)*.

---

## 🤖 4. Agentes de IA e Base de Conhecimento (RAG)

### 4.1. Injeção de Variáveis nos Prompts
Na edição do Agente de IA (aba **Agentes de IA**), você pode usar qualquer tag do Dicionário (como `{{cliente_nome}}` ou `{{vendedor_nome}}`). Antes da IA responder ao cliente, o backend substitui todas as tags pelos valores reais daquela conversa.

### 4.2. Base de Conhecimento RAG (FAQ Institucional)
Na aba **Base de Conhecimento**, você cadastra perguntas e respostas frequentes (ex: garantia, localização, formas de pagamento, documentos necessários).
- Quando o cliente envia uma dúvida, o sistema realiza uma busca de termos na Base de Conhecimento.
- As respostas relevantes encontradas são **injetadas automaticamente** no prompt do Agente de IA como contexto adicional (RAG), garantindo respostas padronizadas e precisas.

---

## 🛡️ 5. Prevenção de Conflitos e Regras de Segurança

Para evitar erros e bugs de dados:
1. **Zero Sobregravação de Nomes**: Se o cliente digitar apenas o primeiro nome, o sistema atualiza `name`, mas preserva `fullName` se já tiver sido capturado anteriormente.
2. **Histórico Preservado no Git**: Toda alteração de código ou schema é commitada e sincronizada via GitHub (`feat/unificacao-canais`).
3. **Escrita Dupla e Fallback Seguro**: As conversas possuem fallback automático para o canal correto (Evolution, Zernio ou Matriz) sem perdas de mensagens.
