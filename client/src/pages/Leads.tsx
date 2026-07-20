import { trpc } from "@/lib/trpc";
import { useState, useMemo, useEffect } from "react";
import { keepPreviousData } from "@tanstack/react-query";
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
  const [view, setView] = useState<"leads" | "intel" | "kanban">("leads");
  const [statusFilter, setStatusFilter] = useState("all");
  const [funnelFilter, setFunnelFilter] = useState("all");
  const [tempFilter, setTempFilter] = useState("all");
  const [instanceFilter, setInstanceFilter] = useState("all");
  const [attendantFilter, setAttendantFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [creditFilter, setCreditFilter] = useState("all");
  // Filtros por coluna (estilo Excel)
  const [colName, setColName] = useState("");
  const [colPhone, setColPhone] = useState("");
  const [colVehicle, setColVehicle] = useState("");
  const [sortField, setSortField] = useState<"entrada" | "lastmsg" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (f: "entrada" | "lastmsg") => {
    if (sortField === f) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(f); setSortDir("desc"); }
  };

  // Opções de filtro: instâncias (todas as fontes) e atendentes
  const { data: evoInstances } = trpc.evolution.listInstances.useQuery();
  const { data: zernioInst } = trpc.zernio.listInstances.useQuery();
  const { data: officialInst } = trpc.whatsappNumber.listInstances.useQuery();
  const { data: teamList } = trpc.team.list.useQuery();
  const instanceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "matriz", label: "Matriz (oficial)" }];
    (evoInstances || []).forEach((i: any) => opts.push({ value: i.instanceName, label: i.displayName || i.instanceName }));
    (zernioInst || []).forEach((i: any) => opts.push({ value: i.instanceName, label: `Zernio: ${i.displayName || i.phone}` }));
    (officialInst || []).forEach((i: any) => opts.push({ value: i.instanceName, label: `Oficial: ${i.displayName || i.phone}` }));
    return opts;
  }, [evoInstances, zernioInst, officialInst]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLeadId, setExpandedLeadId] = useState<number | null>(null);
  const [editingLead, setEditingLead] = useState<LeadWithDetails | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [summaryTab, setSummaryTab] = useState<"full" | "daily">("full");
  const [showFilters, setShowFilters] = useState(false);
  const [, setLocation] = useLocation();

  const [answeredFilter, setAnsweredFilter] = useState("all"); // all | unanswered | answered
  const [pendingOpenLead, setPendingOpenLead] = useState<{ id?: number; phone?: string } | null>(() => {
    // Vindo do inbox: /leads?lead=123 ou /leads?phone=5551...
    const p = new URLSearchParams(window.location.search);
    const id = p.get("lead"); const phone = p.get("phone");
    return id ? { id: parseInt(id) } : phone ? { phone } : null;
  });
  const [scope, setScope] = useState<"leads" | "notlead">("leads");
  const { data: leadsRaw, refetch } = trpc.lead.listWithDetails.useQuery(
    { status: statusFilter, discarded: scope === "notlead" },
    { refetchInterval: 10000, placeholderData: keepPreviousData }
  );

  // Abre automaticamente o lead vindo do inbox (?lead= ou ?phone=)
  useEffect(() => {
    if (!pendingOpenLead || !leadsRaw) return;
    const list = leadsRaw as any[];
    const alvo = pendingOpenLead.id
      ? list.find((l) => l.id === pendingOpenLead.id)
      : list.find((l) => (l.phone || "").replace(/\D/g, "").endsWith((pendingOpenLead.phone || "").replace(/\D/g, "").slice(-10)));
    if (alvo) {
      setExpandedLeadId(alvo.id);
      setPendingOpenLead(null);
      setTimeout(() => {
        document.getElementById(`lead-${alvo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }, [pendingOpenLead, leadsRaw]);

  const setIsLead = trpc.lead.setIsLead.useMutation({
    onSuccess: () => { toast.success("Voltou a ser lead"); refetch(); },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });

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

  const setNotLead = trpc.lead.setNotLead.useMutation({
    onSuccess: () => { toast.success("Marcado — removido do funil"); refetch(); },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
  const handleNotLead = (lead: any) => {
    const reason = window.prompt("Este contato não é um lead. Marcar como? (ex: fornecedor, colega, revenda, outro)", "fornecedor");
    if (reason && reason.trim()) setNotLead.mutate({ leadId: lead.id, reason: reason.trim().slice(0, 40) });
  };

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

    // Instância (fonte da conversa)
    if (instanceFilter !== "all") {
      filtered = filtered.filter((l) => ((l.conversation as any)?.source || "matriz") === instanceFilter);
    }

    // Atendente/vendedor (dono do lead)
    if (attendantFilter !== "all") {
      const aid = attendantFilter === "none" ? null : parseInt(attendantFilter);
      filtered = filtered.filter((l) => ((l as any).ownerId ?? null) === aid);
    }

    // Crédito
    if (creditFilter !== "all") {
      filtered = filtered.filter((l) => {
        const c = (l as any).creditApproved;
        if (creditFilter === "sim") return c === "sim";
        if (creditFilter === "nao") return c === "nao";
        return !c; // "naoavaliado"
      });
    }

    // Data de entrada
    if (dateFilter !== "all") {
      const days = dateFilter === "today" ? 1 : parseInt(dateFilter);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((l) => {
        const t = (l as any).createdAt ? new Date((l as any).createdAt).getTime() : 0;
        return t >= cutoff;
      });
    }

    // Filtros por coluna (Excel)
    if (colName.trim()) {
      const q = colName.toLowerCase();
      filtered = filtered.filter((l) => (l.name || l.conversation?.contactName || "").toLowerCase().includes(q));
    }
    if (colPhone.trim()) {
      const q = colPhone.replace(/\D/g, "");
      filtered = filtered.filter((l) => (l.phone || "").replace(/\D/g, "").includes(q));
    }
    if (colVehicle.trim()) {
      const q = colVehicle.toLowerCase();
      filtered = filtered.filter((l) => {
        const lv = (l as any).linkedVehicle;
        const s = `${l.vehicleInterest || ""} ${lv ? `${lv.brand} ${lv.model}` : ""}`.toLowerCase();
        return s.includes(q);
      });
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

    // Não respondidos / respondidos
    if (answeredFilter !== "all") {
      filtered = filtered.filter((l) =>
        answeredFilter === "unanswered" ? !!(l as any).unanswered : !(l as any).unanswered
      );
    }

    // Ordenação por coluna (clique no título)
    if (sortField) {
      const val = (l: any) => sortField === "entrada"
        ? (l.createdAt ? new Date(l.createdAt).getTime() : 0)
        : (l.conversation?.lastMessageAt || 0);
      filtered = [...filtered].sort((a, b) => sortDir === "asc" ? val(a) - val(b) : val(b) - val(a));
    } else {
      // PADRÃO: não respondidos primeiro, do que espera há MAIS tempo para o menor.
      // (fechado/perdido já não entram como "não respondido" — vem do servidor)
      filtered = [...filtered].sort((a: any, b: any) => {
        const aw = a.unanswered ? Number(a.waitingSince || 0) : 0;
        const bw = b.unanswered ? Number(b.waitingSince || 0) : 0;
        if (aw && bw) return aw - bw;          // mais antigo (espera maior) primeiro
        if (aw) return -1;
        if (bw) return 1;
        return (b.conversation?.lastMessageAt || 0) - (a.conversation?.lastMessageAt || 0);
      });
    }

    return filtered;
  }, [leadsRaw, searchQuery, funnelFilter, tempFilter, instanceFilter, attendantFilter, dateFilter, creditFilter, answeredFilter, colName, colPhone, colVehicle, sortField, sortDir]);

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

  // Abas por ETAPA DO FUNIL (novo, interesse, pagamento, negociando, fechado, perdido…)
  const statusTabs = [
    { value: "all", label: "Todos", count: leadsRaw?.length || 0 },
    ...Object.entries(FUNNEL_CONFIG).map(([value, cfg]: [string, any]) => ({
      value,
      label: `${cfg.icon} ${cfg.label}`,
      count: (leadsRaw as unknown as LeadWithDetails[] | undefined)?.filter((l) => (l.funnelStatus || "novo") === value).length || 0,
    })),
  ];

  const hasActiveFilters = funnelFilter !== "all" || tempFilter !== "all" || instanceFilter !== "all" || attendantFilter !== "all" || dateFilter !== "all" || creditFilter !== "all";

  if (view === "kanban") {
    return (
      <div className="p-4 md:p-6 h-full flex flex-col max-w-full">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setView("leads")} className="px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent">Leads</button>
          <button className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground">📊 Funil</button>
          <button onClick={() => setView("intel")} className="px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent">🧠 Inteligência</button>
        </div>
        <KanbanView leads={(leadsRaw as any[]) || []} onMoved={refetch} setLocation={setLocation} />
      </div>
    );
  }

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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-yellow-400" />
            Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {leads.length} {scope === "notlead" ? "descartado" : "lead"}{leads.length !== 1 ? "s" : ""} encontrado{leads.length !== 1 ? "s" : ""}
            {hasActiveFilters && <span className="text-primary ml-1">(filtrado)</span>}
          </p>
          {/* Aba Leads / Não é lead */}
          <div className="flex rounded-lg overflow-hidden border border-border w-fit mt-2">
            <button onClick={() => setScope("leads")}
              className={`px-3 py-1 text-xs ${scope === "leads" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
              Leads
            </button>
            <button onClick={() => setScope("notlead")}
              className={`px-3 py-1 text-xs ${scope === "notlead" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
              Não é lead
            </button>
          </div>
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
              <div className="min-w-[180px]">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Instância</label>
                <Select value={instanceFilter} onValueChange={setInstanceFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as instâncias</SelectItem>
                    {instanceOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[160px]">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Atendente</label>
                <Select value={attendantFilter} onValueChange={setAttendantFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="none">Sem atendente</SelectItem>
                    {(teamList || []).map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name || m.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[150px]">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Crédito</label>
                <Select value={creditFilter} onValueChange={setCreditFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="sim">💳 Com crédito</SelectItem>
                    <SelectItem value="nao">✗ Sem crédito</SelectItem>
                    <SelectItem value="naoavaliado">Não avaliado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[130px]">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Entrada</label>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Qualquer data</SelectItem>
                    <SelectItem value="today">Hoje</SelectItem>
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={() => { setFunnelFilter("all"); setTempFilter("all"); setInstanceFilter("all"); setAttendantFilter("all"); setDateFilter("all"); setCreditFilter("all"); }}
                >
                  <X className="h-3 w-3 mr-1" />
                  Limpar filtros
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Abas por etapa do FUNIL */}
      <div className="flex gap-1 flex-wrap">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFunnelFilter(tab.value)}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              funnelFilter === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {tab.label}
            <span className={`text-[10px] ${funnelFilter === tab.value ? "opacity-80" : "opacity-50"}`}>
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
          <p className="text-xs text-muted-foreground mt-1">
            {hasActiveFilters || searchQuery || colName || colPhone || colVehicle || answeredFilter !== "all"
              ? "Nenhum resultado para a busca/filtros atuais."
              : "Os leads são criados automaticamente pela IA durante o atendimento."}
          </p>
          <Button size="sm" variant="outline" className="mt-4"
            onClick={() => {
              setSearchQuery(""); setColName(""); setColPhone(""); setColVehicle("");
              setFunnelFilter("all"); setTempFilter("all"); setInstanceFilter("all");
              setAttendantFilter("all"); setDateFilter("all"); setCreditFilter("all");
              setAnsweredFilter("all"); setSortField(null);
            }}>
            Limpar busca e filtros
          </Button>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto bg-card">
          <div className="min-w-[1000px]">
            {/* Cabeçalho com filtro por coluna (estilo Excel) */}
            <div className="grid items-center gap-2 px-2 py-1.5 border-b border-border bg-muted/40 sticky top-0 z-10 text-[10px]" style={{ gridTemplateColumns: LEAD_GRID }}>
              <button onClick={() => toggleSort("entrada")} className="text-muted-foreground font-semibold uppercase text-left hover:text-foreground flex items-center gap-0.5">
                Entrada {sortField === "entrada" ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
              </button>
              <input value={colName} onChange={(e) => setColName(e.target.value)} placeholder="Nome…" className="h-6 px-1.5 rounded border border-border bg-background text-[11px]" />
              <input value={colPhone} onChange={(e) => setColPhone(e.target.value)} placeholder="Telefone…" className="h-6 px-1.5 rounded border border-border bg-background text-[11px]" />
              <input value={colVehicle} onChange={(e) => setColVehicle(e.target.value)} placeholder="Veículo…" className="h-6 px-1.5 rounded border border-border bg-background text-[11px]" />
              <select value={attendantFilter} onChange={(e) => setAttendantFilter(e.target.value)} className="h-6 px-1 rounded border border-border bg-background text-[11px]">
                <option value="all">Atendente</option><option value="none">Sem</option>
                {(teamList || []).map((m: any) => <option key={m.id} value={String(m.id)}>{m.name || m.email}</option>)}
              </select>
              <select value={instanceFilter} onChange={(e) => setInstanceFilter(e.target.value)} className="h-6 px-1 rounded border border-border bg-background text-[11px]">
                <option value="all">Instância</option>
                {instanceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button onClick={() => toggleSort("lastmsg")} className="text-muted-foreground font-semibold uppercase text-center hover:text-foreground">
                Últ. {sortField === "lastmsg" ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
              </button>
              <select value={answeredFilter} onChange={(e) => setAnsweredFilter(e.target.value)} className="h-6 px-1 rounded border border-border bg-background text-[11px]">
                <option value="all">Espera</option>
                <option value="unanswered">⚠️ Não respondidos</option>
                <option value="answered">Respondidos</option>
              </select>
              <select value={funnelFilter} onChange={(e) => setFunnelFilter(e.target.value)} className="h-6 px-1 rounded border border-border bg-background text-[11px]">
                <option value="all">Estágio</option>
                {FUNNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={tempFilter} onChange={(e) => setTempFilter(e.target.value)} className="h-6 px-1 rounded border border-border bg-background text-[11px]">
                <option value="all">Temp</option>
                {TEMP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="text-muted-foreground font-semibold uppercase text-right">Ações</div>
            </div>
          {leads.map((lead) => {
            const isExpanded = expandedLeadId === lead.id;
            const displayName = lead.name || lead.conversation?.contactName || "Sem nome";
            const displayPhone = formatPhone(lead.phone);
            const funnel = FUNNEL_CONFIG[lead.funnelStatus || "novo"];
            const temp = TEMP_CONFIG[lead.temperature || "frio"];
            const instLabel = (lead.conversation as any)?.instanceLabel || (lead.conversation as any)?.instanceName || (lead.conversation?.channel === "zernio" ? "Recepção" : "Matriz");

            return (
              <div key={lead.id} id={`lead-${lead.id}`} className={`border-b border-border ${isExpanded ? "bg-accent/30" : (lead as any).unanswered ? "bg-red-500/[0.07] border-l-2 border-l-red-500 hover:bg-red-500/[0.12]" : "hover:bg-accent/20"}`}>
                {/* Linha (grid) */}
                <div
                  className="grid items-center gap-2 px-2 py-1.5 cursor-pointer select-none text-xs"
                  style={{ gridTemplateColumns: LEAD_GRID }}
                  onClick={() => setExpandedLeadId(isExpanded ? null : lead.id)}
                >
                  <span className="text-[10px] text-muted-foreground">
                    {(lead as any).createdAt ? new Date((lead as any).createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}
                  </span>
                  <span className="font-semibold truncate flex items-center gap-1" title={displayName}>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(String(lead.id)); toast.success(`Lead #${lead.id} copiado`); }}
                      title="ID do lead (aparece no log do CAPI). Clique para copiar."
                      className="font-mono text-[9px] text-muted-foreground bg-muted px-1 rounded shrink-0 hover:bg-accent"
                    >#{lead.id}</button>
                    {(lead as any).creditApproved === "sim" && <span title={`Crédito aprovado${(lead as any).creditBank ? ` · ${(lead as any).creditBank}` : ""}`}>💳</span>}
                    {(lead as any).creditApproved === "nao" && <span title="Sem crédito" className="grayscale opacity-60">💳</span>}
                    {lead.hasTrade && <span title={`Troca: ${lead.tradeVehicle || "veículo não informado"}`}>🔄</span>}
                    {(lead as any).visitedStore && <span title="Visitou a loja">🏪</span>}
                    {(lead as any).quality === "alta" && <span title="Qualidade alta (definida pelo vendedor)">🟢</span>}
                    {(lead as any).quality === "baixa" && <span title="Qualidade baixa (definida pelo vendedor)">🟡</span>}
                    <span className="truncate">{displayName}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">{displayPhone}</span>
                  <span className="truncate text-[11px]" title={lead.linkedVehicle ? `${lead.linkedVehicle.brand} ${lead.linkedVehicle.model}` : lead.vehicleInterest || ""}>
                    {lead.linkedVehicle ? `🚗 ${lead.linkedVehicle.brand} ${lead.linkedVehicle.model}` : (lead.vehicleInterest && lead.vehicleInterest !== "não definido") ? <span className="text-muted-foreground">🔎 {lead.vehicleInterest}</span> : <span className="text-muted-foreground/40">—</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">{lead.assignedAgent?.name?.split(" ")[0] || "—"}</span>
                  <span className="text-[10px] text-muted-foreground truncate" title={instLabel}>{instLabel}</span>
                  <span className="text-[10px] text-muted-foreground text-center">{lead.conversation?.lastMessageAt ? timeAgo(lead.conversation.lastMessageAt) : "—"}</span>
                  {/* Espera: se não respondido mostra há quanto tempo o cliente aguarda */}
                  <span className="text-[10px] text-center">
                    {(lead as any).unanswered && (lead as any).waitingSince ? (
                      <span className="font-semibold text-red-600" title="Cliente aguardando resposta">
                        ⏳ {dur(Date.now() - Number((lead as any).waitingSince))}
                      </span>
                    ) : (lead as any).avgResponseSec != null ? (
                      <span className="text-muted-foreground" title="Tempo médio de resposta">
                        ⌀ {dur(Number((lead as any).avgResponseSec) * 1000)}
                      </span>
                    ) : <span className="text-muted-foreground/40">—</span>}
                  </span>
                  <span>{funnel && <span className={`text-[9px] px-1 rounded ${funnel.bg} ${funnel.color} whitespace-nowrap`}>{funnel.label}</span>}</span>
                  <span>{temp && <span className={`text-[9px] px-1 rounded ${temp.bg} ${temp.color} whitespace-nowrap`}>{temp.icon} {temp.label}</span>}</span>
                  <div className="flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
                    {scope === "notlead" ? (
                      <button title="Voltar a ser lead" className="text-[10px] px-1.5 py-1 rounded bg-green-600/10 text-green-700 hover:bg-green-600/20 whitespace-nowrap"
                        onClick={() => setIsLead.mutate({ leadId: lead.id })}>↩ Voltar a ser lead</button>
                    ) : (
                      <button title="Vincular estoque / editar" className="p-1 rounded hover:bg-accent" onClick={() => openEditDialog(lead)}>🚗</button>
                    )}
                    <GoToConversation lead={lead} compact />
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                </div>

                {/* Expanded Panel */}
                {isExpanded && (
                  <CardContent className="pt-0 pb-4 px-4 border-t border-border">
                    {/* Ações do lead */}
                    <div className="flex flex-wrap gap-2 mt-3 mb-3 items-center">
                      <GoToConversation lead={lead} />
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); openEditDialog(lead); }}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs text-muted-foreground hover:text-red-600" onClick={(e) => { e.stopPropagation(); handleNotLead(lead); }}>
                        Não é lead
                      </Button>
                    </div>

                    {/* Crédito + Vincular carro + Comentário */}
                    <LeadActions lead={lead} onChanged={refetch} />

                    {/* Linha do tempo do lead */}
                    <LeadTimeline leadId={lead.id} />


                    {/* Lead Details Grid */}
                    <div className="grid grid-cols-1 gap-4">
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

                    </div>
                  </CardContent>
                )}
              </div>
            );
          })}
          </div>
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

// Grid da tabela de leads (mesmo template no cabeçalho e nas linhas)
const LEAD_GRID = "60px minmax(130px,1.3fr) 112px minmax(120px,1.3fr) 110px 110px 52px 96px 120px 84px 78px";

/** Formata segundos/duração em texto curto (2min, 1.5h, 3d). */
function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ─── Kanban do funil (por lead) ───────────────────────────────────────────────
const KANBAN_STAGES: { key: string; label: string; color: string }[] = [
  { key: "novo", label: "Novo", color: "border-slate-300" },
  { key: "interesse_definido", label: "Interesse", color: "border-blue-300" },
  { key: "pagamento_definido", label: "Pagamento", color: "border-amber-300" },
  { key: "dados_pessoais", label: "Dados", color: "border-amber-300" },
  { key: "dados_troca", label: "Troca", color: "border-amber-300" },
  { key: "encaminhado_vendedor", label: "No vendedor", color: "border-orange-300" },
  { key: "negociando", label: "Negociando", color: "border-violet-300" },
  { key: "fechado", label: "Fechado", color: "border-green-400" },
];
const tempEmoji: Record<string, string> = { frio: "🧊", morno: "🌤️", quente: "🔥", muito_quente: "🚀" };

function KanbanView({ leads, onMoved, setLocation }: { leads: any[]; onMoved: () => void; setLocation: (u: string) => void }) {
  const move = trpc.lead.update.useMutation({ onSuccess: onMoved, onError: (e: any) => toast.error(e.message) });
  const byStage = (stage: string) => leads.filter(l => (l.funnelStatus || "novo") === stage);
  const stageIndex = (s: string) => KANBAN_STAGES.findIndex(x => x.key === s);

  return (
    <div className="flex-1 min-h-0 overflow-x-auto">
      <div className="flex gap-3 h-full pb-2" style={{ minWidth: "max-content" }}>
        {KANBAN_STAGES.map((col) => {
          const cards = byStage(col.key);
          return (
            <div key={col.key} className="w-64 shrink-0 flex flex-col bg-muted/30 rounded-lg">
              <div className={`px-3 py-2 border-t-4 ${col.color} rounded-t-lg flex items-center justify-between`}>
                <span className="text-sm font-semibold">{col.label}</span>
                <span className="text-xs text-muted-foreground bg-background rounded-full px-2">{cards.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {cards.map((l) => {
                  const idx = stageIndex(col.key);
                  return (
                    <div key={l.id} className="bg-card border border-border rounded-lg p-2.5 text-xs shadow-sm">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold truncate">{l.name || l.contactName || l.phone}</span>
                        <span>{tempEmoji[l.temperature] || ""}</span>
                      </div>
                      <div className="text-muted-foreground truncate">{l.phone}</div>
                      {l.vehicleInterest && l.vehicleInterest !== "não definido" && (
                        <div className="text-[11px] text-muted-foreground truncate mt-0.5">🚗 {l.vehicleInterest}</div>
                      )}
                      <div className="flex items-center justify-between mt-2 gap-1">
                        <button title="Voltar etapa" disabled={idx <= 0 || move.isPending}
                          onClick={() => idx > 0 && move.mutate({ conversationId: l.conversationId, funnelStatus: KANBAN_STAGES[idx - 1].key as any })}
                          className="px-1.5 py-0.5 rounded border border-border disabled:opacity-30 hover:bg-accent">←</button>
                        <button onClick={() => setLocation(`/inbox?conv=${l.conversationId}`)}
                          className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] hover:bg-primary/20">Abrir</button>
                        <button title="Avançar etapa" disabled={idx >= KANBAN_STAGES.length - 1 || move.isPending}
                          onClick={() => idx < KANBAN_STAGES.length - 1 && move.mutate({ conversationId: l.conversationId, funnelStatus: KANBAN_STAGES[idx + 1].key as any })}
                          className="px-1.5 py-0.5 rounded border border-border disabled:opacity-30 hover:bg-accent">→</button>
                      </div>
                    </div>
                  );
                })}
                {cards.length === 0 && <div className="text-[11px] text-muted-foreground/50 text-center py-4">vazio</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Botão "Ir para conversa" (resolve a instância certa; pergunta se >1) ─────
function GoToConversation({ lead, compact }: { lead: any; compact?: boolean }) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [options, setOptions] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const go = (conversationId: number, source: string) =>
    setLocation(`/inbox?conv=${conversationId}&src=${encodeURIComponent(source)}`);
  const handleClick = async () => {
    setLoading(true);
    try {
      const convs = await utils.lead.conversations.fetch({ leadId: lead.id, phone: lead.phone });
      setLoading(false);
      if (!convs || convs.length === 0) return go(lead.conversationId, "matriz");
      if (convs.length === 1) return go(convs[0].conversationId, convs[0].source);
      setOptions(convs);
    } catch {
      setLoading(false);
      go(lead.conversationId, "matriz");
    }
  };
  return (
    <div className="relative inline-block">
      {compact ? (
        <button title="Ir para conversa" className="p-1.5 rounded hover:bg-accent text-primary" onClick={(e) => { e.stopPropagation(); handleClick(); }} disabled={loading}>
          <MessageSquare className="h-4 w-4" />
        </button>
      ) : (
        <Button size="sm" variant="default" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); handleClick(); }} disabled={loading}>
          <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
          {loading ? "Abrindo..." : "Ir para conversa"}
        </Button>
      )}
      {options && (
        <div className="absolute z-30 mt-1 bg-popover border border-border rounded-md shadow-lg p-1 min-w-52" onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] text-muted-foreground px-2 py-1">Este contato falou em vários números:</div>
          {options.map((o: any) => (
            <button key={o.conversationId} onClick={() => { setOptions(null); go(o.conversationId, o.source); }}
              className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent">
              {o.label}
            </button>
          ))}
          <button onClick={() => setOptions(null)} className="w-full text-left px-2 py-1 text-[10px] text-muted-foreground rounded hover:bg-accent">Cancelar</button>
        </div>
      )}
    </div>
  );
}

// ─── Ações do lead: comentário, crédito, vincular carro ───────────────────────
const BANKS = ["Santander", "BV", "Pan", "Sicredi", "C6", "Itaú", "Bradesco", "Safra", "Cresol", "Sicoob", "Outro"];
function LeadActions({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const [tab, setTab] = useState<null | "comment" | "credit" | "vehicle">(null);
  const [comment, setComment] = useState("");
  const [credApproved, setCredApproved] = useState<"sim" | "nao" | null>(lead.creditApproved || null);
  const [amount, setAmount] = useState(lead.creditAmount || "");
  const [conditions, setConditions] = useState(lead.creditConditions || "");
  const [bank, setBank] = useState(lead.creditBank || "");
  const [vSearch, setVSearch] = useState("");
  const addNote = trpc.activity.addNote.useMutation({ onSuccess: () => { toast.success("Comentário adicionado"); setComment(""); setTab(null); onChanged(); }, onError: (e: any) => toast.error(e.message) });
  const setCredit = trpc.lead.setCredit.useMutation({ onSuccess: () => { toast.success("Crédito atualizado"); onChanged(); }, onError: (e: any) => toast.error(e.message) });
  const setQuality = trpc.lead.setQuality.useMutation({ onSuccess: () => { toast.success("Qualidade do lead atualizada — a Meta vai aprender com isso"); onChanged(); }, onError: (e: any) => toast.error(e.message) });
  const linkVehicle = trpc.lead.linkVehicle.useMutation({ onSuccess: () => { toast.success("Veículo vinculado"); setTab(null); onChanged(); }, onError: (e: any) => toast.error(e.message) });
  const { data: vehicles } = trpc.vehicle.list.useQuery(undefined, { enabled: tab === "vehicle" });
  const vList = (vehicles || []).filter((v: any) => v.available && `${v.brand} ${v.model} ${v.year}`.toLowerCase().includes(vSearch.toLowerCase())).slice(0, 30);
  const inputCls = "w-full h-8 px-2 text-sm rounded border border-border bg-background";

  return (
    <div className="space-y-2 mb-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setTab(tab === "comment" ? null : "comment")}>💬 Comentário</Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setTab(tab === "credit" ? null : "credit")}>💳 Crédito</Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setTab(tab === "vehicle" ? null : "vehicle")}>🚗 Vincular carro</Button>
        {lead.creditApproved === "sim" && <span className="text-[11px] text-green-600 self-center">✓ Crédito aprovado{lead.creditAmount ? `: ${lead.creditAmount}` : ""}{lead.creditBank ? ` (${lead.creditBank})` : ""}</span>}
        {lead.creditApproved === "nao" && <span className="text-[11px] text-red-600 self-center">✗ Sem crédito</span>}
      </div>

      {/* ── QUALIDADE DO LEAD (só o vendedor decide) ───────────────────────── */}
      <div className="border border-border rounded-lg p-3 space-y-2.5 bg-muted/20">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qualidade do lead</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
            (lead.qualityScore ?? 0) >= 70 ? "bg-green-500/15 text-green-700"
            : (lead.qualityScore ?? 0) >= 40 ? "bg-yellow-500/15 text-yellow-700"
            : "bg-muted text-muted-foreground"
          }`} title="Pontuação calculada: crédito, visita, troca, etapa e engajamento">
            {lead.qualityScore ?? 0} pts
          </span>
        </div>

        {/* Classificação — quem marca é o vendedor */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-muted-foreground w-20">Classificação</span>
          <button
            onClick={() => setQuality.mutate({ leadId: lead.id, quality: "alta" })}
            className={`px-3 py-1 rounded text-xs font-medium ${lead.quality === "alta" ? "bg-green-600 text-white" : "bg-green-500/10 text-green-700 hover:bg-green-500/20"}`}
            title="Cliente com real potencial de compra"
          >🟢 Alta</button>
          <button
            onClick={() => setQuality.mutate({ leadId: lead.id, quality: "baixa" })}
            className={`px-3 py-1 rounded text-xs font-medium ${lead.quality === "baixa" ? "bg-yellow-500 text-white" : "bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20"}`}
            title="Pouco potencial — não buscar mais clientes assim"
          >🟡 Baixa</button>
          {lead.quality && (
            <button onClick={() => setQuality.mutate({ leadId: lead.id, quality: "limpar" })} className="text-[11px] text-muted-foreground underline hover:text-red-600">limpar</button>
          )}
        </div>

        {/* Visita à loja */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-muted-foreground w-20">Visita</span>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="checkbox" className="h-3.5 w-3.5" checked={!!lead.visitedStore}
              onChange={(e) => setQuality.mutate({ leadId: lead.id, quality: lead.quality || "limpar", visitedStore: e.target.checked })} />
            🏪 Visitou a loja
          </label>
        </div>

        {/* Crédito */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-muted-foreground w-20">Crédito</span>
          <button onClick={() => { setCredApproved("sim"); setTab(tab === "credit" ? null : "credit"); }}
            className={`px-3 py-1 rounded text-xs font-medium ${lead.creditApproved === "sim" ? "bg-green-600 text-white" : "bg-green-500/10 text-green-700 hover:bg-green-500/20"}`}>✓ Com crédito</button>
          <button onClick={() => { setCredApproved("nao"); setCredit.mutate({ leadId: lead.id, approved: "nao" }); }}
            className={`px-3 py-1 rounded text-xs font-medium ${lead.creditApproved === "nao" ? "bg-red-600 text-white" : "bg-red-500/10 text-red-700 hover:bg-red-500/20"}`}>✗ Sem crédito</button>
          {lead.creditApproved && (
            <button onClick={() => setCredit.mutate({ leadId: lead.id, approved: "limpar" })} className="text-[11px] text-muted-foreground underline hover:text-red-600">limpar</button>
          )}
          {lead.creditApproved === "sim" && (
            <span className="text-[11px] text-green-700">{lead.creditAmount || ""}{lead.creditBank ? ` · ${lead.creditBank}` : ""}</span>
          )}
        </div>
      </div>

      {tab === "comment" && (
        <div className="space-y-1">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Comentário (entra na linha do tempo e no contexto da IA)" className="text-sm" />
          <Button size="sm" className="h-7 text-xs" disabled={!comment.trim() || addNote.isPending} onClick={() => addNote.mutate({ conversationId: lead.conversationId, note: comment.trim() })}>Adicionar</Button>
        </div>
      )}

      {tab === "credit" && (
        <div className="space-y-2 border border-border rounded-md p-2">
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => { setCredApproved("sim"); }} className={`px-3 py-1 rounded text-xs font-medium ${credApproved === "sim" ? "bg-green-600 text-white" : "bg-green-500/10 text-green-700"}`}>Com crédito</button>
            <button onClick={() => { setCredApproved("nao"); setCredit.mutate({ leadId: lead.id, approved: "nao" }); }} className={`px-3 py-1 rounded text-xs font-medium ${credApproved === "nao" ? "bg-red-600 text-white" : "bg-red-500/10 text-red-700"}`}>Sem crédito</button>
            {(lead.creditApproved || credApproved) && (
              <button onClick={() => { setCredApproved(null); setAmount(""); setConditions(""); setBank(""); setCredit.mutate({ leadId: lead.id, approved: "limpar" }); }} className="px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-red-600 underline">Limpar / removi por engano</button>
            )}
          </div>
          {credApproved === "sim" && (
            <div className="space-y-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Valor liberado (ex: R$ 45.000)" className={inputCls} />
              <input value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Condições de parcela (ex: 48x de R$ 1.200)" className={inputCls} />
              <select value={bank} onChange={(e) => setBank(e.target.value)} className={inputCls}>
                <option value="">Banco…</option>
                {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <Button size="sm" className="h-7 text-xs" disabled={setCredit.isPending} onClick={() => setCredit.mutate({ leadId: lead.id, approved: "sim", amount: amount || undefined, conditions: conditions || undefined, bank: bank || undefined })}>Salvar crédito</Button>
            </div>
          )}
        </div>
      )}

      {tab === "vehicle" && (
        <div className="space-y-2 border border-border rounded-md p-2">
          <input value={vSearch} onChange={(e) => setVSearch(e.target.value)} placeholder="Buscar veículo no estoque…" className={inputCls} />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {vList.map((v: any) => (
              <button key={v.id} onClick={() => linkVehicle.mutate({ leadId: lead.id, vehicleId: v.id })} className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-accent text-left text-xs">
                {v.imageUrl && <img src={v.imageUrl} className="w-8 h-8 rounded object-cover" alt="" />}
                <span className="flex-1 truncate">{v.brand} {v.model} {v.year}</span>
                <span className="text-muted-foreground">{v.price ? `R$ ${Number(v.price).toLocaleString("pt-BR")}` : ""}</span>
              </button>
            ))}
            {vList.length === 0 && <div className="text-[11px] text-muted-foreground text-center py-2">Nenhum veículo</div>}
          </div>
          {lead.linkedVehicle && <button onClick={() => linkVehicle.mutate({ leadId: lead.id, vehicleId: null })} className="text-[11px] text-red-600">Desvincular veículo atual</button>}
        </div>
      )}
    </div>
  );
}

// ─── Linha do tempo do lead (unificada, todos os números) ────────────────────
function fmtTimelineDate(d: any) {
  try { return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }); } catch { return ""; }
}
function LeadTimeline({ leadId }: { leadId: number }) {
  const { data: events, isLoading } = trpc.activity.timelineByLead.useQuery({ leadId }, { enabled: !!leadId });
  const meta: Record<string, { label: string; icon: string; color: string }> = {
    lead_criado:       { label: "Lead criado", icon: "✨", color: "text-emerald-600" },
    lead_reativado:    { label: "Lead reativado", icon: "🔄", color: "text-blue-600" },
    etapa_funil:       { label: "Avançou etapa", icon: "📈", color: "text-violet-600" },
    negocio_fechado:   { label: "Negócio fechado", icon: "🏆", color: "text-green-600" },
    lead_transferido:  { label: "Transferido ao vendedor", icon: "📤", color: "text-orange-600" },
    nota:              { label: "Nota", icon: "📝", color: "text-slate-600" },
    ia_comentario:     { label: "IA analisou", icon: "🤖", color: "text-fuchsia-600" },
    nao_e_lead:        { label: "Marcado: não é lead", icon: "🚫", color: "text-red-600" },
    credito:           { label: "Crédito", icon: "💳", color: "text-emerald-600" },
    veiculo_vinculado: { label: "Veículo vinculado", icon: "🚗", color: "text-blue-600" },
    atribuido_atendente: { label: "Atribuído a atendente", icon: "👤", color: "text-slate-600" },
  };
  if (isLoading) return <div className="mt-4 text-xs text-muted-foreground">Carregando linha do tempo…</div>;
  if (!events || events.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">🕑 Linha do tempo</p>
      <ol className="space-y-2">
        {events.map((ev: any) => {
          const m = meta[ev.action] || { label: ev.action, icon: "•", color: "text-muted-foreground" };
          const d = ev.details || {};
          let extra = "";
          if (ev.action === "etapa_funil") extra = `${d.de || ""} → ${d.para || ""}`;
          else if (ev.action === "ia_comentario") extra = d.resumo || "";
          else if (ev.action === "nao_e_lead") extra = d.motivo || "";
          else if (ev.action === "lead_criado") extra = `${d.origem === "anuncio" ? "via anúncio" : "orgânico"}${d.instancia ? ` · ${d.instancia}` : ""}`;
          else if (ev.action === "lead_transferido") extra = `→ ${d.para || ""}${d.por ? ` (por ${d.por})` : ""}`;
          else if (ev.action === "lead_reativado") extra = `estava: ${d.de || ""}`;
          else if (ev.action === "credito") extra = d.aprovado === "sim" ? `aprovado${d.valor ? ` ${d.valor}` : ""}${d.banco ? ` · ${d.banco}` : ""}` : "sem crédito";
          else if (ev.action === "veiculo_vinculado") extra = d.veiculo || "";
          else if (ev.action === "nota") extra = d.note || d.texto || "";
          return (
            <li key={ev.id} className="flex gap-2 text-xs">
              <span className="shrink-0">{m.icon}</span>
              <div className="min-w-0">
                <span className={`font-medium ${m.color}`}>{m.label}</span>
                {extra && (ev.action === "ia_comentario"
                  ? <div className="text-muted-foreground mt-0.5 whitespace-pre-line leading-relaxed">{extra}</div>
                  : <span className="text-muted-foreground"> — {extra}</span>)}
                {ev.action === "ia_comentario" && d.proximaAcao && (
                  <div className="text-[11px] text-fuchsia-700/80 mt-0.5">➡️ {d.proximaAcao}</div>
                )}
                <div className="text-[10px] text-muted-foreground">{fmtTimelineDate(ev.createdAt)} · {ev.userName}</div>
              </div>
            </li>
          );
        })}
      </ol>
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
