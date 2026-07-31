# Evals do agente (PR A7)

Contrato de comportamento do agente "Atendente Principal", em vez de "testar no
WhatsApp e torcer".

## Arquivos

- `fixtures.ts` — os cenários do playbook (interesse direto, veículo inexistente,
  ID de anúncio, pechincha, pedido de humano, agendar visita, retorno, LGPD,
  anti-reapresentação, pós-handoff, áudio transcrito...). Cada um diz o que é
  esperado (tools, proibições, avanço de funil, handoff, `semReapresentacao`).
- `assertions.ts` — verificações **puras** de conteúdo (sem markdown, sem oferta de
  desconto, uma pergunta por mensagem, `reapresentouVeiculo`) e de tools
  (esperadas × proibidas).
- `assertions.test.ts` — testes unitários das verificações + sanidade das fixtures.
  Roda no CI junto com `vitest run` (rápido, sem chamar LLM nem banco).
- `vehicleConfirmation.test.ts` — testes da detecção determinística de confirmação
  de veículo (`server/vehicleConfirmation.ts`), o módulo puro extraído do fix do
  bug do "Celta" (cliente dizia "sim" e o agente reapresentava o carro em loop).

## Rodar no CI (o que já roda)

```bash
npx vitest run server/evals/assertions.test.ts
```

Isso valida as verificações e as fixtures — determinístico, sem custo.

## Rodar a avaliação REAL do agente (manual, fora do CI)

A avaliação de aderência ao prompt precisa do modelo de verdade (custo + variância),
então fica **fora** do CI. O esqueleto do runner:

1. Para cada cenário em `EVAL_SCENARIOS`, envie `mensagensCliente` a `processAIMessage`
   usando o agente padrão (Atendente Principal), capturando as tool calls e o texto.
2. Aplique `verificarResposta(texto, cenario.esperado.proibicoes)` e
   `verificarTools(toolsChamadas, esperadas, proibidas)`.
3. Para `deveTransferir`/`etapaFunilMin`, cheque o funil do lead após o cenário.
4. Reporte um resumo (passou/violou) por cenário.

> Observação: como envolve LLM real + banco, rode num ambiente com `DATABASE_URL` e a
> chave da OpenAI configurados, e trate como suíte "sob demanda" (nightly/manual),
> nunca bloqueando o deploy. A parte determinística (assertions) é a que protege o CI.

## Como evoluir

A cada bug de comportamento encontrado no WhatsApp, adicione um cenário em
`fixtures.ts` reproduzindo o caso e o comportamento esperado. Assim a suíte cresce e
vira a rede de segurança do prompt do agente.
