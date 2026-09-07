# Agente Vendedor v2 — Blueprint definitivo (Auto Inova)

> Desenho "do zero" aproveitando TUDO que já foi construído no roadmap.
> Princípio central: **o fluxo conduz, a IA conversa**. A jornada é determinística;
> a linguagem é livre. A IA nunca inventa pergunta de processo e nunca chama API direto.

---

## 1. O que já existe hoje (base real, pós-roadmap)

| Peça | Estado |
|---|---|
| Flow Engine com 23 tipos de nó (`classify_intent`, `vehicle_discovery`, `vehicle_presentation`, `confirm_interest`, `send_vehicle_photos`, `collect_sequence`, `assign_seller`, `business_hours`, `send_buttons/list`…) | ✅ pronto |
| Agente de IA com 8 tools (`buscar_veiculos`, `apresentar_veiculo`, `enviar_botoes`, `transferir_para_vendedor`…) | ✅ pronto |
| Anti-reapresentação + confirmação determinística de veículo | ✅ pronto |
| TTL de sessão (A6), debounce de mensagens, evals de regressão (A7), flowEvents (observabilidade) | ✅ pronto |
| Motor de reengajamento v2 | ✅ pronto |
| Agendamento de visita (tabela, nó, tool, lembretes) | ❌ **não existe** |
| Envio de vídeo do veículo (`send_video`) | ❌ não existe |
| Memória resumida entre sessões (cliente que volta depois de dias) | ⚠️ parcial (lead canônico existe; resumo não é injetado) |

---

## 2. Arquitetura recomendada — "1 fluxo-mestre + 1 agente + memória de slots"

```
Mensagem (qualquer instância)
        │
        ▼
┌─────────────────────┐
│ 1. PORTEIRO         │  debounce + TTL + horário comercial + aiActive
│    (já existe)      │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 2. CLASSIFICADOR    │  classify_intent (NLU): compra | financiamento | troca |
│    (já existe)      │  pos_venda | duvida | agendamento | humano
└─────────┬───────────┘
          ▼
┌─────────────────────────────────────────────┐
│ 3. MÁQUINA DE ESTADOS (fluxo-mestre)        │
│    Estados: SAUDACAO → DESCOBERTA →         │
│    APRESENTACAO → MIDIA → PAGAMENTO →       │
│    COLETA → AGENDAMENTO → HANDOFF           │
│    Cada estado sabe: o que perguntar, o que │
│    já tem (slots), para onde ir.            │
└─────────┬───────────────────────────────────┘
          ▼
┌─────────────────────────────────────────────┐
│ 4. AGENTE VENDEDOR (LLM + tools)            │
│    Só é chamado DENTRO dos estados, para:   │
│    - entender linguagem natural             │
│    - buscar/apresentar veículos (tools)     │
│    - tirar dúvidas técnicas do estoque      │
│    Nunca decide a jornada.                  │
└─────────┬───────────────────────────────────┘
          ▼
┌─────────────────────┐
│ 5. MEMÓRIA (slots)  │  flowSession.context + lead canônico
└─────────────────────┘
```

### Por que NÃO "um agente que decide tudo sozinho"
Agente livre = imprevisível (foi o que gerou os loops do Celta). A melhor prática atual em
atendimento comercial é **state machine + LLM por estado** (modelo LangGraph): cada estado tem
prompt pequeno, tools limitadas e saída estruturada. Você edita a jornada no editor visual
sem tocar em prompt.

---

## 3. A memória de slots (o fim do "perguntar de novo")

Cada conversa carrega um objeto de slots persistido em `flowSession.context.slots`
+ espelhado no lead canônico:

```json
{
  "nome": "Matheus",
  "veiculoInteresse": { "id": 116, "titulo": "Chevrolet Celta 2012", "preco": 34990 },
  "veiculosApresentados": [116, 98, 44],
  "faixaPreco": 50000,
  "pagamento": "financiamento",        // a_vista | financiamento | troca
  "financiamento": { "entrada": 10000, "prazo": 48, "cpf": "..." },
  "troca": { "modelo": "...", "ano": "...", "km": "...", "fotos": true },
  "agendamento": { "data": "2026-09-08", "hora": "14:00", "confirmado": true },
  "etapa": "AGENDAMENTO"
}
```

**Regras duras (as lições dos bugs reais):**
1. Antes de perguntar qualquer coisa, o estado checa o slot — preenchido = nunca pergunta de novo.
2. Veículo já apresentado nunca é reapresentado (já existe; manter).
3. "Sim" após apresentação = avança para PAGAMENTO, não re-busca (já existe; manter).
4. Cliente muda de assunto no meio de uma coleta → responde a dúvida (IA), volta para a coleta
   de onde parou ("E sobre a entrada, consegue me dizer?"), sem perder o que já coletou.
5. Cliente volta depois de dias → nova sessão, mas o **resumo do lead** é injetado:
   "Matheus, da última vez você olhou o Celta 2012 (R$ 34.990). Quer continuar de onde parou?"

---

## 4. A conversa perfeita (roteiro de referência)

```
Cliente: oi
Bot: Olá! 👋 Aqui é da Auto Inova. Procura um carro pra compra, quer financiar,
     tem veículo na troca ou precisa da oficina?            [send_buttons]

Cliente: quero um carro até 50 mil
→ classify_intent: compra | slot faixaPreco=50000
Bot: [tool buscar_veiculos] Achei estas opções até R$ 50.000: ... [vehicle_presentation]

Cliente: tem um celta?
Bot: Temos sim! Chevrolet Celta 2012, prata, R$ 34.990. Quer ver as fotos?  [apresentar_veiculo]

Cliente: quero
→ confirm_interest (determinístico) → send_vehicle_photos (4 fotos)
Bot: (fotos) Quer ver um vídeo dele ou já te passo as condições de pagamento?  [send_buttons]

Cliente: condições
Bot: À vista ou financiado?                                        [send_buttons]

Cliente: financiado
→ collect_sequence (entrada → prazo → CPF) — cada resposta preenche o slot
Bot: Perfeito! Qual valor de entrada você pensa em dar?

Cliente: 10 mil
Bot: E o prazo, 36, 48 ou 60 meses?

Cliente: 48
Bot: Última coisa: seu CPF (só os números) para eu simular.

Cliente: 00011122233
Bot: Pronto! Vou te passar para o nosso vendedor com a simulação.
     Prefere fechar por aqui ou já agendar uma visita para ver o Celta?  [send_buttons]

Cliente: agendar
→ AGENDAMENTO (NOVO): agenda da loja → slots livres → confirmação
Bot: Temos sábado às 9h, 10h30 ou 14h. Qual fica melhor?

Cliente: 10h30
Bot: Agendado! ✅ Sábado, 07/09 às 10h30, Auto Inova (endereço).
     Vou te lembrar na véspera. O vendedor X já está com sua simulação. 🚗

→ assign_seller + notify_number + funil=visita_agendada + IA pausada
```

---

## 5. Agendamento de visita (a peça que falta — desenho novo)

### Banco (migration nova)
```sql
CREATE TABLE "appointments" (
  id serial PRIMARY KEY,
  "conversationId" integer NOT NULL,
  "leadId" integer,
  "vehicleId" integer,
  "sellerId" integer,
  date date NOT NULL,
  "timeSlot" varchar(5) NOT NULL,           -- "09:00"
  status varchar(20) DEFAULT 'scheduled',   -- scheduled|confirmed|done|no_show|canceled
  "reminderSentAt" timestamp,
  "createdAt" timestamp DEFAULT now()
);
```

### Configuração (settings, editável no admin)
`business_schedule`: dias da semana × faixas (ex.: seg-sex 09:00-18:00, sáb 09:00-12:00),
duração do slot (30/60 min), agendamentos simultâneos por slot (ex.: 2).

### Nó novo `schedule_visit` (Flow Engine)
1. Lê `business_schedule` + conta ocupados em `appointments` → oferece 3-5 horários livres
   (sempre os próximos dias úteis) via `send_buttons`/`send_list`.
2. Cliente escolhe → grava `appointments` + slot `agendamento`.
3. Confirma com texto parametrizável + endereço da loja.
4. Job existente (mesmo scheduler do reengajamento) manda **lembrete D-1 e H-2**.
5. No-show → status `no_show` + notifica vendedor (reativa reengajamento).

### Tool do agente `agendar_visita` (para quando o cliente pede fora do fluxo)
`{ data?: string, periodo?: "manha"|"tarde" }` → retorna horários livres;
a confirmação final SEMPRE passa pelo nó determinístico (a IA propõe, o fluxo confirma).

---

## 6. Handoff para o vendedor (já existe — consolidar regras)

Gatilhos de handoff (qualquer um):
- cliente pede humano explicitamente;
- financiamento coletado completo (entrada+prazo+CPF);
- visita agendada;
- negociação de preço ("faz por menos?");
- 2 falhas consecutivas de entendimento.

Ao transferir (já implementado em `assign_seller`): resumo estruturado dos slots no
`notify_number`/notificação — o vendedor recebe nome, veículo, pagamento, entrada, prazo,
agendamento — sem precisar ler a conversa. IA pausa na conversa (`aiActive=false`).

---

## 7. Controles (painel, sem mexer em código)

| Controle | Onde |
|---|---|
| Prompt/personalidade do agente | cadastro do agente (já existe) |
| Tools ligadas por agente | `enabledTools` (já existe) |
| Jornada completa | editor visual de fluxo (já existe) |
| Textos de apresentação/fotos | config dos nós (já existe) |
| Horário de funcionamento + agenda de visitas | settings (agenda = NOVO) |
| Ligar/desligar IA por conexão e por conversa | já existe (`aiAuto`, `aiActive`) |
| Auditoria de decisões | flowEvents (já existe) |

---

## 8. Plano de implantação (o que falta, em ordem)

**Onda A — Agendamento (o gap principal):**
1. Migration `appointments` + settings `business_schedule`
2. Nó `schedule_visit` no engine + editor
3. Tool `agendar_visita` no agente
4. Job de lembrete D-1/H-2 + status no-show

**Onda B — Memória entre sessões:**
5. Resumo do lead injetado na saudação de sessão nova (usa `lead.notes`/slots do lead canônico)

**Onda C — Mídia rica:**
6. Nó/tool `send_video` (campo `videoUrl` no veículo)

**Onda D — Regressão:**
7. Evals novos: agendamento completo, volta após 7 dias, mudança de assunto no meio da coleta

Ondas A+B já entregam o "vendedor virtual" completo: descobre, apresenta, manda fotos,
coleta financiamento/troca, agenda visita e transfere com resumo — sem se perder e sem
repetir pergunta.
