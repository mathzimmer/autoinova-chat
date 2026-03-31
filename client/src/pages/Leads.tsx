import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Target, Phone, Car, CreditCard, ArrowLeftRight, Users, FileText,
  UserCheck, ExternalLink, Copy, MessageSquare, Pencil, ChevronDown,
  ChevronUp, MapPin, Calendar, ClipboardList, Search, X, Sparkles,
  Thermometer,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────
function formatPhone(phone: string): string {
  if (!phone) return "";
  // Remove +55 or 55 prefix
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("55") && p.length > 11) p = p.substring(2);
  return p;
}

function formatDate(dateStr: string): string {
  // dateStr is YYYY-MM-DD
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

// ─── Types ────────────────────────────────────────────────────────
type LeadWithDetails = {
  id: number;
  conversationId: number;
  phone: string;
  name: string | null;
  intention: string | null;
  vehicleInterest: string | null;
  hasTrade: boolean | null;
  tradeVehicle: string | null;
  tradeYear: string | null;
  tradeKm: string | null;
  paymentMethod: string | null;
  downPayment: string | null;
  vehicleId: number | null;
  status: string;
  funnelStatus: string | null;
  temperature: string | null;
  score: number | null;
  city: string | null;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  summaryPreview: string;
  summaries: Array<{ id: number; date: string; summary: string; messageCount: number }>;
  conversation: {
    id: number;
    contactName: string | null;
    contactPhoto: string | null;
    channel: string;
    status: string;
    aiActive: boolean;
    lastMessageAt: number | null;
  } | null;
  linkedVehicle: {
    id: number;
    brand: string;
    model: string;
    year: number;
    price: number;
    color: string | null;
    imageUrl: string | null;
    url: string | null;
  } | null;
  assignedAgent: { id: number; name: string; cargo: string } | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: "Novo", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
  qualifying: { label: "Qualificando", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
  qualified: { label: "Qualificado", color: "text-green-400", bg: "bg-green-500/10 border-green-500/30" },
  contacted: { label: "Contatado", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
  converted: { label: "Convertido", color: "text-primary", bg: "bg-primary/10 border-primary/30" },
  lost: { label: "Perdido", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
};

const STATUS_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "qualifying", label: "Qualificando" },
  { value: "qualified", label: "Qualificado" },
  { value: "contacted", label: "Contatado" },
  { value: "converted", label: "Convertido" },
  { value: "lost", label: "Perdido" },
];

const CHANNEL_ICONS: Record<string, { icon: string; color: string }> = {
  whatsapp: { icon: "🟢", color: "text-green-400" },
  instagram: { icon: "📸", color: "text-pink-400" },
  facebook: { icon: "🔵", color: "text-blue-400" },
  web: { icon: "🌐", color: "text-muted-foreground" },
  webhook: { icon: "🔗", color: "text-muted-foreground" },
};

// ─── Main Component ───────────────────────────────────────────────
export default function Leads() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLeadId, setExpandedLeadId] = useState<number | null>(null);
  const [editingLead, setEditingLead] = useState<LeadWithDetails | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [, setLocation] = useLocation();

  const { data: leadsRaw, refetch } = trpc.lead.listWithDetails.useQuery(
    { status: statusFilter },
    { refetchInterval: 15000 }
  );

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => {
      toast.success("Lead atualizado com sucesso");
      refetch();
      setEditingLead(null);
    },
    onError: (err) => toast.error(`Erro ao atualizar: ${err.message}`),
  });

  const generateSummary = trpc.lead.generateSummary.useMutation({
    onSuccess: (data) => {
      if (data) {
        toast.success("Resumo gerado com sucesso");
        refetch();
      } else {
        toast.info("Nenhuma mensagem hoje para resumir");
      }
    },
    onError: (err) => toast.error(`Erro ao gerar resumo: ${err.message}`),
  });

  const leads = useMemo(() => {
    if (!leadsRaw) return [];
    if (!searchQuery.trim()) return leadsRaw as unknown as LeadWithDetails[];
    const q = searchQuery.toLowerCase();
    return (leadsRaw as unknown as LeadWithDetails[]).filter((l) => {
      const name = (l.name || l.conversation?.contactName || "").toLowerCase();
      const phone = formatPhone(l.phone);
      const vehicle = (l.vehicleInterest || "").toLowerCase();
      const city = (l.city || "").toLowerCase();
      return name.includes(q) || phone.includes(q) || vehicle.includes(q) || city.includes(q);
    });
  }, [leadsRaw, searchQuery]);

  // ─── Copy functions ──────────────────────────────────────────
  function copyLeadInfo(lead: LeadWithDetails) {
    const parts: string[] = [];
    parts.push(`Nome: ${lead.name || lead.conversation?.contactName || "N/A"}`);
    parts.push(`Telefone: ${formatPhone(lead.phone)}`);
    if (lead.city) parts.push(`Cidade: ${lead.city}`);
    if (lead.vehicleInterest) parts.push(`Veículo de interesse: ${lead.vehicleInterest}`);
    if (lead.linkedVehicle) parts.push(`Veículo vinculado: ${lead.linkedVehicle.brand} ${lead.linkedVehicle.model} ${lead.linkedVehicle.year} - R$ ${lead.linkedVehicle.price?.toLocaleString("pt-BR")}`);
    if (lead.hasTrade && lead.tradeVehicle) parts.push(`Veículo de troca: ${lead.tradeVehicle} ${lead.tradeYear || ""} ${lead.tradeKm ? `(${lead.tradeKm} km)` : ""}`);
    if (lead.paymentMethod) parts.push(`Pagamento: ${lead.paymentMethod}${lead.downPayment ? ` - Entrada: ${lead.downPayment}` : ""}`);
    parts.push(`Status: ${STATUS_CONFIG[lead.status]?.label || lead.status}`);
    navigator.clipboard.writeText(parts.join("\n"));
    toast.success("Lead copiado para a área de transferência");
  }

  function copySummary(lead: LeadWithDetails) {
    if (!lead.summaries || lead.summaries.length === 0) {
      toast.info("Nenhum resumo disponível");
      return;
    }
    const text = lead.summaries
      .slice()
      .reverse()
      .map((s) => `[${formatDate(s.date)}] (${s.messageCount} msgs)\n${s.summary}`)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    toast.success("Resumo copiado para a área de transferência");
  }

  function openEditDialog(lead: LeadWithDetails) {
    setEditingLead(lead);
    setEditForm({
      name: lead.name || "",
      phone: formatPhone(lead.phone),
      city: lead.city || "",
      intention: lead.intention || "",
      funnelStatus: (lead as any).funnelStatus || "novo",
      vehicleInterest: lead.vehicleInterest || "",
      hasTrade: lead.hasTrade || false,
      tradeVehicle: lead.tradeVehicle || "",
      tradeYear: lead.tradeYear || "",
      tradeKm: lead.tradeKm || "",
      paymentMethod: lead.paymentMethod || "",
      downPayment: lead.downPayment || "",
      notes: lead.notes || "",
      status: lead.status,
    });
  }

  function saveEdit() {
    if (!editingLead) return;
    updateLead.mutate({
      conversationId: editingLead.conversationId,
      name: editForm.name || undefined,
      city: editForm.city || undefined,
      intention: editForm.intention || undefined,
      vehicleInterest: editForm.vehicleInterest || undefined,
      hasTrade: editForm.hasTrade,
      tradeVehicle: editForm.tradeVehicle || undefined,
      tradeYear: editForm.tradeYear || undefined,
      tradeKm: editForm.tradeKm || undefined,
      paymentMethod: editForm.paymentMethod || undefined,
      downPayment: editForm.downPayment || undefined,
      notes: editForm.notes || undefined,
      status: editForm.status as any,
      funnelStatus: editForm.funnelStatus as any,
    });
  }

  const statusTabs = [
    { value: "all", label: "Todos", count: leadsRaw?.length || 0 },
      ...STATUS_OPTIONS.map((s) => ({
      value: s.value,
      label: s.label,
      count: (leadsRaw as unknown as LeadWithDetails[] | undefined)?.filter((l) => l.status === s.value).length || 0,
    })),
  ];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto overflow-y-auto h-full pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-yellow-400" />
            Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {leads.length} lead{leads.length !== 1 ? "s" : ""} encontrado{leads.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone, veículo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 flex-wrap">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              statusFilter === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {tab.label}
            <span className={`text-[10px] ${statusFilter === tab.value ? "opacity-80" : "opacity-50"}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Leads List */}
      {leads.length === 0 ? (
        <div className="text-center py-16">
          <Target className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-muted-foreground">Nenhum lead encontrado</p>
          <p className="text-xs text-muted-foreground mt-1">Os leads são criados automaticamente pela IA durante o atendimento.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => {
            const isExpanded = expandedLeadId === lead.id;
            const cfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
            const displayName = lead.name || lead.conversation?.contactName || "Sem nome";
            const displayPhone = formatPhone(lead.phone);
            const channel = CHANNEL_ICONS[lead.conversation?.channel || "whatsapp"];

            return (
              <Card
                key={lead.id}
                className={`bg-card border-border transition-all ${isExpanded ? "ring-1 ring-primary/30" : "hover:border-primary/20"}`}
              >
                {/* Lead Row (always visible) */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer select-none"
                  onClick={() => setExpandedLeadId(isExpanded ? null : lead.id)}
                >
                  {/* Avatar / Channel */}
                  <div className="relative flex-shrink-0">
                    {lead.conversation?.contactPhoto ? (
                      <img
                        src={lead.conversation.contactPhoto}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 text-xs" title={lead.conversation?.channel}>
                      {channel?.icon}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-card-foreground truncate">{displayName}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </Badge>
                      {(lead as any).temperature && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                          (lead as any).temperature === "frio" ? "border-blue-500/30 bg-blue-500/10 text-blue-400" :
                          (lead as any).temperature === "morno" ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" :
                          (lead as any).temperature === "quente" ? "border-orange-500/30 bg-orange-500/10 text-orange-400" :
                          "border-red-500/30 bg-red-500/10 text-red-400"
                        }`}>
                          <Thermometer className="h-2.5 w-2.5 mr-0.5" />
                          {(lead as any).temperature === "frio" ? "❄️ Frio" :
                           (lead as any).temperature === "morno" ? "🌤️ Morno" :
                           (lead as any).temperature === "quente" ? "🔥 Quente" :
                           "🔥🔥 Muito Quente"}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {displayPhone}
                      </span>
                      {lead.city && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {lead.city}
                        </span>
                      )}
                      {lead.vehicleInterest && (
                        <span className="flex items-center gap-1 hidden sm:flex">
                          <Car className="h-3 w-3" />
                          {lead.vehicleInterest}
                        </span>
                      )}
                    </div>
                    {/* Summary preview (3 lines max) */}
                    {lead.summaryPreview && (
                      <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
                        {lead.summaryPreview}
                      </p>
                    )}
                  </div>

                  {/* Right side */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {lead.assignedAgent && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 hidden sm:flex">
                            <UserCheck className="h-3 w-3 mr-1" />
                            {lead.assignedAgent.name.split(" ")[0]}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{lead.assignedAgent.name} ({lead.assignedAgent.cargo})</TooltipContent>
                      </Tooltip>
                    )}
                    {lead.conversation?.lastMessageAt && (
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(lead.conversation.lastMessageAt)}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded Panel */}
                {isExpanded && (
                  <CardContent className="pt-0 pb-4 px-4 border-t border-border">
                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2 mt-3 mb-4">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={(e) => { e.stopPropagation(); setLocation(`/inbox?conv=${lead.conversationId}`); }}
                      >
                        <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                        Ir para conversa
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={(e) => { e.stopPropagation(); copyLeadInfo(lead); }}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Copiar lead
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={(e) => { e.stopPropagation(); copySummary(lead); }}
                      >
                        <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
                        Copiar resumo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={(e) => { e.stopPropagation(); openEditDialog(lead); }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={(e) => { e.stopPropagation(); generateSummary.mutate({ conversationId: lead.conversationId }); }}
                        disabled={generateSummary.isPending}
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                        {generateSummary.isPending ? "Gerando..." : "Gerar resumo IA"}
                      </Button>
                    </div>

                    {/* Lead Details Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left: Lead Info */}
                      <div className="space-y-3">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dados do Lead</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-card-foreground">{displayPhone}</span>
                          </div>
                          {lead.city && (
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-card-foreground">{lead.city}</span>
                            </div>
                          )}
                          {lead.intention && (
                            <div className="flex items-center gap-2">
                              <Target className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-card-foreground capitalize">{lead.intention}</span>
                            </div>
                          )}
                          {lead.vehicleInterest && (
                            <div className="flex items-center gap-2">
                              <Car className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-card-foreground">{lead.vehicleInterest}</span>
                            </div>
                          )}
                          {lead.hasTrade && lead.tradeVehicle && (
                            <div className="flex items-center gap-2">
                              <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-card-foreground">
                                Troca: {lead.tradeVehicle} {lead.tradeYear || ""} {lead.tradeKm ? `(${lead.tradeKm} km)` : ""}
                              </span>
                            </div>
                          )}
                          {lead.paymentMethod && (
                            <div className="flex items-center gap-2">
                              <CreditCard className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-card-foreground">
                                {lead.paymentMethod}{lead.downPayment ? ` - Entrada: ${lead.downPayment}` : ""}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Linked Vehicle */}
                        {lead.linkedVehicle && (
                          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Car className="h-3.5 w-3.5 text-primary" />
                              <span className="text-[10px] text-primary uppercase tracking-wider font-semibold">Veículo Vinculado</span>
                            </div>
                            <p className="text-sm text-card-foreground font-medium">
                              {lead.linkedVehicle.brand} {lead.linkedVehicle.model}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <span>{lead.linkedVehicle.year}</span>
                              {lead.linkedVehicle.color && <><span>·</span><span>{lead.linkedVehicle.color}</span></>}
                              <span>·</span>
                              <span className="text-primary font-semibold">
                                R$ {lead.linkedVehicle.price?.toLocaleString("pt-BR")}
                              </span>
                            </div>
                            {lead.linkedVehicle.url && (
                              <a
                                href={lead.linkedVehicle.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-primary hover:underline mt-1.5"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Ver anúncio
                              </a>
                            )}
                          </div>
                        )}

                        {/* Notes */}
                        {lead.notes && (
                          <div className="p-3 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Notas</span>
                            </div>
                            <p className="text-xs text-card-foreground leading-relaxed whitespace-pre-wrap">{lead.notes}</p>
                          </div>
                        )}
                      </div>

                      {/* Right: Daily Summaries */}
                      <div className="space-y-3">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          Resumo da Conversa por Dia
                        </h3>
                        {lead.summaries && lead.summaries.length > 0 ? (
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {lead.summaries.map((s) => (
                              <div key={s.id} className="p-3 rounded-lg bg-muted/30 border border-border">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs font-semibold text-card-foreground">{formatDate(s.date)}</span>
                                  <span className="text-[10px] text-muted-foreground">{s.messageCount} msgs</span>
                                </div>
                                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{s.summary}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-6 text-muted-foreground/50">
                            <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                            <p className="text-xs">Nenhum resumo disponível</p>
                            <p className="text-[10px] mt-1">Clique em "Gerar resumo IA" para criar</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingLead} onOpenChange={(open) => !open && setEditingLead(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Editar Lead
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome</label>
                <Input
                  value={editForm.name || ""}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Nome do cliente"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Cidade</label>
                <Input
                  value={editForm.city || ""}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                  placeholder="Cidade"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Etapa do Funil</label>
                <Select value={editForm.funnelStatus || "novo"} onValueChange={(v) => setEditForm({ ...editForm, funnelStatus: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="novo">❄️ Novo</SelectItem>
                    <SelectItem value="interesse_definido">🌤️ Interesse Definido</SelectItem>
                    <SelectItem value="pagamento_definido">💳 Pagamento Definido</SelectItem>
                    <SelectItem value="dados_pessoais">📝 Dados Pessoais</SelectItem>
                    <SelectItem value="dados_troca">🚗 Dados de Troca</SelectItem>
                    <SelectItem value="encaminhado_vendedor">👤 Encaminhado ao Vendedor</SelectItem>
                    <SelectItem value="negociando">🤝 Negociando</SelectItem>
                    <SelectItem value="fechado">✅ Fechado</SelectItem>
                    <SelectItem value="perdido">❌ Perdido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Intenção</label>
              <Input
                value={editForm.intention || ""}
                onChange={(e) => setEditForm({ ...editForm, intention: e.target.value })}
                placeholder="Ex: compra, pesquisa, troca"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Veículo de Interesse</label>
              <Input
                value={editForm.vehicleInterest || ""}
                onChange={(e) => setEditForm({ ...editForm, vehicleInterest: e.target.value })}
                placeholder="Ex: Hilux 2020"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Forma de Pagamento</label>
                <Input
                  value={editForm.paymentMethod || ""}
                  onChange={(e) => setEditForm({ ...editForm, paymentMethod: e.target.value })}
                  placeholder="Ex: Financiamento"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Entrada</label>
                <Input
                  value={editForm.downPayment || ""}
                  onChange={(e) => setEditForm({ ...editForm, downPayment: e.target.value })}
                  placeholder="Ex: R$ 20.000"
                />
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                <ArrowLeftRight className="h-3 w-3" />
                Veículo de Troca
              </label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                <Input
                  value={editForm.tradeVehicle || ""}
                  onChange={(e) => setEditForm({ ...editForm, tradeVehicle: e.target.value, hasTrade: !!e.target.value })}
                  placeholder="Modelo"
                />
                <Input
                  value={editForm.tradeYear || ""}
                  onChange={(e) => setEditForm({ ...editForm, tradeYear: e.target.value })}
                  placeholder="Ano"
                />
                <Input
                  value={editForm.tradeKm || ""}
                  onChange={(e) => setEditForm({ ...editForm, tradeKm: e.target.value })}
                  placeholder="KM"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notas</label>
              <Textarea
                value={editForm.notes || ""}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder="Observações sobre o lead..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLead(null)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={updateLead.isPending}>
              {updateLead.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
