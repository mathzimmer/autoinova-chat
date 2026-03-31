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
  MoreVertical, LifeBuoy
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
};

export default function Flows() {
  const [editingFlowId, setEditingFlowId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFlow, setNewFlow] = useState({
    name: "",
    description: "",
    trigger: "first_contact" as string,
    triggerValue: "",
  });

  const utils = trpc.useUtils();
  const flowsQuery = trpc.flow.list.useQuery();
  const createMutation = trpc.flow.create.useMutation({
    onSuccess: () => {
      utils.flow.list.invalidate();
      setCreateOpen(false);
      setNewFlow({ name: "", description: "", trigger: "first_contact", triggerValue: "" });
      toast.success("Fluxo criado com sucesso!");
    },
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
  const duplicateMutation = trpc.flow.duplicate.useMutation({
    onSuccess: () => {
      utils.flow.list.invalidate();
      toast.success("Fluxo duplicado!");
    },
  });

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
              <Button
                className="w-full"
                onClick={() => createMutation.mutate({
                  name: newFlow.name,
                  description: newFlow.description,
                  trigger: newFlow.trigger as any,
                  triggerValue: newFlow.triggerValue || undefined,
                })}
                disabled={!newFlow.name || createMutation.isPending}
              >
                {createMutation.isPending ? "Criando..." : "Criar Fluxo"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
    </div>
  );
}
