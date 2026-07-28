import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus, GitBranch, Play, Pause, Trash2, Copy, Edit3, ArrowRight,
  MessageSquare, List, MousePointerClick, Megaphone, RotateCcw, Tag, Wrench,
  MoreVertical, LifeBuoy, Zap, Filter, X
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FlowEditor from "./FlowEditor";

const TRIGGER_LABELS: Record<string, { label: string; icon: typeof MessageSquare; color: string }> = {
  first_contact: { label: "Primeiro Contato", icon: MessageSquare, color: "bg-green-500/10 text-green-500" },
  keyword: { label: "Palavra-chave", icon: Tag, color: "bg-blue-500/10 text-blue-500" },
  button_click: { label: "Clique em Botão", icon: MousePointerClick, color: "bg-purple-500/10 text-purple-500" },
  ad_click: { label: "Anúncio (ID)", icon: Megaphone, color: "bg-orange-500/10 text-orange-500" },
  manual: { label: "Manual", icon: Wrench, color: "bg-gray-500/10 text-gray-400" },
  reactivation: { label: "Reativação", icon: RotateCcw, color: "bg-yellow-500/10 text-yellow-500" },
  category_interest: { label: "Categoria", icon: List, color: "bg-cyan-500/10 text-cyan-500" },
  rescue: { label: "Resgate (Lead Inativo)", icon: LifeBuoy, color: "bg-red-500/10 text-red-500" },
  tag_added: { label: "Etiqueta adicionada", icon: Tag, color: "bg-emerald-500/10 text-emerald-500" },
  tag_removed: { label: "Etiqueta removida", icon: Tag, color: "bg-rose-500/10 text-rose-500" },
  funnel_stage_entered: { label: "Entrou na etapa", icon: ArrowRight, color: "bg-indigo-500/10 text-indigo-500" },
};

const FUNNEL_STAGE_OPTIONS = [
  "novo", "interesse_definido", "pagamento_definido", "dados_pessoais",
  "dados_troca", "encaminhado_vendedor", "negociando", "fechado", "perdido",
];

// Converte o value do seletor ("evolution:x" | "zernio:x" | "tech_provider:12" | "global")
// nos campos do fluxo. connectionId é numérico (número oficial); os outros usam instanceName.
function parseInstanceValue(v: string): { connectionType: string | null; instanceName: string | null; connectionId: number | null } {
  if (!v || v === "global") return { connectionType: null, instanceName: null, connectionId: null };
  const idx = v.indexOf(":");
  const type = idx >= 0 ? v.slice(0, idx) : v;
  const rest = idx >= 0 ? v.slice(idx + 1) : "";
  if (type === "tech_provider") return { connectionType: "tech_provider", instanceName: null, connectionId: Number(rest) || null };
  if (type === "evolution" || type === "zernio") return { connectionType: type, instanceName: rest, connectionId: null };
  return { connectionType: null, instanceName: null, connectionId: null };
}

// Converte os campos salvos de um fluxo de volta no value do seletor.
function flowToInstanceValue(flow: any): string {
  if (flow?.connectionType === "tech_provider" && flow?.connectionId) return `tech_provider:${flow.connectionId}`;
  if ((flow?.connectionType === "evolution" || flow?.connectionType === "zernio") && flow?.instanceName) return `${flow.connectionType}:${flow.instanceName}`;
  return "global";
}

export default function Flows() {
  const [editingFlowId, setEditingFlowId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFlow, setNewFlow] = useState({
    name: "",
    description: "",
    trigger: "first_contact" as string,
    triggerValue: "",
    instanceName: "global",
  });

  const utils = trpc.useUtils();
  const flowsQuery = trpc.flow.list.useQuery();
  const instancesQuery = trpc.evolution.listInstances.useQuery();
  const zernioInstancesQuery = trpc.zernio.listInstances.useQuery();
  const officialInstancesQuery = trpc.whatsappNumber.listInstances.useQuery();

  // Lista unificada de conexões para o seletor "Aplicar em".
  // value codifica tipo+id; parseInstanceValue converte para os campos do fluxo.
  const connectionOptions: { value: string; label: string }[] = [
    { value: "global", label: "Nenhuma conexão (não dispara — escolha uma abaixo)" },
    ...((instancesQuery.data || []) as any[]).map((i) => ({
      value: `evolution:${i.instanceName}`,
      label: `${i.displayName || i.instanceName} (Evolution)`,
    })),
    ...((zernioInstancesQuery.data || []) as any[]).map((i) => ({
      // zernio.listInstances já retorna instanceName = "zernio:<accountId>"
      value: `zernio:${i.accountId}`,
      label: `${i.displayName || i.accountId} (Zernio)`,
    })),
    ...((officialInstancesQuery.data || []) as any[]).map((i) => ({
      value: `tech_provider:${i.id}`,
      label: `${i.displayName || i.phone || i.phoneNumberId} (Oficial)`,
    })),
  ];

  const createMutation = trpc.flow.create.useMutation({
    onSuccess: () => {
      utils.flow.list.invalidate();
      setCreateOpen(false);
      setNewFlow({ name: "", description: "", trigger: "first_contact", triggerValue: "", instanceName: "global" });
      toast.success("Fluxo criado com sucesso!");
    },
    onError: (e) => toast.error("Erro ao criar fluxo: " + e.message),
  });
  const updateMutation = trpc.flow.update.useMutation({
    onSuccess: () => {
      utils.flow.list.invalidate();
      toast.success("Fluxo atualizado!");
    },
  });
  const deleteMutation = trpc.flow.delete.useMutation({
    onSuccess: () => {
      utils.flow.list.invalidate();
      toast.success("Fluxo excluído!");
    },
  });
  const seedMasterMutation = trpc.flow.seedMasterFlow.useMutation({
    onSuccess: (r) => { toast.success(r.message); flowsQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const duplicateMutation = trpc.flow.duplicate.useMutation({
    onSuccess: () => {
      utils.flow.list.invalidate();
      toast.success("Fluxo duplicado!");
    },
  });

  // ── Condições "Somente se" (grupos E/OU) ──
  const [condFlowId, setCondFlowId] = useState<number | null>(null);
  const [condGroups, setCondGroups] = useState<{ field: string; op: string; value: string }[][]>([]);
  function openConditions(flow: any) {
    setCondFlowId(flow.id);
    const g = Array.isArray(flow.conditions) ? flow.conditions : [];
    setCondGroups(g.length ? g : [[{ field: "funnel_stage", op: "eq", value: "" }]]);
  }
  function saveConditions() {
    if (condFlowId == null) return;
    const clean = condGroups
      .map(group => group.filter(c => c.value.trim()))
      .filter(group => group.length > 0);
    updateMutation.mutate(
      { id: condFlowId, conditions: clean.length ? (clean as any) : null },
      { onSuccess: () => { setCondFlowId(null); toast.success("Condições salvas!"); } }
    );
  }

  // If editing a flow, show the editor
  if (editingFlowId !== null) {
    return (
      <FlowEditor
        flowId={editingFlowId}
        onBack={() => {
          setEditingFlowId(null);
          utils.flow.list.invalidate();
        }}
      />
    );
  }

  const flows = flowsQuery.data || [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" />
            Fluxos de Conversa
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Programe fluxos de atendimento com botões, listas e decisões automáticas
          </p>
        </div>
        <div className="flex gap-2">
        <Button variant="outline" onClick={() => {
          const num = prompt("Número do WhatsApp de PÓS-VENDA (com DDI, ex: 5551999998888). Deixe vazio se não quiser encaminhar pós-venda:");
          seedMasterMutation.mutate({ postSaleNumber: num?.replace(/\D/g, "") || undefined });
        }} disabled={seedMasterMutation.isPending}>
          <Zap className="h-4 w-4 mr-2" />
          {seedMasterMutation.isPending ? "Criando..." : "Gerar Fluxo-Mestre"}
        </Button>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo Fluxo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Novo Fluxo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome do Fluxo</Label>
                <Input
                  value={newFlow.name}
                  onChange={(e) => setNewFlow({ ...newFlow, name: e.target.value })}
                  placeholder="Ex: Boas-vindas, Financiamento, Troca..."
                />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea
                  value={newFlow.description}
                  onChange={(e) => setNewFlow({ ...newFlow, description: e.target.value })}
                  placeholder="Descreva o objetivo deste fluxo..."
                  rows={2}
                />
              </div>
              <div>
                <Label>Gatilho</Label>
                <Select value={newFlow.trigger} onValueChange={(v) => setNewFlow({ ...newFlow, trigger: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRIGGER_LABELS).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(newFlow.trigger === "keyword" || newFlow.trigger === "category_interest") && (
                <div>
                  <Label>{newFlow.trigger === "keyword" ? "Palavras-chave (separadas por vírgula)" : "Categoria"}</Label>
                  <Input
                    value={newFlow.triggerValue}
                    onChange={(e) => setNewFlow({ ...newFlow, triggerValue: e.target.value })}
                    placeholder={newFlow.trigger === "keyword" ? "financiar, financiamento, parcela" : "SUV, Sedan, Hatch"}
                  />
                </div>
              )}
              {(newFlow.trigger === "tag_added" || newFlow.trigger === "tag_removed") && (
                <div>
                  <Label>Etiqueta (deixe vazio = qualquer)</Label>
                  <Input
                    value={newFlow.triggerValue}
                    onChange={(e) => setNewFlow({ ...newFlow, triggerValue: e.target.value })}
                    placeholder="Ex: Lead quente, VIP (separe por vírgula)"
                  />
                  <p className="text-xs text-muted-foreground mt-1">O fluxo dispara quando essa etiqueta é {newFlow.trigger === "tag_added" ? "adicionada" : "removida"} na conversa.</p>
                </div>
              )}
              {newFlow.trigger === "funnel_stage_entered" && (
                <div>
                  <Label>Etapa do funil</Label>
                  <Select value={newFlow.triggerValue || ""} onValueChange={(v) => setNewFlow({ ...newFlow, triggerValue: v })}>
                    <SelectTrigger><SelectValue placeholder="Escolha a etapa..." /></SelectTrigger>
                    <SelectContent>
                      {FUNNEL_STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Dispara quando o lead entra nessa etapa do funil.</p>
                </div>
              )}
              <div>
                <Label>Aplicar em (Canal / Instância)</Label>
                <Select
                  value={newFlow.instanceName}
                  onValueChange={(v) => setNewFlow({ ...newFlow, instanceName: v })}
                >
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {connectionOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Escolha a conexão (Evolution, Zernio ou número oficial) ou mantenha Global.</p>
              </div>

              <Button
                className="w-full"
                onClick={() => {
                  const conn = parseInstanceValue(newFlow.instanceName);
                  createMutation.mutate({
                    name: newFlow.name,
                    description: newFlow.description,
                    trigger: newFlow.trigger as any,
                    triggerValue: newFlow.triggerValue || undefined,
                    connectionType: conn.connectionType || undefined,
                    instanceName: conn.instanceName || undefined,
                    connectionId: conn.connectionId || undefined,
                  });
                }}
                disabled={!newFlow.name || createMutation.isPending}
              >
                {createMutation.isPending ? "Criando..." : "Criar Fluxo"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Flow Cards */}
      {flows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhum fluxo criado</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              Crie fluxos de conversa para programar o atendimento automático com botões,
              listas de opções e decisões baseadas nas respostas do cliente.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeiro Fluxo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {flows.map((flow) => {
            const trigger = TRIGGER_LABELS[flow.trigger] || TRIGGER_LABELS.manual;
            const TriggerIcon = trigger.icon;
            return (
              <Card
                key={flow.id}
                className={`cursor-pointer hover:border-primary/50 transition-colors ${flow.active ? "border-green-500/30" : ""}`}
                onClick={() => setEditingFlowId(flow.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{flow.name}</CardTitle>
                      {flow.description && (
                        <CardDescription className="line-clamp-2 mt-1">{flow.description}</CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingFlowId(flow.id); }}>
                          <Edit3 className="h-4 w-4 mr-2" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          updateMutation.mutate({ id: flow.id, active: !flow.active });
                        }}>
                          {flow.active ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                          {flow.active ? "Desativar" : "Ativar"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate({ id: flow.id }); }}>
                          <Copy className="h-4 w-4 mr-2" /> Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openConditions(flow); }}>
                          <Filter className="h-4 w-4 mr-2" /> Condições (Somente se)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Excluir este fluxo?")) deleteMutation.mutate({ id: flow.id });
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={trigger.color}>
                      <TriggerIcon className="h-3 w-3 mr-1" />
                      {trigger.label}
                    </Badge>
                    {flow.triggerValue && (
                      <Badge variant="secondary" className="text-xs">{flow.triggerValue}</Badge>
                    )}
                    <Badge variant={flow.active ? "default" : "secondary"} className="ml-auto">
                      {flow.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span>{flow.nodeCount} nós</span>
                    <span>{flow.sessionCount} execuções</span>
                    {flow.activeSessionCount > 0 && (
                      <span className="text-green-500">{flow.activeSessionCount} ativas</span>
                    )}
                  </div>
                  {/* Vínculo com instância (fallback: global) */}
                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Aplicar em</label>
                    <Select
                      value={flowToInstanceValue(flow)}
                      onValueChange={(v) => {
                        const conn = parseInstanceValue(v);
                        updateMutation.mutate({ id: flow.id, connectionType: conn.connectionType, instanceName: conn.instanceName, connectionId: conn.connectionId });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {connectionOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={(e) => { e.stopPropagation(); setEditingFlowId(flow.id); }}
                    >
                      <Edit3 className="h-3 w-3 mr-1" />
                      Editar Fluxo
                    </Button>
                    <Button
                      size="sm"
                      variant={flow.active ? "destructive" : "default"}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateMutation.mutate({ id: flow.id, active: !flow.active });
                      }}
                    >
                      {flow.active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Diálogo de Condições "Somente se" (grupos E/OU) */}
      <Dialog open={condFlowId !== null} onOpenChange={(o) => !o && setCondFlowId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Condições — Somente se</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            O fluxo só dispara se as condições baterem. Dentro de um grupo, <b>todas</b> precisam valer (E).
            Entre grupos, basta <b>um</b> grupo valer (OU). Sem condições, dispara sempre.
          </p>
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {condGroups.map((group, gi) => (
              <div key={gi} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Grupo {gi + 1}</span>
                  {condGroups.length > 1 && (
                    <button className="text-muted-foreground hover:text-destructive" onClick={() => setCondGroups(condGroups.filter((_, i) => i !== gi))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {group.map((cond, ci) => (
                  <div key={ci} className="flex items-center gap-1.5">
                    <Select value={cond.field} onValueChange={(v) => {
                      const next = [...condGroups]; next[gi] = [...group]; next[gi][ci] = { ...cond, field: v }; setCondGroups(next);
                    }}>
                      <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="funnel_stage">Etapa do funil</SelectItem>
                        <SelectItem value="temperature">Temperatura</SelectItem>
                        <SelectItem value="channel">Canal</SelectItem>
                        <SelectItem value="tag">Tem etiqueta</SelectItem>
                        <SelectItem value="quality">Qualidade</SelectItem>
                        <SelectItem value="payment">Forma de pagamento</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={cond.op} onValueChange={(v) => {
                      const next = [...condGroups]; next[gi] = [...group]; next[gi][ci] = { ...cond, op: v }; setCondGroups(next);
                    }}>
                      <SelectTrigger className="h-8 text-xs w-16"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eq">é</SelectItem>
                        <SelectItem value="neq">não é</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      className="h-8 text-xs flex-1"
                      value={cond.value}
                      placeholder={cond.field === "funnel_stage" ? "negociando" : cond.field === "temperature" ? "quente" : cond.field === "channel" ? "evolution" : cond.field === "tag" ? "Lead quente" : "valor"}
                      onChange={(e) => { const next = [...condGroups]; next[gi] = [...group]; next[gi][ci] = { ...cond, value: e.target.value }; setCondGroups(next); }}
                    />
                    <button className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => {
                      const next = [...condGroups]; next[gi] = group.filter((_, i) => i !== ci);
                      if (next[gi].length === 0) next.splice(gi, 1);
                      setCondGroups(next.length ? next : []);
                    }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="h-7 text-xs w-full" onClick={() => {
                  const next = [...condGroups]; next[gi] = [...group, { field: "funnel_stage", op: "eq", value: "" }]; setCondGroups(next);
                }}>
                  <Plus className="h-3 w-3 mr-1" /> E condição
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setCondGroups([...condGroups, [{ field: "funnel_stage", op: "eq", value: "" }]])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> OU novo grupo
            </Button>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCondFlowId(null)}>Cancelar</Button>
            <Button onClick={saveConditions} disabled={updateMutation.isPending}>Salvar condições</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
