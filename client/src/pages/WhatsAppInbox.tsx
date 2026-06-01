import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Send,
  Search,
  RefreshCw,
  Smartphone,
  MessageSquare,
  CheckCheck,
  Check,
  Clock,
  AlertCircle,
  Paperclip,
  Phone,
  User,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

type WaNumber = {
  id: number;
  phoneNumberId: string;
  displayName: string;
  phoneDisplay: string | null;
  isActive: boolean;
};

type Conversation = {
  id: number;
  whatsappNumberId: number;
  phoneNumberId: string;
  customerPhone: string;
  contactName: string | null;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  status: string;
  windowExpired: boolean | null;
  notes: string | null;
  vehicleInterest: string | null;
  leadStatus: string | null;
};

type Message = {
  id: number;
  content: string | null;
  messageType: string;
  mediaUrl: string | null;
  direction: string;
  senderName: string | null;
  status: string | null;
  timestamp: number;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.length === 13 && clean.startsWith("55")) {
    const ddd = clean.slice(2, 4);
    const num = clean.slice(4);
    if (num.length === 9) return `+55 (${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    if (num.length === 8) return `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  }
  return phone;
}

function getDisplayName(conv: Conversation): string {
  return conv.contactName || formatPhone(conv.customerPhone);
}

function getInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();
}

function formatTime(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function MessageStatus({ status }: { status: string | null }) {
  if (!status) return null;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-blue-400" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === "sent") return <Check className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function WhatsAppInbox() {
  const { user } = useAuth();
  const [selectedNumberId, setSelectedNumberId] = useState<number | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [messageText, setMessageText] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: numbers = [], isLoading: numbersLoading } = trpc.whatsappNumbers.list.useQuery();

  const activeNumbers = (numbers as WaNumber[]).filter(n => n.isActive);

  const { data: conversations = [], refetch: refetchConvs } = trpc.whatsappNumbers.listConversations.useQuery(
    { whatsappNumberId: selectedNumberId! },
    { enabled: !!selectedNumberId, refetchInterval: 5000 }
  );

  const { data: messages = [], refetch: refetchMsgs } = trpc.whatsappNumbers.listMessages.useQuery(
    { conversationId: selectedConvId! },
    { enabled: !!selectedConvId, refetchInterval: 3000 }
  );

  const selectedConv = (conversations as Conversation[]).find(c => c.id === selectedConvId) || null;
  const selectedNumber = activeNumbers.find(n => n.id === selectedNumberId) || null;

  // ── Auto-select first number ───────────────────────────────────────────────
  useEffect(() => {
    if (activeNumbers.length > 0 && !selectedNumberId) {
      setSelectedNumberId(activeNumbers[0].id);
    }
  }, [activeNumbers.length]);

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Mark read on open ──────────────────────────────────────────────────────
  const markReadMutation = trpc.whatsappNumbers.markRead.useMutation();
  const updateConvMutation = trpc.whatsappNumbers.updateConversation.useMutation({
    onSuccess: () => refetchConvs(),
  });

  function selectConversation(conv: Conversation) {
    setSelectedConvId(conv.id);
    setNameInput(conv.contactName || "");
    setEditingName(false);
    if (conv.unreadCount > 0) {
      markReadMutation.mutate({ conversationId: conv.id });
    }
  }

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMutation = trpc.whatsappNumbers.sendText.useMutation({
    onSuccess: () => {
      setMessageText("");
      refetchMsgs();
      refetchConvs();
    },
    onError: (err) => toast.error(`Erro ao enviar: ${err.message}`),
  });

  function handleSend() {
    if (!messageText.trim() || !selectedConv || !selectedNumber) return;
    sendMutation.mutate({
      phoneNumberId: selectedNumber.phoneNumberId,
      to: selectedConv.customerPhone,
      text: messageText.trim(),
      conversationId: selectedConv.id,
      whatsappNumberId: selectedNumber.id,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function saveName() {
    if (!selectedConvId) return;
    updateConvMutation.mutate({ id: selectedConvId, contactName: nameInput });
    setEditingName(false);
  }

  // ── Filtered conversations ─────────────────────────────────────────────────
  const filteredConvs = (conversations as Conversation[]).filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      getDisplayName(c).toLowerCase().includes(q) ||
      c.customerPhone.includes(q)
    );
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  if (numbersLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activeNumbers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-sm">
          <Smartphone className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-40" />
          <h2 className="text-lg font-semibold mb-2">Nenhum número configurado</h2>
          <p className="text-sm text-muted-foreground">
            Cadastre um número WhatsApp Cloud API em <strong>Números WhatsApp</strong> para começar a usar o inbox.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <div className="w-80 flex flex-col border-r border-border">

        {/* Number selector */}
        <div className="p-3 border-b border-border bg-card">
          <Select
            value={selectedNumberId?.toString() || ""}
            onValueChange={(v) => { setSelectedNumberId(Number(v)); setSelectedConvId(null); }}
          >
            <SelectTrigger className="h-9 text-sm">
              <Smartphone className="h-4 w-4 mr-2 text-green-500 flex-shrink-0" />
              <SelectValue placeholder="Selecione um número" />
            </SelectTrigger>
            <SelectContent>
              {activeNumbers.map(n => (
                <SelectItem key={n.id} value={n.id.toString()}>
                  <div>
                    <p className="font-medium">{n.displayName}</p>
                    {n.phoneDisplay && <p className="text-xs text-muted-foreground">{n.phoneDisplay}</p>}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar conversa..."
              className="pl-8 h-9 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          {filteredConvs.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
              {search ? "Nenhuma conversa encontrada" : "Aguardando mensagens..."}
            </div>
          ) : (
            filteredConvs.map(conv => (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv)}
                className={cn(
                  "w-full flex items-start gap-3 p-3 border-b border-border/50 hover:bg-accent/50 transition-colors text-left",
                  selectedConvId === conv.id && "bg-accent"
                )}
              >
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarFallback className="text-xs bg-green-500/20 text-green-400">
                    {getInitials(getDisplayName(conv))}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-sm truncate">{getDisplayName(conv)}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{formatTime(conv.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <span className="text-xs text-muted-foreground truncate">{conv.lastMessagePreview || "—"}</span>
                    {conv.unreadCount > 0 && (
                      <Badge className="h-4 min-w-4 px-1 text-[10px] bg-green-500 text-white flex-shrink-0">
                        {conv.unreadCount}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">{formatPhone(conv.customerPhone)}</span>
                    {conv.status !== "open" && (
                      <Badge variant="outline" className="text-[10px] h-3.5 px-1">{conv.status}</Badge>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      {/* ── Chat area ───────────────────────────────────────────────────────── */}
      {!selectedConv ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Selecione uma conversa para começar</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="text-xs bg-green-500/20 text-green-400">
                {getInitials(getDisplayName(selectedConv))}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    className="h-7 text-sm"
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                  />
                  <Button size="sm" className="h-7 px-2 text-xs" onClick={saveName}>Salvar</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingName(false)}>✕</Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm">{getDisplayName(selectedConv)}</span>
                  <button onClick={() => { setEditingName(true); setNameInput(selectedConv.contactName || ""); }} className="text-muted-foreground hover:text-foreground">
                    <User className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Phone className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{formatPhone(selectedConv.customerPhone)}</span>
                {selectedNumber && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-green-500">{selectedNumber.displayName}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={selectedConv.status}
                onValueChange={(v) => updateConvMutation.mutate({ id: selectedConv.id, status: v as any })}
              >
                <SelectTrigger className="h-7 text-xs w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Aberta</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="resolved">Resolvida</SelectItem>
                  <SelectItem value="closed">Fechada</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => { refetchMsgs(); refetchConvs(); }}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-4 py-3">
            <div className="space-y-2 max-w-3xl mx-auto">
              {(messages as Message[]).map(msg => (
                <div
                  key={msg.id}
                  className={cn("flex", msg.direction === "outbound" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm",
                      msg.direction === "outbound"
                        ? "bg-green-600 text-white rounded-br-sm"
                        : "bg-card border border-border rounded-bl-sm"
                    )}
                  >
                    {msg.direction === "inbound" && msg.senderName && (
                      <p className="text-xs font-medium text-green-400 mb-0.5">{msg.senderName}</p>
                    )}
                    {msg.messageType === "text" && (
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    )}
                    {msg.messageType === "image" && (
                      <div>
                        {msg.mediaUrl ? (
                          <img src={msg.mediaUrl} alt="imagem" className="rounded max-w-[200px]" />
                        ) : (
                          <span className="text-xs opacity-70">[Imagem]</span>
                        )}
                        {msg.content && <p className="mt-1 text-xs">{msg.content}</p>}
                      </div>
                    )}
                    {msg.messageType === "audio" && (
                      <span className="text-xs opacity-70">🎵 Áudio</span>
                    )}
                    {msg.messageType === "document" && (
                      <span className="text-xs opacity-70">📄 {msg.content || "Documento"}</span>
                    )}
                    {msg.messageType === "video" && (
                      <span className="text-xs opacity-70">🎥 Vídeo</span>
                    )}
                    {msg.messageType === "sticker" && (
                      <span className="text-xs opacity-70">🎭 Sticker</span>
                    )}
                    {msg.messageType === "reaction" && (
                      <span>{msg.content}</span>
                    )}
                    <div className={cn("flex items-center gap-1 mt-0.5", msg.direction === "outbound" ? "justify-end" : "justify-start")}>
                      <span className="text-[10px] opacity-60">
                        {new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {msg.direction === "outbound" && <MessageStatus status={msg.status} />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-border bg-card px-4 py-3">
            <div className="flex items-end gap-2 max-w-3xl mx-auto">
              <Textarea
                placeholder="Digite uma mensagem..."
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                className="flex-1 resize-none min-h-[40px] max-h-[120px] text-sm"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleSend}
                    disabled={!messageText.trim() || sendMutation.isPending}
                    size="sm"
                    className="h-10 w-10 p-0 bg-green-600 hover:bg-green-700"
                  >
                    {sendMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Enviar (Enter)</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
