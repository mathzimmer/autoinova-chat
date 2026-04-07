import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Send,
  Plus,
  Play,
  Pause,
  Clock,
  Trash2,
  Eye,
  Search,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Users,
  CalendarClock,
  Repeat,
  GitBranch,
  Tag,
  Loader2,
  ChevronDown,
  ChevronUp,
  BarChart3,
  RefreshCw,
  Settings,
} from "lucide-react";

type Campaign = {
  id: number;
  name: string;
  description: string | null;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[] | null;
  contactIds: number[] | null;
  filterTags: string[] | null;
  scheduleType: string;
  scheduledAt: number | null;
  intervalDays: number | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  responseFlowId: number | null;
  conversationTag: string | null;
  status: string;
  totalContacts: number;
  createdBy: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

// ── Campaign Status Badge ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    draft: { label: "Rascunho", variant: "secondary" },
    scheduled: { label: "Agendada", variant: "default" },
    running: { label: "Enviando...", variant: "default" },
    paused: { label: "Pausada", variant: "outline" },
    completed: { label: "Concluída", variant: "secondary" },
  };
  const c = config[status] || { label: status, variant: "outline" as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

// ── Campaign Stats Mini ────────────────────────────────────────────────────

function CampaignStats({ campaignId }: { campaignId: number }) {
  const stats = trpc.campaign.stats.useQuery({ campaignId });
  if (!stats.data || stats.data.total === 0) return null;
  const s = stats.data;
  return (
    <div className="flex gap-3 text-xs mt-2">
      <span className="text-muted-foreground">Total: <strong className="text-foreground">{s.total}</strong></span>
      <span className="text-emerald-500">Entregues: <strong>{s.delivered}</strong></span>
      <span className="text-blue-500">Lidos: <strong>{s.read}</strong></span>
      <span className="text-amber-500">Respondidos: <strong>{s.responded}</strong></span>
      <span className="text-red-500">Falhas: <strong>{s.failed}</strong></span>
    </div>
  );
}

// ── Dispatch History Dialog ────────────────────────────────────────────────

function DispatchHistoryDialog({ campaignId, campaignName, open, onClose }: {
  campaignId: number;
  campaignName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const dispatches = trpc.campaign.dispatches.useQuery(
    { campaignId, status: statusFilter === "all" ? undefined : statusFilter, limit: 200 },
    { enabled: open }
  );
  const stats = trpc.campaign.stats.useQuery({ campaignId }, { enabled: open });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Histórico de Disparos — {campaignName}
          </DialogTitle>
          <DialogDescription>Detalhes de entrega de cada contato</DialogDescription>
        </DialogHeader>

        {/* Stats Summary */}
        {stats.data && stats.data.total > 0 && (
          <div className="grid grid-cols-6 gap-2 text-center">
            <div className="bg-muted rounded-lg p-2">
              <div className="text-lg font-bold">{stats.data.total}</div>
              <div className="text-[10px] text-muted-foreground">Total</div>
            </div>
            <div className="bg-emerald-500/10 rounded-lg p-2">
              <div className="text-lg font-bold text-emerald-500">{stats.data.sent}</div>
              <div className="text-[10px] text-muted-foreground">Enviados</div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-2">
              <div className="text-lg font-bold text-blue-500">{stats.data.delivered}</div>
              <div className="text-[10px] text-muted-foreground">Entregues</div>
            </div>
            <div className="bg-purple-500/10 rounded-lg p-2">
              <div className="text-lg font-bold text-purple-500">{stats.data.read}</div>
              <div className="text-[10px] text-muted-foreground">Lidos</div>
            </div>
            <div className="bg-amber-500/10 rounded-lg p-2">
              <div className="text-lg font-bold text-amber-500">{stats.data.responded}</div>
              <div className="text-[10px] text-muted-foreground">Respondidos</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-2">
              <div className="text-lg font-bold text-red-500">{stats.data.failed}</div>
              <div className="text-[10px] text-muted-foreground">Falhas</div>
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-2">
          <Label className="text-xs">Filtrar:</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="sent">Enviados</SelectItem>
              <SelectItem value="delivered">Entregues</SelectItem>
              <SelectItem value="read">Lidos</SelectItem>
              <SelectItem value="responded">Respondidos</SelectItem>
              <SelectItem value="failed">Falhas</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => dispatches.refetch()}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        {/* Dispatch List */}
        <div className="flex-1 overflow-auto">
          {dispatches.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !dispatches.data?.dispatches?.length ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Nenhum disparo encontrado
            </div>
          ) : (
            <div className="space-y-1">
              {dispatches.data.dispatches.map((d: any) => (
                <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 text-sm">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{d.contactName || "Sem nome"}</span>
                    <span className="text-xs text-muted-foreground">{d.phone}</span>
                  </div>
                  <DispatchStatusBadge status={d.status} />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {d.sentAt ? new Date(d.sentAt).toLocaleString("pt-BR") : "—"}
                  </span>
                  {d.errorMessage && (
                    <span className="text-xs text-red-400 max-w-[150px] truncate" title={d.errorMessage}>
                      {d.errorMessage}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DispatchStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    pending: { label: "Pendente", color: "text-muted-foreground bg-muted" },
    sent: { label: "Enviado", color: "text-blue-500 bg-blue-500/10" },
    delivered: { label: "Entregue", color: "text-emerald-500 bg-emerald-500/10" },
    read: { label: "Lido", color: "text-purple-500 bg-purple-500/10" },
    responded: { label: "Respondido", color: "text-amber-500 bg-amber-500/10" },
    failed: { label: "Falhou", color: "text-red-500 bg-red-500/10" },
  };
  const c = config[status] || { label: status, color: "text-muted-foreground bg-muted" };
  return <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${c.color}`}>{c.label}</span>;
}

// ── Create/Edit Campaign Dialog ────────────────────────────────────────────

function CampaignFormDialog({ open, onClose, campaign }: {
  open: boolean;
  onClose: () => void;
  campaign?: Campaign | null;
}) {
  const utils = trpc.useUtils();
  const templates = trpc.whatsappTemplate.list.useQuery(undefined, { enabled: open });
  const contactsQuery = trpc.contact.list.useQuery({ limit: 1000 }, { enabled: open });
  const tagsQuery = trpc.contact.tags.useQuery(undefined, { enabled: open });
  const flowsQuery = trpc.campaign.availableFlows.useQuery(undefined, { enabled: open });

  const [name, setName] = useState(campaign?.name || "");
  const [description, setDescription] = useState(campaign?.description || "");
  const [templateName, setTemplateName] = useState(campaign?.templateName || "");
  const [bodyParamsStr, setBodyParamsStr] = useState(campaign?.bodyParams?.join(", ") || "");
  const [selectionMode, setSelectionMode] = useState<"individual" | "tags">(
    campaign?.filterTags?.length ? "tags" : "individual"
  );
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>(campaign?.contactIds || []);
  const [selectedTags, setSelectedTags] = useState<string[]>(campaign?.filterTags || []);
  const [scheduleType, setScheduleType] = useState<"once" | "recurring">(
    (campaign?.scheduleType as any) || "once"
  );
  const [scheduledDate, setScheduledDate] = useState(
    campaign?.scheduledAt ? new Date(campaign.scheduledAt).toISOString().slice(0, 16) : ""
  );
  const [intervalDays, setIntervalDays] = useState(campaign?.intervalDays?.toString() || "7");
  const [responseFlowId, setResponseFlowId] = useState<string>(
    campaign?.responseFlowId?.toString() || "none"
  );
  const [conversationTag, setConversationTag] = useState(campaign?.conversationTag || "");
  const [contactSearch, setContactSearch] = useState("");

  const createMutation = trpc.campaign.create.useMutation({
    onSuccess: () => {
      utils.campaign.list.invalidate();
      toast.success("Campanha criada com sucesso!");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.campaign.update.useMutation({
    onSuccess: () => {
      utils.campaign.list.invalidate();
      toast.success("Campanha atualizada!");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const filteredContacts = useMemo(() => {
    if (!contactsQuery.data?.contacts) return [];
    if (!contactSearch) return contactsQuery.data.contacts;
    const q = contactSearch.toLowerCase();
    return contactsQuery.data.contacts.filter((c: any) =>
      c.name?.toLowerCase().includes(q) || c.phone?.includes(q)
    );
  }, [contactsQuery.data, contactSearch]);

  const handleSubmit = () => {
    if (!name.trim()) return toast.error("Nome da campanha é obrigatório");
    if (!templateName) return toast.error("Selecione um template");

    const bodyParams = bodyParamsStr.trim() ? bodyParamsStr.split(",").map((s: string) => s.trim()) : undefined;
    const scheduledAt = scheduledDate ? new Date(scheduledDate).getTime() : undefined;

    const payload: any = {
      name: name.trim(),
      description: description.trim() || undefined,
      templateName,
      bodyParams,
      scheduleType,
      scheduledAt,
      intervalDays: scheduleType === "recurring" ? parseInt(intervalDays) || 7 : undefined,
      responseFlowId: responseFlowId !== "none" ? parseInt(responseFlowId) : undefined,
      conversationTag: conversationTag.trim() || undefined,
    };

    if (selectionMode === "individual") {
      payload.contactIds = selectedContactIds;
    } else {
      payload.filterTags = selectedTags;
    }

    if (campaign) {
      updateMutation.mutate({ id: campaign.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const approvedTemplates = useMemo(() => {
    if (!templates.data) return [];
    return templates.data.filter((t: any) => t.status === "APPROVED");
  }, [templates.data]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{campaign ? "Editar Campanha" : "Nova Campanha"}</DialogTitle>
          <DialogDescription>
            Configure o envio em massa de templates aprovados pelo Meta
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome da Campanha *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Promoção Semana do Consumidor" />
            </div>
            <div className="space-y-2">
              <Label>Tag da Conversa</Label>
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <Input value={conversationTag} onChange={(e) => setConversationTag(e.target.value)} placeholder="Ex: campanha-marco-2026" />
              </div>
              <p className="text-[10px] text-muted-foreground">Tag aplicada às conversas criadas pelo disparo</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição opcional..." rows={2} />
          </div>

          {/* Template Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Template WhatsApp *
            </Label>
            {templates.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando templates...
              </div>
            ) : approvedTemplates.length === 0 ? (
              <p className="text-sm text-amber-500">Nenhum template aprovado encontrado. Crie templates no Meta Business Suite.</p>
            ) : (
              <Select value={templateName} onValueChange={setTemplateName}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um template aprovado" />
                </SelectTrigger>
                <SelectContent>
                  {approvedTemplates.map((t: any) => (
                    <SelectItem key={t.name} value={t.name}>
                      <div className="flex items-center gap-2">
                        <span>{t.name}</span>
                        <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Parâmetros do Body (separados por vírgula)</Label>
            <Input value={bodyParamsStr} onChange={(e) => setBodyParamsStr(e.target.value)} placeholder="Ex: {{1}} nome, {{2}} veículo" />
            <p className="text-[10px] text-muted-foreground">Deixe vazio se o template não tem variáveis</p>
          </div>

          {/* Contact Selection */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Seleção de Contatos
            </Label>
            <div className="flex gap-2">
              <Button
                variant={selectionMode === "individual" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectionMode("individual")}
              >
                Individual
              </Button>
              <Button
                variant={selectionMode === "tags" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectionMode("tags")}
              >
                Por Tags
              </Button>
            </div>

            {selectionMode === "individual" ? (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Buscar contato..."
                    className="h-8"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (selectedContactIds.length === filteredContacts.length) {
                        setSelectedContactIds([]);
                      } else {
                        setSelectedContactIds(filteredContacts.map((c: any) => c.id));
                      }
                    }}
                  >
                    {selectedContactIds.length === filteredContacts.length ? "Desmarcar" : "Selecionar"} todos
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {contactsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : filteredContacts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">Nenhum contato encontrado</p>
                  ) : (
                    filteredContacts.map((contact: any) => (
                      <label
                        key={contact.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedContactIds.includes(contact.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedContactIds([...selectedContactIds, contact.id]);
                            } else {
                              setSelectedContactIds(selectedContactIds.filter((id) => id !== contact.id));
                            }
                          }}
                        />
                        <span className="text-sm flex-1">{contact.name}</span>
                        <span className="text-xs text-muted-foreground">{contact.phone}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedContactIds.length} contato(s) selecionado(s)
                </p>
              </div>
            ) : (
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Selecione tags para filtrar contatos automaticamente:</p>
                <div className="flex flex-wrap gap-2">
                  {tagsQuery.isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : !tagsQuery.data?.length ? (
                    <p className="text-sm text-muted-foreground">Nenhuma tag encontrada. Adicione tags aos contatos primeiro.</p>
                  ) : (
                    tagsQuery.data.map((tag: string) => (
                      <Badge
                        key={tag}
                        variant={selectedTags.includes(tag) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => {
                          if (selectedTags.includes(tag)) {
                            setSelectedTags(selectedTags.filter((t) => t !== tag));
                          } else {
                            setSelectedTags([...selectedTags, tag]);
                          }
                        }}
                      >
                        {tag}
                      </Badge>
                    ))
                  )}
                </div>
                {selectedTags.length > 0 && (
                  <p className="text-xs text-muted-foreground">{selectedTags.length} tag(s) selecionada(s)</p>
                )}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Agendamento
            </Label>
            <div className="flex gap-2">
              <Button
                variant={scheduleType === "once" ? "default" : "outline"}
                size="sm"
                onClick={() => setScheduleType("once")}
              >
                <Clock className="h-3 w-3 mr-1" /> Envio Único
              </Button>
              <Button
                variant={scheduleType === "recurring" ? "default" : "outline"}
                size="sm"
                onClick={() => setScheduleType("recurring")}
              >
                <Repeat className="h-3 w-3 mr-1" /> Recorrente
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Data/Hora do Envio</Label>
                <Input
                  type="datetime-local"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">Deixe vazio para enviar manualmente</p>
              </div>
              {scheduleType === "recurring" && (
                <div className="space-y-1">
                  <Label className="text-xs">Repetir a cada (dias)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">Ex: 7 = semanal, 30 = mensal</p>
                </div>
              )}
            </div>
          </div>

          {/* Response Flow */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Fluxo de Resposta (opcional)
            </Label>
            <Select value={responseFlowId} onValueChange={setResponseFlowId}>
              <SelectTrigger>
                <SelectValue placeholder="Nenhum fluxo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum (resposta normal)</SelectItem>
                {flowsQuery.data?.map((flow: any) => (
                  <SelectItem key={flow.id} value={flow.id.toString()}>
                    {flow.name} {flow.active ? "" : "(inativo)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Fluxo acionado automaticamente quando o cliente responde ao disparo
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {campaign ? "Salvar" : "Criar Campanha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Campaigns Page ────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [historyDialog, setHistoryDialog] = useState<{ id: number; name: string } | null>(null);

  const campaignsQuery = trpc.campaign.list.useQuery({});
  const utils = trpc.useUtils();

  const executeMutation = trpc.campaign.execute.useMutation({
    onSuccess: (result) => {
      utils.campaign.list.invalidate();
      toast.success(`Campanha executada: ${result.sent} enviados, ${result.failed} falhas`);
    },
    onError: (err) => toast.error(err.message),
  });

  const pauseMutation = trpc.campaign.pause.useMutation({
    onSuccess: () => {
      utils.campaign.list.invalidate();
      toast.success("Campanha pausada");
    },
  });

  const deleteMutation = trpc.campaign.delete.useMutation({
    onSuccess: () => {
      utils.campaign.list.invalidate();
      toast.success("Campanha excluída");
    },
  });

  const scheduleMutation = trpc.campaign.schedule.useMutation({
    onSuccess: () => {
      utils.campaign.list.invalidate();
      toast.success("Campanha agendada!");
    },
    onError: (err) => toast.error(err.message),
  });

  const campaigns = campaignsQuery.data?.campaigns || [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Campanhas de Envio em Massa
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Envie templates aprovados pelo Meta para contatos selecionados
            </p>
          </div>
          <Button onClick={() => { setEditCampaign(null); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Campanha
          </Button>
        </div>
      </div>

      {/* Campaign List */}
      <div className="flex-1 overflow-auto p-6">
        {campaignsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Send className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-1">Nenhuma campanha criada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Crie sua primeira campanha para enviar templates em massa
            </p>
            <Button onClick={() => { setEditCampaign(null); setShowForm(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Campanha
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {campaigns.map((campaign: Campaign) => (
              <Card key={campaign.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground truncate">{campaign.name}</h3>
                        <StatusBadge status={campaign.status} />
                        {campaign.scheduleType === "recurring" && (
                          <Badge variant="outline" className="text-[10px]">
                            <Repeat className="h-3 w-3 mr-1" />
                            A cada {campaign.intervalDays}d
                          </Badge>
                        )}
                      </div>
                      {campaign.description && (
                        <p className="text-sm text-muted-foreground mb-2">{campaign.description}</p>
                      )}
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {campaign.templateName}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {campaign.totalContacts || campaign.contactIds?.length || 0} contatos
                        </span>
                        {campaign.conversationTag && (
                          <span className="flex items-center gap-1">
                            <Tag className="h-3 w-3" />
                            {campaign.conversationTag}
                          </span>
                        )}
                        {campaign.responseFlowId && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            Fluxo vinculado
                          </span>
                        )}
                        {campaign.nextRunAt && (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            Próximo: {new Date(campaign.nextRunAt).toLocaleString("pt-BR")}
                          </span>
                        )}
                        {campaign.lastRunAt && (
                          <span>
                            Último envio: {new Date(campaign.lastRunAt).toLocaleString("pt-BR")}
                          </span>
                        )}
                      </div>
                      <CampaignStats campaignId={campaign.id} />
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 ml-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoryDialog({ id: campaign.id, name: campaign.name })}
                        title="Ver histórico"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditCampaign(campaign); setShowForm(true); }}
                        title="Editar"
                        disabled={campaign.status === "running"}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      {(campaign.status === "draft" || campaign.status === "scheduled" || campaign.status === "completed") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("Executar campanha agora? Os templates serão enviados imediatamente.")) {
                              executeMutation.mutate({ id: campaign.id });
                            }
                          }}
                          disabled={executeMutation.isPending}
                          title="Executar agora"
                          className="text-emerald-500 hover:text-emerald-400"
                        >
                          {executeMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {campaign.status === "scheduled" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => pauseMutation.mutate({ id: campaign.id })}
                          title="Pausar"
                          className="text-amber-500 hover:text-amber-400"
                        >
                          <Pause className="h-4 w-4" />
                        </Button>
                      )}
                      {campaign.status === "paused" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (campaign.nextRunAt) {
                              scheduleMutation.mutate({
                                id: campaign.id,
                                scheduledAt: campaign.nextRunAt,
                                intervalDays: campaign.intervalDays || undefined,
                              });
                            } else {
                              toast.error("Defina uma data de agendamento primeiro");
                            }
                          }}
                          title="Retomar"
                          className="text-emerald-500 hover:text-emerald-400"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm("Excluir campanha e todo o histórico de disparos?")) {
                            deleteMutation.mutate({ id: campaign.id });
                          }
                        }}
                        disabled={campaign.status === "running"}
                        title="Excluir"
                        className="text-red-500 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showForm && (
        <CampaignFormDialog
          open={showForm}
          onClose={() => { setShowForm(false); setEditCampaign(null); }}
          campaign={editCampaign}
        />
      )}

      {historyDialog && (
        <DispatchHistoryDialog
          campaignId={historyDialog.id}
          campaignName={historyDialog.name}
          open={!!historyDialog}
          onClose={() => setHistoryDialog(null)}
        />
      )}
    </div>
  );
}
