/**
 * Verificações PURAS de resposta do agente (PR A7). Sem dependências — testáveis
 * isoladamente e usadas tanto no CI (unit) quanto pelo runner com IA real.
 */
import type { Proibicao } from "./fixtures";

/** Detecta markdown proibido no WhatsApp: headers, listas com traço/asterisco, links [x](y). */
export function contemMarkdown(texto: string): boolean {
  const t = texto || "";
  if (/^\s{0,3}#{1,6}\s/m.test(t)) return true;            // # cabeçalho
  if (/^\s*[-*]\s+\S/m.test(t)) return true;               // - item / * item (lista)
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) return true;          // [texto](link)
  if (/\*\*[^*]+\*\*|__[^_]+__/.test(t)) return true;      // **negrito** / __negrito__
  return false;
}

/** Detecta oferta de desconto/condição especial (que é papel do vendedor). */
export function ofereceDesconto(texto: string): boolean {
  return /\b(desconto|abatimento|brinde|cortesia|fa[çc]o por|deixo por|melhor pre[çc]o|baixo o pre|posso baixar|te dou por)\b/i.test(texto || "");
}

/** Conta perguntas na mensagem (para a regra "uma pergunta por mensagem"). */
export function contarPerguntas(texto: string): number {
  return (texto.match(/\?/g) || []).length;
}

export interface ViolacaoConteudo {
  proibicao: Proibicao;
  detalhe: string;
}

/**
 * Verifica uma resposta do agente contra a lista de proibições esperadas.
 * `vehiclesReais`: títulos/modelos que REALMENTE vieram da busca — se a resposta
 * cita um veículo fora dessa lista, é "inventar_veiculo" (verificação opcional).
 */
export function verificarResposta(
  resposta: string,
  proibicoes: Proibicao[] = [],
): ViolacaoConteudo[] {
  const violacoes: ViolacaoConteudo[] = [];
  for (const p of proibicoes) {
    if (p === "markdown" && contemMarkdown(resposta)) {
      violacoes.push({ proibicao: "markdown", detalhe: "resposta contém markdown/listas/links" });
    }
    if (p === "desconto" && ofereceDesconto(resposta)) {
      violacoes.push({ proibicao: "desconto", detalhe: "resposta oferece desconto/condição especial" });
    }
    if (p === "multiplas_perguntas" && contarPerguntas(resposta) > 1) {
      violacoes.push({ proibicao: "multiplas_perguntas", detalhe: `${contarPerguntas(resposta)} perguntas numa mensagem` });
    }
    // "inventar_veiculo" depende de contexto de estoque → verificado no runner (não puro).
  }
  return violacoes;
}

/** Confere se todas as tools esperadas foram chamadas e nenhuma proibida. */
export function verificarTools(
  toolsChamadas: string[],
  esperadas: string[] = [],
  proibidas: string[] = [],
): { faltando: string[]; proibidasChamadas: string[] } {
  const set = new Set(toolsChamadas);
  return {
    faltando: esperadas.filter(t => !set.has(t)),
    proibidasChamadas: proibidas.filter(t => set.has(t)),
  };
}

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Detecta REAPRESENTAÇÃO de veículo (o bug do "Celta" — PR A7).
 * `titulosApresentados`: títulos que o bot JÁ apresentou na conversa.
 * Só acusa quando a resposta tem CARA de apresentação (linha "Ano: XXXX" ou
 * link /carros/) E repete um título já apresentado. Confirmar a escolha
 * mencionando o título ("Ótimo, o Celta! Vamos avançar...") NÃO é reapresentar.
 * Retorna o título reapresentado ou null.
 */
export function reapresentouVeiculo(resposta: string, titulosApresentados: string[]): string | null {
  const temCaraDeApresentacao = /Ano\s*:\s*\d{4}/i.test(resposta) || resposta.includes("/carros/");
  if (!temCaraDeApresentacao) return null;
  const r = norm(resposta);
  for (const t of titulosApresentados) {
    const nt = norm(t);
    if (nt.length >= 4 && r.includes(nt)) return t;
  }
  return null;
}
