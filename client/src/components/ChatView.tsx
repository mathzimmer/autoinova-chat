import { trpc } from "@/lib/trpc";
import { useConversationSocket } from "@/hooks/useSocket";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Send, Bot, User, Phone, ArrowLeft, Image, Volume2, FileText,
  Play, Pause, Mic, X, ImagePlus, Loader2, Clock, AlertTriangle,
  MessageSquareText, GitBranch, PauseCircle, List, Video, Smile,
  CornerUpLeft, Share2, Tag, AlarmClock, CalendarClock, StickyNote,
  Plus, Trash2, Zap, Car, Sparkles,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/_core/hooks/useAuth";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type Props = {
  conversationId: number;
  onBack?: () => void;
  panelToggle?: React.ReactNode;
};

const MAX_FILE_SIZE = 16 * 1024 * 1024;

type ImagePreviewItem = { file: File; dataUrl: string };

type MessageData = {
  id: number;
  content: string;
  senderType: string;
  senderName: string | null;
  messageType: string;
  metadata: unknown;
  createdAt: Date;
  status?: string | null;
  deliveryError?: string | null;
  externalId?: string | null;
};

// Hora das mensagens. Os timestamps vêm do banco como horário de Brasília (naive),
// mas o driver os rotula como UTC — então os "campos UTC" do valor JÁ contêm o
// relógio de Brasília. Exibindo em UTC mostramos a hora correta, independente do
// device de quem visualiza.
function horaBR(date: Date | string | number): string {
  return new Date(date).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });
}

/**
 * Mídia do Zernio precisa de Bearer token → não renderiza direto no navegador.
 * Reescreve a URL crua do Zernio para o proxy autenticado do CRM, que baixa com
 * o token e devolve os bytes. Corrige áudio/imagem/vídeo (inclusive mensagens já
 * salvas com a URL crua).
 */
function resolveMediaUrl(url?: string): string | undefined {
  if (!url) return url;
  const m = url.match(/zernio\.com\/api\/v1\/whatsapp\/media\/([^/?]+)[^]*?accountId=([^&]+)/);
  if (m) return `/api/zernio/media?mid=${encodeURIComponent(m[1])}&accountId=${encodeURIComponent(m[2])}`;
  return url;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const EMOJI_LIST = [
  "😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😋","😎","😍","🥰","😘",
  "😗","😙","😚","🙂","🤗","🤩","🤔","🤨","😐","😑","😶","🙄","😏","😣","😥",
  "😮","🤐","😯","😪","😫","😴","😌","😛","😜","😝","🤤","😒","😓","😔","😕",
  "🙃","🤑","😲","☹️","🙁","😖","😞","😟","😤","😢","😭","😦","😧","😨","😩",
  "🤯","😬","😰","😱","🥵","🥶","😳","🤪","😵","😡","😠","🤬","😷","🤒","🤕",
  "🤢","🤮","🤧","😇","🥳","🥺","🤠","🤡","🤥","🤫","🤭","🧐","🤓","😈","👿",
  "👋","🤚","🖐","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉",
  "👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝",
  "🙏","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓",
  "💗","💖","💘","💝","💟","🔥","✨","⭐","🌟","💫","❄️","🎉","🎊","🎈","🎁",
  "🚗","🚕","🚙","🏎","🚓","🚑","🚒","🚐","🚚","🚛","🚜","🏍","🛵","🚲","✈️",
  "🏠","🏡","🏢","🏣","🏤","🏥","🏦","🏨","🏩","🏪","🏫","🏬","🏭","🏯","🏰",
  "🍕","🍔","🍟","🌭","🍿","🧂","🥓","🥚","🍳","🥞","🧇","🥐","🍞","🥖","🥨",
  "🍎","🍊","🍋","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆",
  "⚽","🏀","🏈","⚾","🥎","🏐","🏉","🎾","🏸","🏒","🏓","🥊","🎯","🎮",
];

export default function ChatView({ conversationId, onBack, panelToggle }: Props) {
  const [newMessage, setNewMessage] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image preview
  const [imagePreviews, setImagePreviews] = useState<ImagePreviewItem[]>([]);
  const [imageCaption, setImageCaption] = useState("");
  const [sendingImageIndex, setSendingImageIndex] = useState(-1);

  // Video preview
  const [videoPreview, setVideoPreview] = useState<{ file: File; dataUrl: string } | null>(null);
  const [videoCaption, setVideoCaption] = useState("");
  const [isSendingVideo, setIsSendingVideo] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Emoji picker (input)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reactions & interactions
  const [localReactions, setLocalReactions] = useState<Record<number, string[]>>({});
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<number | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<MessageData | null>(null);

  // Notas internas / respostas rápidas / etiquetas / lembretes / agendamento
  const { user } = useAuth();
  const [noteMode, setNoteMode] = useState(false);
  const [qrSelectedIndex, setQrSelectedIndex] = useState(0);
  const [showQrManageDialog, setShowQrManageDialog] = useState(false);
  const [qrForm, setQrForm] = useState({ shortcut: "", title: "", content: "" });
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [reminderPopoverOpen, setReminderPopoverOpen] = useState(false);
  const [reminderNote, setReminderNote] = useState("");
  const [reminderCustom, setReminderCustom] = useState("");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");

  // Fotos do veículo / sugestão IA
  const [showVehiclePhotosDialog, setShowVehiclePhotosDialog] = useState(false);
  const [photoVehicleId, setPhotoVehicleId] = useState<number | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [suggestPopoverOpen, setSuggestPopoverOpen] = useState(false);
  const [suggestHistoryCount, setSuggestHistoryCount] = useState(10);

  const utils = trpc.useUtils();

  const { data: conversation } = trpc.conversation.getById.useQuery(
    { id: conversationId },
    { refetchInterval: 15000 }
  );

  const { data: activeFlowSession, refetch: refetchFlowSession } = trpc.flow.getActiveSession.useQuery(
    { conversationId },
    { refetchInterval: 10000 }
  );
  const pauseFlowMutation = trpc.flow.pauseSession.useMutation({
    onSuccess: () => { toast.success("Fluxo pausado com sucesso"); refetchFlowSession(); },
    onError: () => toast.error("Erro ao pausar fluxo"),
  });

  const { data: msgs, refetch: refetchMessages } = trpc.message.list.useQuery(
    { conversationId },
    { refetchInterval: 5000 }
  );

  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templateParams, setTemplateParams] = useState<string[]>([]);

  const { data: templates } = trpc.whatsappTemplate.list.useQuery(undefined, {
    enabled: showTemplateDialog,
  });
  const sendTemplateMutation = trpc.whatsappTemplate.send.useMutation({
    onSuccess: () => {
      toast.success("Template enviado com sucesso! Janela de 24h reaberta.");
      setShowTemplateDialog(false);
      setSelectedTemplate("");
      setTemplateParams([]);
      refetchMessages();
    },
    onError: (err) => toast.error("Erro ao enviar template: " + err.message),
  });

  const isWindowExpired = useMemo(() => {
    if (!conversation) return false;
    // Instâncias Evolution não têm janela de 24h (API não-oficial)
    if ((conversation as any).channel === "evolution") return false;
    if ((conversation as any).windowExpired) return true;
    const lastCustomerMsg = (conversation as any).lastCustomerMessageAt;
    if (!lastCustomerMsg) return false;
    const elapsed = Date.now() - Number(lastCustomerMsg);
    return elapsed > 24 * 60 * 60 * 1000;
  }, [conversation]);

  const selectedTemplateObj = useMemo(() => {
    if (!templates || !selectedTemplate) return null;
    return templates.find((t: any) => t.name === selectedTemplate) || null;
  }, [templates, selectedTemplate]);

  const handleSendTemplate = () => {
    if (!selectedTemplate || !conversation?.phone) return;
    sendTemplateMutation.mutate({
      phone: conversation.phone,
      templateName: selectedTemplate,
      language: selectedTemplateObj?.language || "pt_BR",
      bodyParams: templateParams.filter(p => p.trim() !== ""),
      conversationId,
    });
  };

  const sendMutation = trpc.message.send.useMutation({
    onSuccess: (data: any) => {
      setNewMessage("");
      refetchMessages();
      inputRef.current?.focus();
      if (data?.windowExpired) {
        toast.error("Janela de 24h expirada. Use um template aprovado para reabrir a conversa.");
      }
    },
  });

  const sendMediaMutation = trpc.message.sendMedia.useMutation({
    onSuccess: () => refetchMessages(),
    onError: (err) => toast.error("Erro ao enviar mídia: " + err.message),
  });
  const markAsReadMutation = trpc.conversation.markAsRead.useMutation();

  // ── Respostas rápidas ──
  const { data: quickReplies } = trpc.quickReply.list.useQuery();
  const trackQrUsage = trpc.quickReply.trackUsage.useMutation();
  const createQrMutation = trpc.quickReply.create.useMutation({
    onSuccess: () => {
      toast.success("Resposta rápida criada");
      setQrForm({ shortcut: "", title: "", content: "" });
      setShowQrManageDialog(false);
      utils.quickReply.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteQrMutation = trpc.quickReply.delete.useMutation({
    onSuccess: () => utils.quickReply.list.invalidate(),
  });

  const qrFilter = newMessage.startsWith("/") ? newMessage.slice(1).toLowerCase() : null;
  const filteredQuickReplies = useMemo(() => {
    if (qrFilter === null || !quickReplies) return [];
    return quickReplies.filter((qr: any) =>
      qr.shortcut.includes(qrFilter) || qr.title.toLowerCase().includes(qrFilter)
    ).slice(0, 6);
  }, [qrFilter, quickReplies]);

  const applyVariables = useCallback((content: string) => content
    .replace(/\{\{nome\}\}/gi, (conversation?.contactName || "").split(" ")[0] || "")
    .replace(/\{\{telefone\}\}/gi, conversation?.phone || "")
    .replace(/\{\{atendente\}\}/gi, user?.name || ""),
  [conversation, user]);

  const selectQuickReply = useCallback((qr: any) => {
    setNewMessage(applyVariables(qr.content));
    trackQrUsage.mutate({ id: qr.id });
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [applyVariables, trackQrUsage]);

  // ── Etiquetas ──
  const { data: allLabels } = trpc.label.list.useQuery();
  const { data: convLabels } = trpc.label.byConversation.useQuery({ conversationId });
  const setLabelsMutation = trpc.label.setForConversation.useMutation({
    onSuccess: () => {
      utils.label.byConversation.invalidate({ conversationId });
      utils.label.assignments.invalidate();
    },
  });
  const createLabelMutation = trpc.label.create.useMutation({
    onSuccess: () => { setNewLabelName(""); utils.label.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const toggleLabel = (labelId: number) => {
    const current = (convLabels || []).map((l: any) => l.id);
    const next = current.includes(labelId) ? current.filter((id: number) => id !== labelId) : [...current, labelId];
    setLabelsMutation.mutate({ conversationId, labelIds: next });
  };

  // ── Lembretes ──
  const { data: myReminders } = trpc.reminder.listMine.useQuery({ conversationId });
  const createReminderMutation = trpc.reminder.create.useMutation({
    onSuccess: () => {
      toast.success("Lembrete criado");
      setReminderNote(""); setReminderCustom(""); setReminderPopoverOpen(false);
      utils.reminder.listMine.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const dismissReminderMutation = trpc.reminder.dismiss.useMutation({
    onSuccess: () => utils.reminder.listMine.invalidate(),
  });

  const createReminder = (remindAt: number) => {
    createReminderMutation.mutate({ conversationId, remindAt, note: reminderNote || undefined });
  };
  const tomorrowAt9 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.getTime();
  };

  // ── Mensagens agendadas ──
  const { data: pendingScheduled } = trpc.scheduledMessage.listByConversation.useQuery(
    { conversationId },
    { refetchInterval: 15000 } // banner some sozinho após o envio
  );
  const createScheduledMutation = trpc.scheduledMessage.create.useMutation({
    onSuccess: () => {
      toast.success("Mensagem agendada");
      setNewMessage(""); setScheduleAt(""); setShowScheduleDialog(false);
      utils.scheduledMessage.listByConversation.invalidate({ conversationId });
    },
    onError: (err) => toast.error(err.message),
  });
  const cancelScheduledMutation = trpc.scheduledMessage.cancel.useMutation({
    onSuccess: () => utils.scheduledMessage.listByConversation.invalidate({ conversationId }),
  });

  // ── Fotos do veículo (estoque) ──
  const { data: lead } = trpc.lead.getByConversation.useQuery({ conversationId });
  const { data: stockVehicles } = trpc.vehicle.list.useQuery(undefined, { enabled: showVehiclePhotosDialog });
  const photoVehicle = useMemo(() => {
    if (!stockVehicles || !photoVehicleId) return null;
    return (stockVehicles as any[]).find(v => v.id === photoVehicleId) || null;
  }, [stockVehicles, photoVehicleId]);
  const vehiclePhotoUrls: string[] = useMemo(() => {
    if (!photoVehicle) return [];
    const imgs = Array.isArray(photoVehicle.images) ? photoVehicle.images : [];
    return (imgs as string[]).filter(u => typeof u === "string" && u.startsWith("http"));
  }, [photoVehicle]);

  // Pré-seleciona o veículo de interesse do lead ao abrir
  useEffect(() => {
    if (showVehiclePhotosDialog && !photoVehicleId && lead?.vehicleId) {
      setPhotoVehicleId(lead.vehicleId);
    }
  }, [showVehiclePhotosDialog, lead, photoVehicleId]);

  const sendVehiclePhotosMutation = trpc.message.sendVehiclePhotos.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.sent} foto(s) enviada(s)${res.failed ? ` — ${res.failed} falharam` : ""}`);
      setShowVehiclePhotosDialog(false);
      setSelectedPhotos([]);
      refetchMessages();
    },
    onError: (err) => toast.error(err.message),
  });

  const togglePhoto = (url: string) => {
    setSelectedPhotos(prev => prev.includes(url) ? prev.filter(u => u !== url) : prev.length >= 10 ? prev : [...prev, url]);
  };

  // ── Sugestão de resposta por IA ──
  useEffect(() => {
    const saved = Number(localStorage.getItem("suggestHistoryCount"));
    if (saved >= 2 && saved <= 50) setSuggestHistoryCount(saved);
  }, []);

  const suggestReplyMutation = trpc.message.suggestReply.useMutation({
    onSuccess: (res) => {
      setNewMessage(res.suggestion);
      setSuggestPopoverOpen(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (err) => toast.error("Erro na sugestão: " + err.message),
  });

  const { socket } = useConversationSocket(conversationId);

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

  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevMsgCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const userScrolledRef = useRef(false);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setIsNearBottom(nearBottom);
    if (!nearBottom) {
      userScrolledRef.current = true;
    } else {
      userScrolledRef.current = false;
      setHasNewMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!msgs || !scrollRef.current) return;
    const msgCount = msgs.length;
    const isNewMessage = msgCount > prevMsgCountRef.current;
    prevMsgCountRef.current = msgCount;
    if (isInitialLoadRef.current && msgCount > 0) {
      isInitialLoadRef.current = false;
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
      return;
    }
    if (!isNewMessage) return;
    if (!userScrolledRef.current || isNearBottom) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    } else {
      setHasNewMessages(true);
    }
  }, [msgs, isNearBottom]);

  useEffect(() => {
    isInitialLoadRef.current = true;
    userScrolledRef.current = false;
    prevMsgCountRef.current = 0;
    setHasNewMessages(false);
    setReplyToMessage(null);
  }, [conversationId]);

  useEffect(() => { markAsReadMutation.mutate({ id: conversationId }); }, [conversationId]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  // Close reaction picker on outside click
  useEffect(() => {
    if (reactionPickerMsgId === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-reaction-picker]") && !target.closest("[data-reaction-btn]")) {
        setReactionPickerMsgId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [reactionPickerMsgId]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setHasNewMessages(false);
      userScrolledRef.current = false;
    }
  }, []);

  // ---- Handlers ----

  const handleSend = () => {
    if (!newMessage.trim()) return;
    let content = newMessage.trim();
    if (noteMode) {
      sendMutation.mutate({ conversationId, content, senderType: "internal" });
      setNoteMode(false);
      return;
    }
    if (replyToMessage) {
      const senderLabel = replyToMessage.senderType === "customer"
        ? "Cliente"
        : replyToMessage.senderName || "Atendente";
      const quotedText = replyToMessage.content.length > 100
        ? replyToMessage.content.slice(0, 100) + "…"
        : replyToMessage.content;
      content = `> *${senderLabel}:* ${quotedText}\n\n${content}`;
    }
    sendMutation.mutate({ conversationId, content, senderType: "agent" });
    setReplyToMessage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Navegação no dropdown de respostas rápidas
    if (filteredQuickReplies.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setQrSelectedIndex(i => Math.min(i + 1, filteredQuickReplies.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setQrSelectedIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectQuickReply(filteredQuickReplies[qrSelectedIndex] || filteredQuickReplies[0]);
        return;
      }
      if (e.key === "Escape") { setNewMessage(""); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape" && replyToMessage) setReplyToMessage(null);
    if (e.key === "Escape" && noteMode) setNoteMode(false);
  };

  useEffect(() => { setQrSelectedIndex(0); }, [qrFilter]);

  // Reseta a altura do textarea quando o campo esvazia (após enviar)
  useEffect(() => {
    if (!newMessage && inputRef.current) inputRef.current.style.height = "auto";
  }, [newMessage]);

  const handleReact = useCallback((messageId: number, emoji: string) => {
    setLocalReactions(prev => {
      const existing = prev[messageId] || [];
      const has = existing.includes(emoji);
      return { ...prev, [messageId]: has ? existing.filter(e => e !== emoji) : [...existing, emoji] };
    });
    setReactionPickerMsgId(null);
  }, []);

  const handleReply = useCallback((message: MessageData) => {
    setReplyToMessage(message);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleForward = useCallback((message: MessageData) => {
    const text = message.content;
    navigator.clipboard.writeText(text).then(() => {
      toast.success("Mensagem copiada para a área de transferência");
    }).catch(() => {
      toast.error("Não foi possível copiar");
    });
  }, []);

  // ---- Image handling ----
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    e.target.value = "";
    let errorCount = 0;
    const validFiles: File[] = [];
    for (const file of fileList) {
      if (!file.type.startsWith("image/")) { errorCount++; continue; }
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name}: máximo 16MB.`); continue; }
      validFiles.push(file);
    }
    if (errorCount > 0) toast.error(`${errorCount} arquivo(s) ignorado(s) — selecione apenas imagens.`);
    if (validFiles.length === 0) return;
    const newPreviews = await Promise.all(
      validFiles.map(file => new Promise<ImagePreviewItem>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ file, dataUrl: reader.result as string });
        reader.onerror = () => resolve({ file, dataUrl: URL.createObjectURL(file) });
        reader.readAsDataURL(file);
      }))
    );
    setImagePreviews(prev => [...prev, ...newPreviews]);
  };

  const handleRemoveImage = (index: number) => {
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendImages = async () => {
    if (imagePreviews.length === 0) return;
    for (let i = 0; i < imagePreviews.length; i++) {
      setSendingImageIndex(i);
      const preview = imagePreviews[i];
      try {
        const base64 = preview.dataUrl.split(",")[1];
        await sendMediaMutation.mutateAsync({
          conversationId, mediaType: "image",
          base64Data: base64, mimeType: preview.file.type, fileName: preview.file.name,
          caption: i === 0 ? (imageCaption || undefined) : undefined,
        });
      } catch { break; }
    }
    setSendingImageIndex(-1);
    setImagePreviews([]);
    setImageCaption("");
    inputRef.current?.focus();
  };

  // ---- Video handling ----
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) { toast.error("Selecione um arquivo de vídeo."); return; }
    if (file.size > 64 * 1024 * 1024) { toast.error("Tamanho máximo de vídeo é 64MB."); return; }
    setVideoPreview({ file, dataUrl: URL.createObjectURL(file) });
    setVideoCaption("");
  };

  const handleSendVideo = async () => {
    if (!videoPreview) return;
    setIsSendingVideo(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await sendMediaMutation.mutateAsync({
          conversationId, mediaType: "video",
          base64Data: base64, mimeType: videoPreview.file.type, fileName: videoPreview.file.name,
          caption: videoCaption || undefined,
        });
        setVideoPreview(null);
        setVideoCaption("");
      };
      reader.readAsDataURL(videoPreview.file);
    } catch {
      // handled by onError
    } finally {
      setIsSendingVideo(false);
    }
  };

  // ---- Emoji picker (input) ----
  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    if (!input) { setNewMessage(prev => prev + emoji); setShowEmojiPicker(false); return; }
    const start = input.selectionStart ?? newMessage.length;
    const end = input.selectionEnd ?? newMessage.length;
    const next = newMessage.slice(0, start) + emoji + newMessage.slice(end);
    setNewMessage(next);
    setShowEmojiPicker(false);
    setTimeout(() => { input.focus(); input.setSelectionRange(start + emoji.length, start + emoji.length); }, 0);
  };

  // ---- Audio recording ----
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm",
      });
      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        console.log(`[Audio] Gravação finalizada: ${audioBlob.size} bytes em ${audioChunksRef.current.length} chunks`);
        if (audioBlob.size > MAX_FILE_SIZE) { toast.error("O tamanho máximo é 16MB."); return; }
        if (audioBlob.size < 1000) {
          toast.error("O microfone não capturou áudio (gravação vazia). Verifique nas Configurações do macOS > Privacidade > Microfone se o navegador tem acesso, e o dispositivo de entrada correto.");
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => toast.error("Falha ao processar o áudio gravado.");
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          console.log(`[Audio] Enviando ${Math.round(base64.length / 1024)}KB para o servidor...`);
          toast.info("Enviando áudio...");
          sendMediaMutation.mutate({
            conversationId, mediaType: "audio", base64Data: base64,
            mimeType: "audio/webm", fileName: "voice-message.webm",
          });
        };
        reader.readAsDataURL(audioBlob);
      };
      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch {
      toast.error("Verifique se o navegador tem permissão para acessar o microfone.");
    }
  }, [conversationId, sendMediaMutation]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const formatRecordingTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const isSending = sendMutation.isPending || sendMediaMutation.isPending;

  return (
    <div className="flex flex-col h-full bg-background">

      {/* ── Header ── */}
      <div className="h-16 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-[#f0f2f5]">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="lg:hidden h-8 w-8 text-[#54656f] hover:text-[#111b21]">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="relative shrink-0">
          {conversation?.contactPhoto ? (
            <img
              src={conversation.contactPhoto}
              alt={conversation.contactName || ""}
              className="h-10 w-10 rounded-full object-cover"
              onError={(e) => {
                const t = e.target as HTMLImageElement;
                t.style.display = "none";
                t.nextElementSibling?.classList.remove("hidden");
              }}
            />
          ) : null}
          <div className={`h-10 w-10 rounded-full bg-[#dfe5e7] flex items-center justify-center ${conversation?.contactPhoto ? "hidden" : ""}`}>
            <span className="text-sm font-semibold text-[#54656f]">
              {(conversation?.contactName || conversation?.phone || "?").charAt(0).toUpperCase()}
            </span>
          </div>
          {/* Platform badge */}
          {conversation?.channel === "instagram" && (
            <div className="absolute -top-0.5 -left-0.5 h-4 w-4 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)" }}>
              <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 text-white fill-current"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
            </div>
          )}
          {conversation?.channel === "facebook" && (
            <div className="absolute -top-0.5 -left-0.5 h-4 w-4 rounded-full bg-[#1877F2] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 text-white fill-current"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </div>
          )}
          {(!conversation?.channel || conversation?.channel === "whatsapp") && (
            <div className="absolute -top-0.5 -left-0.5 h-4 w-4 rounded-full bg-[#25D366] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 text-white fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[#111b21] truncate">
            {conversation?.contactName || conversation?.phone || "Carregando..."}
          </h3>
          <div className="flex items-center gap-2">
            {conversation?.phone && !conversation.phone.startsWith("instagram_") && !conversation.phone.startsWith("facebook_") && (
              <span className="text-xs text-[#54656f] flex items-center gap-1">
                <Phone className="h-3 w-3" />{conversation.phone}
              </span>
            )}
            {conversation?.aiActive ? (
              <span className="text-xs text-[#00a884] flex items-center gap-1">
                <Bot className="h-3 w-3" /> IA Ativa
              </span>
            ) : (
              <span className="text-xs text-blue-400 flex items-center gap-1">
                <User className="h-3 w-3" /> Atendente
              </span>
            )}
            {(convLabels || []).slice(0, 3).map((l: any) => (
              <span key={l.id} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: l.color + "22", border: `1px solid ${l.color}`, color: l.color }}>
                {l.name}
              </span>
            ))}
            {(convLabels || []).length > 3 && (
              <span className="text-[10px] text-[#54656f]">+{(convLabels || []).length - 3}</span>
            )}
          </div>
        </div>

        {/* ── Etiquetas ── */}
        <Popover open={labelPopoverOpen} onOpenChange={setLabelPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]" title="Etiquetas">
              <Tag className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2 bg-[#ffffff] border-[#e9edef]">
            <p className="text-xs font-semibold text-[#54656f] px-1 pb-2">Etiquetas da conversa</p>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {(allLabels || []).map((l: any) => {
                const active = (convLabels || []).some((cl: any) => cl.id === l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLabel(l.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${active ? "bg-[#e9edef] text-[#111b21]" : "text-[#111b21] hover:bg-[#e9edef]/60"}`}
                  >
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                    <span className="flex-1 truncate">{l.name}</span>
                    {active && <X className="h-3 w-3 text-[#54656f]" />}
                  </button>
                );
              })}
              {(allLabels || []).length === 0 && (
                <p className="text-xs text-[#54656f] px-2 py-2">Nenhuma etiqueta criada ainda.</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 pt-2 mt-1 border-t border-[#e9edef]">
              <Input
                value={newLabelName}
                onChange={e => setNewLabelName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newLabelName.trim()) {
                    const palette = ["#00a884", "#53bdeb", "#e9a944", "#eb6262", "#a55eea", "#f27ca4"];
                    createLabelMutation.mutate({ name: newLabelName.trim(), color: palette[(allLabels || []).length % palette.length] });
                  }
                }}
                placeholder="Nova etiqueta + Enter"
                className="h-7 text-xs bg-[#e9edef] border-0 text-[#111b21] placeholder:text-[#54656f]"
              />
            </div>
          </PopoverContent>
        </Popover>

        {/* ── Lembretes ── */}
        <Popover open={reminderPopoverOpen} onOpenChange={setReminderPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={`h-8 w-8 hover:bg-[#e9edef] ${(myReminders || []).length > 0 ? "text-amber-500 hover:text-amber-600" : "text-[#54656f] hover:text-[#111b21]"}`} title="Lembrar-me desta conversa">
              <AlarmClock className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3 bg-[#ffffff] border-[#e9edef]">
            <p className="text-xs font-semibold text-[#54656f] pb-2">Lembrar-me desta conversa</p>
            {(myReminders || []).map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-1.5 mb-2">
                <AlarmClock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-amber-700">{format(new Date(Number(r.remindAt)), "dd/MM 'às' HH:mm", { locale: ptBR })}</p>
                  {r.note && <p className="text-[11px] text-[#54656f] truncate">{r.note}</p>}
                </div>
                <button onClick={() => dismissReminderMutation.mutate({ id: r.id })} className="text-[#54656f] hover:text-red-400">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Input
              value={reminderNote}
              onChange={e => setReminderNote(e.target.value)}
              placeholder="Nota (opcional)"
              className="h-8 text-xs bg-[#e9edef] border-0 text-[#111b21] placeholder:text-[#54656f] mb-2"
            />
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              <Button size="sm" variant="outline" className="h-7 text-xs border-[#e9edef] bg-transparent text-[#111b21] hover:bg-[#e9edef]" onClick={() => createReminder(Date.now() + 60 * 60 * 1000)}>1 hora</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-[#e9edef] bg-transparent text-[#111b21] hover:bg-[#e9edef]" onClick={() => createReminder(Date.now() + 3 * 60 * 60 * 1000)}>3 horas</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-[#e9edef] bg-transparent text-[#111b21] hover:bg-[#e9edef]" onClick={() => createReminder(tomorrowAt9())}>Amanhã 9h</Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="datetime-local"
                value={reminderCustom}
                onChange={e => setReminderCustom(e.target.value)}
                className="h-7 text-xs bg-[#e9edef] border-0 text-[#111b21] flex-1"
              />
              <Button size="sm" className="h-7 text-xs bg-[#00a884] hover:bg-[#00a884]/90 text-white" disabled={!reminderCustom} onClick={() => createReminder(new Date(reminderCustom).getTime())}>OK</Button>
            </div>
          </PopoverContent>
        </Popover>
        {activeFlowSession && (
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="flex items-center gap-1.5 bg-violet-500/15 border border-violet-500/25 text-violet-400 px-2.5 py-1 rounded-full max-w-44">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-medium truncate" title={(activeFlowSession as any)?.flowName}>
                {(activeFlowSession as any)?.flowName || "Fluxo Ativo"}
              </span>
            </div>
            <Button
              variant="ghost" size="sm"
              onClick={() => pauseFlowMutation.mutate({ conversationId })}
              disabled={pauseFlowMutation.isPending}
              className="h-7 px-2 text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
            >
              {pauseFlowMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <><PauseCircle className="h-3.5 w-3.5 mr-1" /> Pausar</>}
            </Button>
          </div>
        )}
        {panelToggle}
      </div>

      {/* ── Messages area with WhatsApp background ── */}
      <div className="relative flex-1 bg-[#efeae2]">
        {/* Subtle texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
        />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto px-4 py-3"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#dfe5e7 transparent" }}
        >
          {!msgs || msgs.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center bg-[#ffffff] rounded-xl px-6 py-4 max-w-xs">
                <p className="text-sm text-[#54656f]">Nenhuma mensagem ainda</p>
                <p className="text-xs text-[#54656f]/60 mt-1">As mensagens aparecerão aqui</p>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {msgs.map((msg, idx) => {
                const prevMsg = idx > 0 ? msgs[idx - 1] : null;
                const isFirstInGroup = !prevMsg || prevMsg.senderType !== msg.senderType ||
                  (new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime()) > 5 * 60 * 1000;
                return (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isFirstInGroup={isFirstInGroup}
                    reactions={localReactions[msg.id] || []}
                    showReactionPicker={reactionPickerMsgId === msg.id}
                    onReact={(emoji) => handleReact(msg.id, emoji)}
                    onToggleReactionPicker={() =>
                      setReactionPickerMsgId(v => v === msg.id ? null : msg.id)
                    }
                    onReply={() => handleReply(msg)}
                    onForward={() => handleForward(msg)}
                  />
                );
              })}
            </div>
          )}
          {typingUser && (
            <div className="flex items-center gap-2 mt-2 pl-2">
              <div className="bg-[#f0f2f5] rounded-xl rounded-bl-none px-4 py-2.5 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#54656f] animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 rounded-full bg-[#54656f] animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 rounded-full bg-[#54656f] animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>

        {/* New messages indicator */}
        {hasNewMessages && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 right-4 z-10 bg-[#00a884] text-white p-2 rounded-full shadow-lg hover:bg-[#00a884]/90 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
        )}
      </div>

      {/* ── Image Preview ── */}
      {imagePreviews.length > 0 && (
        <div className="border-t border-[#e9edef] p-3 bg-[#f0f2f5]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {imagePreviews.map((preview, index) => (
                <div key={index} className="relative group">
                  <img
                    src={preview.dataUrl}
                    alt={`Preview ${index + 1}`}
                    className={`h-16 w-16 object-cover rounded-lg border border-[#e9edef] ${sendingImageIndex === index ? "opacity-50" : ""}`}
                  />
                  {sendingImageIndex === index && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-[#00a884]" />
                    </div>
                  )}
                  {sendingImageIndex < 0 && (
                    <Button
                      variant="destructive" size="icon"
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleRemoveImage(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={imageCaption}
                onChange={e => setImageCaption(e.target.value)}
                placeholder="Legenda (opcional)..."
                className="bg-[#e9edef] border-[#e9edef] text-[#111b21] placeholder:text-[#54656f] text-sm flex-1"
                disabled={sendingImageIndex >= 0}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendImages(); } }}
              />
              <Button variant="ghost" size="icon" onClick={() => { setImagePreviews([]); setImageCaption(""); }} disabled={sendingImageIndex >= 0} className="text-[#54656f] hover:text-red-400">
                <X className="h-4 w-4" />
              </Button>
              <Button onClick={handleSendImages} disabled={sendingImageIndex >= 0} size="sm" className="bg-[#00a884] hover:bg-[#00a884]/90 text-white">
                {sendingImageIndex >= 0 ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />{sendingImageIndex + 1}/{imagePreviews.length}</> : <><Send className="h-4 w-4 mr-1" />Enviar {imagePreviews.length > 1 ? `${imagePreviews.length} fotos` : "foto"}</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Video Preview ── */}
      {videoPreview && (
        <div className="border-t border-[#e9edef] p-3 bg-[#f0f2f5]">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="relative rounded-lg overflow-hidden bg-black w-40 h-24 shrink-0">
                <video src={videoPreview.dataUrl} className="w-full h-full object-contain" muted />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Video className="h-8 w-8 text-white opacity-70" />
                </div>
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <p className="text-xs text-[#54656f] truncate">{videoPreview.file.name}</p>
                <input
                  type="text" value={videoCaption}
                  onChange={e => setVideoCaption(e.target.value)}
                  placeholder="Legenda (opcional)..."
                  className="text-sm bg-[#e9edef] border border-[#e9edef] text-[#111b21] placeholder:text-[#54656f] rounded-md px-3 py-1.5 outline-none focus:ring-1 focus:ring-[#00a884]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setVideoPreview(null)} disabled={isSendingVideo} className="text-[#54656f]">
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
              <Button size="sm" className="bg-[#00a884] hover:bg-[#00a884]/90 text-white" onClick={handleSendVideo} disabled={isSendingVideo}>
                {isSendingVideo ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                Enviar vídeo
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 24h Window Expired Banner ── */}
      {isWindowExpired && (
        <div className="border-t border-yellow-500/30 bg-yellow-500/10 px-4 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Janela de 24h expirada</p>
              <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80">Para enviar mensagem, use um template aprovado pela Meta.</p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 border-yellow-500/50 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/20" onClick={() => setShowTemplateDialog(true)}>
              <MessageSquareText className="h-4 w-4 mr-1.5" />Enviar Template
            </Button>
          </div>
        </div>
      )}

      {/* ── Template Dialog ── */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar Template WhatsApp</DialogTitle>
            <DialogDescription>Selecione um template aprovado pela Meta para reabrir a conversa.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Template</label>
              <Select value={selectedTemplate} onValueChange={(val) => { setSelectedTemplate(val); setTemplateParams([]); }}>
                <SelectTrigger><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                <SelectContent>
                  {templates?.filter((t: any) => t.status === "APPROVED").map((t: any) => (
                    <SelectItem key={t.name} value={t.name}>{t.name} ({t.category})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedTemplateObj && (
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                <p className="text-sm">{(selectedTemplateObj as any).components?.find((c: any) => c.type === "BODY")?.text || selectedTemplateObj.name}</p>
              </div>
            )}
            {((selectedTemplateObj as any)?.components?.find((c: any) => c.type === "BODY")?.text || "")?.match(/\{\{\d+\}\}/g)?.map((_: string, i: number) => (
              <div key={i}>
                <label className="text-sm font-medium mb-1 block">Parâmetro {i + 1}</label>
                <Input
                  value={templateParams[i] || ""}
                  onChange={(e) => { const p = [...templateParams]; p[i] = e.target.value; setTemplateParams(p); }}
                  placeholder={`Valor para {{${i + 1}}}`}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>Cancelar</Button>
            <Button onClick={handleSendTemplate} disabled={!selectedTemplate || sendTemplateMutation.isPending}>
              {sendTemplateMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Enviando...</> : <><Send className="h-4 w-4 mr-1" />Enviar Template</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mensagens agendadas pendentes ── */}
      {(pendingScheduled || []).length > 0 && (
        <div className="border-t border-[#e9edef] bg-[#ffffff] px-3 py-1.5 space-y-1">
          {(pendingScheduled || []).map((sm: any) => (
            <div key={sm.id} className="flex items-center gap-2">
              <CalendarClock className="h-3.5 w-3.5 text-[#53bdeb] shrink-0" />
              <span className="text-xs text-[#53bdeb] shrink-0">
                {format(new Date(Number(sm.scheduledAt)), "dd/MM HH:mm", { locale: ptBR })}
              </span>
              <span className="text-xs text-[#54656f] truncate flex-1">{sm.content}</span>
              <button onClick={() => cancelScheduledMutation.mutate({ id: sm.id })} className="text-[#54656f] hover:text-red-400 shrink-0" title="Cancelar envio">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Agendar mensagem Dialog ── */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Agendar mensagem</DialogTitle>
            <DialogDescription>A mensagem será enviada automaticamente no horário escolhido. Se a janela de 24h expirar antes, você será notificado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="bg-secondary/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Mensagem:</p>
              <p className="text-sm whitespace-pre-wrap">{newMessage}</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Enviar em</label>
              <Input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>Cancelar</Button>
            <Button
              disabled={!scheduleAt || !newMessage.trim() || createScheduledMutation.isPending}
              onClick={() => createScheduledMutation.mutate({ conversationId, content: newMessage.trim(), scheduledAt: new Date(scheduleAt).getTime() })}
            >
              {createScheduledMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CalendarClock className="h-4 w-4 mr-1" />}
              Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Fotos do veículo Dialog ── */}
      <Dialog open={showVehiclePhotosDialog} onOpenChange={(open) => { setShowVehiclePhotosDialog(open); if (!open) setSelectedPhotos([]); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar fotos do veículo</DialogTitle>
            <DialogDescription>Selecione o veículo do estoque e as fotos que deseja enviar (máx. 10).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Select value={photoVehicleId?.toString() || ""} onValueChange={v => { setPhotoVehicleId(Number(v)); setSelectedPhotos([]); }}>
              <SelectTrigger><SelectValue placeholder="Selecione um veículo..." /></SelectTrigger>
              <SelectContent className="max-h-64">
                {((stockVehicles as any[]) || []).filter(v => v.available !== false).map(v => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.year} {v.brand} {v.model} — R$ {Number(v.price).toLocaleString("pt-BR")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {photoVehicle && vehiclePhotoUrls.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Este veículo não tem fotos no estoque sincronizado.</p>
            )}
            {vehiclePhotoUrls.length > 0 && (
              <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                {vehiclePhotoUrls.map((url, i) => {
                  const selected = selectedPhotos.includes(url);
                  const order = selectedPhotos.indexOf(url) + 1;
                  return (
                    <button
                      key={i}
                      onClick={() => togglePhoto(url)}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${selected ? "border-[#00a884] ring-1 ring-[#00a884]" : "border-transparent opacity-80 hover:opacity-100"}`}
                    >
                      <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                      {selected && (
                        <span className="absolute top-1 right-1 h-5 w-5 rounded-full bg-[#00a884] text-white text-[10px] font-bold flex items-center justify-center">{order}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedPhotos.length > 0 && photoVehicle && (
              <p className="text-xs text-muted-foreground">
                1ª foto vai com a legenda: <b>{photoVehicle.title || `${photoVehicle.brand} ${photoVehicle.model}`} {photoVehicle.year} — R$ {Number(photoVehicle.price).toLocaleString("pt-BR")}</b>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVehiclePhotosDialog(false)}>Cancelar</Button>
            <Button
              disabled={selectedPhotos.length === 0 || sendVehiclePhotosMutation.isPending}
              onClick={() => {
                if (!photoVehicle) return;
                sendVehiclePhotosMutation.mutate({
                  conversationId,
                  vehicleId: photoVehicle.id,
                  imageUrls: selectedPhotos,
                  caption: `${photoVehicle.title || `${photoVehicle.brand} ${photoVehicle.model}`} ${photoVehicle.year} — R$ ${Number(photoVehicle.price).toLocaleString("pt-BR")}`,
                });
              }}
            >
              {sendVehiclePhotosMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Enviar {selectedPhotos.length > 0 ? `${selectedPhotos.length} foto(s)` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Gerenciar respostas rápidas Dialog ── */}
      <Dialog open={showQrManageDialog} onOpenChange={setShowQrManageDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Respostas rápidas</DialogTitle>
            <DialogDescription>Digite <b>/</b> no campo de mensagem para usar. Variáveis: {"{{nome}}"}, {"{{telefone}}"}, {"{{atendente}}"}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1 max-h-[50vh] overflow-y-auto">
            {(quickReplies || []).map((qr: any) => (
              <div key={qr.id} className="flex items-start gap-2 bg-secondary/50 rounded-lg p-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">/{qr.shortcut} <span className="text-muted-foreground font-normal">— {qr.title}</span></p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{qr.content}</p>
                </div>
                <button onClick={() => deleteQrMutation.mutate({ id: qr.id })} className="text-muted-foreground hover:text-red-500 shrink-0 mt-0.5">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t pt-3">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="atalho (ex: endereco)" value={qrForm.shortcut} onChange={e => setQrForm(f => ({ ...f, shortcut: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") }))} />
              <Input placeholder="Título" value={qrForm.title} onChange={e => setQrForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <textarea
              placeholder="Conteúdo da mensagem... Ex: Olá {{nome}}! Nossa loja fica na..."
              value={qrForm.content}
              onChange={e => setQrForm(f => ({ ...f, content: e.target.value }))}
              className="w-full text-sm rounded-md border bg-transparent px-3 py-2 min-h-20 outline-none focus:ring-1 focus:ring-ring"
            />
            <Button
              className="w-full"
              disabled={!qrForm.shortcut || !qrForm.title || !qrForm.content || createQrMutation.isPending}
              onClick={() => createQrMutation.mutate(qrForm)}
            >
              <Plus className="h-4 w-4 mr-1" /> Criar resposta rápida
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reply preview ── */}
      {replyToMessage && (
        <div className="flex items-center gap-2 bg-[#f0f2f5] px-3 pt-2 pb-1 border-t border-[#e9edef]">
          <div className="flex-1 border-l-4 border-[#00a884] pl-2.5 py-1 bg-[#e9edef] rounded-r min-w-0">
            <span className="text-xs font-semibold text-[#00a884] block">
              {replyToMessage.senderType === "customer" ? "Cliente" : replyToMessage.senderName || "Atendente"}
            </span>
            <p className="text-xs text-[#54656f] truncate">
              {replyToMessage.messageType !== "text" && replyToMessage.messageType !== "template"
                ? `📎 ${replyToMessage.messageType === "image" ? "Imagem" : replyToMessage.messageType === "audio" ? "Áudio" : replyToMessage.messageType === "video" ? "Vídeo" : "Arquivo"}`
                : replyToMessage.content.slice(0, 80)
              }
            </p>
          </div>
          <button onClick={() => setReplyToMessage(null)} className="text-[#54656f] hover:text-[#111b21] shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Input area ── */}
      <div className={`px-3 py-2 shrink-0 relative transition-colors ${noteMode ? "bg-[#fef3c7]" : "bg-[#f0f2f5]"}`}>
        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} />

        {/* Quick replies dropdown ("/") */}
        {filteredQuickReplies.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 z-50 bg-[#ffffff] border border-[#e9edef] rounded-xl shadow-2xl overflow-hidden">
            {filteredQuickReplies.map((qr: any, i: number) => (
              <button
                key={qr.id}
                onClick={() => selectQuickReply(qr)}
                onMouseEnter={() => setQrSelectedIndex(i)}
                className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${i === qrSelectedIndex ? "bg-[#e9edef]" : ""}`}
              >
                <Zap className="h-3.5 w-3.5 text-[#00a884] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm text-[#111b21]"><span className="text-[#00a884] font-medium">/{qr.shortcut}</span> — {qr.title}</p>
                  <p className="text-xs text-[#54656f] truncate">{applyVariables(qr.content)}</p>
                </div>
              </button>
            ))}
            <button onClick={() => setShowQrManageDialog(true)} className="w-full flex items-center gap-2 px-3 py-1.5 border-t border-[#e9edef] text-xs text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]/50">
              <Plus className="h-3 w-3" /> Gerenciar respostas rápidas
            </button>
          </div>
        )}
        {qrFilter !== null && filteredQuickReplies.length === 0 && (quickReplies || []).length === 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 z-50 bg-[#ffffff] border border-[#e9edef] rounded-xl shadow-2xl">
            <button onClick={() => setShowQrManageDialog(true)} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-[#54656f] hover:text-[#111b21]">
              <Plus className="h-4 w-4 text-[#00a884]" /> Nenhuma resposta rápida ainda — criar a primeira
            </button>
          </div>
        )}

        {/* Note mode banner */}
        {noteMode && (
          <div className="flex items-center gap-2 pb-1.5">
            <StickyNote className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-xs text-amber-700 font-medium">Nota interna — visível apenas para a equipe, não será enviada ao cliente</span>
          </div>
        )}

        {/* Emoji picker (composer) */}
        {showEmojiPicker && (
          <div
            ref={emojiPickerRef}
            className="absolute bottom-16 left-3 z-50 bg-[#ffffff] border border-[#e9edef] rounded-xl shadow-2xl p-3 w-72 max-h-56 overflow-y-auto"
          >
            <div className="flex flex-wrap gap-1">
              {EMOJI_LIST.map((emoji, i) => (
                <button key={i} onClick={() => insertEmoji(emoji)} className="text-lg w-8 h-8 flex items-center justify-center hover:bg-[#e9edef] rounded-md transition-colors">
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {isRecording ? (
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={cancelRecording} className="shrink-0 text-red-400 hover:text-red-300 hover:bg-red-500/10">
              <X className="h-5 w-5" />
            </Button>
            <div className="flex-1 flex items-center gap-3 bg-red-500/10 rounded-full px-4 py-2">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-red-400">Gravando... {formatRecordingTime(recordingTime)}</span>
            </div>
            <Button onClick={stopRecording} size="icon" className="shrink-0 bg-[#00a884] hover:bg-[#00a884]/90 rounded-full">
              <Send className="h-4 w-4 text-white" />
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <Button variant="ghost" size="icon" onClick={() => setShowEmojiPicker(v => !v)} disabled={isSending} className="shrink-0 text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]" title="Emojis">
              <Smile className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={isSending} className="shrink-0 text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]" title="Enviar imagens">
              <ImagePlus className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => videoInputRef.current?.click()} disabled={isSending} className="shrink-0 text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]" title="Enviar vídeo">
              <Video className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={startRecording} disabled={isSending} className="shrink-0 text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]" title="Gravar áudio">
              <Mic className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={() => { setShowVehiclePhotosDialog(true); }}
              disabled={isSending}
              className="shrink-0 text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]"
              title="Enviar fotos de um veículo do estoque"
            >
              <Car className="h-5 w-5" />
            </Button>
            <Popover open={suggestPopoverOpen} onOpenChange={setSuggestPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost" size="icon"
                  disabled={isSending}
                  className="shrink-0 text-[#54656f] hover:text-[#00a884] hover:bg-[#e9edef]"
                  title="IA: sugerir resposta"
                >
                  {suggestReplyMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin text-[#00a884]" /> : <Sparkles className="h-5 w-5" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-3 bg-[#ffffff] border-[#e9edef]">
                <p className="text-xs font-semibold text-[#54656f] pb-2">Sugestão de resposta (IA)</p>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-[#54656f] flex-1">Histórico:</span>
                  <Select
                    value={String(suggestHistoryCount)}
                    onValueChange={v => { setSuggestHistoryCount(Number(v)); localStorage.setItem("suggestHistoryCount", v); }}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs bg-[#e9edef] border-0 text-[#111b21]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 mensagens</SelectItem>
                      <SelectItem value="10">10 mensagens</SelectItem>
                      <SelectItem value="20">20 mensagens</SelectItem>
                      <SelectItem value="30">30 mensagens</SelectItem>
                      <SelectItem value="50">50 mensagens</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  className="w-full h-8 text-xs bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                  disabled={suggestReplyMutation.isPending}
                  onClick={() => suggestReplyMutation.mutate({ conversationId, historyCount: suggestHistoryCount })}
                >
                  {suggestReplyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                  Gerar sugestão
                </Button>
                <p className="text-[10px] text-[#54656f] mt-2">A sugestão entra no campo de mensagem — revise antes de enviar.</p>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost" size="icon"
              onClick={() => setNoteMode(v => !v)}
              disabled={isSending}
              className={`shrink-0 hover:bg-[#e9edef] ${noteMode ? "text-amber-600 bg-amber-500/15" : "text-[#54656f] hover:text-[#111b21]"}`}
              title="Nota interna (só a equipe vê)"
            >
              <StickyNote className="h-5 w-5" />
            </Button>
            <textarea
              ref={inputRef}
              value={newMessage}
              onChange={e => {
                setNewMessage(e.target.value);
                // Auto-grow: cresce com o conteúdo até ~7 linhas
                const el = e.target as HTMLTextAreaElement;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 160) + "px";
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={noteMode ? "Escreva uma nota interna..." : "Digite uma mensagem ou / para respostas rápidas"}
              className={`flex-1 border-0 text-sm text-[#111b21] placeholder:text-[#54656f] rounded-lg px-3 py-2.5 outline-none resize-none leading-5 max-h-40 overflow-y-auto ${noteMode ? "bg-[#fde68a]" : "bg-[#e9edef]"}`}
              disabled={isSending}
              style={{ scrollbarWidth: "thin" }}
            />
            {!noteMode && (
              <Button
                variant="ghost" size="icon"
                onClick={() => { if (newMessage.trim()) setShowScheduleDialog(true); else toast.info("Escreva a mensagem primeiro, depois clique para agendar."); }}
                disabled={isSending}
                className="shrink-0 text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]"
                title="Agendar envio"
              >
                <CalendarClock className="h-5 w-5" />
              </Button>
            )}
            <Button
              onClick={handleSend}
              disabled={!newMessage.trim() || isSending}
              size="icon"
              className={`shrink-0 rounded-full text-white disabled:bg-[#e9edef] disabled:text-[#54656f] ${noteMode ? "bg-amber-500 hover:bg-amber-500/90" : "bg-[#00a884] hover:bg-[#00a884]/90"}`}
            >
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : noteMode ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MessageBubble
// ─────────────────────────────────────────────

type MessageBubbleProps = {
  message: MessageData;
  isFirstInGroup: boolean;
  reactions: string[];
  showReactionPicker: boolean;
  onReact: (emoji: string) => void;
  onToggleReactionPicker: () => void;
  onReply: () => void;
  onForward: () => void;
};

function MessageBubble({ message, isFirstInGroup, reactions, showReactionPicker, onReact, onToggleReactionPicker, onReply, onForward }: MessageBubbleProps) {
  const isCustomer = message.senderType === "customer";
  const isBot = message.senderType === "bot";
  const meta = message.metadata as Record<string, unknown> | null;
  const isTemplate = !!(meta?.isTemplate);
  const isSystem = message.senderType === "bot" && message.senderName === "Sistema" && !isTemplate;
  const mediaUrl = resolveMediaUrl(meta?.mediaUrl as string | undefined);
  const transcribedText = meta?.transcribedText as string | undefined;

  const interactiveType = meta?.interactiveType as string | undefined;
  const interactiveButtons = (meta?.buttons as Array<{ id?: string; title: string }>) || [];
  const interactiveSections = (meta?.sections as Array<{ title?: string; rows: Array<{ id?: string; title: string; description?: string }> }>) || [];
  const interactiveData = meta?.interactiveData as Record<string, any> | undefined;
  const effectiveButtons = interactiveButtons.length > 0 ? interactiveButtons : (interactiveData?.buttons || []);
  const effectiveSections = interactiveSections.length > 0 ? interactiveSections : (interactiveData?.sections || []);

  // Internal note — visível só para a equipe
  if (message.senderType === "internal") {
    return (
      <div className="flex justify-center my-2 py-1">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2 max-w-[75%] shadow-sm">
          <div className="flex items-center gap-1.5 mb-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/></svg>
            <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Nota interna · {message.senderName || "Equipe"}</span>
          </div>
          <p className="text-sm text-amber-900 whitespace-pre-wrap break-words">{message.content}</p>
          <p className="text-[10px] text-amber-600/50 text-right mt-0.5">{horaBR(message.createdAt)}</p>
        </div>
      </div>
    );
  }

  // System message
  if (isSystem || message.messageType === "system") {
    return (
      <div className="flex justify-center my-2 py-1">
        <div className="bg-[#ffffff] text-[#54656f] text-xs px-4 py-1.5 rounded-full max-w-[85%] text-center shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  // Template message
  if (isTemplate) {
    const templateName = (meta?.templateName as string) || "template";
    const templateParams = (meta?.templateParams as string[]) || [];
    const statusColor = message.status === "read" ? "text-blue-400" : message.status === "delivered" ? "text-green-400" : message.status === "failed" ? "text-red-400" : "text-[#54656f]";
    const statusLabel = message.status === "read" ? "Lida" : message.status === "delivered" ? "Entregue" : message.status === "failed" ? "Falhou" : "Enviada";

    return (
      <div className={`flex ${isFirstInGroup ? "mt-2" : "mt-0.5"} justify-end`}>
        <div className="max-w-[75%]">
          <div className="bg-[#d9fdd3] rounded-xl rounded-tr-none px-4 py-2.5 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileText className="h-3.5 w-3.5 text-[#00a884]" />
              <span className="text-xs font-semibold text-[#00a884]">{templateName}</span>
            </div>
            {templateParams.length > 0 && (
              <div className="text-xs text-[#54656f] mb-1.5 flex flex-wrap gap-1">
                {templateParams.map((p, i) => (
                  <span key={i} className="bg-[#00a884]/10 rounded px-1.5 py-0.5">{p}</span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-white/10">
              <span className={`text-[10px] font-medium ${statusColor}`}>{statusLabel}</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#54656f]">{horaBR(message.createdAt)}</span>
                <DeliveryStatusIcon status={message.status} deliveryError={message.deliveryError} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Bubble colors
  const bubbleClass = isCustomer
    ? "bg-[#f0f2f5] text-[#111b21]"
    : isBot
    ? "bg-[#d9fdd3] text-[#111b21]"
    : "bg-[#d9fdd3] text-[#111b21]";

  // Corner radius: cut the origin corner for first message in group
  const radiusClass = isCustomer
    ? isFirstInGroup ? "rounded-xl rounded-tl-none" : "rounded-xl"
    : isFirstInGroup ? "rounded-xl rounded-tr-none" : "rounded-xl";

  return (
    <div className={`flex ${isCustomer ? "justify-start" : "justify-end"} ${isFirstInGroup ? "mt-3" : "mt-0.5"} group`}>
      <div className="relative max-w-[75%]">
        {/* Sender label for first in group */}
        {isFirstInGroup && !isCustomer && (
          <div className="flex justify-end mb-0.5 pr-1">
            <span className="text-[10px] text-[#54656f]">
              {isBot ? "IA" : message.senderName || "Atendente"}
            </span>
          </div>
        )}

        {/* Hover action: responder */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${
            isCustomer ? "-right-9" : "-left-9"
          }`}
        >
          <button
            onClick={onReply}
            className="h-7 w-7 rounded-full bg-[#ffffff] border border-[#e9edef] flex items-center justify-center hover:bg-[#e9edef] transition-colors shadow-md"
            title="Responder"
          >
            <CornerUpLeft className="h-3.5 w-3.5 text-[#54656f]" />
          </button>
        </div>

        {/* Bubble */}
        <div className={`${bubbleClass} ${radiusClass} px-3 py-2 shadow-sm min-w-[80px]`}>

          {/* Image */}
          {message.messageType === "image" && mediaUrl && (
            <div className="mb-1 -mx-1">
              <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                <img
                  src={mediaUrl}
                  alt="Imagem"
                  className="rounded-lg max-w-full max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  loading="lazy"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </a>
            </div>
          )}

          {/* Audio */}
          {message.messageType === "audio" && (
            <div className="mb-1">
              {mediaUrl ? (
                <AudioPlayer url={mediaUrl} />
              ) : (
                <div className="flex items-center gap-2 text-xs text-[#54656f]">
                  <Volume2 className="h-3.5 w-3.5" /><span>Mensagem de voz</span>
                </div>
              )}
              {transcribedText && (
                <div className="mt-2 pt-2 border-t border-white/10">
                  <span className="text-[10px] text-[#54656f] block mb-0.5">Transcrição:</span>
                  <p className="whitespace-pre-wrap text-xs italic opacity-80">{transcribedText}</p>
                </div>
              )}
            </div>
          )}

          {/* Video */}
          {message.messageType === "video" && mediaUrl && (
            <div className="mb-1 -mx-1">
              <video src={mediaUrl} controls className="rounded-lg max-w-full max-h-64 object-contain bg-black" preload="metadata" />
            </div>
          )}

          {/* Document */}
          {message.messageType === "document" && mediaUrl && (
            <div className="mb-1">
              <a href={mediaUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded-lg bg-black/20 hover:bg-black/30 transition-colors">
                <FileText className="h-5 w-5 text-[#54656f] shrink-0" />
                <span className="text-xs text-[#00a884] underline truncate">Abrir documento</span>
              </a>
            </div>
          )}

          {/* Text content */}
          {!(message.messageType === "image" && mediaUrl && ["[Imagem enviada pelo cliente]","[Imagem recebida]","[Imagem enviada]"].includes(message.content)) &&
           !(message.messageType === "audio" && ["[Mensagem de áudio]","[Áudio não pôde ser transcrito]","[Mensagem de voz]"].includes(message.content)) &&
           !(message.messageType === "video" && mediaUrl && ["[Vídeo enviado]","[Vídeo recebido]"].includes(message.content)) && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {interactiveType
                ? (meta?.body as string || message.content.split("\n\n[")[0] || message.content)
                : message.content}
            </p>
          )}

          {/* Interactive Buttons */}
          {interactiveType === "buttons" && effectiveButtons.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
              {effectiveButtons.map((btn: any, i: number) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#00a884]/15 border border-[#00a884]/25 text-xs font-medium text-[#00a884]">
                  <span className="h-4 w-4 rounded-full border border-[#00a884]/40 flex items-center justify-center text-[9px] shrink-0">{i + 1}</span>
                  {btn.title}
                </div>
              ))}
            </div>
          )}

          {/* Interactive List */}
          {interactiveType === "list" && effectiveSections.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/10">
              <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-[#00a884]">
                <List className="h-3.5 w-3.5" />
                {(meta?.buttonText as string) || (interactiveData?.buttonText as string) || "Ver Opções"}
              </div>
              {effectiveSections.map((section: any, si: number) => (
                <div key={si} className="mb-2">
                  {section.title && <div className="text-[10px] font-semibold text-[#54656f] uppercase tracking-wider mb-1">{section.title}</div>}
                  <div className="space-y-1">
                    {(section.rows || []).map((row: any, ri: number) => (
                      <div key={ri} className="flex items-start gap-2 px-2.5 py-1.5 rounded-md bg-[#00a884]/10 border border-[#00a884]/15 text-xs">
                        <span className="h-4 w-4 rounded bg-[#00a884]/20 flex items-center justify-center text-[9px] font-bold text-[#00a884] shrink-0 mt-0.5">{ri + 1}</span>
                        <div className="min-w-0">
                          <div className="font-medium text-[#111b21]">{row.title}</div>
                          {row.description && <div className="text-[#54656f] text-[10px] mt-0.5 line-clamp-2">{row.description}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Timestamp + status (inside bubble, bottom-right) */}
          <div className={`flex items-center gap-1 mt-1 ${isCustomer ? "justify-end" : "justify-end"}`}>
            {!isCustomer && !isBot && (
              <span className="text-[10px] text-[#54656f]/60">Atendente ·</span>
            )}
            {isBot && (
              <span className="text-[10px] text-[#54656f]/60">IA ·</span>
            )}
            <span className="text-[10px] text-[#54656f]">
              {horaBR(message.createdAt)}
            </span>
            {!isCustomer && <DeliveryStatusIcon status={message.status} deliveryError={message.deliveryError} />}
          </div>
        </div>

        {/* Reactions display */}
        {reactions.length > 0 && (
          <div className={`flex gap-1 mt-1 flex-wrap ${isCustomer ? "justify-start" : "justify-end"}`}>
            {reactions.map((emoji, i) => (
              <span key={i} className="bg-[#ffffff] border border-[#e9edef] rounded-full px-2 py-0.5 text-sm shadow-sm">
                {emoji}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// DeliveryStatusIcon
// ─────────────────────────────────────────────

function DeliveryStatusIcon({ status, deliveryError }: { status?: string | null; deliveryError?: string | null }) {
  if (!status) return null;
  switch (status) {
    case "sent":
      return (
        <span className="inline-flex items-center" title="Enviada">
          <svg width="14" height="10" viewBox="0 0 16 12" fill="none" className="text-[#54656f]">
            <path d="M1 6l4 4L14 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      );
    case "delivered":
      return (
        <span className="inline-flex items-center" title="Entregue">
          <svg width="18" height="10" viewBox="0 0 20 12" fill="none" className="text-[#54656f]">
            <path d="M1 6l4 4L14 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6l4 4L19 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      );
    case "read":
      return (
        <span className="inline-flex items-center" title="Lida">
          <svg width="18" height="10" viewBox="0 0 20 12" fill="none" className="text-[#53bdeb]">
            <path d="M1 6l4 4L14 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6l4 4L19 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center" title={deliveryError || "Falha na entrega"}>
          <AlertTriangle className="h-3 w-3 text-red-500" />
        </span>
      );
    default:
      return null;
  }
}

// ─────────────────────────────────────────────
// AudioPlayer
// ─────────────────────────────────────────────

function AudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);
  const maxTimeRef = useRef(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateDuration = () => {
      const d = audio.duration;
      if (d && isFinite(d) && d > 0) setDuration(d);
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.currentTime > maxTimeRef.current) maxTimeRef.current = audio.currentTime;
      updateDuration();
    };
    const onEnded = () => {
      setIsPlaying(false);
      if (maxTimeRef.current > 0 && duration === 0) setDuration(maxTimeRef.current);
    };
    const onError = () => setError(true);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("durationchange", updateDuration);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [duration]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); } else { audio.play().catch(() => setError(true)); }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const fmt = (s: number) => {
    if (!s || !isFinite(s) || isNaN(s)) return "0:00";
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  };

  const effectiveDuration = duration > 0 && isFinite(duration) ? duration : maxTimeRef.current;

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-[#54656f]">
        <Volume2 className="h-3.5 w-3.5" />
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[#00a884] underline">Baixar áudio</a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio ref={audioRef} src={url} preload="auto" />
      <button
        onClick={togglePlay}
        className="h-9 w-9 rounded-full bg-[#00a884]/20 hover:bg-[#00a884]/30 flex items-center justify-center shrink-0 transition-colors"
      >
        {isPlaying ? <Pause className="h-4 w-4 text-[#00a884]" /> : <Play className="h-4 w-4 text-[#00a884] ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        {effectiveDuration > 0 ? (
          <input
            type="range" min={0} max={effectiveDuration} step={0.1} value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 rounded-full appearance-none bg-[#e9edef] cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#00a884]"
          />
        ) : (
          <div className="w-full h-1 rounded-full bg-[#e9edef] relative overflow-hidden">
            {isPlaying && <div className="absolute inset-0 bg-[#00a884]/40 animate-pulse" />}
          </div>
        )}
        <div className="flex justify-between text-[9px] text-[#54656f]">
          <span>{fmt(currentTime)}</span>
          <span>{effectiveDuration > 0 ? fmt(effectiveDuration) : (isPlaying ? "" : "Áudio")}</span>
        </div>
      </div>
    </div>
  );
}
