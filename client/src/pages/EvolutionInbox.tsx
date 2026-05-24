import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  MessageSquare, Send, Smartphone, Search, RefreshCw,
  Phone, User, ChevronLeft, Wifi, WifiOff, Users
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

type Instance = {
  id: number;
  instanceName: string;
  displayName: string | null;
  phone: string | null;
  status: "connecting" | "connected" | "disconnected" | "qr_code";
};

type Conversation = {
  id: number;
  instanceId: number;
  instanceName: string;
  remoteJid: string;
  phone: string | null;
  contactName: string | null;
  contactPhoto: string | null;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  status: "open" | "pending" | "resolved" | "closed";
};

type Message = {
  id: number;
  content: string | null;
  messageType: "text" | "audio" | "image" | "document" | "video" | "sticker" | "reaction" | "system";
  direction: "inbound" | "outbound";
  senderName: string | null;
  timestamp: number;
  status: "sent" | "delivered" | "read" | "failed";
};

export default function EvolutionInbox() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split("?")[1] || "");
  const instanceParam = searchParams.get("instance") || "";

  const [selectedInstanceName, setSelectedInstanceName] = useState(instanceParam);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messageText, setMessageText] = useState("");
  const [search, setSearch] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const instancesQuery = trpc.evolution.listInstances.useQuery();
  const instances = instancesQuery.data || [];
  const selectedInstance = instances.find(i => i.instanceName === selectedInstanceName);

  const conversationsQuery = trpc.evolution.listConversations.useQuery(
    { instanceId: selectedInstance?.id },
    { refetchInterval: 10000 }
  );
  const conversations = (conversationsQuery.data || []) as Conversation[];

  const messagesQuery = trpc.evolution.listMessages.useQuery(
    { conversationId: selectedConversation?.id || 0, limit: 100 },
    { enabled: !!selectedConversation, refetchInterval: 5000 }
  );
  const messages = (messagesQuery.data || []) as Message[];

  const sendMutation = trpc.evolution.sendMessage.useMutation({
    onSuccess: () => {
      setMessageText("");
      messagesQuery.refetch();
      conversationsQuery.refetch();
    },
    onError: (e) => toast.error("Erro ao enviar: " + e.message),
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filteredConversations = conversations.filter(c =>
    !search || (c.contactName || c.phone || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSend = () => {
    if (!messageText.trim() || !selectedConversation || !selectedInstanceName) return;
    sendMutation.mutate({
      instanceName: selectedInstanceName,
      remoteJid: selectedConversation.remoteJid,
      text: messageText.trim(),
      conversationId: selectedConversation.id,
    });
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  const statusIcon = (status: Instance["status"]) =>
    status === "connected"
      ? <Wifi className="w-3 h-3 text-green-500" />
      : <WifiOff className="w-3 h-3 text-red-400" />;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left sidebar: instances + conversations */}
      <div className={cn(
        "flex flex-col border-r bg-card transition-all duration-200",
        showSidebar ? "w-80" : "w-0 overflow-hidden"
      )}>
        {/* Instance selector */}
        <div className="p-3 border-b">
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Números</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            <button
              onClick={() => { setSelectedInstanceName(""); setSelectedConversation(null); }}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-accent transition-colors",
                !selectedInstanceName && "bg-accent"
              )}
            >
              <Users className="w-4 h-4 text-muted-foreground" />
              <span>Todos os números</span>
              <Badge variant="secondary" className="ml-auto text-xs">{conversations.length}</Badge>
            </button>
            {instances.map(inst => (
              <button
                key={inst.id}
                onClick={() => { setSelectedInstanceName(inst.instanceName); setSelectedConversation(null); }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-accent transition-colors",
                  selectedInstanceName === inst.instanceName && "bg-accent"
                )}
              >
                {statusIcon(inst.status)}
                <span className="truncate">{inst.displayName || inst.instanceName}</span>
                {inst.phone && <span className="text-xs text-muted-foreground ml-auto">{inst.phone.slice(-4)}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar conversa..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          {conversationsQuery.isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {selectedInstanceName ? "Nenhuma conversa ainda" : "Selecione um número"}
            </div>
          ) : (
            filteredConversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversation(conv)}
                className={cn(
                  "w-full flex items-start gap-3 p-3 hover:bg-accent border-b text-left transition-colors",
                  selectedConversation?.id === conv.id && "bg-accent"
                )}
              >
                <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  {conv.contactPhoto ? (
                    <img src={conv.contactPhoto} className="w-9 h-9 rounded-full object-cover" alt="" />
                  ) : (
                    <User className="w-4 h-4 text-green-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">
                      {conv.contactName || conv.phone || conv.remoteJid}
                    </span>
                    {conv.lastMessageAt && (
                      <span className="text-xs text-muted-foreground ml-1 flex-shrink-0">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.lastMessagePreview || "Sem mensagens"}
                    </p>
                    {conv.unreadCount > 0 && (
                      <Badge className="ml-1 bg-green-500 text-white text-xs px-1.5 py-0 flex-shrink-0">
                        {conv.unreadCount}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">{conv.instanceName}</p>
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedConversation ? (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 p-3 border-b bg-card">
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setShowSidebar(true)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-green-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">
                  {selectedConversation.contactName || selectedConversation.phone || selectedConversation.remoteJid}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {selectedConversation.phone} · {selectedConversation.instanceName}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => messagesQuery.refetch()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-2 max-w-2xl mx-auto">
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={cn("flex", msg.direction === "outbound" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
                        msg.direction === "outbound"
                          ? "bg-green-500 text-white rounded-br-sm"
                          : "bg-muted rounded-bl-sm"
                      )}
                    >
                      {msg.messageType !== "text" && (
                        <p className="text-xs opacity-70 mb-1">[{msg.messageType}]</p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <p className={cn(
                        "text-xs mt-1 text-right",
                        msg.direction === "outbound" ? "text-green-100" : "text-muted-foreground"
                      )}>
                        {formatTime(msg.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Message input */}
            <div className="p-3 border-t bg-card">
              <div className="flex gap-2 max-w-2xl mx-auto">
                <Input
                  placeholder="Digite uma mensagem..."
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  className="flex-1"
                />
                <Button
                  onClick={handleSend}
                  disabled={!messageText.trim() || sendMutation.isPending}
                  className="bg-green-500 hover:bg-green-600 text-white"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Inbox dos Vendedores</h3>
              <p className="text-muted-foreground text-sm max-w-xs">
                {instances.length === 0
                  ? "Nenhum número conectado. Vá em Números WhatsApp para adicionar."
                  : "Selecione uma conversa para visualizar as mensagens"
                }
              </p>
              {instances.length === 0 && (
                <Button className="mt-4" onClick={() => window.location.href = "/evolution-instances"}>
                  <Smartphone className="w-4 h-4 mr-2" />
                  Gerenciar Números
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
