# Fluxo-Mestre Auto Inova — "Vendedor Virtual" (nó a nó, pronto para montar)

Filosofia: o **fluxo garante a jornada**, a **IA entende e fala**. Perguntas
obrigatórias ficam em `collect_sequence` (a IA não pula etapa); dúvidas fora do
script são respondidas pela IA **dentro** do nó, sem sair do fluxo.

Gatilho recomendado: `first_contact` (1ª mensagem) — vinculado à conexão do
número principal (matriz, oficial ou instância Evolution, agora com gatilho ativo).

---

## MAPA GERAL

```
START
  └─► [1] business_hours
        ├─ DENTRO  → [2] classify_intent
        └─ FORA    → [20] msg fora de expediente → [21] collect_with_ai → [22] assign_seller → END

[2] classify_intent (NLU — não pergunta, lê a 1ª mensagem)
  ├─ COMPRA / veículo      → [3]
  ├─ FINANCIAMENTO         → [10]
  ├─ TROCA                 → [13]
  ├─ PÓS-VENDA             → [17]
  ├─ INFORMAÇÃO / DÚVIDA   → [18]
  └─ (sem match)           → [19] IA Recepção (discovery)
```

---

## RAMO COMPRA (o caminho principal)

| # | Nó | Tipo | Configuração |
|---|----|------|--------------|
| 3 | Confirmar interesse | `confirm_interest` | Se o lead JÁ tem veículo (veio de anúncio/retorno): "Vi que você tinha interesse no {{veiculo}}. Quer seguir com esse ou ver outras opções?" → botões: **Seguir com esse** (vai p/ 5) / **Ver outras** (vai p/ 4). Sem interesse prévio → cai direto no 4. |
| 4 | Apresentar veículos | `vehicle_discovery` | Agente: **Recepção**. Tools: `buscar_veiculos`, `apresentar_veiculo`, `buscar_veiculo_por_id`, `atualizar_lead`, `enviar_botoes`. Instrução: "Você é o vendedor virtual da Auto Inova. Descubra o que o cliente quer (tipo, marca, faixa de preço) com NO MÁXIMO 2 perguntas. Apresente até 3 veículos com foto. NUNCA reapresente um veículo já mostrado. Quando o cliente demonstrar preferência clara por UM veículo, confirme e avance." |
| 5 | Apresentação completa | `vehicle_presentation` | Veículo escolhido: ficha completa (ano, km, câmbio, preço, link). |
| 6 | Fotos | `send_vehicle_photos` | Envia as fotos com legenda. Texto fixo parametrizável: "Olha essas fotos do {{veiculo}} 📸 Quer que eu te mande um vídeo dele também?" |
| 7 | Forma de pagamento | `send_buttons` | "O {{veiculo}} está por {{preco}}. Como você pretende pagar?" Botões: **Financiamento** → [8] · **Tenho troca** → [13] · **À vista** → [9] |
| 8 | Sequência financiamento | `collect_sequence` | Perguntas fixas, nesta ordem: 1) `entrada` — "Qual valor de entrada você consegue dar? 💰" 2) `prazo` — "Em quantas parcelas? (12, 24, 36, 48...)" 3) `cpf` — "Pra simular, me passa seu CPF (pode ser com pontos)". Validação automática; se inválido, repete a pergunta. |
| 9 | Marcar etapa quente | `update_lead_status` | funnelStatus: `pagamento_definido` (à vista) ou `dados_pessoais` (pós-sequência) |
| 10→ | (financiamento direto) | — | Se a intenção JÁ era financiamento: primeiro passa pelo [4] (precisa saber o carro), depois [8]. |
| 11 | Handoff | `assign_seller` | Loja: `auto` (detecta pelo veículo). Notifica vendedor com resumo completo. |
| 12 | Despedida | `send_message` | "Pronto, {{nome}}! ✅ Já passei tudo para o {{vendedor}} da {{loja}}. Ele vai te chamar aqui mesmo em instantes com a simulação. Qualquer coisa, é só mandar mensagem!" → `end` |

## RAMO TROCA

| # | Nó | Tipo | Configuração |
|---|----|------|--------------|
| 13 | Sequência troca | `collect_sequence` | 1) `troca_modelo` — "Qual o modelo do seu carro atual? 🚗" 2) `troca_ano` — "Que ano ele é?" 3) `troca_km` — "Quantos km rodados?" 4) `troca_fotos` — "Consegue me mandar umas fotos dele? (frente, traseira e painel)" — fotos chegam como mídia e ficam na conversa. |
| 14 | Pagamento complementar | `send_buttons` | "Anotado! E a diferença, como pretende pagar?" **Financiamento** → [8] · **À vista** → [9] |
| 15 | Etapa | `update_lead_status` | `dados_troca` |
| 16 | Handoff | `assign_seller` | → [12] despedida |

## RAMO PÓS-VENDA

| # | Nó | Tipo | Configuração |
|---|----|------|--------------|
| 17 | Avisar pós-venda | `notify_number` | Número fixo do pós-venda. Manda nome, telefone, veículo comprado (se houver) e a dúvida. Cliente recebe: "Já chamei nossa equipe de pós-venda pra te ajudar! 👍" → `end` |

## RAMO INFORMAÇÃO / DÚVIDA / FALLBACK

| # | Nó | Tipo | Configuração |
|---|----|------|--------------|
| 18 | IA Recepção (FAQ) | `ai_response` | Agente: **Recepção**. Responde dúvidas gerais (horário, endereço, garantia, formas de pagamento) usando a base de conhecimento. SEM tools de veículo. |
| 19 | Reenquadrar | `send_buttons` | "Posso te ajudar com mais alguma coisa?" **Ver veículos** → [4] · **Falar com vendedor** → [11] · **Só isso, obrigado** → `end` |

## RAMO FORA DE EXPEDIENTE

| # | Nó | Tipo | Configuração |
|---|----|------|--------------|
| 20 | Aviso | `send_message` | "Olá! Nosso horário de atendimento é seg-sex 8h30-18h30 e sáb 8h30-12h30. Mas já vou adiantar seu atendimento! 🚗" |
| 21 | Coleta leve | `collect_with_ai` | Coleta: `nome`, `veiculo_interesse`, `pagamento`. Insiste no máx 2x por campo. |
| 22 | Handoff agendado | `assign_seller` | Vendedor recebe o lead qualificado na manhã seguinte → [12] |

---

## AGENTES NECESSÁRIOS (configurar uma vez)

| Agente | Tools habilitadas | Papel |
|---|---|---|
| **Recepção** | buscar_veiculos, apresentar_veiculo, buscar_veiculo_por_id, atualizar_lead, enviar_botoes, enviar_lista, transferir_para_vendedor | Vende, apresenta, coleta, reenquadra |
| **Financeiro** | atualizar_lead | Só usado se quiser um nó de simulação com IA (opcional — o collect_sequence já resolve) |
| **Pós-venda** | (nenhuma) | Relacionamento; handoff rápido |

Regras transversais já no motor (não configurar de novo): anti-reapresentação,
confirmação determinística após escolha, TTL de sessão 24h, temperatura/etapa
automáticas, LGPD (consentimento no 1º contato).

---

## NÓS QUE SUGIRO CRIAR (roadmap de produto)

1. **`send_video`** — cliente pede vídeo do carro com frequência; hoje só temos
   `send_image`/`send_vehicle_photos`. (effort: baixo — espelha send_image)
2. **`schedule_visit`** — agendar visita/test-drive com data: coleta dia/hora,
   valida horário e notifica vendedor. Hoje dá pra improvisar com
   collect_sequence + notify, mas merece nó próprio. (médio)
3. **`http_request`** — chamar API externa (ex.: simulador real de financiamento,
   consulta de score). Destrava integrações sem deploy. (médio)
4. **`set_label`** — etiquetar a conversa automaticamente (ex.: "campaanha-x",
   "prioridade") para relatórios. (baixo)
5. **`branch_by_lead_field`** — condição pronta por campo do lead (tem troca?
   crédito aprovado?) sem escrever expressão. (baixo)

Prioridade real pro seu caso: **1 (send_video)** e **2 (schedule_visit)**.
