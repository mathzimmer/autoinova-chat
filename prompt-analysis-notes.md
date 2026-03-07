# Notas de Análise dos Prompts - Rodada 58

## CORE_PROMPT atual: ~2100 chars, 8 regras
- Regra 1 (formato): 6 linhas → pode ser 3
- Regra 2 (prioridade): 6 linhas com exemplos → pode ser 3 com 1 exemplo
- Regra 3 (numérico): 3 linhas → pode ser 2
- Regra 4 (lead update): 6 linhas → pode ser 3
- Regra 5 (imagens): 6 linhas → pode ser 3
- Regra 6 (limpeza): 2 linhas → pode ser 1
- Regra 7 (inventar): 8 linhas → pode ser 4
- Regra 8 (áudio): 2 linhas → pode ser 1
Meta: reduzir de ~2100 para ~1200 chars

## COMMERCIAL_PROMPT atual: ~2600 chars
- Prioridade de ações: ok
- Anúncios: ok
- Busca: 5 linhas → ok
- Simplificação: 8 linhas → pode ser 4
- Paginação: 3 linhas → ok
- Filtros: 16 linhas → pode ser 8
- Qualificação: 5 linhas genéricas → PRECISA virar motor de etapas
Meta: transformar em motor de etapas/cenários

## O que o usuário quer:
1. Processo baseado em ETAPAS da conversa
2. Cenários: se cliente pedir X, responda Y
3. Se identificar interesse, continue pedindo troca
4. Fluxo robusto: interesse → troca → pagamento → agendamento
5. Migração automática de prompts legados

## Plano de etapas do motor comercial:
ETAPA 1 - PRIMEIRO CONTATO: Cumprimentar, identificar interesse
ETAPA 2 - APRESENTAÇÃO: Buscar e apresentar veículo(s)
ETAPA 3 - QUALIFICAÇÃO: Perguntar sobre troca, financiamento
ETAPA 4 - NEGOCIAÇÃO: Detalhes de pagamento, entrada
ETAPA 5 - FECHAMENTO: Agendar visita, transferir para vendedor
