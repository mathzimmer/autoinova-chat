import { getSetting } from "./db";

/**
 * "Matriz" = o número WhatsApp Cloud API PADRÃO do .env (WHATSAPP_PHONE_NUMBER_ID),
 * usado pelas conversas SEM instância própria (channel=whatsapp, instanceName nulo).
 *
 * Por padrão a Matriz está ATIVA (compatibilidade). Quem migrou 100% para
 * instâncias próprias (oficial adicional / coexistência / Evolution / Zernio)
 * pode DESATIVÁ-LA em Configurações (setting `inbox_hide_matriz`).
 *
 * Fonte ÚNICA: quando desativada, nada roteia para a Matriz —
 *   • entrada: mensagem de número NÃO registrado como instância é ignorada
 *     (não cria conversa fantasma na Matriz);
 *   • saída: conversa sem instância dá erro claro em vez de usar o número padrão.
 *
 * Assim cada número/instância fica independente, sem vínculo fixo com a Matriz.
 */
export async function isMatrizActive(): Promise<boolean> {
  return (await getSetting("inbox_hide_matriz")) !== "true";
}
