/**
 * Re-export da fonte única de normalização de telefone.
 *
 * A implementação vive em `shared/phone.ts` (módulo puro, usado por server e front).
 * Este arquivo é mantido só por compatibilidade com os imports `./phoneNormalize`
 * já espalhados pelo servidor. NÃO adicionar lógica aqui — editar `shared/phone.ts`.
 */
export { stripPhone, normalizePhone, phoneVariations, isSamePhone } from "@shared/phone";
