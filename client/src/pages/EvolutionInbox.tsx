import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  MessageSquare, Send, Smartphone, Search, RefreshCw,
  Phone, User, ChevronLeft, Wifi, WifiOff, Users,
  Paperclip, Image, FileText, Smile, MoreVertical,
  UserPlus, UserCheck, CheckCheck, Check, Clock,
  X, Download, Play, Volume2, Star, Archive,
  MessageCircle, Plus, Camera, Mic, Video,
  ChevronDown, Info, Edit2, Save
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";

type Instance = {
  id: number;
  instanceName: string;
  displayName: string | null;
  phone: string | null;
  status: "connecting" | "connected" | "disconnected" | "qr_code";
  profilePicUrl?: string | null;
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
  notes?: string | null;
  leadStatus?: string | null;
  vehicleInterest?: string | null;
};

type Message = {
  id: number;
  content: string | null;
  messageType: "text" | "audio" | "image" | "document" | "video" | "sticker" | "reaction" | "system";
  direction: "inbound" | "outbound";
  senderName: string | null;
  timestamp: number;
  status: "sent" | "delivered" | "read" | "failed";
  mediaUrl?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

const EMOJI_LIST = ["😀","😂","❤️","👍","👎","🙏","🔥","🎉","😍","🤔","😎","🥳","💪","✅","❌","⭐","💰","🚗","📱","📞"];

function Avatar({ name, photo, size = "md" }: { name?: string | null; photo?: string | null; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "w-8 h-8 text-xs" : size === "lg" ? "w-12 h-12 text-base" : "w-10 h-10 text-sm";
  const initials = (name || "?").split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
  if (photo) {
    return <img src={photo} className={cn(sizeClass, "rounded-full object-cover flex-shrink-0")} alt={name || ""} />;
  }
  return (
    <div className={cn(sizeClass, "rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center flex-shrink-0 text-white font-semibold")}>
      {initials}
    </div>
  );
}

function MessageStatusIcon({ status, direction }: { status: Message["status"]; direction: Message["direction"] }) {
  if (direction !== "outbound") return null;
  if (status === "read") return <CheckCheck className="w-3.5 h-3.5 text-blue-400" />;
  if (status === "delivered") return <CheckCheck className="w-3.5 h-3.5 text-green-200" />;
  if (status === "sent") return <Check className="w-3.5 h-3.5 text-green-200" />;
  return <Clock className="w-3.5 h-3.5 text-green-200" />;
}

function MessageBubble({ msg, formatTime }: { msg: Message; formatTime: (ts: number) => string }) {
  const isOut = msg.direction === "outbound";

  const renderContent = () => {
    if (msg.messageType === "image" && msg.mediaUrl) {
      return (
        <div>
          <img
            src={msg.mediaUrl}
            className="max-w-[240px] rounded-lg mb-1 cursor-pointer"
            alt="imagem"
            onClick={() => window.open(msg.mediaUrl!, "_blank")}
          />
          {msg.content && msg.content !== "[Imagem]" && (
            <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
          )}
        </div>
      );
    }
    if (msg.messageType === "video" && msg.mediaUrl) {
      return (
        <div>
          <video src={msg.mediaUrl} controls className="max-w-[240px] rounded-lg mb-1" />
          {msg.content && msg.content !== "[Vídeo]" && (
            <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
          )}
        </div>
      );
    }
    if (msg.messageType === "audio" && msg.mediaUrl) {
      return (
        <div className="flex items-center gap-2 min-w-[180px]">
          <Volume2 className="w-4 h-4 flex-shrink-0" />
          <audio src={msg.mediaUrl} controls className="h-8 flex-1" />
        </div>
      );
    }
    if (msg.messageType === "document" && msg.mediaUrl) {
      return (
        <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 hover:underline">
          <FileText className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm truncate max-w-[200px]">{msg.content || "Documento"}</span>
          <Download className="w-3 h-3 flex-shrink-0" />
        </a>
      );
    }
    if (msg.messageType === "sticker" && msg.mediaUrl) {
      return <img src={msg.mediaUrl} className="w-24 h-24 object-contain" alt="sticker" />;
    }
    if (msg.messageType === "reaction") {
      return <span className="text-2xl">{msg.content}</span>;
    }
    return <p className="text-sm whitespace-pre-wrap break-words">{msg.content || ""}</p>;
  };

  const isSticker = msg.messageType === "sticker";
  const isReaction = msg.messageType === "reaction";

  return (
    <div className={cn("flex gap-2 group", isOut ? "justify-end" : "justify-start")}>
      <div className={cn(
        "relative max-w-[75%]",
        isSticker || isReaction ? "" : cn(
          "rounded-2xl px-3 py-2 shadow-sm",
          isOut ? "bg-[#005c4b] text-white rounded-br-sm" : "bg-[#202c33] text-[#e9edef] rounded-bl-sm"
        )
      )}>
        {renderContent()}
        {!isSticker && !isReaction && (
          <div className={cn("flex items-center justify-end gap-1 mt-1", isOut ? "text-green-200/70" : "text-[#8696a0]")}>
            <span className="text-[10px]">{formatTime(msg.timestamp)}</span>
            <MessageStatusIcon status={msg.status} direction={msg.direction} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function EvolutionInbox() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split("?")[1] || "");
  const instanceParam = searchParams.get("instance") || "";

  const [selectedInstanceName, setSelectedInstanceName] = useState(instanceParam);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messageText, setMessageText] = useState("");
  const [search, setSearch] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showNewConvDialog, setShowNewConvDialog] = useState(false);
  const [showSaveContactDialog, setShowSaveContactDialog] = useState(false);
  const [editingContactName, setEditingContactName] = useState(false);
  const [contactNameInput, setContactNameInput] = useState("");
  const [newConvPhone, setNewConvPhone] = useState("");
  const [newConvName, setNewConvName] = useState("");
  const [newConvText, setNewConvText] = useState("");
  const [saveContactName, setSaveContactName] = useState("");
  const [saveContactPhone, setSaveContactPhone] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "pending" | "resolved">("all");
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const instancesQuery = trpc.evolution.listInstances.useQuery();
  const instances = (instancesQuery.data || []) as Instance[];
  const selectedInstance = instances.find(i => i.instanceName === selectedInstanceName);

  const conversationsQuery = trpc.evolution.listConversations.useQuery(
    { instanceId: selectedInstance?.id },
    { refetchInterval: 8000 }
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

  const uploadSendMutation = trpc.evolution.uploadAndSendMedia.useMutation({
    onSuccess: () => {
      setIsUploading(false);
      messagesQuery.refetch();
      conversationsQuery.refetch();
      toast.success("Arquivo enviado!");
    },
    onError: (e) => {
      setIsUploading(false);
      toast.error("Erro ao enviar arquivo: " + e.message);
    },
  });

  const startConvMutation = trpc.evolution.startConversation.useMutation({
    onSuccess: (data) => {
      setShowNewConvDialog(false);
      setNewConvPhone(""); setNewConvName(""); setNewConvText("");
      conversationsQuery.refetch();
      toast.success("Conversa iniciada!");
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const updateConvMutation = trpc.evolution.updateConversation.useMutation({
    onSuccess: () => {
      conversationsQuery.refetch();
      if (selectedConversation) {
        setSelectedConversation(prev => prev ? { ...prev, contactName: contactNameInput } : prev);
      }
      setEditingContactName(false);
    },
  });

  const markAsReadMutation = trpc.evolution.markAsRead.useMutation();

  const saveContactMutation = trpc.contact.create.useMutation({
    onSuccess: () => {
      toast.success(`Contato "${saveContactName}" salvo com sucesso!`);
      setShowSaveContactDialog(false);
      setSaveContactName("");
      setSaveContactPhone("");
    },
    onError: (e: { message: string }) => toast.error("Erro ao salvar contato: " + e.message),
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark as read when opening conversation
  useEffect(() => {
    if (selectedConversation && selectedConversation.unreadCount > 0) {
      markAsReadMutation.mutate({ conversationId: selectedConversation.id });
    }
  }, [selectedConversation?.id]);

  // Set contact name input when conversation changes
  useEffect(() => {
    if (selectedConversation) {
      setContactNameInput(selectedConversation.contactName || selectedConversation.phone || "");
    }
  }, [selectedConversation?.id]);

  const filteredConversations = conversations.filter(c => {
    const matchSearch = !search || (c.contactName || c.phone || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleSend = () => {
    if (!messageText.trim() || !selectedConversation || !selectedInstanceName) return;
    sendMutation.mutate({
      instanceName: selectedInstanceName,
      remoteJid: selectedConversation.remoteJid,
      text: messageText.trim(),
      conversationId: selectedConversation.id,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedConversation || !selectedInstanceName) return;

    const MAX_SIZE = 16 * 1024 * 1024; // 16MB
    if (file.size > MAX_SIZE) {
      toast.error("Arquivo muito grande. Máximo 16MB.");
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadSendMutation.mutate({
        instanceName: selectedInstanceName,
        remoteJid: selectedConversation.remoteJid,
        fileBase64: base64,
        mimeType: file.type,
        fileName: file.name,
        conversationId: selectedConversation.id,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleEmojiClick = (emoji: string) => {
    setMessageText(prev => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  };

  const handleSaveContactName = () => {
    if (!selectedConversation || !contactNameInput.trim()) return;
    updateConvMutation.mutate({
      id: selectedConversation.id,
      contactName: contactNameInput.trim(),
    });
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  const formatFullTime = (ts: number) => {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  };

  const statusIcon = (status: Instance["status"]) =>
    status === "connected"
      ? <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
      : <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />;

  const statusBadge = (status: Conversation["status"]) => {
    const map: Record<string, string> = {
      open: "bg-green-500/20 text-green-400",
      pending: "bg-yellow-500/20 text-yellow-400",
      resolved: "bg-blue-500/20 text-blue-400",
      closed: "bg-gray-500/20 text-gray-400",
    };
    const label: Record<string, string> = {
      open: "Aberta", pending: "Pendente", resolved: "Resolvida", closed: "Fechada"
    };
    return <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", map[status])}>{label[status]}</span>;
  };

  // Group messages by date
  const groupedMessages: { date: string; messages: Message[] }[] = [];
  messages.forEach(msg => {
    const dateStr = new Date(msg.timestamp).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    const last = groupedMessages[groupedMessages.length - 1];
    if (!last || last.date !== dateStr) {
      groupedMessages.push({ date: dateStr, messages: [msg] });
    } else {
      last.messages.push(msg);
    }
  });

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  return (
    <TooltipProvider>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[#111b21] text-[#e9edef]">

        {/* ── Left Panel: Instances + Conversations ── */}
        <div className={cn(
          "flex flex-col border-r border-[#2a3942] bg-[#111b21] transition-all duration-200",
          showSidebar ? "w-[360px] min-w-[360px]" : "w-0 overflow-hidden"
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#202c33]">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-green-400" />
              <span className="font-semibold text-sm">Inbox Vendedores</span>
              {totalUnread > 0 && (
                <Badge className="bg-green-500 text-white text-xs px-1.5 py-0">{totalUnread}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-[#aebac1] hover:text-white hover:bg-[#2a3942]"
                    onClick={() => setShowNewConvDialog(true)}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Nova conversa</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-[#aebac1] hover:text-white hover:bg-[#2a3942]"
                    onClick={() => { instancesQuery.refetch(); conversationsQuery.refetch(); }}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Atualizar</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Instance selector */}
          <div className="px-3 py-2 bg-[#202c33] border-b border-[#2a3942]">
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => { setSelectedInstanceName(""); setSelectedConversation(null); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors",
                  !selectedInstanceName
                    ? "bg-green-500 text-white"
                    : "bg-[#2a3942] text-[#aebac1] hover:bg-[#3a4a52]"
                )}
              >
                <Users className="w-3 h-3" />
                Todos
              </button>
              {instances.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => { setSelectedInstanceName(inst.instanceName); setSelectedConversation(null); }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors",
                    selectedInstanceName === inst.instanceName
                      ? "bg-green-500 text-white"
                      : "bg-[#2a3942] text-[#aebac1] hover:bg-[#3a4a52]"
                  )}
                >
                  {statusIcon(inst.status)}
                  {inst.displayName || inst.instanceName}
                </button>
              ))}
            </div>
          </div>

          {/* Search + filter */}
          <div className="px-3 py-2 bg-[#111b21] border-b border-[#2a3942]">
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#8696a0]" />
              <Input
                placeholder="Pesquisar conversa..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm bg-[#202c33] border-none text-[#e9edef] placeholder:text-[#8696a0] focus-visible:ring-0"
              />
            </div>
            <div className="flex gap-1">
              {(["all", "open", "pending", "resolved"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full transition-colors",
                    filterStatus === s ? "bg-green-500 text-white" : "bg-[#2a3942] text-[#8696a0] hover:bg-[#3a4a52]"
                  )}
                >
                  {s === "all" ? "Todas" : s === "open" ? "Abertas" : s === "pending" ? "Pendentes" : "Resolvidas"}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation list */}
          <ScrollArea className="flex-1">
            {conversationsQuery.isLoading ? (
              <div className="p-6 text-center text-sm text-[#8696a0]">Carregando...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#8696a0]">
                {selectedInstanceName ? "Nenhuma conversa encontrada" : "Selecione um número ou veja todas"}
              </div>
            ) : (
              filteredConversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => { setSelectedConversation(conv); setShowSidebar(window.innerWidth > 768); }}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 hover:bg-[#2a3942] border-b border-[#2a3942]/50 text-left transition-colors",
                    selectedConversation?.id === conv.id && "bg-[#2a3942]"
                  )}
                >
                  <Avatar name={conv.contactName || conv.phone} photo={conv.contactPhoto} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-medium text-[#e9edef] truncate">
                        {conv.contactName || conv.phone || conv.remoteJid}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                        {conv.lastMessageAt && (
                          <span className={cn("text-[11px]", conv.unreadCount > 0 ? "text-green-400" : "text-[#8696a0]")}>
                            {formatTime(conv.lastMessageAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-[#8696a0] truncate flex-1">
                        {conv.lastMessagePreview || "Sem mensagens"}
                      </p>
                      <div className="flex items-center gap-1 ml-1 flex-shrink-0">
                        {conv.unreadCount > 0 && (
                          <span className="bg-green-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                            {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                          </span>
                        )}
                        {statusBadge(conv.status)}
                      </div>
                    </div>
                    <p className="text-[10px] text-[#8696a0]/60 mt-0.5">{conv.instanceName}</p>
                  </div>
                </button>
              ))
            )}
          </ScrollArea>
        </div>

        {/* ── Main Chat Area ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#0b141a]" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)",
          backgroundSize: "24px 24px"
        }}>
          {selectedConversation ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-[#202c33] border-b border-[#2a3942]">
                <Button variant="ghost" size="icon" className="md:hidden w-8 h-8 text-[#aebac1]"
                  onClick={() => setShowSidebar(true)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <button
                  className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                  onClick={() => setShowContactInfo(!showContactInfo)}
                >
                  <Avatar
                    name={selectedConversation.contactName || selectedConversation.phone}
                    photo={selectedConversation.contactPhoto}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {editingContactName ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <Input
                            value={contactNameInput}
                            onChange={e => setContactNameInput(e.target.value)}
                            className="h-6 text-sm bg-[#2a3942] border-none text-white w-40"
                            autoFocus
                          />
                          <Button size="icon" variant="ghost" className="w-6 h-6 text-green-400"
                            onClick={handleSaveContactName}>
                            <Save className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="w-6 h-6 text-red-400"
                            onClick={() => setEditingContactName(false)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p className="font-medium text-sm text-[#e9edef] truncate">
                            {selectedConversation.contactName || selectedConversation.phone || selectedConversation.remoteJid}
                          </p>
                          <button
                            onClick={e => { e.stopPropagation(); setEditingContactName(true); }}
                            className="text-[#8696a0] hover:text-white"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-[#8696a0] flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {selectedConversation.phone} · {selectedConversation.instanceName}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-1">
                  {statusBadge(selectedConversation.status)}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="w-8 h-8 text-[#aebac1] hover:text-white hover:bg-[#2a3942]">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-[#233138] border-[#2a3942] text-[#e9edef]">
                      <DropdownMenuItem onClick={() => {
                        updateConvMutation.mutate({ id: selectedConversation.id, status: "open" });
                        setSelectedConversation(prev => prev ? { ...prev, status: "open" } : prev);
                      }}>
                        <MessageCircle className="w-4 h-4 mr-2 text-green-400" /> Marcar como Aberta
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        updateConvMutation.mutate({ id: selectedConversation.id, status: "pending" });
                        setSelectedConversation(prev => prev ? { ...prev, status: "pending" } : prev);
                      }}>
                        <Clock className="w-4 h-4 mr-2 text-yellow-400" /> Marcar como Pendente
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        updateConvMutation.mutate({ id: selectedConversation.id, status: "resolved" });
                        setSelectedConversation(prev => prev ? { ...prev, status: "resolved" } : prev);
                      }}>
                        <CheckCheck className="w-4 h-4 mr-2 text-blue-400" /> Marcar como Resolvida
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-[#2a3942]" />
                      <DropdownMenuItem onClick={() => {
                        setSaveContactName(selectedConversation.contactName || "");
                        setSaveContactPhone(selectedConversation.phone || "");
                        setShowSaveContactDialog(true);
                      }}>
                        <UserPlus className="w-4 h-4 mr-2 text-purple-400" /> Salvar Contato
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => messagesQuery.refetch()}>
                        <RefreshCw className="w-4 h-4 mr-2" /> Atualizar mensagens
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Messages area */}
              <ScrollArea className="flex-1 px-4 py-4">
                <div className="space-y-1 max-w-3xl mx-auto">
                  {groupedMessages.map(group => (
                    <div key={group.date}>
                      {/* Date separator */}
                      <div className="flex items-center justify-center my-4">
                        <span className="bg-[#182229] text-[#8696a0] text-xs px-3 py-1 rounded-full">
                          {group.date}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {group.messages.map(msg => (
                          <MessageBubble key={msg.id} msg={msg} formatTime={formatTime} />
                        ))}
                      </div>
                    </div>
                  ))}
                  {messages.length === 0 && !messagesQuery.isLoading && (
                    <div className="text-center py-12 text-[#8696a0] text-sm">
                      Nenhuma mensagem ainda. Inicie a conversa!
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message input */}
              <div className="px-4 py-3 bg-[#202c33] border-t border-[#2a3942]">
                {/* Emoji picker */}
                {showEmojiPicker && (
                  <div className="mb-2 p-2 bg-[#233138] rounded-xl border border-[#2a3942] flex flex-wrap gap-1">
                    {EMOJI_LIST.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleEmojiClick(emoji)}
                        className="text-xl hover:scale-125 transition-transform p-1"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2 max-w-3xl mx-auto">
                  {/* Emoji button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost" size="icon"
                        className="w-9 h-9 text-[#aebac1] hover:text-white hover:bg-[#2a3942] flex-shrink-0"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      >
                        <Smile className="w-5 h-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Emojis</TooltipContent>
                  </Tooltip>

                  {/* Attach button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost" size="icon"
                        className="w-9 h-9 text-[#aebac1] hover:text-white hover:bg-[#2a3942] flex-shrink-0"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        {isUploading ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <Paperclip className="w-5 h-5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Anexar arquivo</TooltipContent>
                  </Tooltip>

                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                    onChange={handleFileUpload}
                  />

                  {/* Text input */}
                  <Textarea
                    ref={textareaRef}
                    placeholder="Digite uma mensagem..."
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    className="flex-1 min-h-[40px] max-h-32 resize-none bg-[#2a3942] border-none text-[#e9edef] placeholder:text-[#8696a0] focus-visible:ring-0 rounded-xl py-2.5 px-4 text-sm"
                    style={{ scrollbarWidth: "none" }}
                  />

                  {/* Send button */}
                  <Button
                    onClick={handleSend}
                    disabled={!messageText.trim() || sendMutation.isPending}
                    className="w-9 h-9 bg-green-500 hover:bg-green-600 text-white rounded-full flex-shrink-0 p-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-20 h-20 rounded-full bg-[#202c33] flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-10 h-10 text-green-400" />
                </div>
                <h3 className="text-xl font-semibold text-[#e9edef] mb-2">Inbox dos Vendedores</h3>
                <p className="text-[#8696a0] text-sm mb-4">
                  {instances.length === 0
                    ? "Nenhum número conectado. Configure os números dos vendedores primeiro."
                    : "Selecione uma conversa para começar a atender"
                  }
                </p>
                {instances.length === 0 ? (
                  <Button className="bg-green-500 hover:bg-green-600 text-white"
                    onClick={() => window.location.href = "/evolution-instances"}>
                    <Smartphone className="w-4 h-4 mr-2" />
                    Conectar Número
                  </Button>
                ) : (
                  <Button className="bg-green-500 hover:bg-green-600 text-white"
                    onClick={() => setShowNewConvDialog(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Nova Conversa
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Contact Info Panel ── */}
        {showContactInfo && selectedConversation && (
          <div className="w-72 flex-shrink-0 bg-[#111b21] border-l border-[#2a3942] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 bg-[#202c33]">
              <span className="font-semibold text-sm">Informações</span>
              <Button variant="ghost" size="icon" className="w-7 h-7 text-[#aebac1]"
                onClick={() => setShowContactInfo(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1 p-4">
              <div className="flex flex-col items-center mb-6">
                <Avatar
                  name={selectedConversation.contactName || selectedConversation.phone}
                  photo={selectedConversation.contactPhoto}
                  size="lg"
                />
                <p className="font-semibold mt-3 text-[#e9edef]">
                  {selectedConversation.contactName || selectedConversation.phone}
                </p>
                <p className="text-xs text-[#8696a0] mt-1">{selectedConversation.phone}</p>
                {statusBadge(selectedConversation.status)}
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[#8696a0] uppercase font-semibold mb-2">Número</p>
                  <p className="text-sm text-[#e9edef] flex items-center gap-2">
                    <Phone className="w-4 h-4 text-green-400" />
                    {selectedConversation.phone || selectedConversation.remoteJid}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#8696a0] uppercase font-semibold mb-2">Instância</p>
                  <p className="text-sm text-[#e9edef] flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-blue-400" />
                    {selectedConversation.instanceName}
                  </p>
                </div>
                {selectedConversation.lastMessageAt && (
                  <div>
                    <p className="text-xs text-[#8696a0] uppercase font-semibold mb-2">Última mensagem</p>
                    <p className="text-xs text-[#e9edef]">{formatFullTime(selectedConversation.lastMessageAt)}</p>
                  </div>
                )}
                <div className="pt-2 border-t border-[#2a3942]">
                  <Button
                    className="w-full bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30"
                    variant="outline"
                    onClick={() => {
                      setSaveContactName(selectedConversation.contactName || "");
                      setSaveContactPhone(selectedConversation.phone || "");
                      setShowSaveContactDialog(true);
                    }}
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Salvar como Contato
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}

        {/* ── New Conversation Dialog ── */}
        <Dialog open={showNewConvDialog} onOpenChange={setShowNewConvDialog}>
          <DialogContent className="bg-[#233138] border-[#2a3942] text-[#e9edef] max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-green-400" />
                Nova Conversa
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Número (instância)</Label>
                <select
                  className="w-full bg-[#2a3942] border border-[#3a4a52] text-[#e9edef] rounded-lg px-3 py-2 text-sm"
                  value={selectedInstanceName}
                  onChange={e => setSelectedInstanceName(e.target.value)}
                >
                  <option value="">Selecione um número...</option>
                  {instances.filter(i => i.status === "connected").map(inst => (
                    <option key={inst.id} value={inst.instanceName}>
                      {inst.displayName || inst.instanceName} {inst.phone ? `(${inst.phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Telefone do contato</Label>
                <Input
                  placeholder="5551999999999"
                  value={newConvPhone}
                  onChange={e => setNewConvPhone(e.target.value)}
                  className="bg-[#2a3942] border-[#3a4a52] text-[#e9edef] placeholder:text-[#8696a0]"
                />
                <p className="text-xs text-[#8696a0] mt-1">Formato: código do país + DDD + número (ex: 5551999999999)</p>
              </div>
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Nome (opcional)</Label>
                <Input
                  placeholder="Nome do contato"
                  value={newConvName}
                  onChange={e => setNewConvName(e.target.value)}
                  className="bg-[#2a3942] border-[#3a4a52] text-[#e9edef] placeholder:text-[#8696a0]"
                />
              </div>
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Primeira mensagem</Label>
                <Textarea
                  placeholder="Olá! Como posso ajudar?"
                  value={newConvText}
                  onChange={e => setNewConvText(e.target.value)}
                  rows={3}
                  className="bg-[#2a3942] border-[#3a4a52] text-[#e9edef] placeholder:text-[#8696a0] resize-none"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowNewConvDialog(false)} className="text-[#aebac1]">
                Cancelar
              </Button>
              <Button
                className="bg-green-500 hover:bg-green-600 text-white"
                disabled={!newConvPhone.trim() || !newConvText.trim() || !selectedInstanceName || startConvMutation.isPending}
                onClick={() => startConvMutation.mutate({
                  instanceName: selectedInstanceName,
                  phone: newConvPhone.trim(),
                  text: newConvText.trim(),
                  contactName: newConvName.trim() || undefined,
                })}
              >
                {startConvMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Enviar e Iniciar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Save Contact Dialog ── */}
        <Dialog open={showSaveContactDialog} onOpenChange={setShowSaveContactDialog}>
          <DialogContent className="bg-[#233138] border-[#2a3942] text-[#e9edef] max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-green-400" />
                Salvar Contato
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Nome</Label>
                <Input
                  value={saveContactName}
                  onChange={e => setSaveContactName(e.target.value)}
                  placeholder="Nome do contato"
                  className="bg-[#2a3942] border-[#3a4a52] text-[#e9edef] placeholder:text-[#8696a0]"
                />
              </div>
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Telefone</Label>
                <Input
                  value={saveContactPhone}
                  onChange={e => setSaveContactPhone(e.target.value)}
                  placeholder="5551999999999"
                  className="bg-[#2a3942] border-[#3a4a52] text-[#e9edef] placeholder:text-[#8696a0]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowSaveContactDialog(false)} className="text-[#aebac1]">
                Cancelar
              </Button>
              <Button
                className="bg-green-500 hover:bg-green-600 text-white"
                disabled={!saveContactName.trim() || !saveContactPhone.trim()}
              onClick={() => {
                saveContactMutation.mutate({
                  name: saveContactName.trim(),
                  phone: saveContactPhone.trim(),
                });
              }}
              >
                <UserCheck className="w-4 h-4 mr-2" />
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider>
  );
}
