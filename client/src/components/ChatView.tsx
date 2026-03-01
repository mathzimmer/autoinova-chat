import { trpc } from "@/lib/trpc";
import { useConversationSocket } from "@/hooks/useSocket";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Bot, User, Phone, ArrowLeft, Image, Volume2, FileText, Play, Pause, Mic, MicOff, X, ImagePlus, Loader2, Clock, AlertTriangle, MessageSquareText, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type Props = {
  conversationId: number;
  onBack?: () => void;
  panelToggle?: React.ReactNode;
};

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB

type ImagePreviewItem = {
  file: File;
  dataUrl: string;
};

export default function ChatView({ conversationId, onBack, panelToggle }: Props) {
  const [newMessage, setNewMessage] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image preview state - now supports multiple images
  const [imagePreviews, setImagePreviews] = useState<ImagePreviewItem[]>([]);
  const [imageCaption, setImageCaption] = useState("");
  const [sendingImageIndex, setSendingImageIndex] = useState(-1);

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: conversation } = trpc.conversation.getById.useQuery(
    { id: conversationId },
    { refetchInterval: 15000 }
  );
  const { data: msgs, refetch: refetchMessages } = trpc.message.list.useQuery(
    { conversationId },
    { refetchInterval: 5000 }
  );
  // 24h window detection
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
    onError: (err) => {
      toast.error("Erro ao enviar template: " + err.message);
    },
  });

  // Calculate if 24h window is expired based on conversation data
  const isWindowExpired = useMemo(() => {
    if (!conversation) return false;
    // If server flagged it as expired
    if ((conversation as any).windowExpired) return true;
    // Calculate from lastCustomerMessageAt
    const lastCustomerMsg = (conversation as any).lastCustomerMessageAt;
    if (!lastCustomerMsg) return false;
    const elapsed = Date.now() - Number(lastCustomerMsg);
    const hours24 = 24 * 60 * 60 * 1000;
    return elapsed > hours24;
  }, [conversation]);

  // Find the selected template object for param count
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
    });
  };

  const sendMutation = trpc.message.send.useMutation({
    onSuccess: (data: any) => {
      setNewMessage("");
      refetchMessages();
      inputRef.current?.focus();
      // Check if window expired was detected
      if (data?.windowExpired) {
        toast.error("Janela de 24h expirada. Use um template aprovado para reabrir a conversa.");
      }
    },
  });
  const sendMediaMutation = trpc.message.sendMedia.useMutation({
    onSuccess: () => {
      refetchMessages();
    },
    onError: (err) => {
      toast.error("Erro ao enviar mídia: " + err.message);
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

  // Smart auto-scroll: only scroll to bottom if user is already near bottom
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevMsgCountRef = useRef(0);

  // Track scroll position to detect manual scrolling
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const threshold = 100; // pixels from bottom
    const nearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    setIsNearBottom(nearBottom);
    if (nearBottom) {
      setHasNewMessages(false);
    }
  }, []);

  // Auto-scroll to bottom only when near bottom or on initial load
  useEffect(() => {
    if (!msgs || !scrollRef.current) return;
    const msgCount = msgs.length;
    const isNewMessage = msgCount > prevMsgCountRef.current;
    prevMsgCountRef.current = msgCount;

    if (isNearBottom || !isNewMessage) {
      // User is near bottom or this is initial load/same data - scroll to bottom
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } else if (isNewMessage) {
      // User scrolled up and new message arrived - show indicator
      setHasNewMessages(true);
    }
  }, [msgs, isNearBottom]);

  // Scroll to bottom when clicking the "new messages" indicator
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setHasNewMessages(false);
    }
  }, []);

  // Mark as read on open
  useEffect(() => {
    markAsReadMutation.mutate({ id: conversationId });
  }, [conversationId]);

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

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

  // --- Image handling (multiple) ---
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Reset input immediately so same files can be selected again
    const fileList = Array.from(files);
    e.target.value = "";

    let errorCount = 0;
    const validFiles: File[] = [];

    for (const file of fileList) {
      if (!file.type.startsWith("image/")) {
        errorCount++;
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: tamanho máximo é 16MB.`);
        continue;
      }
      validFiles.push(file);
    }

    if (errorCount > 0) {
      toast.error(`${errorCount} arquivo(s) ignorado(s) — selecione apenas imagens.`);
    }

    if (validFiles.length === 0) return;

    // Read all files in parallel with Promise.all
    const readPromises = validFiles.map((file) => {
      return new Promise<ImagePreviewItem>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({ file, dataUrl: reader.result as string });
        };
        reader.onerror = () => {
          // Fallback: create object URL instead
          resolve({ file, dataUrl: URL.createObjectURL(file) });
        };
        reader.readAsDataURL(file);
      });
    });

    const newPreviews = await Promise.all(readPromises);
    setImagePreviews((prev) => [...prev, ...newPreviews]);
  };

  const handleRemoveImage = (index: number) => {
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendImages = async () => {
    if (imagePreviews.length === 0) return;

    // Send images sequentially
    for (let i = 0; i < imagePreviews.length; i++) {
      setSendingImageIndex(i);
      const preview = imagePreviews[i];

      try {
        const base64 = preview.dataUrl.split(",")[1]; // Remove data:image/...;base64, prefix
        await sendMediaMutation.mutateAsync({
          conversationId,
          mediaType: "image",
          base64Data: base64,
          mimeType: preview.file.type,
          fileName: preview.file.name,
          caption: i === 0 ? (imageCaption || undefined) : undefined, // Caption only on first image
        });
      } catch {
        // Error already handled by onError
        break;
      }
    }

    setSendingImageIndex(-1);
    setImagePreviews([]);
    setImageCaption("");
    inputRef.current?.focus();
  };

  const handleCancelImages = () => {
    setImagePreviews([]);
    setImageCaption("");
  };

  // --- Audio recording ---
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

        if (audioBlob.size > MAX_FILE_SIZE) {
          toast.error("O tamanho máximo é 16MB.");
          return;
        }

        if (audioBlob.size < 1000) {
          // Too short, ignore
          return;
        }

        // Convert to base64 and send
        // The server will convert webm → ogg for WhatsApp compatibility
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          sendMediaMutation.mutate({
            conversationId,
            mediaType: "audio",
            base64Data: base64,
            mimeType: "audio/webm",
            fileName: "voice-message.webm",
          });
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start(250); // Collect data every 250ms
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      toast.error("Verifique se o navegador tem permissão para acessar o microfone.");
    }
  }, [conversationId, sendMediaMutation]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isSending = sendMutation.isPending || sendMediaMutation.isPending;

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
        {/* Panel toggle button */}
        {panelToggle}
      </div>

      {/* Messages */}
      <div className="relative flex-1">
      <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto p-4 space-y-3">
        {!msgs || msgs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
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
      {/* New messages indicator */}
      {hasNewMessages && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-primary text-primary-foreground px-4 py-1.5 rounded-full text-xs font-medium shadow-lg hover:bg-primary/90 transition-all animate-in fade-in slide-in-from-bottom-2 flex items-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          Novas mensagens
        </button>
      )}
      </div>

      {/* Image Preview - Multiple images */}
      {imagePreviews.length > 0 && (
        <div className="border-t border-border p-3 bg-secondary/30">
          <div className="flex flex-col gap-3">
            {/* Image thumbnails grid */}
            <div className="flex flex-wrap gap-2">
              {imagePreviews.map((preview, index) => (
                <div key={index} className="relative group">
                  <img
                    src={preview.dataUrl}
                    alt={`Preview ${index + 1}`}
                    className={`h-16 w-16 object-cover rounded-lg border border-border ${
                      sendingImageIndex === index ? "opacity-50" : ""
                    }`}
                  />
                  {sendingImageIndex === index && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}
                  {sendingImageIndex < 0 && (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleRemoveImage(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {/* Caption + send */}
            <div className="flex items-center gap-2">
              <Input
                value={imageCaption}
                onChange={(e) => setImageCaption(e.target.value)}
                placeholder="Legenda (opcional)..."
                className="bg-input border-border text-sm flex-1"
                disabled={sendingImageIndex >= 0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendImages();
                  }
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCancelImages}
                disabled={sendingImageIndex >= 0}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="Cancelar"
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                onClick={handleSendImages}
                disabled={sendingImageIndex >= 0}
                size="sm"
                className="shrink-0 bg-primary hover:bg-primary/90"
              >
                {sendingImageIndex >= 0 ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    {sendingImageIndex + 1}/{imagePreviews.length}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1" />
                    Enviar {imagePreviews.length > 1 ? `${imagePreviews.length} fotos` : "foto"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 24h Window Expired Banner */}
      {isWindowExpired && (
        <div className="border-t border-yellow-500/30 bg-yellow-500/10 px-4 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Janela de 24h expirada</p>
              <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80">Para enviar mensagem, use um template aprovado pela Meta.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-yellow-500/50 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/20"
              onClick={() => setShowTemplateDialog(true)}
            >
              <MessageSquareText className="h-4 w-4 mr-1.5" />
              Enviar Template
            </Button>
          </div>
        </div>
      )}

      {/* Template Send Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar Template WhatsApp</DialogTitle>
            <DialogDescription>
              Selecione um template aprovado pela Meta para reabrir a conversa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Template</label>
              <Select value={selectedTemplate} onValueChange={(val) => {
                setSelectedTemplate(val);
                setTemplateParams([]);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um template" />
                </SelectTrigger>
                <SelectContent>
                  {templates?.filter((t: any) => t.status === 'APPROVED').map((t: any) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name} ({t.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedTemplateObj && (
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                <p className="text-sm">{(selectedTemplateObj as any).components?.find((c: any) => c.type === 'BODY')?.text || selectedTemplateObj.name}</p>
              </div>
            )}
            {((selectedTemplateObj as any)?.components?.find((c: any) => c.type === 'BODY')?.text || '')?.match(/\{\{\d+\}\}/g)?.map((_: string, i: number) => (
              <div key={i}>
                <label className="text-sm font-medium mb-1 block">Parâmetro {i + 1}</label>
                <Input
                  value={templateParams[i] || ""}
                  onChange={(e) => {
                    const newParams = [...templateParams];
                    newParams[i] = e.target.value;
                    setTemplateParams(newParams);
                  }}
                  placeholder={`Valor para {{${i + 1}}}`}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>Cancelar</Button>
            <Button
              onClick={handleSendTemplate}
              disabled={!selectedTemplate || sendTemplateMutation.isPending}
            >
              {sendTemplateMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Enviando...</>
              ) : (
                <><Send className="h-4 w-4 mr-1" /> Enviar Template</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Input Area */}
      <div className="border-t border-border p-3 shrink-0">
        {/* Hidden file input - now accepts multiple */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />

        {isRecording ? (
          /* Recording UI */
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={cancelRecording}
              className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Cancelar gravação"
            >
              <X className="h-5 w-5" />
            </Button>
            <div className="flex-1 flex items-center gap-3 bg-destructive/5 rounded-lg px-4 py-2.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-destructive">
                Gravando... {formatRecordingTime(recordingTime)}
              </span>
            </div>
            <Button
              onClick={stopRecording}
              size="icon"
              className="shrink-0 bg-primary hover:bg-primary/90"
              title="Enviar áudio"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          /* Normal input UI */
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title="Enviar imagens"
            >
              <ImagePlus className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={startRecording}
              disabled={isSending}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title="Gravar áudio"
            >
              <Mic className="h-5 w-5" />
            </Button>
            <Input
              ref={inputRef}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem..."
              className="flex-1 bg-input border-border"
              disabled={isSending}
            />
            <Button
              onClick={handleSend}
              disabled={!newMessage.trim() || isSending}
              size="icon"
              className="bg-primary hover:bg-primary/90 shrink-0"
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}
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
  status?: string | null;
  deliveryError?: string | null;
  externalId?: string | null;
};

function DeliveryStatusIcon({ status, deliveryError }: { status?: string | null; deliveryError?: string | null }) {
  if (!status) return null;
  
  switch (status) {
    case 'sent':
      return (
        <span className="inline-flex items-center ml-1" title="Enviada">
          <svg width="14" height="10" viewBox="0 0 16 12" fill="none" className="text-muted-foreground">
            <path d="M1 6l4 4L14 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      );
    case 'delivered':
      return (
        <span className="inline-flex items-center ml-1" title="Entregue">
          <svg width="18" height="10" viewBox="0 0 20 12" fill="none" className="text-muted-foreground">
            <path d="M1 6l4 4L14 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6l4 4L19 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      );
    case 'read':
      return (
        <span className="inline-flex items-center ml-1" title="Lida">
          <svg width="18" height="10" viewBox="0 0 20 12" fill="none" className="text-blue-500">
            <path d="M1 6l4 4L14 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6l4 4L19 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center ml-1" title={deliveryError || 'Falha na entrega'}>
          <AlertTriangle className="h-3 w-3 text-destructive" />
        </span>
      );
    default:
      return null;
  }
}

function MessageBubble({ message }: { message: MessageData }) {
  const isCustomer = message.senderType === "customer";
  const isBot = message.senderType === "bot";
  const isSystem = message.senderType === "bot" && message.senderName === "Sistema";
  const meta = message.metadata as Record<string, unknown> | null;
  const mediaUrl = meta?.mediaUrl as string | undefined;
  const transcribedText = meta?.transcribedText as string | undefined;

  // System messages (delivery errors, etc.)
  if (isSystem || message.messageType === "system") {
    return (
      <div className="flex justify-center my-1">
        <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs px-3 py-1.5 rounded-full max-w-[85%] text-center">
          {message.content}
        </div>
      </div>
    );
  }

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
          {/* Delivery status for outgoing messages */}
          {!isCustomer && <DeliveryStatusIcon status={message.status} deliveryError={message.deliveryError} />}
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
          {!(message.messageType === "image" && mediaUrl && (message.content === "[Imagem enviada pelo cliente]" || message.content === "[Imagem recebida]" || message.content === "[Imagem enviada]")) &&
           !(message.messageType === "audio" && (message.content === "[Mensagem de áudio]" || message.content === "[Áudio não pôde ser transcrito]" || message.content === "[Mensagem de voz]")) && (
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
  const maxTimeRef = useRef(0); // Track max time seen for webm files without duration

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateDuration = () => {
      const d = audio.duration;
      if (d && isFinite(d) && d > 0) {
        setDuration(d);
      }
    };

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // For webm files, duration may become available during playback
      if (audio.currentTime > maxTimeRef.current) {
        maxTimeRef.current = audio.currentTime;
      }
      updateDuration();
    };
    const onLoadedMetadata = () => updateDuration();
    const onDurationChange = () => updateDuration();
    const onEnded = () => {
      setIsPlaying(false);
      // When playback ends, we know the actual duration
      if (maxTimeRef.current > 0 && duration === 0) {
        setDuration(maxTimeRef.current);
      }
    };
    const onError = () => setError(true);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [duration]);

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
    if (!seconds || !isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Effective duration: use known duration, or max time seen during playback
  const effectiveDuration = (duration > 0 && isFinite(duration)) ? duration : maxTimeRef.current;

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
      <audio ref={audioRef} src={url} preload="auto" />
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
        {effectiveDuration > 0 ? (
          <input
            type="range"
            min={0}
            max={effectiveDuration}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 rounded-full appearance-none bg-muted cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />
        ) : (
          <div className="w-full h-1 rounded-full bg-muted relative overflow-hidden">
            {isPlaying && (
              <div className="absolute inset-0 bg-primary/40 animate-pulse" />
            )}
          </div>
        )}
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <span>{effectiveDuration > 0 ? formatTime(effectiveDuration) : (isPlaying ? "" : "Áudio")}</span>
        </div>
      </div>
    </div>
  );
}
