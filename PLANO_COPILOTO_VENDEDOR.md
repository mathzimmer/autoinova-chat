# Plano — Copiloto do Vendedor (sugestões de IA em tempo real)

## Objetivo

Um painel de IA na lateral do chat que **lê a conversa em tempo real** e **sugere ao
vendedor** a melhor resposta e o próximo passo — sempre com foco em **fechar o negócio**
e **trazer o cliente até a loja**. A IA **sugere**, o vendedor **decide** (insere, edita,
envia). Pode ser **ligado/desligado**.

### Princípio central (o que diferencia do agente autônomo)

O agente autônomo (`aiActive`) **responde sozinho**. O copiloto **não envia nada** —
ele só sugere para um **humano** que está conduzindo a conversa. Por isso ele é útil
justamente quando `aiActive` está **desligado** (vendedor no comando). São coisas
independentes e podem coexistir.

## Como funciona (visão de produto)

1. Chega mensagem do cliente → o copiloto lê o contexto e monta:
   - **2–3 sugestões de resposta** (tons diferentes: direto, consultivo, "puxa pra loja").
   - **1 próximo passo** recomendado (ex.: *agendar visita*, *mandar foto do Vectra*,
     *oferecer test-drive*, *coletar dados da troca*).
   - Opcional: um **card de ação** pronto (ex.: botão "Enviar endereço + horário",
     "Mandar 2 opções parecidas de estoque").
2. O vendedor clica em **Usar** → o texto cai no campo de digitação (ele ainda pode
   editar antes de enviar). Ou **Copiar** / **Regenerar**.
3. Tudo isso só acontece se o copiloto estiver **ligado** para aquela conversa.

## Contexto que o copiloto lê (para sugerir bem)

- Últimas ~15 mensagens da conversa.
- Dados do lead: veículo de interesse, forma de pagamento, troca, **score**, etapa do funil.
- **Estoque relevante** (reaproveita a busca que a IA já usa) — pra sugerir carro certo,
  com link/foto quando fizer sentido.
- **Dados da loja**: endereço, horário, como chegar — essencial pro "trazer até a loja".
- **Playbook/persona** do agente "Atendente Principal" (mesmas regras de conduta).

## Ligar/desligar (DECIDIDO)

- Vale para **todas as instâncias** (Zernio / Evolution / oficial / coexistência).
- **Ativação manual por conversa**, com **padrão SEMPRE desativado**. O vendedor liga o
  copiloto só na conversa que quer (botão "Copiloto: ON/OFF" no topo do chat).
- Quando **ligado numa conversa**, as sugestões são **automáticas**: a cada mensagem nova
  do cliente, o painel relê o contexto e atualiza as sugestões sozinho (sem apertar botão).
- Estado guardado por conversa (em `conversation.metadata.copilot = true/false`).

## Parametrização nas Configurações (DECIDIDO)

Uma área nova em **Configurações → "Copiloto do Vendedor"**. Vira **um único prompt** por
baixo, montado a partir de **campos separados** (mais fácil de editar e permite ajustar o
tom sozinho):

- **Tom** — como as sugestões devem soar (ex.: *consultivo, direto, informal de WhatsApp*).
  Pode ser um select com presets + um campo livre.
- **Fluxo de condução da conversa** — os passos que você quer que o vendedor siga
  (ex.: entender necessidade → mostrar carro → contornar objeção → **puxar pra visita**).
- **Sinais de interesse** — o que indica cliente "quente" (ex.: pergunta preço, pede foto,
  fala em financiamento, pergunta endereço).
- **Objeções comuns + como contornar** (ex.: preço, troca, distância, "vou pensar").
- **Objetivo / CTA padrão** — o desfecho que toda sugestão deve empurrar (ex.: *agendar
  visita / trazer à loja*).

Guardado em `settings` (um JSON `copilot_playbook` + `copilot_tom`). Na hora de sugerir,
o `sellerCopilot` **concatena** esses campos + contexto da conversa num **prompt só**.

**Resposta à dúvida "pode ser um prompt só?":** sim — a saída é um prompt único para o
modelo. Só recomendo manter os campos separados **na interface** para facilitar a edição e
o ajuste de tom; o sistema junta tudo antes de enviar.

## Onde encaixa no código (arquitetura)

- **Backend novo**: `server/sellerCopilot.ts`
  - `suggestForConversation(conversationId)` → monta contexto (reusando helpers de
    `ai.ts` e `conversationIntelligence.ts`), chama o modelo e devolve
    `{ suggestions: [{ texto, tom }], proximoPasso, acao?, motivo }`.
  - Modelo **barato e rápido** (Haiku) — é sugestão, precisa ser instantâneo e barato.
- **tRPC**: `copilot.suggest({ conversationId })` (query on-demand) +
  `copilot.setEnabled` (global) + flag por conversa em `conversation.metadata`.
- **Tempo real**: quando entra mensagem nova (o socket/‌debounce que já existe), o painel
  **revalida** as sugestões — sem precisar o vendedor pedir.
- **Frontend novo**: `client/src/components/SellerCopilotPanel.tsx` na lateral do
  `ChatView` (área do `ConversationPanel`). Assina as mensagens, chama `copilot.suggest`,
  renderiza os cards. "Usar" preenche o input do chat (`setNewMessage`).
- **Config**: reaproveita o padrão de `getGlobalStatus` / toggles do `settings`.

## Guarda-corpos (qualidade — reusa a filosofia dos evals A7)

- Nunca inventar veículo/preço; se não tem no estoque, não promete.
- Não oferecer desconto por conta própria (defere ao vendedor).
- Uma pergunta por mensagem; sem markdown; tom de WhatsApp.
- Respeitar LGPD e o playbook.
- **Nunca envia sozinho** — 100% sob controle do vendedor.

## Custo e desempenho

- Só roda com o copiloto **ligado** e o painel **aberto**.
- Modelo Haiku + **debounce** (3–5s) + **cache** da última sugestão por mensagem (não
  regenera à toa).
- Sem impacto em quem não usa.

## Fases de entrega

**Fase A — MVP funcional (o que você pediu):**
- Tela **Configurações → Copiloto do Vendedor** com os campos (tom, fluxo, sinais,
  objeções, objetivo) → montados num prompt único.
- Botão **Copiloto ON/OFF por conversa** (padrão OFF), valendo em todas as instâncias.
- Quando ON: **sugestão automática** a cada mensagem nova do cliente (lê o contexto,
  gera 2–3 respostas + próximo passo). "Usar" joga no input.
- Guarda-corpos básicos + Haiku + debounce + cache.

**Fase B — Ações que fecham/trazem pra loja:**
Cards de ação: "Enviar endereço + horário", "Mandar 2 opções de estoque" (foto/link),
"Propor test-drive / agendar visita". Urgência conforme o **score** do lead.

**Fase C — Aprendizado e medição:**
Feedback (👍/👎) nas sugestões, log de quais foram usadas, ajuste do prompt. Métricas:
taxa de uso, tempo até 1ª resposta, e conversão (visita agendada / negócio fechado)
**com vs sem** copiloto.

## Decisões (RESOLVIDAS)

1. **Canais**: todas as instâncias. ✅
2. **Ativação**: manual por conversa, **padrão desativado**; automática quando ligada. ✅
3. **Parametrização**: área em Configurações, campos separados → **um prompt só**. ✅
4. **Tom**: parametrizável na tela. ✅

### Ainda a definir (pequeno)

- **Quem pode ligar** o copiloto numa conversa: qualquer vendedor ou só admin? (default
  sugerido: qualquer vendedor na própria conversa).
- **Quantas sugestões** por vez: 2 ou 3? (sugestão: 3).
