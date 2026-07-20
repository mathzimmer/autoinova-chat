# Manual do AutoInova CRM

Guia completo da lógica e das funções do sistema.

---

## 1. Os conceitos que sustentam tudo

Antes das telas, entenda os cinco conceitos. Quase toda dúvida se resolve sabendo qual deles está em jogo.

### Instância (número)
Cada número de WhatsApp é uma **instância** e vira uma **aba própria** no inbox. Existem três tipos:

- **Matriz (oficial)** — o número principal, via API oficial da Meta.
- **Zernio (coexistência)** — números que usam o WhatsApp normal no celular e a API ao mesmo tempo (ex.: bianca, deivid). Cada conta Zernio tem seu `accountId`, sua API key e seu webhook secret.
- **Evolution** — números conectados por QR Code.

### Conversa
É o diálogo em **um** número. A mesma pessoa falando com a bianca e com o deivid gera **duas conversas** — mas continua sendo **um lead só**.

### Lead (a pessoa)
Identificado pelo **telefone**. Criado no primeiro contato, em qualquer número. Nunca duplica: se a pessoa fala em vários números, tudo se junta na mesma ficha.

### Oportunidade (o ciclo)
Cada tentativa de venda. Um lead pode ter várias ao longo do tempo — comprou em janeiro, voltou em julho. É isso que permite medir sem perder histórico.

### Atendente x Dono
- **Atendente da conversa** — quem está com aquela conversa agora (define o filtro "Minhas").
- **Dono da instância** — o vendedor "dono" daquele número (define o que ele enxerga).
- **Dono do lead** — o vendedor responsável pela pessoa, definido na transferência.

---

## 2. O ciclo de vida do lead

```
1º contato ──> cria LEAD + abre OPORTUNIDADE
                      │
                      ▼
        avança no funil (Novo → Interesse → Pagamento → Negociando)
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   FECHADO (venda)            PERDIDO
   oportunidade "ganha"    oportunidade "perdida"
        └─────────────┬─────────────┘
                      ▼
        cliente volta a falar (semanas/meses depois)
                      │
                      ▼
              REATIVAÇÃO automática
   • fecha o ciclo anterior no histórico
   • abre uma OPORTUNIDADE NOVA
   • funil volta para "Novo", temperatura "Morno"
   • zera o crédito (banco reavalia)
   • soma +1 no contador de reativações
```

**Não gera lead duplicado.** A ficha é a mesma; o que muda é o ciclo.

**Encerramento automático:** lead sem resposta do cliente por **14 dias** (ajustável) e que ainda não foi finalizado é marcado como **perdido** automaticamente. Isso mantém o funil limpo e garante que, se a pessoa voltar, o sistema abra um ciclo novo em vez de continuar num antigo travado.

---

## 3. O funil

| Etapa | Quando acontece |
|---|---|
| **Novo** | Chegou, ainda não demonstrou interesse claro |
| **Interesse Definido** | Definiu um veículo específico |
| **Pagamento Definido** | Falou como vai pagar (à vista, financiamento, entrada) |
| **Dados Pessoais** | Forneceu nome completo, CPF etc. |
| **Dados de Troca** | Informou o veículo que vai dar na troca |
| **Encaminhado** | Transferido para um vendedor |
| **Negociando** | Discutindo proposta e condições finais |
| **Fechado** | Venda concretizada (**sempre manual**) |
| **Perdido** | Não vai comprar (manual ou automático por inatividade) |

A **IA avança o funil sozinha** até o teto configurado (padrão "Negociando"). Ela **nunca** marca venda — isso é sempre do vendedor.

---

## 4. Qualidade do lead — o que ensina os anúncios

Este é o ponto mais estratégico do sistema.

A Meta **não sabe** quem é bom cliente. Ela só aprende com o que o CRM reporta. Se você reportar como "ótimo" um lead sem crédito, ela vai buscar mais gente sem crédito.

Por isso existe a **qualidade do lead**, com três fontes em ordem de prioridade:

**1. Vendedor (manda mais que tudo)** — botões no lead:
- **👍 Cliente bom** = "quero mais clientes assim" → dispara o sinal forte para a Meta, mesmo sem crédito
- **👎 Cliente ruim** → bloqueia os sinais profundos
- **🏪 Visitou a loja** → sinal muito forte de intenção real

**2. Crédito** — aprovado conta como bom, negado como ruim. Mas se o vendedor julgou manualmente, a opinião dele vence.

**3. IA** — lê a conversa procurando sinais concretos: visita/test-drive, troca com valor real, entrada, pagamento à vista, negociação de condições. Do lado ruim: crédito negado, restrição, só pesquisando preço, revenda/concorrente. Ela só preenche se o vendedor ainda não julgou, e prefere não opinar a errar.

### O que vai para a Meta

| Momento | Evento enviado |
|---|---|
| Interesse definido | `Lead` |
| **Crédito aprovado** ou **vendedor marcou 👍** | `SubmitApplication` ← **otimize a campanha por este** |
| Negociando (se não for lead ruim) | `InitiateCheckout` |
| Venda fechada | `Purchase` |

Lead marcado como **ruim** não recebe os eventos profundos. E **não existe desfazer** na Meta — por isso o sistema decide antes de enviar.

---

## 5. As telas

### Inbox
Caixa única com uma aba por instância.

- **Filtros:** Todas · **Minhas** (que você assumiu) · **Sem agente** (ninguém pegou) · **IA ativa**
- **Busca:** por nome, telefone (parcial ou completo, com ou sem máscara) e, marcando a caixinha, **dentro do conteúdo das mensagens**
- **Ao abrir uma instância:** abre a conversa mais recente, com o cursor já no campo de texto
- **No chat:** enviar texto, áudio (com transcrição), imagens, vídeo, fotos do estoque, agendar envio, nota interna, etiquetas, lembrete, sugestão de resposta da IA, **Ir para o lead**
- **Divisores de data** (Hoje / Ontem / data) separam os dias

### Leads
Lista em formato planilha, com filtro em cima de cada coluna.

- **Abas por etapa do funil**, com contagem
- **Colunas:** entrada, nome (com selos), telefone, veículo, atendente, instância, última mensagem, **espera**, estágio, temperatura, ações
- **Não respondidos** aparecem **grifados em vermelho**, com ⏳ mostrando há quanto tempo o cliente aguarda, e vêm **primeiro** na ordem (maior espera no topo)
- **Espera:** `⏳ tempo` = aguardando resposta · `⌀ tempo` = tempo médio de resposta daquele lead
- **Selos:** 💳 crédito · 🔄 troca · 🏪 visitou · 👍/👎 qualidade
- **Aba "Não é lead"** para fornecedores/colegas, com botão de restaurar
- **Ao expandir:** linha do tempo completa, comentários, crédito, qualidade, vincular veículo, ir para a conversa

### Performance
Avaliação do atendimento, por **instância** ou por **atendente**.

Nota de 0 a 100 composta por cinco pilares: **conversão 35%**, **velocidade 20%**, **condução 25%** (a IA lê as conversas), **valor 10%**, **atividade 10%**. Tem coaching da IA com pontos fortes, o que melhorar e dicas práticas, além de um chat interno para o gestor perguntar sobre o time.

### Estoque
Veículos com **ID visível** em cada card (clique copia) — é o ID usado ao criar anúncios.

### Meta Ads
Criação de anúncios dentro de campanhas existentes (Click-to-WhatsApp), com upload de arte própria (stories), variações de título (um anúncio por título) e mensagem de boas-vindas personalizável.

### Fluxos
Automação por nós: mensagens, botões, listas, fotos do veículo, condições, IA, **entrada inesperada** (com tentativas e saída para IA), **aguardar resposta** (com lembrete e rota de sem-resposta) e **encaminhar para vendedor**.

### Configurações
Auto-qualificação por IA, **estilo dos comentários da IA**, tracking (Meta CAPI), agrupamento de mensagens, etiquetas, nomes das etapas e permissões por cargo.

*(A edição do prompt da IA fica em **Agentes IA**.)*

---

## 6. Permissões

| | Admin / Gerente | Vendedor |
|---|---|---|
| Abas do inbox | Todas | Só a instância dele |
| Conversas | Todas | Só da instância dele |
| Leads | Todos | Da instância dele ou que ele é dono |

O vínculo é feito em **Instâncias WhatsApp**, no seletor **"Vendedor desta instância"**.

---

## 7. Automações que rodam sozinhas

| Rotina | Frequência | O que faz |
|---|---|---|
| Lembrete de sem-resposta (fluxos) | 1 min | Cobra o cliente e avisa o vendedor |
| Auto-qualificação por IA | 2 min | Avança o funil e comenta na linha do tempo |
| Encerramento de leads parados | 1 hora | Marca como perdido após 14 dias sem resposta |
| Agrupamento de mensagens | 8 s | Junta mensagens em rajada num disparo só |

---

## 8. Rotina recomendada

**Vendedor, todo dia:** abrir Leads → os **vermelhos no topo** são quem está esperando → responder pelos mais antigos. Ao terminar um atendimento, marcar **👍/👎** e o **crédito**. Se o cliente visitou a loja, marcar **🏪**.

**Gestor, toda semana:** abrir **Performance** → rodar "Avaliar com IA" nos vendedores → usar o chat para perguntar quem precisa de atenção. Conferir o funil por aba e o diagnóstico do Gerenciador de Eventos da Meta.

**A regra de ouro:** a qualidade dos leads que a Meta traz é resultado direto do que a equipe marca no CRM. Marcar 👍/👎 e o crédito não é burocracia — é o que treina o algoritmo a trazer gente que compra.
