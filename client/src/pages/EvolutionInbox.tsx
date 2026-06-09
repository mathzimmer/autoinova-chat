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
  if (status === "read") return <CheckCheck className="w-3.5 h-3.5 text-blue-500" />;
  if (status === "delivered") return <CheckCheck className="w-3.5 h-3.5 text-gray-500" />;
  if (status === "sent") return <Check className="w-3.5 h-3.5 text-gray-500" />;
  return <Clock className="w-3.5 h-3.5 text-gray-400" />;
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
          isOut ? "bg-[#d9fdd3] text-gray-900 rounded-br-sm" : "bg-white text-gray-900 rounded-bl-sm shadow-sm"
        )
      )}>
        {renderContent()}
        {!isSticker && !isReaction && (
          <div className={cn("flex items-center justify-end gap-1 mt-1", isOut ? "text-gray-500" : "text-gray-400")}>
            <span className="text-[10px]">{formatTime(msg.timestamp)}</span>
            <MessageStatusIcon status={msg.status} direction={msg.direction} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper functions (outside component to avoid TDZ issues) ─────────────────

// Format phone number for display: remove @lid/@s.whatsapp.net suffix and show cleanly
function formatPhone(phone: string | null | undefined, remoteJid?: string | null): string {
  const raw = phone || remoteJid || "";
  const clean = raw.replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "").replace(/@lid$/, "");
  if (/^\d+$/.test(clean)) {
    if (clean.startsWith("55") && clean.length >= 12) {
      const local = clean.slice(2);
      if (local.length === 11) {
        return `+55 (${local.slice(0,2)}) ${local.slice(2,7)}-${local.slice(7)}`;
      } else if (local.length === 10) {
        return `+55 (${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`;
      }
      return `+55 ${local}`;
    }
    return clean;
  }
  return clean || "Número desconhecido";
}

// Get display name: prefer contactName, then formatted phone
function getDisplayName(conv: { contactName?: string | null; phone?: string | null; remoteJid?: string | null }): string {
  if (conv.contactName && conv.contactName !== conv.phone && !conv.contactName.includes("@lid")) {
    return conv.contactName;
  }
  return formatPhone(conv.phone, conv.remoteJid);
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
  const [editingContactPhone, setEditingContactPhone] = useState(false);
  const [contactPhoneInput, setContactPhoneInput] = useState("");
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [newConvPhone, setNewConvPhone] = useState("");
  const [newConvName, setNewConvName] = useState("");
  const [newConvText, setNewConvText] = useState("");
  const [saveContactName, setSaveContactName] = useState("");
  const [saveContactPhone, setSaveContactPhone] = useState("");
  const [saveContactNotes, setSaveContactNotes] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "pending" | "resolved">("all");
  const [isUploading, setIsUploading] = useState(false);
  const [lidPhoneInput, setLidPhoneInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Detect if selected conversation has unresolved @lid JID
  const isLidConversation = !!(selectedConversation?.remoteJid?.endsWith("@lid"));
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
    onSuccess: (data) => {
      setMessageText("");
      messagesQuery.refetch();
      conversationsQuery.refetch();
      if ((data as any)?.pendingDelivery) {
        toast.info("Mensagem salva. Será entregue quando o número real for identificado.", { duration: 4000 });
      }
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
    onSuccess: (_, vars) => {
      conversationsQuery.refetch();
      if (selectedConversation) {
        setSelectedConversation(prev => prev ? {
          ...prev,
          contactName: vars.contactName !== undefined ? vars.contactName : prev.contactName,
          phone: vars.phone !== undefined ? vars.phone.replace(/\D/g, "") : prev.phone,
          remoteJid: vars.phone !== undefined ? `${vars.phone.replace(/\D/g, "")}@s.whatsapp.net` : prev.remoteJid,
        } : prev);
      }
      setEditingContactName(false);
      setEditingContactPhone(false);
    },
  });

  const resolvePhoneMutation = trpc.evolution.resolveContactPhone.useMutation({
    onSuccess: (data) => {
      if (data.resolved) {
        toast.success(`Número resolvido: ${data.phone}`);
        conversationsQuery.refetch();
        if (selectedConversation) {
          setSelectedConversation(prev => prev ? {
            ...prev,
            phone: data.phone || prev.phone,
            remoteJid: data.jid || prev.remoteJid,
            contactName: data.name || prev.contactName,
          } : prev);
        }
      } else {
        toast.info(data.message || "Não foi possível resolver automaticamente. Use a edição manual.");
      }
    },
    onError: (e) => toast.error("Erro ao resolver número: " + e.message),
  });

  const syncContactsMutation = trpc.evolution.syncContacts.useMutation({
    onSuccess: (data) => {
      setIsSyncingContacts(false);
      toast.success(data.message || "Contatos sincronizados!");
      conversationsQuery.refetch();
    },
    onError: (e) => {
      setIsSyncingContacts(false);
      toast.error("Erro ao sincronizar: " + e.message);
    },
  });

  const markAsReadMutation = trpc.evolution.markAsRead.useMutation();

  // Query linked contact for selected conversation
  const linkedContactQuery = trpc.evolution.getLinkedContact.useQuery(
    { conversationId: selectedConversation?.id || 0 },
    { enabled: !!selectedConversation }
  );
  const linkedContact = linkedContactQuery.data as { id: number; name: string; phone: string; notes?: string | null; source?: string | null } | null;

  const saveContactMutation = trpc.evolution.saveAndLinkContact.useMutation({
    onSuccess: (data) => {
      toast.success(`Contato "${saveContactName}" salvo e vinculado!`);
      setShowSaveContactDialog(false);
      setSaveContactName("");
      setSaveContactPhone("");
      setSaveContactNotes("");
      linkedContactQuery.refetch();
      conversationsQuery.refetch();
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
    // @lid conversations will self-heal when the contact sends a new message (WPP_LID_MODE=false)
  }, [selectedConversation?.id]);

  // Set contact name input when conversation changes
  useEffect(() => {
    if (selectedConversation) {
      setContactNameInput(getDisplayName(selectedConversation));
    }
  }, [selectedConversation?.id]);

  const filteredConversations = conversations.filter(c => {
    const displayName = getDisplayName(c);
    const matchSearch = !search || displayName.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || "").includes(search) ||
      (c.contactName || "").toLowerCase().includes(search.toLowerCase());
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
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[#111b21] text-[#e9edef] relative">

        {/* ── Left Panel: Instances + Conversations ── */}
        <div className={cn(
          "flex flex-col border-r border-[#2a3942] bg-[#111b21] transition-all duration-200 z-20",
          showSidebar
            ? "absolute inset-0 md:relative md:w-[340px] md:min-w-[340px]"
            : "w-0 overflow-hidden absolute md:relative"
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-[#202c33]">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-green-400" />
              <span className="font-semibold text-sm">Inbox Vendedores</span>
              {totalUnread > 0 && (
                <Badge className="bg-green-500 text-white text-xs px-1.5 py-0">{totalUnread}</Badge>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-[#aebac1] hover:text-white hover:bg-[#2a3942]"
                    onClick={() => setShowNewConvDialog(true)}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Nova conversa</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-[#aebac1] hover:text-white hover:bg-[#2a3942]"
                    onClick={() => window.location.href = "/evolution-instances"}>
                    <Smartphone className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Gerenciar Instâncias / Conectar Números</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-[#aebac1] hover:text-white hover:bg-[#2a3942]"
                    disabled={isSyncingContacts || !selectedInstanceName}
                    onClick={() => {
                      if (!selectedInstanceName) { toast.info("Selecione uma instância primeiro"); return; }
                      setIsSyncingContacts(true);
                      syncContactsMutation.mutate({ instanceName: selectedInstanceName });
                    }}>
                    <Users className={cn("w-4 h-4", isSyncingContacts && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sincronizar contatos</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-[#aebac1] hover:text-white hover:bg-[#2a3942]"
                    onClick={() => { instancesQuery.refetch(); conversationsQuery.refetch(); }}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Atualizar</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Instance selector */}
          <div className="px-2 py-1.5 bg-[#202c33] border-b border-[#2a3942]">
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
          <div className="px-2 py-1.5 bg-[#111b21] border-b border-[#2a3942]">
            <div className="relative mb-1.5">
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
                  onClick={() => { setSelectedConversation(conv); if (window.innerWidth < 768) setShowSidebar(false); }}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 hover:bg-[#2a3942] border-b border-[#2a3942]/50 text-left transition-colors",
                    selectedConversation?.id === conv.id && "bg-[#2a3942]"
                  )}
                >
                  <Avatar name={getDisplayName(conv)} photo={conv.contactPhoto} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-medium text-[#e9edef] truncate">
                        {getDisplayName(conv)}
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
                    <div className="flex items-center gap-1 mt-0.5">
                      <p className="text-[10px] text-[#8696a0]/60">{conv.instanceName}</p>
                      {conv.remoteJid?.endsWith("@lid") && (
                        <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1 rounded">@lid</span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </ScrollArea>
        </div>

        {/* ── Main Chat Area ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#e5ddd5]" style={{
          backgroundImage: "url('data:image/svg+xml,%3Csvg width=\"200\" height=\"200\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cdefs%3E%3Cpattern id=\"p\" width=\"40\" height=\"40\" patternUnits=\"userSpaceOnUse\"%3E%3Cpath d=\"M0 20h40M20 0v40\" stroke=\"rgba(0,0,0,0.03)\" fill=\"none\"/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\"200\" height=\"200\" fill=\"url(%23p)\"/%3E%3C/svg%3E')"
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
                    name={getDisplayName(selectedConversation)}
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
                            {linkedContact ? linkedContact.name : getDisplayName(selectedConversation)}
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
                    <p className="text-xs flex items-center gap-1">
                      <Phone className="w-3 h-3 text-[#8696a0]" />
                      {linkedContact ? (
                        <span className="text-[#8696a0]">{formatPhone(linkedContact.phone)}</span>
                      ) : (
                        <span className="text-[#8696a0]">{formatPhone(selectedConversation.phone, selectedConversation.remoteJid)}</span>
                      )}
                      <span className="text-[#8696a0]"> · {selectedConversation.instanceName}</span>
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
                        <span className="bg-white/80 text-gray-600 text-xs px-3 py-1 rounded-full shadow-sm">
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
                    <div className="text-center py-12 text-gray-500 text-sm">
                      Nenhuma mensagem ainda. Inicie a conversa!
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message input */}
              <div className="px-4 py-3 bg-[#202c33] border-t border-[#2a3942]">

                {/* Subtle @lid info - non-blocking */}

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
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center max-w-sm">
                <div className="w-16 h-16 rounded-full bg-[#202c33] flex items-center justify-center mx-auto mb-3">
                  <MessageSquare className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold text-[#e9edef] mb-2">Inbox dos Vendedores</h3>
                <p className="text-[#8696a0] text-sm mb-4">
                  {instances.length === 0
                    ? "Nenhum número conectado. Conecte um número para começar."
                    : "Selecione uma conversa para atender"
                  }
                </p>
                <div className="flex flex-col gap-2 items-center">
                  {instances.length === 0 ? (
                    <Button className="bg-green-500 hover:bg-green-600 text-white"
                      onClick={() => window.location.href = "/evolution-instances"}>
                      <Smartphone className="w-4 h-4 mr-2" />
                      Conectar Número
                    </Button>
                  ) : (
                    <>
                      <Button className="bg-green-500 hover:bg-green-600 text-white"
                        onClick={() => setShowNewConvDialog(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Nova Conversa
                      </Button>
                      <Button variant="outline" className="border-[#2a3942] text-[#aebac1] hover:bg-[#2a3942] hover:text-white"
                        onClick={() => window.location.href = "/evolution-instances"}>
                        <Smartphone className="w-4 h-4 mr-2" />
                        Gerenciar Instâncias
                      </Button>
                    </>
                  )}
                </div>
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
                  name={getDisplayName(selectedConversation)}
                  photo={selectedConversation.contactPhoto}
                  size="lg"
                />
                <p className="font-semibold mt-3 text-[#e9edef]">
                  {getDisplayName(selectedConversation)}
                </p>
                <p className="text-xs mt-1">
                  <span className="text-[#8696a0]">{formatPhone(selectedConversation.phone, selectedConversation.remoteJid)}</span>
                </p>
                {statusBadge(selectedConversation.status)}
              </div>

              <div className="space-y-4">
                {/* Phone number section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-[#8696a0] uppercase font-semibold">Número WhatsApp</p>
                    {!editingContactPhone && (
                      <button onClick={() => { setEditingContactPhone(true); setContactPhoneInput(selectedConversation.phone || ""); }}
                        className="text-[#8696a0] hover:text-white">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {editingContactPhone ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={contactPhoneInput}
                        onChange={e => setContactPhoneInput(e.target.value)}
                        placeholder="5551999999999"
                        className="h-7 text-xs bg-[#2a3942] border-none text-white flex-1"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" className="w-6 h-6 text-green-400 flex-shrink-0"
                        onClick={() => {
                          if (!contactPhoneInput.trim()) return;
                          updateConvMutation.mutate({ id: selectedConversation.id, phone: contactPhoneInput.trim() });
                        }}>
                        <Save className="w-3 h-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="w-6 h-6 text-red-400 flex-shrink-0"
                        onClick={() => setEditingContactPhone(false)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-[#e9edef] flex items-center gap-2">
                        <Phone className="w-4 h-4 text-green-400 flex-shrink-0" />
                        <span className={cn(
                          selectedConversation.remoteJid?.endsWith("@lid") ? "text-yellow-400" : "text-[#e9edef]"
                        )}>
                          {formatPhone(selectedConversation.phone, selectedConversation.remoteJid)}
                        </span>
                      </p>
                      {selectedConversation.remoteJid?.endsWith("@lid") && (
                        <p className="text-[10px] text-[#8696a0]/60 mt-1">Número será atualizado automaticamente</p>
                      )}
                    </div>
                  )}
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
                {/* Linked Contact Section */}
                <div className="pt-2 border-t border-[#2a3942] space-y-2">
                  {linkedContact ? (
                    <div className="space-y-2">
                      <p className="text-xs text-[#8696a0] uppercase font-semibold">Contato Vinculado</p>
                      <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <UserCheck className="w-4 h-4 text-green-400" />
                          <span className="text-sm font-medium text-green-300">{linkedContact.name}</span>
                        </div>
                        <p className="text-xs text-[#8696a0] ml-6">{formatPhone(linkedContact.phone)}</p>
                        {linkedContact.notes && (
                          <p className="text-xs text-[#8696a0] ml-6 mt-1 italic">{linkedContact.notes}</p>
                        )}
                      </div>
                      <Button
                        className="w-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/30"
                        variant="outline"
                        size="sm"
                        onClick={() => window.open("/contacts", "_blank")}
                      >
                        <Users className="w-4 h-4 mr-2" />
                        Ver no Módulo de Contatos
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-[#8696a0] uppercase font-semibold">Contato</p>
                      <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-yellow-400" />
                          <span className="text-xs text-yellow-300">Contato não vinculado ao módulo</span>
                        </div>
                      </div>
                      <Button
                        className="w-full bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30"
                        variant="outline"
                        onClick={() => {
                          setSaveContactName(getDisplayName(selectedConversation));
                          setSaveContactPhone(selectedConversation.phone || "");
                          setSaveContactNotes("");
                          setShowSaveContactDialog(true);
                        }}
                      >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Salvar como Contato
                      </Button>
                      <Button
                        className="w-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/30"
                        variant="outline"
                        size="sm"
                        onClick={() => window.open("/contacts", "_blank")}
                      >
                        <Users className="w-4 h-4 mr-2" />
                        Ver Módulo de Contatos
                      </Button>
                    </div>
                  )}
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
                Salvar no Módulo de Contatos
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Nome *</Label>
                <Input
                  value={saveContactName}
                  onChange={e => setSaveContactName(e.target.value)}
                  placeholder="Nome do contato"
                  className="bg-[#2a3942] border-[#3a4a52] text-[#e9edef] placeholder:text-[#8696a0]"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Telefone WhatsApp *</Label>
                <Input
                  value={saveContactPhone}
                  onChange={e => setSaveContactPhone(e.target.value)}
                  placeholder="5551999999999"
                  className="bg-[#2a3942] border-[#3a4a52] text-[#e9edef] placeholder:text-[#8696a0]"
                />
                <p className="text-xs text-[#8696a0] mt-1">Somente números, com DDD e código do país (55)</p>
              </div>
              <div>
                <Label className="text-[#aebac1] text-xs mb-1.5 block">Observações (opcional)</Label>
                <Textarea
                  value={saveContactNotes}
                  onChange={e => setSaveContactNotes(e.target.value)}
                  placeholder="Notas sobre o contato..."
                  className="bg-[#2a3942] border-[#3a4a52] text-[#e9edef] placeholder:text-[#8696a0] text-sm resize-none h-16"
                />
              </div>
              {linkedContact ? (
                <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <UserCheck className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <p className="text-xs text-green-300">
                    Contato já vinculado: <strong>{linkedContact.name}</strong> ({formatPhone(linkedContact.phone)}). Salvar atualizará os dados existentes.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2 bg-[#1a2730] rounded-lg">
                  <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <p className="text-xs text-[#8696a0]">
                    O contato será salvo no{" "}
                    <a href="/contacts" target="_blank" className="text-blue-400 hover:underline">Módulo de Contatos</a>
                    {" "}e vinculado a esta conversa. Se o número já existir, os dados serão mesclados automaticamente.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" onClick={() => setShowSaveContactDialog(false)} className="text-[#aebac1]">
                Cancelar
              </Button>
              <Button
                variant="outline"
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                onClick={() => { setShowSaveContactDialog(false); window.open("/contacts", "_blank"); }}
              >
                <User className="w-4 h-4 mr-2" />
                Ver Contatos
              </Button>
              <Button
                className="bg-green-500 hover:bg-green-600 text-white"
                disabled={!saveContactName.trim() || !saveContactPhone.trim() || saveContactMutation.isPending}
                onClick={() => {
                  if (!selectedConversation) return;
                  saveContactMutation.mutate({
                    conversationId: selectedConversation.id,
                    name: saveContactName.trim(),
                    phone: saveContactPhone.trim(),
                    notes: saveContactNotes.trim() || undefined,
                  });
                }}
              >
                {saveContactMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <UserCheck className="w-4 h-4 mr-2" />
                )}
                Salvar Contato
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider>
  );
}
