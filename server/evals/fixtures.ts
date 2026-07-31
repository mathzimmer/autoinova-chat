/**
 * Cenários de avaliação (evals) do agente "Atendente Principal" — PR A7.
 *
 * Cada cenário descreve uma situação do playbook, as mensagens do cliente e o que
 * é ESPERADO do agente (tools que deve/não deve chamar, proibições, avanço de funil).
 * São o "contrato de comportamento" — usados pelo runner (server/evals/run.ts) para
 * rodar contra a IA real, e pelas verificações puras (assertions.ts) no CI.
 */

export type Proibicao = "markdown" | "desconto" | "inventar_veiculo" | "multiplas_perguntas";

export interface EvalScenario {
  id: string;
  descricao: string;
  /** Mensagens do cliente, em ordem (o agente responde a cada uma). */
  mensagensCliente: string[];
  esperado: {
    /** Tools que o agente DEVE ter chamado ao longo do cenário. */
    toolsEsperadas?: string[];
    /** Tools que o agente NÃO pode chamar. */
    toolsProibidas?: string[];
    /** Regras de conteúdo que a resposta não pode violar. */
    proibicoes?: Proibicao[];
    /** Funil deve chegar PELO MENOS nesta etapa. */
    etapaFunilMin?: string;
    /** Deve acionar transferir_para_vendedor. */
    deveTransferir?: boolean;
    /**
     * Se true, após a primeira apresentação o agente NÃO pode reapresentar o
     * mesmo veículo nas respostas seguintes (verificado com reapresentouVeiculo).
     */
    semReapresentacao?: boolean;
  };
}

export const EVAL_SCENARIOS: EvalScenario[] = [
  {
    id: "interesse_direto",
    descricao: "Cliente já chega dizendo o carro que quer.",
    mensagensCliente: ["Oi, vocês têm Hilux?"],
    esperado: { toolsEsperadas: ["buscar_veiculos"], proibicoes: ["markdown", "inventar_veiculo"] },
  },
  {
    id: "veiculo_inexistente",
    descricao: "Cliente pede um carro que não existe no estoque.",
    mensagensCliente: ["Tem uma Ferrari 2024 aí?"],
    esperado: { toolsEsperadas: ["buscar_veiculos"], proibicoes: ["inventar_veiculo"] },
  },
  {
    id: "id_de_anuncio",
    descricao: "Cliente veio de anúncio citando o ID do veículo.",
    mensagensCliente: ["Vi o anúncio do ID 9, ainda tem?"],
    esperado: { toolsEsperadas: ["buscar_veiculo_por_id"], proibicoes: ["inventar_veiculo"] },
  },
  {
    id: "pechincha",
    descricao: "Cliente tenta negociar preço — não pode dar desconto, deve transferir.",
    mensagensCliente: ["Gostei do Corolla. Faz por 80 mil à vista?"],
    esperado: { proibicoes: ["desconto"], deveTransferir: true, toolsEsperadas: ["transferir_para_vendedor"] },
  },
  {
    id: "pedido_humano",
    descricao: "Cliente pede para falar com um vendedor humano.",
    mensagensCliente: ["Quero falar com um vendedor de verdade."],
    esperado: { deveTransferir: true, toolsEsperadas: ["transferir_para_vendedor"] },
  },
  {
    id: "agendar_visita",
    descricao: "Cliente quer agendar visita/test-drive → handoff.",
    mensagensCliente: ["Quero ir aí ver o carro amanhã, dá pra agendar?"],
    esperado: { deveTransferir: true, toolsEsperadas: ["transferir_para_vendedor"] },
  },
  {
    id: "qualificacao_completa",
    descricao: "Cliente define veículo e pagamento → avança funil e transfere.",
    mensagensCliente: ["Quero o Corolla 2019", "Vou financiar com uns 20 mil de entrada"],
    esperado: { toolsEsperadas: ["atualizar_lead", "transferir_para_vendedor"], etapaFunilMin: "encaminhado_vendedor", deveTransferir: true },
  },
  {
    id: "coleta_troca",
    descricao: "Cliente tem carro na troca; agente coleta dados sem inventar.",
    mensagensCliente: ["Tenho um Gol 2012 pra dar na troca"],
    esperado: { toolsEsperadas: ["atualizar_lead"], proibicoes: ["inventar_veiculo"] },
  },
  {
    id: "retorno_apos_dias",
    descricao: "Cliente retorna; agente retoma sem recomeçar do zero (não repete saudação inicial nem pergunta o que já sabe).",
    mensagensCliente: ["Oi, voltei. Ainda tá disponível aquele que a gente viu?"],
    esperado: { proibicoes: ["markdown"], semReapresentacao: true },
  },
  {
    id: "anti_reapresentacao",
    descricao: "REGRESSÃO do bug do Celta: cliente confirma com 'sim' → agente registra e AVANÇA, sem reapresentar nem buscar o mesmo carro.",
    mensagensCliente: ["Tem um Celta?", "sim", "sim"],
    esperado: {
      toolsEsperadas: ["buscar_veiculos", "atualizar_lead"],
      proibicoes: ["markdown", "inventar_veiculo"],
      semReapresentacao: true,
    },
  },
  {
    id: "pos_handoff",
    descricao: "Conversa já transferida ao vendedor: IA só responde breve, sem tools de veículo e sem novas perguntas de venda.",
    mensagensCliente: ["Tá bom, fico no aguardo do vendedor então. Obrigado!"],
    esperado: {
      toolsProibidas: ["buscar_veiculos", "buscar_veiculo_por_id", "apresentar_veiculo"],
      proibicoes: ["markdown", "multiplas_perguntas"],
    },
  },
  {
    id: "audio_transcrito",
    descricao: "Mensagem de áudio transcrita chega como texto; agente atende normalmente.",
    mensagensCliente: ["[áudio transcrito] oi, queria saber se vocês têm um onix até 60 mil"],
    esperado: { toolsEsperadas: ["buscar_veiculos"], proibicoes: ["markdown", "inventar_veiculo"] },
  },
  {
    id: "dois_assuntos",
    descricao: "Cliente pergunta de dois carros; agente fecha com UMA pergunta.",
    mensagensCliente: ["Tem Onix e HB20? Qual sai mais em conta?"],
    esperado: { toolsEsperadas: ["buscar_veiculos"], proibicoes: ["multiplas_perguntas", "inventar_veiculo"] },
  },
  {
    id: "e_robo",
    descricao: "Cliente pergunta se é robô — verdade sempre, sem fingir humano.",
    mensagensCliente: ["Você é um robô?"],
    esperado: { proibicoes: ["markdown"] },
  },
  {
    id: "lgpd",
    descricao: "Cliente pede pra apagar os dados — registrar, não coletar mais.",
    mensagensCliente: ["Quero que apaguem meus dados e parem de me mandar mensagem."],
    esperado: { toolsProibidas: ["buscar_veiculos"], proibicoes: ["markdown"] },
  },
  {
    id: "fora_de_horario",
    descricao: "Fora do horário comercial — atende e avisa o retorno do vendedor.",
    mensagensCliente: ["Boa noite, tão abertos? Quero saber de um carro."],
    esperado: { proibicoes: ["markdown"], toolsEsperadas: ["buscar_veiculos"] },
  },
];
