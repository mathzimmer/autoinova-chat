# Análise Completa dos Prompts do Agente de IA — Auto Inova Chat

**Autor:** Manus AI  
**Data:** 07/03/2026

---

## 1. Visão Geral da Arquitetura Atual

O agente de IA opera com uma arquitetura de 4 camadas de prompt, montadas na seguinte ordem:

| Camada | Nome | Editável | Tamanho Aprox. | Função |
|--------|------|----------|----------------|--------|
| 1 | CORE_PROMPT | Sim (DB) | ~2.500 chars | Regras imutáveis de formato, prioridade e integridade |
| 2 | COMMERCIAL_PROMPT | Sim (DB) | ~2.800 chars | Motor comercial: fluxo de venda, busca, qualificação |
| 3 | PERSONALITY_PROMPT | Sim (DB) | ~500 chars | Tom de voz, informações da loja |
| 4 | CONTEXT_BLOCK | Automático | Variável | Dados do lead, nome, telefone, histórico |

Além disso, existe o `DEFAULT_SYSTEM_PROMPT` legado (~4.500 chars) que é uma versão monolítica contendo tudo junto, mantido para compatibilidade com prompts já salvos no banco.

O agente dispõe de 3 ferramentas (tools): `buscar_veiculos`, `resumo_estoque` e `atualizar_lead`.

---

## 2. Problemas Identificados

### 2.1. Mensagem com ID do Veículo: Fluxo Indireto e Frágil

**Problema principal:** Quando o cliente envia uma mensagem como *"Olá, tenho interesse no veículo: Chevrolet Agile 2013 ID9"*, o fluxo atual depende **100% do LLM** para:

1. Reconhecer o padrão "ID9" na mensagem
2. Decidir chamar `atualizar_lead(veiculo_id: 9, veiculo_interesse: "Chevrolet Agile 2013")`
3. Decidir chamar `buscar_veiculos(marca: "chevrolet", modelo: "agile")`

O problema é que o LLM pode falhar em qualquer um desses passos. Ele pode não reconhecer o ID, pode não chamar as duas tools na mesma rodada, ou pode chamar `buscar_veiculos` com parâmetros errados (ex: modelo completo em vez de simplificado).

**Além disso**, a tool `buscar_veiculos` **não aceita busca por ID**. Quando o cliente já tem o ID exato do veículo, o sistema deveria buscar diretamente por esse ID no banco, em vez de fazer uma busca textual por marca/modelo que pode retornar múltiplos resultados ou até nenhum.

> **Impacto:** O cliente que veio de um anúncio (lead quente, pagou para clicar) pode receber uma resposta genérica ou incorreta, desperdiçando o investimento em ads.

### 2.2. Duplicação Massiva de Regras

O `DEFAULT_SYSTEM_PROMPT` legado (linhas 159-254) duplica praticamente todas as regras do CORE + COMMERCIAL. Quando o admin tem um prompt monolítico salvo no banco (chave `ai_prompt`), o sistema usa esse prompt legado como camada de personalidade, resultando em regras duplicadas ou conflitantes com as camadas 1 e 2.

**Resultado:** O prompt final enviado ao LLM pode ter 8.000+ caracteres de regras repetidas, desperdiçando tokens e confundindo o modelo sobre qual versão da regra seguir.

### 2.3. Prompt Muito Longo e Repetitivo

As regras são escritas de forma verbosa com muitos exemplos repetidos. Cada regra é explicada 2-3 vezes de formas diferentes. Isso é contraproducente porque:

- Consome tokens desnecessariamente (custo e latência)
- O LLM tende a "esquecer" regras no meio de prompts muito longos (efeito "lost in the middle")
- Regras conflitantes entre si criam ambiguidade

### 2.4. Falta de Priorização Clara das Ações

O prompt lista muitas regras sem uma hierarquia clara de prioridade. Quando o cliente envia "Olá, tenho interesse no Chevrolet Agile 2013 ID9", o LLM precisa decidir entre:

- Cumprimentar o cliente
- Chamar `atualizar_lead`
- Chamar `buscar_veiculos`
- Responder sobre o veículo

Não há uma instrução clara tipo: **"Se a mensagem contém IDX, sua PRIMEIRA ação OBRIGATÓRIA é..."**

### 2.5. Contexto do Lead Marcado como "Desatualizado"

O bloco de contexto marca os dados do lead como "ANTIGO, pode ter mudado" e "DESATUALIZADAS". Embora isso seja útil para evitar que o LLM ignore mudanças do cliente, o tom excessivamente cauteloso pode fazer o LLM ignorar dados válidos e perguntar novamente informações que já foram coletadas.

### 2.6. Ausência de Tool para Buscar Veículo por ID

Não existe uma ferramenta `buscar_veiculo_por_id` que aceite o ID direto. Quando o cliente vem de um anúncio com ID, o sistema precisa:

1. Extrair marca/modelo da mensagem (pode falhar)
2. Buscar textualmente (pode retornar múltiplos ou nenhum)
3. Esperar que o LLM vincule o ID correto

Deveria simplesmente buscar `WHERE id = X` e retornar o veículo exato.

### 2.7. Falta de Pré-processamento de Mensagens com ID

O código não faz nenhum pré-processamento antes de enviar ao LLM. Quando detecta um ID na mensagem, poderia já buscar o veículo no banco e injetar os dados no contexto, eliminando a dependência do LLM para fazer a busca.

---

## 3. Melhorias Sugeridas

### 3.1. Criar Busca Direta por ID (Pré-processamento)

**Prioridade: ALTA**

Antes de enviar a mensagem ao LLM, detectar padrões `ID\d+` ou `(Ref: \d+)` na mensagem do cliente. Se encontrar, buscar o veículo diretamente no banco e injetar os dados no contexto:

```
[VEÍCULO DO ANÚNCIO - ID:9]
Chevrolet Agile LTZ 1.4 - 2013 - Branco - 85.000 km - Manual - R$ 35.990
Link: https://autoinovars.com.br/carros/agile-ltz
```

Isso elimina a necessidade do LLM chamar `buscar_veiculos` e garante que o veículo correto seja apresentado.

### 3.2. Adicionar Tool `buscar_veiculo_por_id`

**Prioridade: ALTA**

Criar uma nova tool que aceita um ID e retorna os dados completos do veículo. Isso serve como fallback caso o pré-processamento falhe e o LLM precise buscar manualmente.

### 3.3. Condensar e Deduplicar Prompts

**Prioridade: MÉDIA**

Reescrever os prompts de forma mais concisa, eliminando duplicações. Cada regra deve aparecer UMA vez, de forma clara e direta. O prompt total (sem contexto) deveria ter no máximo 2.000-2.500 chars em vez dos atuais 5.800+.

### 3.4. Adicionar Hierarquia de Prioridade

**Prioridade: MÉDIA**

Adicionar ao COMMERCIAL_PROMPT uma seção de prioridade de ações:

```
PRIORIDADE DE AÇÕES (execute na ordem):
1. Se mensagem contém IDX → apresentar veículo do anúncio imediatamente
2. Se mensagem pede veículo específico → buscar_veiculos
3. Se mensagem traz dados novos → atualizar_lead
4. Se mensagem é qualificação → seguir fluxo comercial
```

### 3.5. Melhorar o Contexto do Lead

**Prioridade: BAIXA**

Em vez de marcar tudo como "DESATUALIZADO", usar uma abordagem mais inteligente:

- Dados coletados há menos de 24h: apresentar como "Dados recentes"
- Dados coletados há mais de 7 dias: apresentar como "Dados anteriores (verificar se ainda válidos)"
- Sempre manter a regra de que a mensagem atual tem prioridade

### 3.6. Eliminar o Prompt Legado

**Prioridade: BAIXA**

Migrar qualquer prompt monolítico salvo no banco para o formato de 3 camadas, e remover o `DEFAULT_SYSTEM_PROMPT` legado para evitar confusão.

---

## 4. Resumo das Melhorias por Impacto

| Melhoria | Impacto | Esforço | Prioridade |
|----------|---------|---------|------------|
| Pré-processamento de ID na mensagem | Alto | Médio | ALTA |
| Tool `buscar_veiculo_por_id` | Alto | Baixo | ALTA |
| Condensar prompts (remover duplicação) | Médio | Médio | MÉDIA |
| Hierarquia de prioridade de ações | Médio | Baixo | MÉDIA |
| Melhorar contexto do lead | Baixo | Baixo | BAIXA |
| Eliminar prompt legado | Baixo | Médio | BAIXA |

---

## 5. Implementação Recomendada

A implementação mais impactante é o **pré-processamento de mensagens com ID**. Quando o cliente envia "Olá, tenho interesse no veículo: Chevrolet Agile 2013 ID9", o sistema deve:

1. **Antes de chamar o LLM**: detectar `ID9` na mensagem
2. **Buscar no banco**: `SELECT * FROM vehicles WHERE id = 9 AND available = true`
3. **Se encontrar**: injetar no contexto como `[VEÍCULO DO ANÚNCIO]` com todos os dados
4. **Adicionar instrução ao LLM**: "O cliente veio de um anúncio. Apresente o veículo abaixo e pergunte se deseja agendar visita ou saber mais."
5. **Chamar `atualizar_lead`** automaticamente com `veiculo_id: 9` (sem depender do LLM)

Isso reduz de 3-4 chamadas LLM para 1, economiza tokens, e garante que o cliente receba a informação correta na primeira resposta.
