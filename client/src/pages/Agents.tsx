import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Bot, Plus, Pencil, Trash2, Power, PowerOff, Copy,
  Wrench, MessageSquare, Search, Zap, ListChecks,
  Hash, ChevronRight, AlertTriangle, Image,
} from "lucide-react";

const MODEL_OPTIONS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini", description: "Rápido e econômico" },
  { value: "gpt-4o", label: "GPT-4o", description: "Mais inteligente, mais caro" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo", description: "Equilibrado" },
];

const TOOL_ICONS: Record<string, React.ReactNode> = {
  buscar_veiculos: <Search className="h-4 w-4" />,
  resumo_estoque: <ListChecks className="h-4 w-4" />,
  atualizar_lead: <Zap className="h-4 w-4" />,
  buscar_veiculo_por_id: <Hash className="h-4 w-4" />,
  apresentar_veiculo: <Image className="h-4 w-4" />,
  enviar_botoes: <MessageSquare className="h-4 w-4" />,
  enviar_lista: <ListChecks className="h-4 w-4" />,
};

interface AgentFormData {
  name: string;
  description: string;
  systemPrompt: string;
  includeCoreLayers: boolean;
  model: string;
  temperature: string;
  maxTokens: number;
  enabledTools: string[];
  active: boolean;
}

const defaultFormData: AgentFormData = {
  name: "",
  description: "",
  systemPrompt: "",
  includeCoreLayers: true,
  model: "gpt-4o-mini",
  temperature: "0.7",
  maxTokens: 1024,
  enabledTools: [],
  active: true,
};

export default function Agents() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<AgentFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const agentsQuery = trpc.agent.list.useQuery();
  const toolsQuery = trpc.agent.availableTools.useQuery();
  const channelAgentsQuery = trpc.agent.getChannelAgents.useQuery();
  const defaultAgentQuery = trpc.agent.getDefaultAgent.useQuery();
  const instanceAgentsQuery = trpc.agent.getInstanceAgents.useQuery();
  const instancesQuery = trpc.evolution.listInstances.useQuery();

  const seedMutation = trpc.agent.seedTemplates.useMutation({
    onSuccess: (res) => {
      if (res.count > 0) toast.success(`Agentes criados: ${res.created.join(", ")}`);
      else toast.info("Os agentes-template já existem.");
      agentsQuery.refetch();
      defaultAgentQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const setDefaultMutation = trpc.agent.setDefaultAgent.useMutation({
    onSuccess: () => { toast.success("Agente padrão definido"); defaultAgentQuery.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const setInstanceMutation = trpc.agent.setInstanceAgent.useMutation({
    onSuccess: () => { toast.success("Agente da instância atualizado"); instanceAgentsQuery.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const createMutation = trpc.agent.create.useMutation({
    onSuccess: () => {
      toast.success("Agente criado com sucesso");
      agentsQuery.refetch();
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (err) => toast.error("Erro ao criar agente: " + err.message),
  });

  const updateMutation = trpc.agent.update.useMutation({
    onSuccess: () => {
      toast.success("Agente atualizado com sucesso");
      agentsQuery.refetch();
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (err) => toast.error("Erro ao atualizar agente: " + err.message),
  });

  const deleteMutation = trpc.agent.delete.useMutation({
    onSuccess: () => {
      toast.success("Agente excluído");
      agentsQuery.refetch();
      channelAgentsQuery.refetch();
      setDeleteConfirmId(null);
    },
    onError: (err) => toast.error("Erro ao excluir agente: " + err.message),
  });

  const setChannelMutation = trpc.agent.setChannelAgent.useMutation({
    onSuccess: () => {
      toast.success("Canal atualizado");
      channelAgentsQuery.refetch();
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });

  const agents = agentsQuery.data || [];
  const tools = toolsQuery.data || [];
  const channelAgents = channelAgentsQuery.data;

  const activeAgents = useMemo(() => agents.filter(a => a.active), [agents]);

  function resetForm() {
    setFormData(defaultFormData);
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setIsDialogOpen(true);
  }

  function openEdit(agent: any) {
    setEditingId(agent.id);
    setFormData({
      name: agent.name,
      description: agent.description || "",
      systemPrompt: agent.systemPrompt,
      includeCoreLayers: agent.includeCoreLayers,
      model: agent.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      enabledTools: agent.enabledTools || [],
      active: agent.active,
    });
    setIsDialogOpen(true);
  }

  function handleSave() {
    if (!formData.name.trim()) {
      toast.error("Nome do agente é obrigatório");
      return;
    }
    if (!formData.systemPrompt.trim()) {
      toast.error("Prompt do agente é obrigatório");
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  function toggleTool(toolId: string) {
    setFormData(prev => ({
      ...prev,
      enabledTools: prev.enabledTools.includes(toolId)
        ? prev.enabledTools.filter(t => t !== toolId)
        : [...prev.enabledTools, toolId],
    }));
  }

  function duplicateAgent(agent: any) {
    setEditingId(null);
    setFormData({
      name: `${agent.name} (cópia)`,
      description: agent.description || "",
      systemPrompt: agent.systemPrompt,
      includeCoreLayers: agent.includeCoreLayers,
      model: agent.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      enabledTools: agent.enabledTools || [],
      active: false,
    });
    setIsDialogOpen(true);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="h-7 w-7 text-primary" />
            Agentes de IA
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Crie e gerencie agentes com prompts, tools e modelos específicos para cada situação.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} className="gap-2">
            <Zap className="h-4 w-4" />
            Criar agentes prontos
          </Button>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Agente
          </Button>
        </div>
      </div>

      {/* Agente Geral (modo livre — 3 camadas) */}
      <GeneralAgentCard toolsQuery={toolsQuery} />

      {/* Como funciona — hierarquia */}
      <Card className="mb-6 bg-primary/5 border-primary/20">
        <CardContent className="pt-4 pb-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Como a IA escolhe o agente (do mais específico ao geral):</p>
          <p>1. Agente <b>fixado na conversa</b> (você escolhe no painel do chat) → 2. Agente do <b>fluxo</b> ativo → 3. Agente da <b>instância</b> → 4. Agente do <b>canal</b> → 5. Agente <b>padrão da loja</b>.</p>
          <p className="mt-1">Clique em <b>"Criar agentes prontos"</b> para gerar Recepção (herda sua IA atual), Financeiro e Pós-venda.</p>
        </CardContent>
      </Card>

      {/* Agente padrão da loja */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agente Padrão da Loja</CardTitle>
          <CardDescription>Responde quando nenhum agente mais específico se aplica.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={defaultAgentQuery.data ? String(defaultAgentQuery.data) : "none"}
            onValueChange={(v) => setDefaultMutation.mutate({ agentId: v === "none" ? null : parseInt(v, 10) })}
          >
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Selecione o agente padrão" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum (usa prompts globais atuais)</SelectItem>
              {activeAgents.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Agente por instância WhatsApp */}
      {(instancesQuery.data || []).length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agente por Número (Instância)</CardTitle>
            <CardDescription>Cada número WhatsApp pode ter seu próprio agente — ex.: um número só de pós-venda.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(instancesQuery.data || []).map((inst: any) => (
                <div key={inst.id} className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-emerald-500" />
                    {inst.displayName || inst.instanceName}
                  </Label>
                  <Select
                    value={instanceAgentsQuery.data?.[inst.instanceName] ? String(instanceAgentsQuery.data[inst.instanceName]) : "none"}
                    onValueChange={(v) => setInstanceMutation.mutate({ instanceName: inst.instanceName, agentId: v === "none" ? null : parseInt(v, 10) })}
                  >
                    <SelectTrigger><SelectValue placeholder="Usa o agente padrão" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Usa o agente padrão</SelectItem>
                      {activeAgents.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Channel Agent Assignment */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agente por Canal</CardTitle>
          <CardDescription>
            Selecione qual agente responde em cada canal quando não há fluxo ativo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-emerald-500" />
                WhatsApp
              </Label>
              <Select
                value={channelAgents?.whatsapp ? String(channelAgents.whatsapp) : "none"}
                onValueChange={(v) => setChannelMutation.mutate({
                  channel: "whatsapp",
                  agentId: v === "none" ? null : parseInt(v, 10),
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um agente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum (usa prompts globais)</SelectItem>
                  {activeAgents.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-pink-500" />
                Instagram
              </Label>
              <Select
                value={channelAgents?.instagram ? String(channelAgents.instagram) : "none"}
                onValueChange={(v) => setChannelMutation.mutate({
                  channel: "instagram",
                  agentId: v === "none" ? null : parseInt(v, 10),
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um agente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum (usa prompts globais)</SelectItem>
                  {activeAgents.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agents Grid */}
      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bot className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-1">Nenhum agente criado</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
              Crie agentes de IA com prompts e ferramentas específicas para cada situação de atendimento.
            </p>
            <Button onClick={openCreate} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Criar primeiro agente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Card
              key={agent.id}
              className={`relative transition-all hover:shadow-md ${
                !agent.active ? "opacity-60" : ""
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                      agent.active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{agent.name}</CardTitle>
                      <CardDescription className="text-xs truncate">
                        {agent.description || "Sem descrição"}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant={agent.active ? "default" : "secondary"} className="shrink-0 text-[10px]">
                    {agent.active ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {/* Model & Config */}
                <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {agent.model}
                  </Badge>
                  <span>T: {agent.temperature}</span>
                  <span>{agent.maxTokens} tokens</span>
                </div>

                {/* Enabled Tools */}
                <div className="mb-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Ferramentas:</p>
                  <div className="flex flex-wrap gap-1">
                    {(agent.enabledTools as string[] || []).length === 0 ? (
                      <span className="text-xs text-muted-foreground/60 italic">Todas habilitadas</span>
                    ) : (
                      (agent.enabledTools as string[]).map(toolId => (
                        <Badge key={toolId} variant="outline" className="text-[10px] gap-1 py-0.5">
                          {TOOL_ICONS[toolId] || <Wrench className="h-3 w-3" />}
                          {toolId.replace(/_/g, " ")}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                {/* Core layers indicator */}
                <div className="flex items-center gap-1.5 mb-3 text-xs">
                  {agent.includeCoreLayers ? (
                    <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30 bg-emerald-500/5">
                      Core + Comercial inclusos
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30 bg-amber-500/5">
                      Prompt independente
                    </Badge>
                  )}
                </div>

                {/* Prompt preview */}
                <div className="bg-muted/50 rounded-md p-2 mb-3">
                  <p className="text-xs text-muted-foreground line-clamp-3 font-mono">
                    {agent.systemPrompt.substring(0, 200)}
                    {agent.systemPrompt.length > 200 ? "..." : ""}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1" onClick={() => openEdit(agent)}>
                    <Pencil className="h-3 w-3" />
                    Editar
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => duplicateAgent(agent)}>
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => updateMutation.mutate({ id: agent.id, active: !agent.active })}
                  >
                    {agent.active ? <PowerOff className="h-3 w-3 text-red-400" /> : <Power className="h-3 w-3 text-emerald-400" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirmId(agent.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) { resetForm(); } setIsDialogOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              {editingId ? "Editar Agente" : "Novo Agente"}
            </DialogTitle>
            <DialogDescription>
              Configure o comportamento, prompt e ferramentas deste agente de IA.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Nome do Agente</Label>
                <Input
                  id="agent-name"
                  placeholder="Ex: Vendedor de Hatch"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-desc">Descrição</Label>
                <Input
                  id="agent-desc"
                  placeholder="Ex: Especialista em carros compactos"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>

            <Separator />

            {/* Prompt */}
            <div className="space-y-2">
              <Label htmlFor="agent-prompt" className="flex items-center justify-between">
                <span>Prompt do Sistema</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {formData.systemPrompt.length} caracteres
                </span>
              </Label>
              <Textarea
                id="agent-prompt"
                placeholder="Você é um assistente de vendas especializado em..."
                value={formData.systemPrompt}
                onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                className="min-h-[200px] font-mono text-sm"
              />
              <div className="mt-2 rounded-md border border-border bg-muted/40 p-2.5">
                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                  Variáveis (substituídas automaticamente na conversa) — clique para inserir:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "{{cliente_nome}}",
                    "{{cliente_telefone}}",
                    "{{vendedor_nome}}",
                    "{{loja_nome}}",
                    "{{loja_endereco}}",
                    "{{horario_funcionamento}}",
                  ].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, systemPrompt: `${prev.systemPrompt}${v}` }))}
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Core Layers Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Incluir camadas Core + Comercial</Label>
                <p className="text-xs text-muted-foreground">
                  Inclui regras de formato WhatsApp, motor comercial e etapas de venda automaticamente.
                </p>
              </div>
              <Switch
                checked={formData.includeCoreLayers}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, includeCoreLayers: checked }))}
              />
            </div>

            <Separator />

            {/* Model Config */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                Configuração do Modelo
              </h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Modelo</Label>
                  <Select
                    value={formData.model}
                    onValueChange={(v) => setFormData(prev => ({ ...prev, model: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_OPTIONS.map(m => (
                        <SelectItem key={m.value} value={m.value}>
                          <div>
                            <span className="font-medium">{m.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">{m.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Temperatura: {formData.temperature}</Label>
                  <Slider
                    value={[parseFloat(formData.temperature)]}
                    onValueChange={([v]) => setFormData(prev => ({ ...prev, temperature: v.toFixed(1) }))}
                    min={0}
                    max={1}
                    step={0.1}
                    className="mt-2"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    0 = preciso, 1 = criativo
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Max Tokens</Label>
                  <Input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) => setFormData(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 1024 }))}
                    min={256}
                    max={4096}
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Tools Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Ferramentas Habilitadas
                </h4>
                <p className="text-xs text-muted-foreground">
                  {formData.enabledTools.length === 0
                    ? "Todas habilitadas (padrão)"
                    : `${formData.enabledTools.length} selecionadas`}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Selecione quais ferramentas este agente pode usar. Se nenhuma for selecionada, todas ficam disponíveis.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {tools.map(tool => (
                  <label
                    key={tool.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      formData.enabledTools.includes(tool.id)
                        ? "border-primary/50 bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <Checkbox
                      checked={formData.enabledTools.includes(tool.id)}
                      onCheckedChange={() => toggleTool(tool.id)}
                    />
                    <div className="flex items-center gap-2 flex-1">
                      {TOOL_ICONS[tool.id] || <Wrench className="h-4 w-4" />}
                      <div>
                        <span className="text-sm font-medium">{tool.name}</span>
                        <p className="text-xs text-muted-foreground">{tool.description}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Agente Ativo</Label>
                <p className="text-xs text-muted-foreground">
                  Agentes inativos não são usados em nenhum fluxo ou canal.
                </p>
              </div>
              <Switch
                checked={formData.active}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, active: checked }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Salvando..." : editingId ? "Salvar" : "Criar Agente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Excluir Agente
            </DialogTitle>
            <DialogDescription>
              Tem certeza? O agente será removido de todos os fluxos e canais onde está vinculado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate({ id: deleteConfirmId })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Card do Agente Geral (modo livre — 3 camadas + ferramentas) ─────────────
function GeneralAgentCard({ toolsQuery }: { toolsQuery: any }) {
  const utils = trpc.useUtils();
  const promptQuery = trpc.settings.getPrompt.useQuery();
  const freeCfgQuery = trpc.settings.getFreeAgentConfig.useQuery();
  const [core, setCore] = useState("");
  const [commercial, setCommercial] = useState("");
  const [personality, setPersonality] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [layer, setLayer] = useState<"personality" | "commercial" | "core">("personality");

  useEffect(() => {
    if (promptQuery.data) {
      setCore(promptQuery.data.corePrompt || "");
      setCommercial(promptQuery.data.commercialPrompt || "");
      setPersonality(promptQuery.data.personalityPrompt || "");
    }
  }, [promptQuery.data]);
  useEffect(() => { if ((freeCfgQuery as any).data) setTools((freeCfgQuery as any).data.enabledTools || []); }, [(freeCfgQuery as any).data]);

  const savePrompt = trpc.settings.savePrompt.useMutation({
    onSuccess: () => { toast.success("Prompt salvo"); utils.settings.getPrompt.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const saveFreeCfg = trpc.settings.saveFreeAgentConfig.useMutation({
    onSuccess: () => toast.success("Ferramentas do Agente Geral salvas"),
    onError: (e: any) => toast.error(e.message),
  });

  const allTools = (toolsQuery?.data as any[]) || [];
  const layers = {
    core: { label: "🛡 Núcleo (regras invioláveis)", value: core, set: setCore, hint: "Formato, proibições, limpeza. Raramente mexer." },
    commercial: { label: "💼 Comercial (motor de vendas)", value: commercial, set: setCommercial, hint: "Como conduzir a venda, quando oferecer." },
    personality: { label: "😊 Personalidade (tom da loja)", value: personality, set: setPersonality, hint: "Jeito de falar, saudação, estilo." },
  } as const;
  const cur = layers[layer];

  return (
    <Card className="mb-6 border-emerald-500/30">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4 text-emerald-500" />
          Agente Geral (responde quando nenhum outro está ativo)
          <span className="ml-auto text-xs text-muted-foreground">{open ? "▲ fechar" : "▼ configurar"}</span>
        </CardTitle>
        <CardDescription>Este é o cérebro padrão da IA — 3 camadas de prompt + ferramentas. Antes ficava em Configurações.</CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {/* Seletor de camada */}
          <div className="flex gap-1">
            {(Object.keys(layers) as (keyof typeof layers)[]).map(k => (
              <button key={k} onClick={() => setLayer(k)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium ${layer === k ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                {layers[k].label.split(" ")[0]} {k === "core" ? "Núcleo" : k === "commercial" ? "Comercial" : "Personalidade"}
              </button>
            ))}
          </div>
          <div>
            <Label className="text-xs">{cur.label}</Label>
            <p className="text-[10px] text-muted-foreground mb-1">{cur.hint}</p>
            <Textarea value={cur.value} onChange={e => cur.set(e.target.value)} className="min-h-[200px] text-sm font-mono" />
            <Button size="sm" className="mt-2" disabled={savePrompt.isPending}
              onClick={() => savePrompt.mutate({ layer, prompt: cur.value })}>
              Salvar {layer === "core" ? "Núcleo" : layer === "commercial" ? "Comercial" : "Personalidade"}
            </Button>
          </div>

          {/* Ferramentas do modo livre */}
          <div className="border-t pt-3">
            <Label className="text-xs">Ferramentas disponíveis para o Agente Geral</Label>
            <p className="text-[10px] text-muted-foreground mb-2">Vazio = todas. Marque para restringir.</p>
            <div className="grid grid-cols-2 gap-1.5">
              {allTools.map((t: any) => {
                const name = t.name || t.function?.name || t;
                const checked = tools.includes(name);
                return (
                  <label key={name} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" className="accent-primary" checked={checked}
                      onChange={() => setTools(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])} />
                    {name}
                  </label>
                );
              })}
            </div>
            <Button size="sm" variant="outline" className="mt-2" disabled={saveFreeCfg.isPending}
              onClick={() => saveFreeCfg.mutate({ enabledTools: tools })}>
              Salvar ferramentas
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
