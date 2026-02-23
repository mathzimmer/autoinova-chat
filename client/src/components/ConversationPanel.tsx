import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, UserCheck, Phone, Car, CreditCard, ArrowLeftRight, Target, Zap, ZapOff, Pencil, Save, X, Mail, StickyNote } from "lucide-react";
import { toast } from "sonner";

type Props = {
  conversationId: number;
};

export default function ConversationPanel({ conversationId }: Props) {
  const utils = trpc.useUtils();
  const { data: conversation } = trpc.conversation.getById.useQuery({ id: conversationId });
  const { data: lead } = trpc.lead.getByConversation.useQuery({ conversationId });

  const [editingContact, setEditingContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactNotes, setContactNotes] = useState("");

  useEffect(() => {
    if (conversation) {
      setContactName(conversation.contactName || "");
      setContactEmail((conversation as any).contactEmail || "");
      setContactNotes((conversation as any).contactNotes || "");
    }
  }, [conversation]);

  const toggleAI = trpc.conversation.toggleAI.useMutation({
    onSuccess: (data) => {
      utils.conversation.getById.invalidate({ id: conversationId });
      utils.conversation.list.invalidate();
      toast.success(data?.aiActive ? "IA reativada" : "IA pausada - você assumiu o atendimento");
    },
  });

  const updateStatus = trpc.conversation.updateStatus.useMutation({
    onSuccess: () => {
      utils.conversation.getById.invalidate({ id: conversationId });
      utils.conversation.list.invalidate();
      toast.success("Status atualizado");
    },
  });

  const updateContact = trpc.conversation.updateContact.useMutation({
    onSuccess: () => {
      utils.conversation.getById.invalidate({ id: conversationId });
      utils.conversation.list.invalidate();
      setEditingContact(false);
      toast.success("Contato atualizado");
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });

  const handleSaveContact = () => {
    updateContact.mutate({
      id: conversationId,
      contactName: contactName.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      contactNotes: contactNotes.trim() || undefined,
    });
  };

  const handleCancelEdit = () => {
    if (conversation) {
      setContactName(conversation.contactName || "");
      setContactEmail((conversation as any).contactEmail || "");
      setContactNotes((conversation as any).contactNotes || "");
    }
    setEditingContact(false);
  };

  if (!conversation) return null;

  return (
    <div className="h-full flex flex-col bg-card border-l border-border overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold text-card-foreground mb-1">Painel de Controle</h3>
        <p className="text-xs text-muted-foreground">Gerenciar atendimento</p>
      </div>

      {/* AI Control */}
      <div className="p-4 border-b border-border shrink-0">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Controle da IA</h4>
        <div className="space-y-2">
          {conversation.aiActive ? (
            <Button
              onClick={() => toggleAI.mutate({ id: conversationId, aiActive: false })}
              variant="outline"
              className="w-full justify-start gap-2 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
              disabled={toggleAI.isPending}
            >
              <UserCheck className="h-4 w-4" />
              Assumir Conversa
            </Button>
          ) : (
            <Button
              onClick={() => toggleAI.mutate({ id: conversationId, aiActive: true })}
              variant="outline"
              className="w-full justify-start gap-2 border-primary/30 text-primary hover:bg-primary/10"
              disabled={toggleAI.isPending}
            >
              <Bot className="h-4 w-4" />
              Reativar IA
            </Button>
          )}
          <div className="flex items-center gap-2 p-2 rounded-md bg-secondary/50">
            {conversation.aiActive ? (
              <>
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-xs text-primary font-medium">IA respondendo automaticamente</span>
              </>
            ) : (
              <>
                <ZapOff className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">IA pausada - atendimento humano</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="p-4 border-b border-border shrink-0">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Status da Conversa</h4>
        <Select
          value={conversation.status}
          onValueChange={(value) => updateStatus.mutate({ id: conversationId, status: value as any })}
        >
          <SelectTrigger className="bg-input border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Aberta</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="resolved">Resolvida</SelectItem>
            <SelectItem value="closed">Fechada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Contact Info - Editable */}
      <div className="p-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contato</h4>
          {!editingContact ? (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-primary" onClick={() => setEditingContact(true)}>
              <Pencil className="h-3 w-3 mr-1" />
              Editar
            </Button>
          ) : (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary" onClick={handleSaveContact} disabled={updateContact.isPending}>
                <Save className="h-3 w-3 mr-1" />
                Salvar
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={handleCancelEdit}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        {editingContact ? (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Nome</label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Nome do contato"
                className="h-8 text-sm bg-input border-border"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Telefone</label>
              <Input value={conversation.phone} disabled className="h-8 text-sm bg-muted border-border opacity-60" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">E-mail</label>
              <Input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="email@exemplo.com"
                className="h-8 text-sm bg-input border-border"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Observações</label>
              <Textarea
                value={contactNotes}
                onChange={(e) => setContactNotes(e.target.value)}
                placeholder="Notas sobre o contato, preferências, observações..."
                className="text-sm bg-input border-border min-h-[80px] resize-y"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-card-foreground">{conversation.phone}</span>
            </div>
            {conversation.contactName && (
              <div className="flex items-center gap-2 text-sm">
                <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-card-foreground">{conversation.contactName}</span>
              </div>
            )}
            {(conversation as any).contactEmail && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-card-foreground">{(conversation as any).contactEmail}</span>
              </div>
            )}
            <Badge variant="outline" className="text-xs">
              {conversation.channel === "whatsapp" ? "WhatsApp" : conversation.channel}
            </Badge>
            {(conversation as any).contactNotes && (
              <div className="mt-2 p-2 rounded-md bg-secondary/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <StickyNote className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Observações</span>
                </div>
                <p className="text-xs text-card-foreground whitespace-pre-wrap">{(conversation as any).contactNotes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lead Info */}
      {lead && (
        <div className="p-4 shrink-0">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Dados do Lead</h4>
          <div className="space-y-3">
            {lead.intention && (
              <LeadField icon={<Target className="h-3.5 w-3.5" />} label="Intenção" value={lead.intention} />
            )}
            {lead.vehicleInterest && (
              <LeadField icon={<Car className="h-3.5 w-3.5" />} label="Veículo de Interesse" value={lead.vehicleInterest} />
            )}
            {lead.hasTrade !== null && lead.hasTrade !== undefined && (
              <LeadField icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Tem Troca" value={lead.hasTrade ? "Sim" : "Não"} />
            )}
            {lead.tradeVehicle && (
              <LeadField icon={<Car className="h-3.5 w-3.5" />} label="Veículo Troca" value={`${lead.tradeVehicle} ${lead.tradeYear || ""} ${lead.tradeKm ? `- ${lead.tradeKm} km` : ""}`} />
            )}
            {lead.paymentMethod && (
              <LeadField icon={<CreditCard className="h-3.5 w-3.5" />} label="Pagamento" value={lead.paymentMethod} />
            )}
            {lead.downPayment && (
              <LeadField icon={<CreditCard className="h-3.5 w-3.5" />} label="Entrada" value={lead.downPayment} />
            )}
            <Separator className="my-2" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status do Lead</span>
              <Badge variant={lead.status === "qualified" ? "default" : "outline"} className="text-xs capitalize">
                {lead.status === "new" ? "Novo" :
                 lead.status === "qualifying" ? "Qualificando" :
                 lead.status === "qualified" ? "Qualificado" :
                 lead.status === "contacted" ? "Contatado" :
                 lead.status === "converted" ? "Convertido" :
                 lead.status === "lost" ? "Perdido" : lead.status}
              </Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-sm text-card-foreground">{value}</p>
      </div>
    </div>
  );
}
