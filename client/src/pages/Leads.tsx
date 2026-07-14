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
  Thermometer, LifeBuoy, ShieldAlert, Store, Clock, Filter,
  Brain, Loader2, TrendingUp, AlertCircle, CheckCircle2, ArrowRight,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────
function formatPhone(phone: string): string {
  if (!phone) return "";
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("55") && p.length > 11) p = p.substring(2);
  return p;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
  fullName: string | null;
  email: string | null;
  cpf: string | null;
  birthDate: string | null;
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
  fullSummary: string;
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
  sellerAssignment: {
    sellerName: string;
    sellerPhone: string;
    storeLocation: string;
    status: string;
    assignedAt: number | null;
    contactedAt: number | null;
  } | null;
  rescueInfo: {
    totalAttempts: number;
    lastAttemptAt: number | null;
    responded: boolean;
    attempts: Array<{
      attemptNumber: number;
      status: string;
      sentAt: number | null;
      respondedAt: number | null;
    }>;
  } | null;
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

const FUNNEL_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  novo: { label: "Novo", icon: "🆕", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
  interesse_definido: { label: "Interesse Definido", icon: "🎯", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
  pagamento_definido: { label: "Pagamento Definido", icon: "💳", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
  dados_pessoais: { label: "Dados Pessoais", icon: "📝", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
  dados_troca: { label: "Dados de Troca", icon: "🚗", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
  encaminhado_vendedor: { label: "Encaminhado", icon: "👤", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
  negociando: { label: "Negociando", icon: "🤝", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
  fechado: { label: "Fechado", icon: "✅", color: "text-green-400", bg: "bg-green-500/10 border-green-500/30" },
  perdido: { label: "Perdido", icon: "❌", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
};

const TEMP_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  frio: { label: "Frio", icon: "❄️", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
  morno: { label: "Morno", icon: "🌤️", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
  quente: { label: "Quente", icon: "🔥", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
  muito_quente: { label: "Muito Quente", icon: "🔥🔥", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
};

const CHANNEL_ICONS: Record<string, { icon: string; color: string }> = {
  whatsapp: { icon: "🟢", color: "text-green-400" },
  instagram: { icon: "📸", color: "text-pink-400" },
  facebook: { icon: "🔵", color: "text-blue-400" },
  web: { icon: "🌐", color: "text-muted-foreground" },
  webhook: { icon: "🔗", color: "text-muted-foreground" },
};

const FUNNEL_OPTIONS = Object.entries(FUNNEL_CONFIG).map(([value, cfg]) => ({ value, label: `${cfg.icon} ${cfg.label}` }));
const TEMP_OPTIONS = Object.entries(TEMP_CONFIG).map(([value, cfg]) => ({ value, label: `${cfg.icon} ${cfg.label}` }));

// ─── Main Component ───────────────────────────────────────────────
export default function Leads() {
  const [view, setView] = useState<"leads" | "intel">("leads");
  const [statusFilter, setStatusFilter] = useState("all");
  const [funnelFilter, setFunnelFilter] = useState("all");
  const [tempFilter, setTempFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLeadId, setExpandedLeadId] = useState<number | null>(null);
  const [editingLead, setEditingLead] = useState<LeadWithDetails | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [summaryTab, setSummaryTab] = useState<"full" | "daily">("full");
  const [showFilters, setShowFilters] = useState(false);
  const [, setLocation] = useLocation();

  const { data: leadsRaw, refetch } = trpc.lead.listWithDetails.useQuery(
    { status: statusFilter },
    { refetchInterval: 10000 }
  );

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => {
      toast.success("Lead atualizado com sucesso");
      refetch();
      setEditingLead(null);
    },
    onError: (err: any) => toast.error(`Erro ao atualizar: ${err.message}`),
  });

  const generateSummary = trpc.lead.generateSummary.useMutation({
    onSuccess: (data: any) => {
      if (data) {
        toast.success("Resumo gerado com sucesso");
        refetch();
      } else {
        toast.info("Nenhuma mensagem hoje para resumir");
      }
    },
    onError: (err: any) => toast.error(`Erro ao gerar resumo: ${err.message}`),
  });

  const leads = useMemo(() => {
    if (!leadsRaw) return [];
    let filtered = leadsRaw as unknown as LeadWithDetails[];

    // Funnel filter
    if (funnelFilter !== "all") {
      filtered = filtered.filter((l) => l.funnelStatus === funnelFilter);
    }

    // Temperature filter
    if (tempFilter !== "all") {
      filtered = filtered.filter((l) => l.temperature === tempFilter);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((l) => {
        const name = (l.name || l.conversation?.contactName || "").toLowerCase();
        const phone = formatPhone(l.phone);
        const vehicle = (l.vehicleInterest || "").toLowerCase();
        const city = (l.city || "").toLowerCase();
        return name.includes(q) || phone.includes(q) || vehicle.includes(q) || city.includes(q);
      });
    }

    return filtered;
  }, [leadsRaw, searchQuery, funnelFilter, tempFilter]);

  // ─── Copy functions ──────────────────────────────────────────
  function copyLeadInfo(lead: LeadWithDetails) {
    const parts: string[] = [];
    
    // ─── Dados Pessoais ──────────────────────────────────────
    parts.push("═══ DADOS DO LEAD ═══");
    parts.push(`Nome: ${lead.fullName || lead.name || lead.conversation?.contactName || "N/A"}`);
    parts.push(`Telefone: ${formatPhone(lead.phone)}`);
    if (lead.email) parts.push(`Email: ${lead.email}`);
    if (lead.cpf) parts.push(`CPF: ${lead.cpf}`);
    if (lead.birthDate) parts.push(`Nascimento: ${lead.birthDate}`);
    if (lead.city) parts.push(`Cidade: ${lead.city}`);
    
    // ─── Status ──────────────────────────────────────────────
    parts.push("");
    parts.push("═══ STATUS ═══");
    parts.push(`Status: ${STATUS_CONFIG[lead.status]?.label || lead.status}`);
    if (lead.funnelStatus) parts.push(`Etapa Funil: ${FUNNEL_CONFIG[lead.funnelStatus]?.label || lead.funnelStatus}`);
    if (lead.temperature) parts.push(`Temperatura: ${TEMP_CONFIG[lead.temperature]?.label || lead.temperature}`);
    
    // ─── Veículo de Interesse ────────────────────────────────
    if (lead.vehicleInterest || lead.linkedVehicle) {
      parts.push("");
      parts.push("═══ VEÍCULO DE INTERESSE ═══");
      if (lead.vehicleInterest) parts.push(`Veículo: ${lead.vehicleInterest}`);
      if (lead.linkedVehicle) {
        parts.push(`Vinculado: ${lead.linkedVehicle.brand} ${lead.linkedVehicle.model} ${lead.linkedVehicle.year}`);
        if (lead.linkedVehicle.price) parts.push(`Valor: R$ ${lead.linkedVehicle.price.toLocaleString("pt-BR")}`);
      }
    }
    
    // ─── Dados da Troca ──────────────────────────────────────
    if (lead.hasTrade) {
      parts.push("");
      parts.push("═══ VEÍCULO DE TROCA ═══");
      if (lead.tradeVehicle) parts.push(`Veículo: ${lead.tradeVehicle}`);
      if (lead.tradeYear) parts.push(`Ano: ${lead.tradeYear}`);
      if (lead.tradeKm) parts.push(`KM: ${lead.tradeKm}`);
    }
    
    // ─── Pagamento ───────────────────────────────────────────
    if (lead.paymentMethod) {
      parts.push("");
      parts.push("═══ PAGAMENTO ═══");
      parts.push(`Forma: ${lead.paymentMethod}`);
      if (lead.downPayment) parts.push(`Entrada: ${lead.downPayment}`);
    }
    
    // ─── Vendedor ────────────────────────────────────────────
    if (lead.sellerAssignment) {
      parts.push("");
      parts.push("═══ VENDEDOR ═══");
      parts.push(`Nome: ${lead.sellerAssignment.sellerName}`);
      if (lead.sellerAssignment.storeLocation) parts.push(`Loja: ${lead.sellerAssignment.storeLocation}`);
      if (lead.sellerAssignment.assignedAt) parts.push(`Atribuído em: ${new Date(lead.sellerAssignment.assignedAt).toLocaleString("pt-BR")}`);
    }
    
    // ─── Resgate ─────────────────────────────────────────────
    if (lead.rescueInfo && lead.rescueInfo.totalAttempts > 0) {
      parts.push("");
      parts.push(`Resgate: ${lead.rescueInfo.totalAttempts} tentativa(s)`);
    }
    
    // ─── Notas ───────────────────────────────────────────────
    if (lead.notes) {
      parts.push("");
      parts.push("═══ NOTAS ═══");
      parts.push(lead.notes);
    }
    
    navigator.clipboard.writeText(parts.join("\n"));
    toast.success("Lead copiado para a área de transferência");
  }

  function copySummary(lead: LeadWithDetails) {
    const text = lead.fullSummary || lead.summaryPreview;
    if (!text) {
      toast.info("Nenhum resumo disponível");
      return;
    }
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
      funnelStatus: lead.funnelStatus || "novo",
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

  const hasActiveFilters = funnelFilter !== "all" || tempFilter !== "all";

  if (view === "intel") {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto overflow-y-auto h-full pb-16">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setView("leads")} className="px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent">Leads</button>
          <button className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground">🧠 Inteligência</button>
        </div>
        <IntelligencePanel />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto overflow-y-auto h-full pb-16">
      {/* Alterna Leads / Inteligência */}
      <div className="flex items-center gap-2">
        <button className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground">Leads</button>
        <button onClick={() => setView("intel")} className="px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent">🧠 Inteligência</button>
      </div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-yellow-400" />
            Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {leads.length} lead{leads.length !== 1 ? "s" : ""} encontrado{leads.length !== 1 ? "s" : ""}
            {hasActiveFilters && <span className="text-primary ml-1">(filtrado)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar nome, telefone, veículo..."
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
          <Button
            variant={hasActiveFilters ? "default" : "outline"}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filtros
            {hasActiveFilters && <span className="text-[10px] bg-white/20 rounded-full px-1.5">!</span>}
          </Button>
        </div>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="min-w-[180px]">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Etapa do Funil</label>
                <Select value={funnelFilter} onValueChange={setFunnelFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as etapas</SelectItem>
                    {FUNNEL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[160px]">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Temperatura</label>
                <Select value={tempFilter} onValueChange={setTempFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {TEMP_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={() => { setFunnelFilter("all"); setTempFilter("all"); }}
                >
                  <X className="h-3 w-3 mr-1" />
                  Limpar filtros
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
            const funnel = FUNNEL_CONFIG[lead.funnelStatus || "novo"];
            const temp = TEMP_CONFIG[lead.temperature || "frio"];

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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm text-card-foreground truncate">{displayName}</span>
                      {/* Funnel Stage Badge */}
                      {funnel && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${funnel.bg} ${funnel.color}`}>
                          {funnel.icon} {funnel.label}
                        </Badge>
                      )}
                      {/* Temperature Badge */}
                      {temp && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${temp.bg} ${temp.color}`}>
                          <Thermometer className="h-2.5 w-2.5 mr-0.5" />
                          {temp.icon} {temp.label}
                        </Badge>
                      )}
                      {/* Rescue indicator */}
                      {lead.rescueInfo && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 bg-amber-500/10 text-amber-400">
                              <LifeBuoy className="h-2.5 w-2.5 mr-0.5" />
                              Resgate {lead.rescueInfo.totalAttempts}x
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {lead.rescueInfo.totalAttempts} tentativa(s) de resgate
                            {lead.rescueInfo.responded ? " - Respondeu" : " - Sem resposta"}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {/* Seller assignment indicator */}
                      {lead.sellerAssignment && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/30 bg-violet-500/10 text-violet-400 hidden sm:flex">
                              <Store className="h-2.5 w-2.5 mr-0.5" />
                              {lead.sellerAssignment.sellerName.split(" ")[0]}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            Vendedor: {lead.sellerAssignment.sellerName}
                            <br />
                            Loja: {lead.sellerAssignment.storeLocation}
                            {lead.sellerAssignment.assignedAt && (
                              <><br />Atribuído: {formatTimestamp(lead.sellerAssignment.assignedAt)}</>
                            )}
                          </TooltipContent>
                        </Tooltip>
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
                    {/* Summary preview */}
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
                        variant="default"
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

                        {/* Seller Assignment */}
                        {lead.sellerAssignment && (
                          <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Store className="h-3.5 w-3.5 text-violet-400" />
                              <span className="text-[10px] text-violet-400 uppercase tracking-wider font-semibold">Vendedor Atribuído</span>
                            </div>
                            <p className="text-sm text-card-foreground font-medium">{lead.sellerAssignment.sellerName}</p>
                            <div className="flex flex-col gap-1 mt-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {lead.sellerAssignment.sellerPhone}
                              </span>
                              <span className="flex items-center gap-1">
                                <Store className="h-3 w-3" />
                                {lead.sellerAssignment.storeLocation}
                              </span>
                              {lead.sellerAssignment.assignedAt && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Atribuído em: {formatTimestamp(lead.sellerAssignment.assignedAt)}
                                </span>
                              )}
                              {lead.sellerAssignment.contactedAt && (
                                <span className="flex items-center gap-1 text-green-400">
                                  <UserCheck className="h-3 w-3" />
                                  Contatado em: {formatTimestamp(lead.sellerAssignment.contactedAt)}
                                </span>
                              )}
                              <Badge variant="outline" className={`text-[10px] w-fit mt-0.5 ${
                                lead.sellerAssignment.status === "completed" ? "border-green-500/30 text-green-400" :
                                lead.sellerAssignment.status === "contacted" ? "border-blue-500/30 text-blue-400" :
                                lead.sellerAssignment.status === "expired" ? "border-red-500/30 text-red-400" :
                                "border-yellow-500/30 text-yellow-400"
                              }`}>
                                {lead.sellerAssignment.status === "completed" ? "Concluído" :
                                 lead.sellerAssignment.status === "contacted" ? "Contatado" :
                                 lead.sellerAssignment.status === "expired" ? "Expirado" : "Pendente"}
                              </Badge>
                            </div>
                          </div>
                        )}

                        {/* Rescue Info */}
                        {lead.rescueInfo && (
                          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <LifeBuoy className="h-3.5 w-3.5 text-amber-400" />
                              <span className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold">Resgate de Lead</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-card-foreground font-medium">
                                {lead.rescueInfo.totalAttempts} tentativa{lead.rescueInfo.totalAttempts !== 1 ? "s" : ""}
                              </span>
                              <Badge variant="outline" className={`text-[10px] ${
                                lead.rescueInfo.responded
                                  ? "border-green-500/30 text-green-400"
                                  : "border-amber-500/30 text-amber-400"
                              }`}>
                                {lead.rescueInfo.responded ? "Respondeu" : "Sem resposta"}
                              </Badge>
                            </div>
                            <div className="mt-2 space-y-1">
                              {lead.rescueInfo.attempts.map((a, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="font-mono text-[10px] bg-muted px-1 rounded">#{a.attemptNumber}</span>
                                  <Clock className="h-3 w-3" />
                                  <span>{a.sentAt ? formatTimestamp(a.sentAt) : "—"}</span>
                                  {a.respondedAt && (
                                    <span className="text-green-400 flex items-center gap-1">
                                      <ShieldAlert className="h-3 w-3" />
                                      Resp: {formatTimestamp(a.respondedAt)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
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

                      {/* Right: Summaries */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            Resumo da Conversa
                          </h3>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setSummaryTab("full")}
                              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                summaryTab === "full"
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
                              }`}
                            >
                              Completo
                            </button>
                            <button
                              onClick={() => setSummaryTab("daily")}
                              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                summaryTab === "daily"
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
                              }`}
                            >
                              Por Dia
                            </button>
                          </div>
                        </div>

                        {summaryTab === "full" ? (
                          /* Full Summary */
                          lead.fullSummary ? (
                            <div className="p-3 rounded-lg bg-muted/30 border border-border max-h-80 overflow-y-auto">
                              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{lead.fullSummary}</p>
                            </div>
                          ) : (
                            <div className="text-center py-6 text-muted-foreground/50">
                              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                              <p className="text-xs">Nenhum resumo disponível</p>
                              <p className="text-[10px] mt-1">Clique em "Gerar resumo IA" para criar</p>
                            </div>
                          )
                        ) : (
                          /* Daily Summaries */
                          lead.summaries && lead.summaries.length > 0 ? (
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
                          )
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
                    {FUNNEL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
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

// ─── Barra de Auto-qualificação por IA ───────────────────────────────────────
function AutoQualifyBar() {
  const { data, refetch } = trpc.settings.getAutoQualify.useQuery();
  const save = trpc.settings.saveAutoQualify.useMutation({
    onSuccess: () => { refetch(); },
  });
  if (!data) return null;
  const stages: Record<string, string> = {
    interesse_definido: "Interesse", pagamento_definido: "Pagamento", dados_pessoais: "Dados pessoais",
    dados_troca: "Troca", encaminhado_vendedor: "Encaminhado", negociando: "Negociando",
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={data.enabled}
          onChange={(e) => save.mutate({ enabled: e.target.checked, maxStage: data.maxStage as any })} />
        <span className="font-medium">Auto-qualificar leads com IA</span>
      </label>
      <span className="text-muted-foreground text-xs">A IA lê as conversas (recepção + vendedor) e avança o funil sozinha — a venda continua manual.</span>
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs text-muted-foreground">Avançar até:</span>
        <Select value={data.maxStage} onValueChange={(v) => save.mutate({ enabled: data.enabled, maxStage: v as any })}>
          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(stages).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Painel de Inteligência Comercial ────────────────────────────────────────

const TEMP_STYLE: Record<string, { label: string; bar: string; badge: string }> = {
  muito_quente: { label: "🔥🔥 Muito quente", bar: "bg-red-500", badge: "bg-red-500/15 text-red-600 border-red-500/30" },
  quente:       { label: "🔥 Quente",         bar: "bg-orange-500", badge: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
  morno:        { label: "🌤 Morno",          bar: "bg-yellow-500", badge: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30" },
  frio:         { label: "🧊 Frio",           bar: "bg-sky-500", badge: "bg-sky-500/15 text-sky-600 border-sky-500/30" },
};

function IntelligencePanel() {
  const [, setLocation] = useLocation();
  const [source, setSource] = useState("matriz");
  const [sinceDays, setSinceDays] = useState(7);
  const utils = trpc.useUtils();

  const { data: instances } = trpc.evolution.listInstances.useQuery();
  const { data: rows, isLoading } = trpc.lead.intelligence.useQuery(
    { source, sinceDays },
    { refetchInterval: 20000 }
  );
  const analyzeBulk = trpc.lead.analyzeBulk.useMutation({
    onSuccess: (r) => { toast.success(`${r.analyzed} conversa(s) analisada(s)`); utils.lead.intelligence.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const list = (rows as any[]) || [];
  const hot = list.filter(l => l.temperature === "quente" || l.temperature === "muito_quente").length;
  const avgScore = list.length ? Math.round(list.reduce((s, l) => s + (l.score || 0), 0) / list.length) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="h-6 w-6 text-violet-500" /> Inteligência Comercial
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">A IA lê as conversas (incluindo áudios) e classifica a temperatura de cada lead.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase block mb-1">Origem</label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="matriz">Matriz (oficial)</SelectItem>
                {(instances || []).map((i: any) => <SelectItem key={i.id} value={i.instanceName}>{i.displayName || i.instanceName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase block mb-1">Período</label>
            <Select value={String(sinceDays)} onValueChange={v => setSinceDays(Number(v))}>
              <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Hoje</SelectItem>
                <SelectItem value="7">7 dias</SelectItem>
                <SelectItem value="15">15 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => analyzeBulk.mutate({ source, sinceDays })} disabled={analyzeBulk.isPending} className="h-9 gap-1.5">
            {analyzeBulk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            Analisar {source === "matriz" ? "Matriz" : "instância"}
          </Button>
        </div>
      </div>

      <AutoQualifyBar />

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold">{list.length}</div><div className="text-xs text-muted-foreground">Leads analisados</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-orange-500">{hot}</div><div className="text-xs text-muted-foreground">Quentes / Muito quentes</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-violet-500">{avgScore}</div><div className="text-xs text-muted-foreground">Score médio</div></CardContent></Card>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Carregando...</div>
      ) : list.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma conversa analisada nesta origem/período.<br />
          Clique em <b>"Analisar"</b> acima para a IA processar as conversas recentes.
        </CardContent></Card>
      ) : (
        <div className="space-y-2.5">
          {list.map((l) => {
            const t = TEMP_STYLE[l.temperature] || TEMP_STYLE.frio;
            return (
              <Card key={l.conversationId} className="overflow-hidden">
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    {/* Score ring */}
                    <div className="shrink-0 flex flex-col items-center">
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-sm ${t.bar}`}>
                        {l.score}
                      </div>
                      <span className="text-[9px] text-muted-foreground mt-0.5">score</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{l.contactName || l.phone}</span>
                        <Badge variant="outline" className={`text-[10px] ${t.badge}`}>{t.label}</Badge>
                        {l.vehicleInterest && l.vehicleInterest !== "não definido" && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Car className="h-3 w-3" />{l.vehicleInterest}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">📱 {l.instanceName || "Matriz"}</span>
                      </div>
                      {l.summary && <p className="text-sm text-muted-foreground mt-1">{l.summary}</p>}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                        {(l.buyingSignals || []).length > 0 && (
                          <div className="flex items-start gap-1.5 text-green-600">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span><b>Sinais:</b> {(l.buyingSignals || []).join("; ")}</span>
                          </div>
                        )}
                        {(l.objections || []).length > 0 && (
                          <div className="flex items-start gap-1.5 text-red-500">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span><b>Objeções:</b> {(l.objections || []).join("; ")}</span>
                          </div>
                        )}
                        {l.creditStatus && l.creditStatus !== "não mencionado" && (
                          <div className="flex items-start gap-1.5 text-blue-600">
                            <CreditCard className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span><b>Crédito:</b> {l.creditStatus}</span>
                          </div>
                        )}
                        {l.nextAction && (
                          <div className="flex items-start gap-1.5 text-violet-600">
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span><b>Próxima ação:</b> {l.nextAction}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0" onClick={() => setLocation(`/inbox?conv=${l.conversationId}`)}>
                      <MessageSquare className="h-3.5 w-3.5 mr-1" /> Abrir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
