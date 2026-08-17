# Plano — Coach de Vendas (ao vivo + avaliação + aprendizado)

> Este plano UNIFICA o Copiloto (ajuda ao vivo) com a Avaliação de atendimento. É um
> sistema só, com três camadas: **ajuda ao vivo → nota no fim → aprende com ganho/perdido**.

## Objetivo

Um coach de IA que acompanha o vendedor em três momentos:

1. **AO VIVO** — enquanto atende, lê a conversa e dá **dicas de como evoluir a negociação**
   (responder mais rápido, contornar objeção, sinal de compra → puxar pra loja), além das
   sugestões de resposta que o Copiloto já dá.
2. **NO FIM** — dá uma **nota do atendimento** + **pontos a melhorar**, avaliando início,
   meio e fim contra um padrão configurável.
3. **APRENDE** — quando a conversa é **ganha ou perdida**, ele entende **por quê** ("perdeu
   por isso", "ganhou por aquilo") e guarda a lição, que passa a **melhorar as dicas ao
   vivo** dos próximos atendimentos.

## Como ele "aprende" (sendo honesto)

Ele **não** retreina o modelo sozinho (isso seria caro e arriscado). O que ele faz — e é
eficaz e transparente — é manter uma **base de conhecimento** que cresce:

- Cada conversa ganha/perdida vira uma **lição curta** ("o que funcionou" / "o que evitar").
- Casos de sucesso viram exemplos concretos.
- O coach ao vivo e o Copiloto **consultam essa base** (as lições mais relevantes) e
  injetam no contexto → as dicas passam a refletir **o que já deu certo/errado na SUA loja**.
- Você pode **ver, editar e curar** as lições. Nada é caixa-preta.

Resultado prático: quanto mais atendimentos, melhores as dicas — sem fine-tuning.

## O que JÁ existe (vamos aproveitar, não refazer)

- `server/sellerPerformance.ts` — nota do vendedor em 5 pilares (Conversão, Velocidade,
  **Condução via IA**, Valor, Atividade) + tabela `sellerEvaluations`.
- `server/routers/performance.ts` — `overview`, `evaluate`, `chat` (perguntar à IA sobre
  desempenho), por vendedor e por instância.
- `client/src/pages/Performance.tsx` — painel de desempenho já existente.
- CSAT (`csat.ts`) — satisfação do cliente.

Isso hoje é **agregado por vendedor**. Falta o **nível conversa** e o **padrão**.

## O que FALTA (o que você pediu)

### 1. Padrão de Atendimento configurável (a régua)
Uma rubrica editável nas Configurações (igual ao playbook do copiloto → vira um prompt):
- **Início**: saudação, identificar-se, qualificar (o que procura, pagamento, troca).
- **Meio**: apresentar o veículo certo, tirar dúvidas, contornar objeções, gerar valor.
- **Fim**: CTA claro — **agendar visita/test-drive**, combinar próximo passo, follow-up.
- Critérios de qualidade: objetividade, tempo de resposta, uma pergunta por vez, cordial,
  sem sumir. Guardado em `settings` (`atendimento_rubrica`).

### 2. Avaliação POR CONVERSA (automática)
Quando a conversa **encerra / é ganha / perdida** (ou o handoff termina), a IA avalia
**aquela conversa** contra o padrão e gera:
- Nota por etapa: **início / meio / fim** (0–100) + nota geral.
- **Pontos fortes** e **erros** específicos (com trechos).
- **1–2 dicas** práticas do que fazer melhor.
- Semáforo (verde / amarelo / vermelho).
Guardado em nova tabela `conversationEvaluations` (conversationId, sellerId, notas, json).
Dispara **automático** (job) e sob demanda (botão "Avaliar atendimento").

### 3. Biblioteca de "Casos que deram certo"
A IA analisa conversas de **negócios fechados** e extrai **o que funcionou** (movimentos,
frases, timing, como contornou objeção, como trouxe pra loja). Vira:
- Uma **galeria de boas práticas** para treinar a equipe.
- **Combustível do Copiloto** — as sugestões passam a se basear no que **já fechou** aqui.

### 4. Painel (onde você controla tudo)
- **Scorecard por vendedor** (reusa o que existe) + drill-down nas avaliações por conversa.
- **Lista de atendimentos avaliados** com semáforo + o que faltou em cada um.
- **Feed de coaching por vendedor**: "seus 3 erros mais comuns", "faça mais isso".
- **Casos de sucesso**: exemplos reais do que deu certo.
- **Alertas**: vendedor abaixo do padrão, lead esfriando sem resposta, atendimento
  fora do padrão de início/meio/fim.

## Como funciona por baixo

- **Régua → prompt**: a rubrica configurável é montada num prompt de avaliação.
- **Gatilhos**: ao encerrar/ganhar/perder a conversa + um **job** que varre conversas
  recentes sem avaliação. Modelo barato; roda em lote, fora do horário de pico.
- **Armazenamento**: `conversationEvaluations` (por conversa) alimenta os agregados do
  `sellerPerformance` (o pilar "Condução" passa a usar avaliações reais, não amostragem).
- **Fecha o ciclo**: avalia → aprende (casos de sucesso) → **melhora as sugestões do
  Copiloto** → vendedor atende melhor → avalia de novo.

## Fases de entrega (atualizado para as 3 camadas)

**Fase A — Régua + Coach AO VIVO (dicas) + avaliação por conversa:**
- Configurar o **Padrão** (início/meio/fim + critérios) nas Configurações.
- Na faixa do Copiloto (que já existe), além das respostas, um **modo Coach**: 1–2 dicas
  curtas de negociação em tempo real ("responda rápido — 8 min parado", "ele perguntou
  preço = sinal de compra, puxe a visita", "contorne a objeção da troca").
- **Avaliação por conversa** ao encerrar/ganhar/perder: nota início/meio/fim + fortes +
  erros + dicas, com semáforo. (Migração: tabela `conversationEvaluations`.)

**Fase B — Por que ganhou/perdeu + base de aprendizado:**
Na conversa ganha/perdida, a IA gera o **motivo** ("perdeu por: sumiu 2 dias; não ofereceu
test-drive"). Vira **lição** guardada na base. Feed de "erros recorrentes / faça mais isso"
por vendedor. (Migração: tabela `salesLessons` / casos de sucesso.)

**Fase C — Aprendizado alimenta o AO VIVO:**
O Coach ao vivo e o Copiloto passam a **consultar a base de lições/casos** e refletir o que
já deu certo/errado na loja. Alertas (fora do padrão / lead esfriando).

**Fase D — Metas, ranking, relatórios e curadoria das lições.**

## Rubrica de avaliação (o que ele mede) + dicas ao vivo

Cada critério recebe 0–100. A nota geral é a média **ponderada**. Os mesmos critérios
geram as **dicas ao vivo** (o coach mostra as 1–2 lacunas mais impactantes do momento).

### INÍCIO (peso padrão 25%)
| Critério | Como avalia | Dica ao vivo (exemplo) |
|---|---|---|
| Rapidez da 1ª resposta (SLA) | tempo até responder o lead (dado do banco) | "Responda agora — cliente esperando 11 min" |
| Saudação e cordialidade | cumprimentou, se identificou, tom acolhedor | "Cumprimente e use o nome do cliente" |
| Qualificação | entendeu o que procura, pagamento, se tem troca | "Pergunte a forma de pagamento e se tem troca" |

### MEIO (peso padrão 45%)
| Critério | Como avalia | Dica ao vivo (exemplo) |
|---|---|---|
| Apresentação do veículo | mostrou o carro certo, com info/foto, destacou benefício | "Mande foto e destaque o diferencial do modelo" |
| Contorno de objeções | preço, troca, distância, "vou pensar" | "Contorne o preço: mostre condição/entrada" |
| Ofertas e condições | financiamento, **simular em mais bancos**, entrada | "Ofereça simulação — tente 2–3 bancos" |
| Objetividade e ritmo | 1 pergunta por vez, sem enrolar, sem sumir | "Foque em 1 pergunta; ele já demonstrou interesse" |
| Clareza e português | escreveu bem, sem erros que atrapalham | "Revise: 'concerteza' → 'com certeza'" |
| Cordialidade e tom | educado, empático, não robótico/seco | "Suavize o tom — soou seco" |

### FIM (peso padrão 30%)
| Critério | Como avalia | Dica ao vivo (exemplo) |
|---|---|---|
| CTA / trazer pra loja | puxou visita/test-drive, próximo passo | "Sinal de compra! Proponha test-drive amanhã 10h" |
| Fechamento | criou urgência saudável, combinou data/confirmação | "Feche: sugira reservar o carro e agendar" |
| Follow-up | retomou quem esfriou, não deixou morrer | "Cliente parado 2 dias — mande follow-up leve" |

**Ao vivo**: a cada mensagem nova o coach recalcula esses critérios e mostra só as 1–2
dicas de maior impacto (não despeja tudo). **No fim**: nota por etapa + geral, pontos
fortes, erros com trecho, e — se ganho/perdido — o **porquê**.

## Parametrização (tela em Configurações)

Tudo editável, com padrões sensatos já preenchidos:

- **Texto do padrão** (início / meio / fim) — a descrição que vira o prompt de avaliação.
- **Critérios**: cada um pode ser **ligado/desligado** e ter **peso** ajustável (ex.: se
  não liga pra português, desliga; se conversão importa mais, aumenta o peso do fim).
- **Metas numéricas**: SLA da 1ª resposta (ex.: 5 min), gap máximo sem responder (ex.:
  30 min), nº de bancos esperado na simulação.
- **Tom e idioma** das dicas.
- **Dicas ao vivo ativas**: liga/desliga por tipo (SLA, objeção, financiamento,
  cordialidade, português, CTA, follow-up) e quantas por vez (1 ou 2).
- **Base de lições** (fase B/C): ver, editar e curar o que a IA aprendeu de ganho/perdido.

## Decisões a confirmar antes de construir a Fase A

1. **Dicas ao vivo**: junto na mesma faixa do Copiloto (recomendado) ou num painel à parte?
2. **Quem vê** a nota/dicas: admin vê todos; o **próprio vendedor** vê o dele? (recomendado.)
3. **"Ganho/Perdido"**: uso o `funnelStatus` (ganho/fechado x perdido) como gatilho da
   avaliação final e da lição? (recomendado.)
4. **Disparo da avaliação final**: ao marcar ganho/perdido **ou** ao encerrar a conversa —
   posso usar os dois. Confirmar.
