import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, UserCheck, Phone, Car, CreditCard, ArrowLeftRight, Target, Zap, ZapOff, Pencil, Save, X, Mail, StickyNote, DollarSign, ExternalLink, Link2, FileText } from "lucide-react";
import { toast } from "sonner";

type Props = {
  conversationId: number;
};

export default function ConversationPanel({ conversationId }: Props) {
  const utils = trpc.useUtils();
  const { data: conversation } = trpc.conversation.getById.useQuery({ id: conversationId });
  const { data: lead, refetch: refetchLead } = trpc.lead.getByConversation.useQuery({ conversationId });
  const { data: vehicles } = trpc.vehicle.list.useQuery();

  // Find the linked vehicle
  const linkedVehicle = lead?.vehicleId && vehicles ? vehicles.find((v: any) => v.id === lead.vehicleId) : null;

  // Contact editing state
  const [editingContact, setEditingContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactNotes, setContactNotes] = useState("");

  // Lead editing state
  const [editingLead, setEditingLead] = useState(false);
  const [leadIntention, setLeadIntention] = useState("");
  const [leadVehicleInterest, setLeadVehicleInterest] = useState("");
  const [leadVehicleId, setLeadVehicleId] = useState<number | null>(null);
  const [leadHasTrade, setLeadHasTrade] = useState(false);
  const [leadTradeVehicle, setLeadTradeVehicle] = useState("");
  const [leadTradeYear, setLeadTradeYear] = useState("");
  const [leadTradeKm, setLeadTradeKm] = useState("");
  const [leadPaymentMethod, setLeadPaymentMethod] = useState("");
  const [leadDownPayment, setLeadDownPayment] = useState("");
  const [leadNotes, setLeadNotes] = useState("");
  const [leadStatus, setLeadStatus] = useState("qualifying");

  useEffect(() => {
    if (conversation) {
      setContactName(conversation.contactName || "");
      setContactEmail((conversation as any).contactEmail || "");
      setContactNotes((conversation as any).contactNotes || "");
    }
  }, [conversation]);

  useEffect(() => {
    if (lead) {
      setLeadIntention(lead.intention || "");
      setLeadVehicleInterest(lead.vehicleInterest || "");
      setLeadVehicleId(lead.vehicleId || null);
      setLeadHasTrade(lead.hasTrade || false);
      setLeadTradeVehicle(lead.tradeVehicle || "");
      setLeadTradeYear(lead.tradeYear || "");
      setLeadTradeKm(lead.tradeKm || "");
      setLeadPaymentMethod(lead.paymentMethod || "");
      setLeadDownPayment(lead.downPayment || "");
      setLeadNotes((lead as any).notes || "");
      setLeadStatus(lead.status || "qualifying");
    }
  }, [lead]);

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

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => {
      refetchLead();
      setEditingLead(false);
      toast.success("Dados do lead atualizados");
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

  const handleCancelContact = () => {
    if (conversation) {
      setContactName(conversation.contactName || "");
      setContactEmail((conversation as any).contactEmail || "");
      setContactNotes((conversation as any).contactNotes || "");
    }
    setEditingContact(false);
  };

  const handleSaveLead = () => {
    updateLead.mutate({
      conversationId,
      intention: leadIntention.trim() || undefined,
      vehicleInterest: leadVehicleInterest.trim() || undefined,
      vehicleId: leadVehicleId || undefined,
      hasTrade: leadHasTrade,
      tradeVehicle: leadTradeVehicle.trim() || undefined,
      tradeYear: leadTradeYear.trim() || undefined,
      tradeKm: leadTradeKm.trim() || undefined,
      paymentMethod: leadPaymentMethod.trim() || undefined,
      downPayment: leadDownPayment.trim() || undefined,
      notes: leadNotes.trim() || undefined,
      status: leadStatus as any,
    });
  };

  const handleCancelLead = () => {
    if (lead) {
      setLeadIntention(lead.intention || "");
      setLeadVehicleInterest(lead.vehicleInterest || "");
      setLeadVehicleId(lead.vehicleId || null);
      setLeadHasTrade(lead.hasTrade || false);
      setLeadTradeVehicle(lead.tradeVehicle || "");
      setLeadTradeYear(lead.tradeYear || "");
      setLeadTradeKm(lead.tradeKm || "");
      setLeadPaymentMethod(lead.paymentMethod || "");
      setLeadDownPayment(lead.downPayment || "");
      setLeadNotes((lead as any).notes || "");
      setLeadStatus(lead.status || "qualifying");
    }
    setEditingLead(false);
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

      {/* Contact Info */}
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
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={handleCancelContact}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        {editingContact ? (
          <div className="space-y-2.5">
            <FieldInput label="Nome" value={contactName} onChange={setContactName} placeholder="Nome do contato" />
            <FieldInput label="Telefone" value={conversation.phone} disabled />
            <FieldInput label="E-mail" value={contactEmail} onChange={setContactEmail} placeholder="email@exemplo.com" />
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Observações</label>
              <Textarea
                value={contactNotes}
                onChange={(e) => setContactNotes(e.target.value)}
                placeholder="Notas sobre o contato..."
                className="text-sm bg-input border-border min-h-[60px] resize-y"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <InfoRow icon={<Phone className="h-3.5 w-3.5" />} value={conversation.phone} />
            {conversation.contactName && <InfoRow icon={<UserCheck className="h-3.5 w-3.5" />} value={conversation.contactName} />}
            {(conversation as any).contactEmail && <InfoRow icon={<Mail className="h-3.5 w-3.5" />} value={(conversation as any).contactEmail} />}
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

      {/* Lead Info - Editable */}
      <div className="p-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dados do Lead</h4>
          {!editingLead ? (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-primary" onClick={() => setEditingLead(true)}>
              <Pencil className="h-3 w-3 mr-1" />
              Editar
            </Button>
          ) : (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary" onClick={handleSaveLead} disabled={updateLead.isPending}>
                <Save className="h-3 w-3 mr-1" />
                Salvar
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={handleCancelLead}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        {editingLead ? (
          <div className="space-y-2.5">
            <FieldInput label="Intenu00e7u00e3o" value={leadIntention} onChange={setLeadIntention} placeholder="compra, troca, informau00e7u00e3o..." />
            <FieldInput label="Veu00edculo de Interesse (Texto)" value={leadVehicleInterest} onChange={setLeadVehicleInterest} placeholder="Ex: Toyota Corolla 2024" />
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Veu00edculo do Estoque</label>
              <Select value={leadVehicleId?.toString() || ""} onValueChange={(val) => setLeadVehicleId(val ? parseInt(val) : null)}>
                <SelectTrigger className="h-8 text-sm bg-input border-border">
                  <SelectValue placeholder="Selecione um veu00edculo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhum (limpar)</SelectItem>
                  {vehicles && vehicles.length > 0 ? (
                    vehicles.map((v: any) => (
                      <SelectItem key={v.id} value={v.id.toString()}>
                        {v.year} {v.brand} {v.model} - {v.km}km
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="" disabled>Carregando veu00edculos...</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between py-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Tem Troca?</label>
              <Switch checked={leadHasTrade} onCheckedChange={setLeadHasTrade} />
            </div>
            {leadHasTrade && (
              <>
                <FieldInput label="Veículo de Troca" value={leadTradeVehicle} onChange={setLeadTradeVehicle} placeholder="Ex: Honda Civic" />
                <div className="grid grid-cols-2 gap-2">
                  <FieldInput label="Ano" value={leadTradeYear} onChange={setLeadTradeYear} placeholder="2020" />
                  <FieldInput label="KM" value={leadTradeKm} onChange={setLeadTradeKm} placeholder="50.000" />
                </div>
              </>
            )}
            <FieldInput label="Forma de Pagamento" value={leadPaymentMethod} onChange={setLeadPaymentMethod} placeholder="financiamento, à vista..." />
            <FieldInput label="Valor de Entrada" value={leadDownPayment} onChange={setLeadDownPayment} placeholder="R$ 10.000" />
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Notas / Resumo</label>
              <Textarea
                value={leadNotes}
                onChange={(e) => setLeadNotes(e.target.value)}
                placeholder="Resumo da conversa, observações..."
                className="text-sm bg-input border-border min-h-[60px] resize-y"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Status do Lead</label>
              <Select value={leadStatus} onValueChange={setLeadStatus}>
                <SelectTrigger className="h-8 text-sm bg-input border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Novo</SelectItem>
                  <SelectItem value="qualifying">Qualificando</SelectItem>
                  <SelectItem value="qualified">Qualificado</SelectItem>
                  <SelectItem value="contacted">Contatado</SelectItem>
                  <SelectItem value="converted">Convertido</SelectItem>
                  <SelectItem value="lost">Perdido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : lead ? (
          <div className="space-y-3">
            {lead.intention && <LeadField icon={<Target className="h-3.5 w-3.5" />} label="Intenção" value={lead.intention} />}
            {lead.vehicleInterest && <LeadField icon={<Car className="h-3.5 w-3.5" />} label="Veículo de Interesse" value={lead.vehicleInterest} />}
            {linkedVehicle && (
              <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
                <div className="flex items-center gap-1.5 mb-1">
                  <Link2 className="h-3 w-3 text-primary" />
                  <span className="text-[10px] text-primary uppercase tracking-wider font-semibold">Veículo Vinculado</span>
                </div>
                <p className="text-sm text-card-foreground font-medium">{linkedVehicle.title || `${linkedVehicle.brand} ${linkedVehicle.model}`}</p>
                <p className="text-xs text-muted-foreground">{linkedVehicle.year} | R$ {linkedVehicle.price?.toLocaleString("pt-BR")} | {linkedVehicle.mileage?.toLocaleString("pt-BR")} km</p>
                {linkedVehicle.url && (
                  <a href={linkedVehicle.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
                    <ExternalLink className="h-3 w-3" /> Ver anúncio
                  </a>
                )}
              </div>
            )}
            {lead.hasTrade !== null && lead.hasTrade !== undefined && (
              <LeadField icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Tem Troca" value={lead.hasTrade ? "Sim" : "Não"} />
            )}
            {lead.tradeVehicle && (
              <LeadField icon={<Car className="h-3.5 w-3.5" />} label="Veículo Troca" value={`${lead.tradeVehicle} ${lead.tradeYear || ""} ${lead.tradeKm ? `- ${lead.tradeKm} km` : ""}`} />
            )}
            {lead.paymentMethod && <LeadField icon={<CreditCard className="h-3.5 w-3.5" />} label="Pagamento" value={lead.paymentMethod} />}
            {lead.downPayment && <LeadField icon={<DollarSign className="h-3.5 w-3.5" />} label="Entrada" value={lead.downPayment} />}
            {(lead as any).notes && (
              <div className="mt-2 p-2.5 rounded-md bg-muted/50 border border-border">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Resumo da Conversa</span>
                </div>
                <p className="text-xs text-card-foreground leading-relaxed whitespace-pre-wrap">{(lead as any).notes}</p>
              </div>
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
        ) : (
          <p className="text-xs text-muted-foreground text-center py-3">Nenhum dado de lead coletado ainda. A IA coletará automaticamente durante a conversa.</p>
        )}
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange, placeholder, disabled }: { label: string; value: string; onChange?: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      <Input
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        className="h-8 text-sm bg-input border-border"
      />
    </div>
  );
}

function InfoRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-card-foreground">{value}</span>
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
