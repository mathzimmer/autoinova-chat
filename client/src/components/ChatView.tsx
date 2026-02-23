import { trpc } from "@/lib/trpc";
import { useConversationSocket } from "@/hooks/useSocket";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Bot, User, Phone, ArrowLeft, Image, Volume2, FileText, Play, Pause } from "lucide-react";
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
            <span>{typingUser} est digitando...</span>
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

type MessageData = {
  id: number;
  content: string;
  senderType: string;
  senderName: string | null;
  messageType: string;
  metadata: unknown;
  createdAt: Date;
};

function MessageBubble({ message }: { message: MessageData }) {
  const isCustomer = message.senderType === "customer";
  const isBot = message.senderType === "bot";
  const meta = message.metadata as Record<string, unknown> | null;
  const mediaUrl = meta?.mediaUrl as string | undefined;
  const transcribedText = meta?.transcribedText as string | undefined;

  return (
    <div className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[75%]">
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
          {/* Image message */}
          {message.messageType === "image" && mediaUrl && (
            <div className="mb-2">
              <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                <img
                  src={mediaUrl}
                  alt="Imagem enviada"
                  className="rounded-lg max-w-full max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  loading="lazy"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                  }}
                />
              </a>
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <Image className="h-3 w-3" />
                <span>Imagem</span>
              </div>
            </div>
          )}

          {/* Audio message with player */}
          {message.messageType === "audio" && (
            <div className="mb-2">
              {mediaUrl ? (
                <AudioPlayer url={mediaUrl} />
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Mensagem de voz</span>
                </div>
              )}
              {transcribedText && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <span className="text-[10px] text-muted-foreground block mb-0.5">Transcrição:</span>
                  <p className="whitespace-pre-wrap text-xs italic opacity-80">{transcribedText}</p>
                </div>
              )}
            </div>
          )}

          {/* Document message */}
          {message.messageType === "document" && mediaUrl && (
            <div className="mb-2">
              <a
                href={mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded-lg bg-background/50 hover:bg-background/80 transition-colors"
              >
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="text-xs text-primary underline truncate">Abrir documento</span>
              </a>
            </div>
          )}

          {/* Text content - hide generic placeholders for image/audio if we already show the media */}
          {!(message.messageType === "image" && mediaUrl && (message.content === "[Imagem enviada pelo cliente]" || message.content === "[Imagem recebida]")) &&
           !(message.messageType === "audio" && !transcribedText && (message.content === "[Mensagem de áudio]" || message.content === "[Áudio não pôde ser transcrito]")) && (
            <p className="whitespace-pre-wrap">
              {message.messageType === "audio" && transcribedText
                ? "" // Already shown in transcription section above
                : message.content
              }
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function AudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);
    const onError = () => setError(true);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => setError(true));
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Volume2 className="h-3.5 w-3.5" />
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
          Baixar áudio
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio ref={audioRef} src={url} preload="metadata" />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 rounded-full bg-primary/20 hover:bg-primary/30"
        onClick={togglePlay}
      >
        {isPlaying ? (
          <Pause className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Play className="h-3.5 w-3.5 text-primary ml-0.5" />
        )}
      </Button>
      <div className="flex-1 flex flex-col gap-0.5">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1 rounded-full appearance-none bg-muted cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
