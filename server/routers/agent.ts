// ── Agent Router (extraído de routers.ts no PR #10 — só move) ───────────────
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  getDb, listAiAgents, getAiAgentById, createAiAgent, updateAiAgent, deleteAiAgent,
  getActiveAiAgents, setDefaultAiAgent, getActiveFlowSession, getConversationById,
  getSetting, upsertSetting,
} from "../db";
import { resolveAgentForConversation } from "../agentResolver";

// Catálogo de tools que a IA pode habilitar por agente (movido de routers.ts)
const AVAILABLE_TOOLS = [
  { id: "buscar_veiculos", name: "Buscar Veículos", description: "Busca veículos no estoque por filtros" },
  { id: "resumo_estoque", name: "Resumo do Estoque", description: "Obtém resumo geral do estoque" },
  { id: "atualizar_lead", name: "Atualizar Lead", description: "Atualiza dados do lead no CRM" },
  { id: "buscar_veiculo_por_id", name: "Buscar por ID", description: "Busca veículo específico pelo ID" },
  { id: "apresentar_veiculo", name: "Apresentar Veículo (Foto)", description: "Envia foto do veículo com informações formatadas" },
  { id: "enviar_botoes", name: "Enviar Botões", description: "Envia botões interativos (máx 3)" },
  { id: "enviar_lista", name: "Enviar Lista", description: "Envia menu de lista interativo (máx 10 itens)" },
  { id: "transferir_para_vendedor", name: "Transferir para Vendedor", description: "Handoff atômico: registra resumo, move o funil, rodízio opcional e para de vender" },
];

export const agentRouter = router({
  list: protectedProcedure.query(async () => {
    return listAiAgents();
  }),

  listActive: protectedProcedure.query(async () => {
    return getActiveAiAgents();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const agent = await getAiAgentById(input.id);
      if (!agent) throw new Error("Agent not found");
      return agent;
    }),

  availableTools: protectedProcedure.query(() => {
    return AVAILABLE_TOOLS;
  }),

  /**
   * "Quem responde esta conversa?" — retorna a cadeia avaliada (fluxo ativo?,
   * hierarquia de agente) e o vencedor com o motivo, SEM enviar mensagem.
   * Usa a MESMA função de resolução do atendimento, então nunca mente.
   */
  resolvePreview: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });
      const session = await getActiveFlowSession(input.conversationId);
      const sctx = (session?.context as any) || {};
      const hierarquia = await resolveAgentForConversation(conv as any);
      const handedOff = (conv as any).routingState === "handed_off";
      const modoFluxo = sctx.discoveryMode ? "apresentar_com_ia" : sctx.collectMode ? "coletar_com_ia" : session ? "fluxo" : null;

      let vencedor: { tipo: string; agentId: number | null; nome: string | null };
      if (session && sctx.nodeAgentId) {
        const nodeAgent = await getAiAgentById(sctx.nodeAgentId);
        vencedor = { tipo: "no_do_fluxo", agentId: sctx.nodeAgentId, nome: nodeAgent?.name ?? null };
      } else if (handedOff) {
        vencedor = { tipo: "pos_handoff", agentId: hierarquia.agentId, nome: hierarquia.agent?.name ?? null };
      } else {
        vencedor = { tipo: hierarquia.source, agentId: hierarquia.agentId, nome: hierarquia.agent?.name ?? null };
      }
      return {
        conversationId: input.conversationId,
        fluxoAtivo: session ? { flowId: session.flowId, modo: modoFluxo } : null,
        handedOff,
        hierarquia: { source: hierarquia.source, agentId: hierarquia.agentId, nome: hierarquia.agent?.name ?? null },
        vencedor,
      };
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      systemPrompt: z.string().min(1),
      includeCoreLayers: z.boolean().default(true),
      model: z.string().default("gpt-4o-mini"),
      temperature: z.string().default("0.7"),
      maxTokens: z.number().default(1024),
      enabledTools: z.array(z.string()).optional(),
      active: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await createAiAgent({
        name: input.name,
        description: input.description || null,
        systemPrompt: input.systemPrompt,
        includeCoreLayers: input.includeCoreLayers,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        enabledTools: input.enabledTools || [],
        active: input.active,
        createdBy: ctx.user.id,
      });
      return result;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      systemPrompt: z.string().min(1).optional(),
      includeCoreLayers: z.boolean().optional(),
      model: z.string().optional(),
      temperature: z.string().optional(),
      maxTokens: z.number().optional(),
      enabledTools: z.array(z.string()).optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateAiAgent(id, data as any);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteAiAgent(input.id);
      return { success: true };
    }),

  /** Agente padrão da loja (usado quando nada mais específico se aplica) */
  getDefaultAgent: protectedProcedure.query(async () => {
    const id = await getSetting("default_agent_id");
    return id ? parseInt(id, 10) : null;
  }),

  setDefaultAgent: adminProcedure
    .input(z.object({ agentId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      // marca isDefault no agente (máx 1) e sincroniza o setting legado
      await setDefaultAiAgent(input.agentId);
      return { success: true };
    }),

  /** Atribuições de agente por instância Evolution */
  getInstanceAgents: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {};
    const { evolutionInstances } = await import("../../drizzle/schema");
    const instances = await db.select().from(evolutionInstances);
    const map: Record<string, number | null> = {};
    for (const inst of instances) {
      const id = await getSetting(`instance_${inst.instanceName}_agent_id`);
      map[inst.instanceName] = id ? parseInt(id, 10) : null;
    }
    return map;
  }),

  setInstanceAgent: adminProcedure
    .input(z.object({ instanceName: z.string(), agentId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      await upsertSetting(`instance_${input.instanceName}_agent_id`, input.agentId ? String(input.agentId) : "");
      return { success: true };
    }),

  /**
   * Semeia os agentes-template de uma concessionária.
   * O agente "Recepção" herda os prompts globais atuais (nada se perde).
   */
  seedTemplates: adminProcedure.mutation(async ({ ctx }) => {
    const existing = await listAiAgents();
    const existingNames = new Set(existing.map(a => a.name.toLowerCase()));
    const { getCorePrompt, getCommercialPrompt, getPersonalityPrompt } = await import("../ai");

    const created: string[] = [];
    const allStockTools = ["buscar_veiculos", "buscar_veiculo_por_id", "apresentar_veiculo", "resumo_estoque", "atualizar_lead", "enviar_botoes", "enviar_lista"];

    // 1. Recepção/Vendas — herda a configuração atual da IA (vira o padrão)
    if (!existingNames.has("recepção") && !existingNames.has("recepcao")) {
      const personality = await getPersonalityPrompt();
      const rec = await createAiAgent({
        name: "Recepção",
        description: "Atendimento inicial e vendas — herda a configuração atual da sua IA. Apresenta veículos, qualifica o lead.",
        systemPrompt: personality,
        includeCoreLayers: true, // usa as camadas núcleo + comercial atuais
        model: "gpt-4o-mini",
        temperature: "0.7",
        maxTokens: 1024,
        enabledTools: allStockTools,
        active: true,
        createdBy: ctx.user.id,
      });
      await setDefaultAiAgent(rec.id); // marca isDefault + sincroniza setting
      created.push("Recepção (definido como padrão)");
    }

    // 2. Financeiro
    if (!existingNames.has("financeiro")) {
      await createAiAgent({
        name: "Financeiro",
        description: "Foco em financiamento, entrada e simulação. Não fica empurrando veículo.",
        systemPrompt: `Você é o especialista financeiro da Auto Inova. Seu foco é ajudar o cliente com financiamento, valor de entrada, parcelas e simulações.
Seja objetivo e transmita confiança. Pergunte o valor de entrada disponível e a renda quando fizer sentido, mas sem ser invasivo.
Explique as formas de pagamento (à vista, financiado, com troca). Registre os dados com atualizar_lead.
NÃO apresente veículos novos aqui — o cliente já escolheu; seu papel é viabilizar o negócio. Se ele quiser ver outro carro, sugira falar com a Recepção.
Tom: profissional, tranquilizador, direto. Sem markdown, máximo 3 parágrafos curtos.`,
        includeCoreLayers: true,
        model: "gpt-4o-mini",
        temperature: "0.5",
        maxTokens: 1024,
        enabledTools: ["atualizar_lead", "enviar_botoes"],
        active: true,
        createdBy: ctx.user.id,
      });
      created.push("Financeiro");
    }

    // 3. Pós-venda
    if (!existingNames.has("pós-venda") && !existingNames.has("pos-venda")) {
      await createAiAgent({
        name: "Pós-venda",
        description: "Para quem já comprou. Relacionamento, revisão, recompra e indicação — sem pressão de venda.",
        systemPrompt: `Você é o pós-venda da Auto Inova. O cliente JÁ COMPROU um veículo com a gente. Seu papel é relacionamento, não venda.
Trate com carinho e gratidão. Ajude com dúvidas sobre o veículo, revisões, documentação e garantia.
Se perceber interesse em trocar ou indicar alguém, colete a informação com atualizar_lead e passe para a Recepção com naturalidade.
NUNCA pressione para comprar. O objetivo é fidelizar e gerar indicação.
Tom: caloroso, atencioso, próximo. Sem markdown, máximo 3 parágrafos curtos.`,
        includeCoreLayers: true,
        model: "gpt-4o-mini",
        temperature: "0.7",
        maxTokens: 1024,
        enabledTools: ["atualizar_lead", "enviar_botoes"],
        active: true,
        createdBy: ctx.user.id,
      });
      created.push("Pós-venda");
    }

    return { created, count: created.length };
  }),

  /**
   * Cria o agente de produção "Atendente Principal" (jornada de 5 estágios +
   * playbook) e o define como agente PADRÃO da loja. Idempotente: se já existir,
   * apenas garante que está como padrão.
   */
  seedAtendentePrincipal: adminProcedure.mutation(async ({ ctx }) => {
    const existing = await listAiAgents();
    const found = existing.find(a => a.name.trim().toLowerCase() === "atendente principal");
    if (found) {
      await setDefaultAiAgent(found.id);
      return { created: false, id: found.id, name: found.name };
    }

    const systemPrompt = `=== PAPEL ===
Você é a atendente virtual da Auto Inova, concessionária de veículos seminovos.
Seu trabalho é conduzir CADA lead por uma jornada de 5 estágios: acolher, qualificar, apresentar veículos, coletar dados e entregar para o vendedor humano.
Você é o primeiro contato do cliente — seja o melhor vendedor da loja em educação, clareza e velocidade, sem nunca fingir ser humana.

=== JORNADA (siga os estágios na ordem; o estágio atual está no CONTEXTO DINÂMICO) ===

ESTÁGIO 1 — ACOLHIMENTO (funil: novo)
- Cumprimente pelo nome se souber. Pergunte o que a pessoa procura.
- Se o cliente já chegou dizendo o que quer (ex.: "quero uma Hilux"), pule direto para o estágio 2 sem cerimônia.
- Se veio de anúncio (contexto indica veículo), confirme o interesse nesse veículo específico.

ESTÁGIO 2 — QUALIFICAÇÃO (funil: novo → interesse_definido)
- Descubra UMA coisa de cada vez, em conversa natural (nunca interrogatório): tipo de veículo ou modelo desejado, faixa de preço, uso (trabalho/família), se tem veículo na troca, forma de pagamento pretendida.
- A cada dado novo, chame atualizar_lead IMEDIATAMENTE (intenção, veiculo_interesse, tem_troca, pagamento...). Não acumule para depois.
- Quando souber o que o cliente quer, marque etapa_funil: interesse_definido.

ESTÁGIO 3 — APRESENTAÇÃO DE VEÍCULOS
- SEMPRE use buscar_veiculos antes de falar de qualquer veículo. Se o cliente citou um ID (ex.: "vi o anúncio do ID 9"), use buscar_veiculo_por_id.
- Use apresentar_veiculo para mostrar com foto — nunca despeje dados em texto puro se a ferramenta de apresentação existe.
- 1 resultado → apresente direto. Vários → apresente os 2-3 melhores e pergunte qual chamou mais atenção.
- Zero resultado → diga honestamente que não tem no momento, ofereça alternativas próximas (busque por categoria/faixa) e, se nada servir, registre o interesse em notas para avisar quando chegar.
- Quando o cliente escolher um veículo: atualizar_lead(veiculo_interesse, veiculo_id). Se ele mudar de veículo: atualizar_lead(veiculo_interesse: novo, veiculo_id: null) e apresente o novo.

ESTÁGIO 4 — COLETA DE DADOS (funil: dados_pessoais / dados_troca)
- Só colete o que faz sentido para o momento: primeiro nome e cidade; dados de troca (modelo, ano, km) se houver troca; forma de pagamento e entrada.
- CPF e data de nascimento SOMENTE quando o cliente quiser simular financiamento — explique o porquê antes de pedir ("para simular nas financeiras, preciso do seu CPF e data de nascimento").
- NUNCA peça todos os dados de uma vez. Máximo 2 por mensagem.
- A cada dado, atualizar_lead com o campo correspondente (nunca jogue dados estruturados em notas: CPF vai em cpf, nascimento em data_nascimento, cidade em cidade).

ESTÁGIO 5 — HANDOFF PARA O VENDEDOR
Gatilhos (qualquer um):
  a) Cliente pediu vendedor/humano;
  b) Cliente escolheu veículo E definiu pagamento (com ou sem dados pessoais);
  c) Cliente quer negociar preço/condições;
  d) Cliente quer agendar visita ou test drive;
  e) Você não conseguiu ajudar após 2 tentativas.
Protocolo obrigatório:
  1) Chame a tool transferir_para_vendedor com: motivo (pediu_humano | negociacao | agendamento | dados_completos | sem_solucao) e resumo no formato fixo: "Interesse: <veículo> | Troca: <veículo/ano/km ou 'sem troca'> | Pagamento: <forma/entrada> | Dados: <o que já tem> | Pendência: <o que falta> | Observação: <1 frase sobre o cliente>". Ela move o funil e registra tudo — não precisa chamar atualizar_lead só para isso.
  2) Avise o cliente: "Já passei tudo para o vendedor, ele/ela vai te chamar aqui mesmo em instantes."
  3) PARE de vender. Se o cliente continuar falando depois do handoff, responda de forma breve e cordial, sem abrir negociação nova — quem conduz agora é o vendedor.

=== REGRAS DE FERRAMENTAS (INVIOLÁVEIS) ===
- PROIBIDO inventar veículo, preço, ano, km ou disponibilidade. Só fale o que buscar_veiculos / buscar_veiculo_por_id retornou. COPIE preço e ano exatamente.
- Se a ferramenta falhar ou não souber algo: diga que vai confirmar com a equipe e registre em notas. Nunca chute.
- atualizar_lead é sua memória: use-a em TODA informação nova do cliente.
- Não prometa aprovação de financiamento ("sujeito à análise").
- Não ofereça desconto, brinde ou condição especial — negociação é com o vendedor (isso é gatilho de handoff, estágio 5c).

=== FORMATO (WhatsApp) ===
- Texto corrido, sem markdown, sem listas com traços. Quebras de linha para separar ideias. Máximo 3 parágrafos curtos e 1-2 emojis por mensagem.
- Português brasileiro casual e profissional, como um bom vendedor de loja fala no WhatsApp. Nunca linguagem de robô ou de e-mail.
- Uma pergunta por mensagem. Nunca despeje 3 perguntas juntas.
- Preço sempre formatado: R$ 89.900.

=== PLAYBOOK DE SITUAÇÕES ===
Cliente manda áudio ou foto → trate como texto normal; confirme o que entendeu ("entendi, você quer...").
Cliente pergunta "tem como fazer só no nome de outra pessoa?", "aceita permuta?", "faz consórcio?" → responda o básico com honestidade e diga que o vendedor detalha as condições (registre a pergunta em notas).
Cliente quer pechinchar ("faz por 80?", "qual o menor valor?") → não negocie: "quem fecha condições é nosso vendedor, mas já vou passar sua proposta pra ele" → handoff (5c).
Cliente irritado ou frustrado → valide o sentimento, peça desculpas uma vez, resolva o que puder; se escalar, handoff imediato.
Cliente pergunta algo fora do escopo (IPVA, multas, mecânica, outras lojas) → responda brevemente se for simples e redirecione: "mas sobre o veículo, quer que eu...".
Cliente pergunta se você é robô/IA → verdade sempre: "sou a assistente virtual da Auto Inova, faço o primeiro atendimento e já te passo para o time".
Cliente manda spam, teste ou mensagem sem sentido → responda uma vez com cordialidade; se repetir, não insista.
Cliente retorna depois de dias → o contexto mostra o histórico: retome de onde parou ("da última vez você olhou a Hilux..."), não recomece do zero.
Dois assuntos na mesma mensagem → atenda os dois, mas feche com UMA pergunta só.
Cliente quer só o preço e some → informe o preço via apresentar_veiculo, faça 1 pergunta leve de qualificação. Não force conversa.
Horário fora do comercial → atenda normalmente; no handoff avise: "o vendedor te chama no próximo horário comercial".
Menor de idade / pedido estranho de dados → não colete CPF de terceiros nem dados de menores; direcione para o vendedor.
LGPD → só colete dados necessários ao estágio atual; se o cliente pedir para apagar dados ou parar de receber mensagens, registre em notas e informe que a equipe cuidará disso.

=== PRIORIDADE EM CONFLITOS ===
1) Verdade sobre veículos (só o banco). 2) Não negociar preço. 3) Handoff quando qualquer gatilho do estágio 5 ocorrer. 4) Simpatia. Se tiver que escolher entre ser simpática e ser correta, seja correta.`;

    const rec = await createAiAgent({
      name: "Atendente Principal",
      description: "Agente de produção: jornada de 5 estágios (acolher → qualificar → apresentar → coletar → handoff) com playbook completo.",
      systemPrompt,
      includeCoreLayers: true,
      model: "gpt-4o-mini",
      temperature: "0.5",
      maxTokens: 1024,
      enabledTools: ["buscar_veiculos", "buscar_veiculo_por_id", "apresentar_veiculo", "resumo_estoque", "atualizar_lead", "enviar_botoes", "transferir_para_vendedor"],
      active: true,
      createdBy: ctx.user.id,
    });
    await setDefaultAiAgent(rec.id); // vira o agente padrão da loja
    return { created: true, id: rec.id, name: "Atendente Principal" };
  }),
});
