import { trpc } from "@/lib/trpc";
import { useConversationSocket } from "@/hooks/useSocket";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Phone, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Props = {
  conversationId: number;
  onBack?: () => void;
};

export default function ChatView({ conversationId, onBack }: Props) {
  const [newMessage, setNewMessage] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: conversation } = trpc.conversation.getById.useQuery(
    { id: conversationId },
    { refetchInterval: 15000 }
  );
  const { data: msgs, refetch: refetchMessages } = trpc.message.list.useQuery(
    { conversationId },
    { refetchInterval: 5000 }
  );
  const sendMutation = trpc.message.send.useMutation({
    onSuccess: () => {
      setNewMessage("");
      refetchMessages();
      inputRef.current?.focus();
    },
  });
  const markAsReadMutation = trpc.conversation.markAsRead.useMutation();

  const { socket } = useConversationSocket(conversationId);

  // Listen for new messages via WebSocket
  useEffect(() => {
    if (!socket) return;
    const onNewMessage = () => { refetchMessages(); };
    const onTyping = (data: { isTyping: boolean; senderName: string }) => {
      setTypingUser(data.isTyping ? data.senderName : null);
    };
    socket.on("new_message", onNewMessage);
    socket.on("typing", onTyping);
    return () => {
      socket.off("new_message", onNewMessage);
      socket.off("typing", onTyping);
    };
  }, [socket, refetchMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs]);

  // Mark as read on open
  useEffect(() => {
    markAsReadMutation.mutate({ id: conversationId });
  }, [conversationId]);

  const handleSend = () => {
    if (!newMessage.trim()) return;
    sendMutation.mutate({
      conversationId,
      content: newMessage.trim(),
      senderType: "agent",
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Chat Header */}
      <div className="h-16 border-b border-border flex items-center px-4 gap-3 shrink-0">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="lg:hidden h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
          <span className="text-sm font-medium text-secondary-foreground">
            {(conversation?.contactName || conversation?.phone || "?").charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {conversation?.contactName || conversation?.phone || "Carregando..."}
          </h3>
          <div className="flex items-center gap-2">
            {conversation?.phone && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {conversation.phone}
              </span>
            )}
            {conversation?.aiActive ? (
              <span className="text-xs text-primary flex items-center gap-1">
                <Bot className="h-3 w-3" /> IA Ativa
              </span>
            ) : (
              <span className="text-xs text-blue-400 flex items-center gap-1">
                <User className="h-3 w-3" /> Atendente
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {!msgs || msgs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Bot className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          msgs.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
        {typingUser && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pl-2">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span>{typingUser} está digitando...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem..."
            className="flex-1 bg-input border-border"
            disabled={sendMutation.isPending}
          />
          <Button
            onClick={handleSend}
            disabled={!newMessage.trim() || sendMutation.isPending}
            size="icon"
            className="bg-primary hover:bg-primary/90 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: { id: number; content: string; senderType: string; senderName: string | null; messageType: string; createdAt: Date } }) {
  const isCustomer = message.senderType === "customer";
  const isBot = message.senderType === "bot";

  return (
    <div className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] ${isCustomer ? "order-1" : "order-1"}`}>
        <div className="flex items-center gap-1.5 mb-1">
          {isBot && <Bot className="h-3 w-3 text-primary" />}
          {!isCustomer && !isBot && <User className="h-3 w-3 text-blue-400" />}
          <span className="text-[10px] text-muted-foreground">
            {message.senderName || (isCustomer ? "Cliente" : isBot ? "IA" : "Atendente")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {format(new Date(message.createdAt), "HH:mm", { locale: ptBR })}
          </span>
        </div>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isCustomer
              ? "bg-secondary text-secondary-foreground rounded-tl-sm"
              : isBot
              ? "bg-primary/15 text-foreground border border-primary/20 rounded-tr-sm"
              : "bg-blue-500/15 text-foreground border border-blue-500/20 rounded-tr-sm"
          }`}
        >
          {message.messageType === "audio" && (
            <span className="text-xs text-muted-foreground block mb-1">🎤 Mensagem de áudio (transcrita)</span>
          )}
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  );
}
