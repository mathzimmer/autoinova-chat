/**
 * Message Debounce System
 * 
 * Agrupa mensagens do cliente recebidas em sequência rápida para que a IA
 * processe todas de uma vez, evitando respostas duplicadas.
 * 
 * Fluxo:
 * 1. Mensagem chega → salva no banco → adiciona ao buffer do debounce
 * 2. Timer de DEBOUNCE_DELAY_MS é iniciado/resetado para a conversa
 * 3. Quando o timer expira → callback é chamado com todas as mensagens agrupadas
 */

const DEFAULT_DEBOUNCE_DELAY_MS = 8000; // 8 segundos padrão
let currentDelayMs = DEFAULT_DEBOUNCE_DELAY_MS;

/**
 * Atualiza o delay do debounce (chamado quando a config muda).
 */
export function setDebounceDelay(delayMs: number): void {
  currentDelayMs = Math.max(1000, Math.min(30000, delayMs)); // min 1s, max 30s
  console.log(`[Debounce] Delay atualizado para ${currentDelayMs}ms`);
}

/**
 * Retorna o delay atual do debounce.
 */
export function getDebounceDelay(): number {
  return currentDelayMs;
}

interface PendingMessage {
  content: string;
  messageType: string;
  mediaUrl?: string;
  timestamp: number;
}

interface ConversationBuffer {
  messages: PendingMessage[];
  timer: ReturnType<typeof setTimeout>;
  conversationId: number;
}

// Map de conversationId → buffer de mensagens pendentes
const conversationBuffers = new Map<number, ConversationBuffer>();

type DebounceCallback = (
  conversationId: number,
  groupedContent: string,
  messages: PendingMessage[]
) => Promise<void>;

let onFlushCallback: DebounceCallback | null = null;

/**
 * Registra o callback que será chamado quando o debounce expirar.
 * Deve ser chamado uma vez na inicialização do servidor.
 */
export function setDebounceCallback(callback: DebounceCallback): void {
  onFlushCallback = callback;
}

/**
 * Adiciona uma mensagem ao buffer de debounce de uma conversa.
 * Se já houver um timer ativo, reseta. Quando o timer expira,
 * chama o callback com todas as mensagens agrupadas.
 */
export function addToDebounce(
  conversationId: number,
  content: string,
  messageType: string,
  mediaUrl?: string
): void {
  const existing = conversationBuffers.get(conversationId);

  const pendingMsg: PendingMessage = {
    content,
    messageType,
    mediaUrl,
    timestamp: Date.now(),
  };

  if (existing) {
    // Já tem buffer ativo: limpa timer anterior, adiciona mensagem, reinicia timer
    clearTimeout(existing.timer);
    existing.messages.push(pendingMsg);
    
    console.log(`[Debounce] Conversa ${conversationId}: ${existing.messages.length} mensagens agrupadas, resetando timer (${currentDelayMs}ms)`);
    
    existing.timer = setTimeout(() => {
      flushBuffer(conversationId);
    }, currentDelayMs);
  } else {
    // Primeira mensagem: cria buffer novo com timer
    console.log(`[Debounce] Conversa ${conversationId}: primeira mensagem, iniciando timer (${currentDelayMs}ms)`);
    
    const timer = setTimeout(() => {
      flushBuffer(conversationId);
    }, currentDelayMs);

    conversationBuffers.set(conversationId, {
      messages: [pendingMsg],
      timer,
      conversationId,
    });
  }
}

/**
 * Verifica se uma conversa tem mensagens pendentes no debounce.
 */
export function hasPendingMessages(conversationId: number): boolean {
  return conversationBuffers.has(conversationId);
}

/**
 * Força o flush imediato do buffer de uma conversa (ex: quando atendente assume).
 */
export function cancelDebounce(conversationId: number): void {
  const existing = conversationBuffers.get(conversationId);
  if (existing) {
    clearTimeout(existing.timer);
    conversationBuffers.delete(conversationId);
    console.log(`[Debounce] Conversa ${conversationId}: debounce cancelado (${existing.messages.length} mensagens descartadas do buffer de IA)`);
  }
}

/**
 * Processa o buffer acumulado: agrupa as mensagens e chama o callback.
 */
async function flushBuffer(conversationId: number): Promise<void> {
  const buffer = conversationBuffers.get(conversationId);
  if (!buffer || buffer.messages.length === 0) {
    conversationBuffers.delete(conversationId);
    return;
  }

  // Remove o buffer ANTES de processar para evitar race conditions
  conversationBuffers.delete(conversationId);

  const messages = buffer.messages;
  
  // Agrupa o conteúdo das mensagens
  let groupedContent: string;
  
  if (messages.length === 1) {
    // Mensagem única: passa direto sem agrupar
    groupedContent = messages[0].content;
  } else {
    // Múltiplas mensagens: agrupa em um bloco
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.messageType === "image" && msg.mediaUrl) {
        parts.push(`[IMAGEM: ${msg.mediaUrl}] ${msg.content}`);
      } else {
        parts.push(msg.content);
      }
    }
    groupedContent = parts.join("\n");
    console.log(`[Debounce] Conversa ${conversationId}: processando ${messages.length} mensagens agrupadas`);
  }

  if (onFlushCallback) {
    try {
      await onFlushCallback(conversationId, groupedContent, messages);
    } catch (err) {
      console.error(`[Debounce] Erro ao processar buffer da conversa ${conversationId}:`, err);
    }
  } else {
    console.warn(`[Debounce] Nenhum callback registrado para processar mensagens`);
  }
}

/**
 * Retorna estatísticas do debounce (para debug/monitoramento).
 */
export function getDebounceStats(): { activeBuffers: number; totalPending: number } {
  let totalPending = 0;
  const buffers = Array.from(conversationBuffers.values());
  for (const buffer of buffers) {
    totalPending += buffer.messages.length;
  }
  return {
    activeBuffers: conversationBuffers.size,
    totalPending,
  };
}
