import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Connection,
  Node,
  Edge,
  Handle,
  Position,
  NodeProps,
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  ArrowLeft, Save, Plus, Trash2, X, Copy, Settings2,
  MessageSquare, MousePointerClick, List, Image, GitBranch,
  Bot, UserCheck, Clock, Square, Play, MessageCircle,
  ChevronDown, GripVertical, Cpu, UserPlus, Camera, Car,
  Thermometer,
} from "lucide-react";
// ─── Funnel Status Labels ─────────────────────────────────────
const FUNNEL_STATUS_LABELS: Record<string, string> = {
  novo: "❄️ Novo",
  interesse_definido: "🌤️ Interesse Definido",
  pagamento_definido: "💳 Pagamento Definido",
  dados_pessoais: "📝 Dados Pessoais",
  dados_troca: "🚗 Dados de Troca",
  encaminhado_vendedor: "👤 Encaminhado ao Vendedor",
  negociando: "🤝 Negociando",
  fechado: "✅ Fechado",
  perdido: "❌ Perdido",
};

const TEMPERATURE_LABELS: Record<string, { label: string; color: string }> = {
  frio: { label: "❄️ Frio", color: "text-blue-400" },
  morno: { label: "🌤️ Morno", color: "text-yellow-400" },
  quente: { label: "🔥 Quente", color: "text-orange-400" },
  muito_quente: { label: "🔥🔥 Muito Quente", color: "text-red-400" },
};

// ─── Node Type Definitions ───────────────────────────────────────
const NODE_TYPES_CONFIG: Record<string, {
  label: string;
  icon: typeof MessageSquare;
  color: string;
  bgColor: string;
  description: string;
}> = {
  start: { label: "Início", icon: Play, color: "text-green-400", bgColor: "border-green-500/50 bg-green-500/5", description: "Ponto de entrada do fluxo" },
  send_message: { label: "Mensagem", icon: MessageSquare, color: "text-blue-400", bgColor: "border-blue-500/50 bg-blue-500/5", description: "Enviar mensagem de texto" },
  send_buttons: { label: "Botões", icon: MousePointerClick, color: "text-purple-400", bgColor: "border-purple-500/50 bg-purple-500/5", description: "Reply Buttons (até 3)" },
  send_list: { label: "Lista", icon: List, color: "text-cyan-400", bgColor: "border-cyan-500/50 bg-cyan-500/5", description: "List Message (até 10 itens)" },
  send_image: { label: "Imagem", icon: Image, color: "text-pink-400", bgColor: "border-pink-500/50 bg-pink-500/5", description: "Enviar imagem" },
  condition: { label: "Condição", icon: GitBranch, color: "text-yellow-400", bgColor: "border-yellow-500/50 bg-yellow-500/5", description: "If/Else baseado em dados" },
  ai_response: { label: "IA Livre", icon: Bot, color: "text-emerald-400", bgColor: "border-emerald-500/50 bg-emerald-500/5", description: "Deixar IA responder" },
  update_lead: { label: "Atualizar Lead", icon: UserCheck, color: "text-orange-400", bgColor: "border-orange-500/50 bg-orange-500/5", description: "Atualizar dados do lead" },
  assign_agent: { label: "Transferir", icon: UserCheck, color: "text-red-400", bgColor: "border-red-500/50 bg-red-500/5", description: "Transferir para humano" },
  delay: { label: "Delay", icon: Clock, color: "text-gray-400", bgColor: "border-gray-500/50 bg-gray-500/5", description: "Aguardar X segundos" },
  wait_input: { label: "Aguardar Resposta", icon: MessageCircle, color: "text-teal-400", bgColor: "border-teal-500/50 bg-teal-500/5", description: "Aguardar texto livre do cliente" },
  end: { label: "Fim", icon: Square, color: "text-red-400", bgColor: "border-red-500/50 bg-red-500/5", description: "Encerrar fluxo" },
  goto_flow: { label: "Ir para Fluxo", icon: GitBranch, color: "text-amber-400", bgColor: "border-amber-500/50 bg-amber-500/5", description: "Redirecionar para outro fluxo" },
  assign_seller: { label: "Falar c/ Vendedor", icon: UserPlus, color: "text-lime-400", bgColor: "border-lime-500/50 bg-lime-500/5", description: "Atribuir vendedor da fila (rodízio)" },
  send_vehicle_photos: { label: "Fotos do Veículo", icon: Camera, color: "text-rose-400", bgColor: "border-rose-500/50 bg-rose-500/5", description: "Enviar fotos do veículo com legendas" },
  vehicle_presentation: { label: "Apresentar Veículo", icon: Car, color: "text-indigo-400", bgColor: "border-indigo-500/50 bg-indigo-500/5", description: "Apresentação personalizada do veículo" },
  update_lead_status: { label: "Status do Lead", icon: Thermometer, color: "text-amber-400", bgColor: "border-amber-500/50 bg-amber-500/5", description: "Atualizar etapa do funil e temperatura" },
};

// ─── Custom Node Component ───────────────────────────────────
function FlowNode({ data, selected, id }: NodeProps) {
  const config = NODE_TYPES_CONFIG[data.nodeType as string] || NODE_TYPES_CONFIG.send_message;
  const Icon = config.icon;
  const nodeType = data.nodeType as string;

  // Determine output handles based on node type
  const getOutputHandles = () => {
    if (nodeType === "end" || nodeType === "goto_flow" || nodeType === "assign_seller") return [];
    if (nodeType === "send_buttons") {
      const buttons = ((data.config as any)?.buttons || []) as Array<{ text: string }>;
      if (buttons.length === 0) return [{ id: "default", label: "Próximo" }];
      return buttons.map((b: { text: string }, i: number) => ({ id: `button_${i}`, label: b.text || `Botão ${i + 1}` }));
    }
    if (nodeType === "send_list") {
      const rows = ((data.config as any)?.sections || []).flatMap((s: any) => s.rows || []) as Array<{ title: string }>;
      if (rows.length === 0) return [{ id: "default", label: "Próximo" }];
      return rows.map((r: { title: string }, i: number) => ({ id: `row_${i}`, label: r.title || `Item ${i + 1}` }));
    }
    if (nodeType === "condition") {
      return [
        { id: "yes", label: "Sim ✓" },
        { id: "no", label: "Não ✗" },
      ];
    }
    return [{ id: "default", label: "" }];
  };

  const outputs = getOutputHandles();

  return (
    <div className={`rounded-lg border-2 ${config.bgColor} ${selected ? "ring-2 ring-primary" : ""} min-w-[200px] max-w-[280px] shadow-lg`}>
      {/* Input handle (not for start) */}
      {nodeType !== "start" && (
        <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-primary !border-2 !border-background" />
      )}

      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border/50">
        <Icon className={`h-4 w-4 ${config.color} shrink-0`} />
        <span className="text-xs font-semibold text-foreground truncate">{data.label as string || config.label}</span>
      </div>

      {/* Content preview */}
      <div className="px-3 py-2">
        {nodeType === "send_message" && (
          <p className="text-xs text-muted-foreground line-clamp-3">{(data.config as any)?.text || "Configurar mensagem..."}</p>
        )}
        {nodeType === "send_buttons" && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground line-clamp-2">{(data.config as any)?.body || "Texto..."}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {((data.config as any)?.buttons || []).map((b: any, i: number) => (
                <Badge key={i} variant="outline" className="text-[10px] py-0">{b.text || `Botão ${i + 1}`}</Badge>
              ))}
            </div>
          </div>
        )}
        {nodeType === "send_list" && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{(data.config as any)?.body || "Texto..."}</p>
            <Badge variant="outline" className="text-[10px]">
              {((data.config as any)?.sections || []).reduce((acc: number, s: any) => acc + (s.rows?.length || 0), 0)} itens
            </Badge>
          </div>
        )}
        {nodeType === "condition" && (
          <p className="text-xs text-muted-foreground">
            {(data.config as any)?.field || "campo"} {(data.config as any)?.operator || "="} {(data.config as any)?.value || "valor"}
          </p>
        )}
        {nodeType === "delay" && (
          <p className="text-xs text-muted-foreground">{(data.config as any)?.seconds || 0}s de espera</p>
        )}
        {nodeType === "ai_response" && (
          <div>
            {(data.config as any)?.agentName && (
              <p className="text-[10px] font-medium text-primary">{(data.config as any).agentName}</p>
            )}
            <p className="text-xs text-muted-foreground">{(data.config as any)?.instruction || "IA responde livremente"}</p>
          </div>
        )}
        {nodeType === "update_lead" && (
          <p className="text-xs text-muted-foreground">
            {(data.config as any)?.field || "campo"} → {(data.config as any)?.value || "valor"}
          </p>
        )}
        {nodeType === "start" && (
          <p className="text-xs text-muted-foreground">Início do fluxo</p>
        )}
        {nodeType === "end" && (
          <p className="text-xs text-muted-foreground">Fim do fluxo</p>
        )}
        {nodeType === "assign_agent" && (
          <p className="text-xs text-muted-foreground">Transferir para agente humano</p>
        )}
        {nodeType === "send_image" && (
          <p className="text-xs text-muted-foreground">{(data.config as any)?.caption || "Imagem"}</p>
        )}
        {nodeType === "goto_flow" && (
          <p className="text-xs text-muted-foreground">
            {(data.config as any)?.targetFlowName || "Selecionar fluxo destino..."}
          </p>
        )}
        {nodeType === "assign_seller" && (
          <p className="text-xs text-muted-foreground">
            {(data.config as any)?.storeLocation === "auto"
              ? "Detectar loja automaticamente"
              : (data.config as any)?.storeLocation || "Fila de vendedores"}
          </p>
        )}
        {nodeType === "send_vehicle_photos" && (
          <p className="text-xs text-muted-foreground">
            {(data.config as any)?.photoSlots?.length
              ? `${(data.config as any).photoSlots.length} foto(s) configurada(s)`
              : "Configurar fotos e legendas..."}
          </p>
        )}
        {nodeType === "vehicle_presentation" && (
          <p className="text-xs text-muted-foreground">
            {(data.config as any)?.message
              ? `Mensagem + ${(data.config as any)?.photoSlots?.length || 0} foto(s)`
              : "Configurar apresentação..."}
          </p>
        )}
        {nodeType === "update_lead_status" && (
          <p className="text-xs text-muted-foreground">
            {(data.config as any)?.funnelStatus
              ? `Funil: ${FUNNEL_STATUS_LABELS[(data.config as any).funnelStatus] || (data.config as any).funnelStatus}`
              : "Configurar status..."}
          </p>
        )}
      </div>

      {/* Output handles */}
      {outputs.length === 1 && outputs[0].id === "default" ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id="default"
          className="!w-3 !h-3 !bg-primary !border-2 !border-background"
        />
      ) : outputs.length > 0 ? (
        <div className="border-t border-border/50 px-2 py-1.5 space-y-1">
          {outputs.map((out, i) => (
            <div key={out.id} className="relative flex items-center justify-end pr-2">
              <span className="text-[10px] text-muted-foreground mr-1 truncate max-w-[180px]">{out.label}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={out.id}
                style={{ top: "auto", position: "relative", transform: "none" }}
                className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background !relative !right-0 !top-0 !transform-none"
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Node Agent Selector (for ai_response nodes) ──────────────────
function NodeAgentSelector({ config, updateConfig, node, onUpdate }: { config: any; updateConfig: (key: string, value: any) => void; node: Node; onUpdate: (id: string, data: any) => void }) {
  const activeAgentsQuery = trpc.agent.listActive.useQuery();
  const activeAgents = activeAgentsQuery.data || [];

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Cpu className="h-3 w-3 text-primary" />
          Agente de IA
        </Label>
        <Select
          value={config.agentId ? String(config.agentId) : "none"}
          onValueChange={(v) => {
            if (v === "none") {
              // Use a single atomic update to avoid race condition where second call overwrites first
              onUpdate(node.id, {
                ...node.data,
                config: { ...config, agentId: null, agentName: null },
              });
            } else {
              const id = parseInt(v, 10);
              const agent = activeAgents.find(a => a.id === id);
              onUpdate(node.id, {
                ...node.data,
                config: { ...config, agentId: id, agentName: agent?.name || null },
              });
            }
          }}
        >
          <SelectTrigger className="h-8 text-sm mt-1">
            <SelectValue placeholder="Selecione um agente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nenhum (usa agente do fluxo/canal)</SelectItem>
            {activeAgents.map(a => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {config.agentId
            ? "Este nó usará o agente selecionado com seu prompt e tools"
            : "Sem agente: usará o agente do fluxo ou do canal como fallback"}
        </p>
      </div>
      <div>
        <Label className="text-xs">Instrução adicional (opcional)</Label>
        <Textarea
          value={config.instruction || ""}
          onChange={(e) => updateConfig("instruction", e.target.value)}
          placeholder="Ex: Apresente os veículos encontrados e pergunte sobre troca..."
          rows={3}
          className="text-sm"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Instrução específica para este momento do fluxo (complementa o prompt do agente)
        </p>
      </div>
    </div>
  );
}

// ─── Properties Panel ────────────────────────────────────────────────────
function PropertiesPanel({
  node,
  onUpdate,
  onDelete,
  onDuplicate,
  onClose,
}: {
  node: Node;
  onUpdate: (id: string, data: any) => void;
  onDelete: (id: string) => void;
  onDuplicate: (node: Node) => void;
  onClose: () => void;
}) {
  const nodeType = node.data.nodeType as string;
  const config = node.data.config as any || {};
  const nodeConfig = NODE_TYPES_CONFIG[nodeType];

  const updateConfig = (key: string, value: any) => {
    onUpdate(node.id, {
      ...node.data,
      config: { ...config, [key]: value },
    });
  };

  const updateLabel = (label: string) => {
    onUpdate(node.id, { ...node.data, label });
  };

  return (
    <Card className="w-80 max-h-[calc(100vh-200px)] overflow-y-auto shadow-xl border-primary/20">
      <CardHeader className="pb-3 sticky top-0 bg-card z-10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {nodeConfig && (() => { const Icon = nodeConfig.icon; return <Icon className={`h-4 w-4 ${nodeConfig.color}`} />; })()}
            Propriedades
          </CardTitle>
          <div className="flex gap-1">
            {nodeType !== "start" && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-400 hover:text-blue-300" onClick={() => onDuplicate(node)} title="Duplicar nó">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            )}
            {nodeType !== "start" && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(node.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Label */}
        <div>
          <Label className="text-xs">Nome do Nó</Label>
          <Input
            value={(node.data.label as string) || ""}
            onChange={(e) => updateLabel(e.target.value)}
            placeholder={nodeConfig?.label}
            className="h-8 text-sm"
          />
        </div>

        {/* Type-specific fields */}
        {nodeType === "send_message" && (
          <div>
            <Label className="text-xs">Mensagem</Label>
            <Textarea
              value={config.text || ""}
              onChange={(e) => updateConfig("text", e.target.value)}
              placeholder="Digite a mensagem que será enviada ao cliente..."
              rows={4}
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Use {"{{nome}}"} para nome do cliente, {"{{veiculo}}"} para veículo de interesse
            </p>
          </div>
        )}

        {nodeType === "send_buttons" && (
          <>
            <div>
              <Label className="text-xs">Texto da Mensagem</Label>
              <Textarea
                value={config.body || ""}
                onChange={(e) => updateConfig("body", e.target.value)}
                placeholder="Texto que acompanha os botões..."
                rows={3}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Botões (máx. 3)</Label>
              <div className="space-y-2 mt-1">
                {(config.buttons || [{ text: "" }]).map((btn: any, i: number) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={btn.text}
                      onChange={(e) => {
                        const newButtons = [...(config.buttons || [{ text: "" }])];
                        newButtons[i] = { ...newButtons[i], text: e.target.value };
                        updateConfig("buttons", newButtons);
                      }}
                      placeholder={`Botão ${i + 1}`}
                      className="h-8 text-sm"
                      maxLength={20}
                    />
                    {(config.buttons || []).length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => {
                          const newButtons = (config.buttons || []).filter((_: any, j: number) => j !== i);
                          updateConfig("buttons", newButtons);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
                {(config.buttons || []).length < 3 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={() => updateConfig("buttons", [...(config.buttons || []), { text: "" }])}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Adicionar Botão
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {nodeType === "send_list" && (
          <>
            <div>
              <Label className="text-xs">Texto da Mensagem</Label>
              <Textarea
                value={config.body || ""}
                onChange={(e) => updateConfig("body", e.target.value)}
                placeholder="Texto que acompanha a lista..."
                rows={3}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Texto do Botão</Label>
              <Input
                value={config.buttonText || ""}
                onChange={(e) => updateConfig("buttonText", e.target.value)}
                placeholder="Ver Opções"
                className="h-8 text-sm"
                maxLength={20}
              />
            </div>
            <div>
              <Label className="text-xs">Seções e Itens</Label>
              {(config.sections || [{ title: "", rows: [{ title: "", description: "" }] }]).map((section: any, si: number) => (
                <div key={si} className="border rounded-md p-2 mt-2 space-y-2">
                  <div className="flex gap-2 items-center">
                    <Input
                      value={section.title}
                      onChange={(e) => {
                        const newSections = [...(config.sections || [{ title: "", rows: [] }])];
                        newSections[si] = { ...newSections[si], title: e.target.value };
                        updateConfig("sections", newSections);
                      }}
                      placeholder={`Seção ${si + 1}`}
                      className="h-7 text-xs"
                    />
                    {(config.sections || []).length > 1 && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
                        updateConfig("sections", (config.sections || []).filter((_: any, j: number) => j !== si));
                      }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {(section.rows || []).map((row: any, ri: number) => (
                    <div key={ri} className="pl-3 flex gap-1">
                      <div className="flex-1 space-y-1">
                        <Input
                          value={row.title}
                          onChange={(e) => {
                            const newSections = [...(config.sections || [])];
                            const newRows = [...(newSections[si].rows || [])];
                            newRows[ri] = { ...newRows[ri], title: e.target.value };
                            newSections[si] = { ...newSections[si], rows: newRows };
                            updateConfig("sections", newSections);
                          }}
                          placeholder="Título do item"
                          className="h-6 text-[11px]"
                          maxLength={24}
                        />
                        <Input
                          value={row.description || ""}
                          onChange={(e) => {
                            const newSections = [...(config.sections || [])];
                            const newRows = [...(newSections[si].rows || [])];
                            newRows[ri] = { ...newRows[ri], description: e.target.value };
                            newSections[si] = { ...newSections[si], rows: newRows };
                            updateConfig("sections", newSections);
                          }}
                          placeholder="Descrição (opcional)"
                          className="h-6 text-[11px]"
                          maxLength={72}
                        />
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => {
                        const newSections = [...(config.sections || [])];
                        newSections[si] = { ...newSections[si], rows: (newSections[si].rows || []).filter((_: any, j: number) => j !== ri) };
                        updateConfig("sections", newSections);
                      }}>
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-6 text-[10px]"
                    onClick={() => {
                      const newSections = [...(config.sections || [])];
                      newSections[si] = { ...newSections[si], rows: [...(newSections[si].rows || []), { title: "", description: "" }] };
                      updateConfig("sections", newSections);
                    }}
                  >
                    <Plus className="h-2.5 w-2.5 mr-1" /> Item
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs mt-2"
                onClick={() => updateConfig("sections", [...(config.sections || []), { title: "", rows: [{ title: "", description: "" }] }])}
              >
                <Plus className="h-3 w-3 mr-1" /> Adicionar Seção
              </Button>
            </div>
          </>
        )}

        {nodeType === "condition" && (
          <>
            <div>
              <Label className="text-xs">Campo do Lead</Label>
              <Select value={config.field || ""} onValueChange={(v) => updateConfig("field", v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hasTrade">Tem troca?</SelectItem>
                  <SelectItem value="vehicleInterest">Veículo de interesse</SelectItem>
                  <SelectItem value="paymentMethod">Forma de pagamento</SelectItem>
                  <SelectItem value="city">Cidade</SelectItem>
                  <SelectItem value="name">Nome (WhatsApp)</SelectItem>
                  <SelectItem value="fullName">Nome Completo</SelectItem>
                  <SelectItem value="status">Status do lead</SelectItem>
                  <SelectItem value="lastMessage">Última mensagem contém</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Operador</Label>
              <Select value={config.operator || "equals"} onValueChange={(v) => updateConfig("operator", v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equals">Igual a</SelectItem>
                  <SelectItem value="not_equals">Diferente de</SelectItem>
                  <SelectItem value="contains">Contém</SelectItem>
                  <SelectItem value="not_empty">Não está vazio</SelectItem>
                  <SelectItem value="is_empty">Está vazio</SelectItem>
                  <SelectItem value="is_true">É verdadeiro</SelectItem>
                  <SelectItem value="is_false">É falso</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!["not_empty", "is_empty", "is_true", "is_false"].includes(config.operator) && (
              <div>
                <Label className="text-xs">Valor</Label>
                <Input
                  value={config.value || ""}
                  onChange={(e) => updateConfig("value", e.target.value)}
                  placeholder="Valor para comparar"
                  className="h-8 text-sm"
                />
              </div>
            )}
          </>
        )}

        {nodeType === "ai_response" && (
          <NodeAgentSelector config={config} updateConfig={updateConfig} node={node} onUpdate={onUpdate} />
        )}

        {nodeType === "update_lead" && (
          <>
            <div>
              <Label className="text-xs">Campo</Label>
              <Select value={config.field || ""} onValueChange={(v) => updateConfig("field", v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="vehicleInterest">Veículo de interesse</SelectItem>
                  <SelectItem value="hasTrade">Tem troca</SelectItem>
                  <SelectItem value="paymentMethod">Forma de pagamento</SelectItem>
                  <SelectItem value="intention">Intenção</SelectItem>
                  <SelectItem value="notes">Notas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor</Label>
              <Input
                value={config.value || ""}
                onChange={(e) => updateConfig("value", e.target.value)}
                placeholder="Novo valor"
                className="h-8 text-sm"
              />
            </div>
          </>
        )}

        {nodeType === "wait_input" && (
          <>
            <div>
              <Label className="text-xs">Pergunta para o cliente</Label>
              <Textarea
                value={config.promptText || ""}
                onChange={(e) => updateConfig("promptText", e.target.value)}
                placeholder="Ex: Qual o seu nome completo?"
                rows={3}
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Mensagem enviada antes de aguardar a resposta. Suporta variáveis: {"{{nome}}"}, {"{{telefone}}"}, etc.
              </p>
            </div>
            <div>
              <Label className="text-xs">Salvar resposta no campo</Label>
              <Select value={config.variable || ""} onValueChange={(v) => updateConfig("variable", v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Selecione o campo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nome">Nome (WhatsApp)</SelectItem>
                  <SelectItem value="nome_completo">Nome Completo</SelectItem>
                  <SelectItem value="cidade">Cidade</SelectItem>
                  <SelectItem value="veiculo_interesse">Veículo de Interesse</SelectItem>
                  <SelectItem value="veiculo_troca">Veículo de Troca</SelectItem>
                  <SelectItem value="pagamento">Forma de Pagamento</SelectItem>
                  <SelectItem value="entrada">Valor de Entrada</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="cpf">CPF</SelectItem>
                  <SelectItem value="data_nascimento">Data de Nascimento</SelectItem>
                  <SelectItem value="notas">Notas</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                A resposta do cliente será salva automaticamente neste campo do lead
              </p>
            </div>
            <div className="border-t border-border pt-3">
              <Label className="text-xs">Aguardar múltiplas mensagens</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="number"
                  min={0}
                  max={120}
                  step={5}
                  value={config.groupTimeoutSeconds || 0}
                  onChange={(e) => updateConfig("groupTimeoutSeconds", parseInt(e.target.value) || 0)}
                  className="h-8 text-sm w-24"
                />
                <span className="text-xs text-muted-foreground">segundos (0 = desativado)</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Quando ativado, o fluxo aguarda este tempo após a última mensagem do cliente antes de avançar.
                Todas as mensagens enviadas nesse período são agrupadas em uma só resposta.
                Ideal para perguntas que exigem várias mensagens (ex: dados do veículo de troca).
              </p>
            </div>
          </>
        )}

        {nodeType === "delay" && (
          <div>
            <Label className="text-xs">Tempo de espera (segundos)</Label>
            <Input
              type="number"
              value={config.seconds || 3}
              onChange={(e) => updateConfig("seconds", parseInt(e.target.value) || 3)}
              min={1}
              max={300}
              className="h-8 text-sm"
            />
          </div>
        )}

        {nodeType === "send_image" && (
          <>
            <div>
              <Label className="text-xs">URL da Imagem</Label>
              <Input
                value={config.imageUrl || ""}
                onChange={(e) => updateConfig("imageUrl", e.target.value)}
                placeholder="https://..."
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Legenda</Label>
              <Input
                value={config.caption || ""}
                onChange={(e) => updateConfig("caption", e.target.value)}
                placeholder="Legenda da imagem"
                className="h-8 text-sm"
              />
            </div>
          </>
        )}

        {nodeType === "goto_flow" && (
          <GotoFlowSelector config={config} onUpdate={onUpdate} node={node} />
        )}
        {nodeType === "assign_seller" && (
          <AssignSellerConfig config={config} onUpdate={onUpdate} node={node} />
        )}
        {nodeType === "send_vehicle_photos" && (
          <SendVehiclePhotosConfig config={config} onUpdate={onUpdate} node={node} />
        )}
        {nodeType === "vehicle_presentation" && (
          <VehiclePresentationConfig config={config} onUpdate={onUpdate} node={node} />
        )}
        {nodeType === "update_lead_status" && (
          <UpdateLeadStatusConfig config={config} onUpdate={onUpdate} node={node} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Assign Seller Config Component ──────────────────────────
function AssignSellerConfig({ config, onUpdate, node }: { config: any; onUpdate: (id: string, data: any) => void; node: Node }) {
  const storesQuery = trpc.seller.storeLocations.useQuery();
  const stores = storesQuery.data || [];

  const updateConfig = (key: string, value: any) => {
    onUpdate(node.id, {
      ...node.data,
      config: { ...config, [key]: value },
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Loja</Label>
        <Select
          value={config.storeLocation || "auto"}
          onValueChange={(v) => updateConfig("storeLocation", v)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Detectar automaticamente (pelo veículo)</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          "Auto" detecta a loja pelo veículo de interesse do cliente.
        </p>
      </div>

      {/* Modo de contato: Cartão ou Link wa.me */}
      <div className="border border-border rounded-lg p-3 space-y-3">
        <Label className="text-xs font-medium">Modo de contato com o vendedor</Label>
        <Select
          value={config.contactMode || "contact_card"}
          onValueChange={(v) => updateConfig("contactMode", v)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="contact_card">📎 Cartão de contato (vCard)</SelectItem>
            <SelectItem value="wa_link">🔗 Link wa.me (com resumo)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          {config.contactMode === "wa_link"
            ? "Envia um link wa.me com mensagem pré-preenchida contendo os dados do lead."
            : "Envia o cartão de contato do vendedor para o cliente salvar."}
        </p>

        {config.contactMode === "wa_link" && (
          <div>
            <Label className="text-xs">Mensagem do link wa.me (personalizável)</Label>
            <Textarea
              className="text-sm min-h-[100px] mt-1"
              placeholder={`Olá {vendedor}, vim pelo atendimento da {loja}.\nMeu nome é {{nome}}.\nVeículo de interesse: {{veiculo}}\nTroca: {{troca}}\nPagamento: {{pagamento}}`}
              value={config.waLinkMessage || ""}
              onChange={(e) => updateConfig("waLinkMessage", e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Variáveis: {'{vendedor}'}, {'{loja}'}, {'{{nome}}'}, {'{{telefone}}'}, {'{{veiculo}}'}, {'{{troca}}'}, {'{{pagamento}}'}, {'{{entrada}}'}, {'{{cidade}}'}, {'{{cpf}}'}, {'{{email}}'}
            </p>
          </div>
        )}
      </div>

      <div>
        <Label className="text-xs">Mensagem para o cliente (opcional)</Label>
        <Textarea
          className="text-sm min-h-[80px]"
          placeholder={config.contactMode === "wa_link"
            ? `Perfeito! Clique no link abaixo para falar com {vendedor}...\n\nUse {link} para inserir o link wa.me`
            : `Perfeito! Vou te conectar com um dos nossos vendedores...\n\nUse {vendedor} para o nome e {loja} para a loja.`}
          value={config.message || ""}
          onChange={(e) => updateConfig("message", e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Variáveis: {'{vendedor}'}, {'{loja}'}, {config.contactMode === "wa_link" ? '{link}, ' : ''}{'{{nome}}'}, {'{{telefone}}'}
        </p>
      </div>
      <div className="border-t border-border pt-3 mt-3">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="notifySeller"
            checked={config.notifySeller !== false}
            onChange={(e) => updateConfig("notifySeller", e.target.checked)}
            className="rounded border-border"
          />
          <Label htmlFor="notifySeller" className="text-xs cursor-pointer font-medium">
            Notificar vendedor sobre o novo lead
          </Label>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          Envia uma mensagem ao vendedor com os dados do cliente (usa template para funcionar fora da janela de 24h).
        </p>
        {config.notifySeller !== false && (
          <div>
            <Label className="text-xs">Mensagem para o vendedor (opcional)</Label>
            <Textarea
              className="text-sm min-h-[100px] mt-1"
              placeholder={`Deixe vazio para usar a mensagem padrão.\n\nOu personalize usando variáveis:\n{vendedor} - Nome do vendedor\n{cliente} - Nome do cliente\n{telefone} - Telefone do cliente\n{veiculo} - Veículo de interesse\n{resumo} - Resumo da conversa\n{loja} - Nome da loja`}
              value={config.sellerMessage || ""}
              onChange={(e) => updateConfig("sellerMessage", e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Variáveis: {'{vendedor}'}, {'{cliente}'}, {'{telefone}'}, {'{veiculo}'}, {'{resumo}'}, {'{loja}'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Send Vehicle Photos Config Component ──────────────────────────────
function SendVehiclePhotosConfig({ config, onUpdate, node }: { config: any; onUpdate: (id: string, data: any) => void; node: Node }) {
  const photoSlots: Array<{ position: number; caption: string }> = config.photoSlots || [
    { position: 1, caption: "Vista frontal" },
    { position: 2, caption: "Vista traseira" },
    { position: 3, caption: "Interior" },
    { position: 4, caption: "Painel" },
  ];

  const updateSlots = (newSlots: typeof photoSlots) => {
    onUpdate(node.id, {
      ...node.data,
      config: { ...config, photoSlots: newSlots },
    });
  };

  const updateSlot = (index: number, field: string, value: any) => {
    const newSlots = [...photoSlots];
    newSlots[index] = { ...newSlots[index], [field]: value };
    updateSlots(newSlots);
  };

  const addSlot = () => {
    const nextPos = photoSlots.length > 0 ? Math.max(...photoSlots.map(s => s.position)) + 1 : 1;
    updateSlots([...photoSlots, { position: nextPos, caption: `Foto ${nextPos}` }]);
  };

  const removeSlot = (index: number) => {
    updateSlots(photoSlots.filter((_, i) => i !== index));
  };

  const updateConfig = (key: string, value: any) => {
    onUpdate(node.id, {
      ...node.data,
      config: { ...config, [key]: value },
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Origem das fotos</Label>
        <Select
          value={config.photoSource || "vehicle_interest"}
          onValueChange={(v) => updateConfig("photoSource", v)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vehicle_interest">Veículo de interesse do cliente (automático)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          Usa as fotos do veículo que o cliente demonstrou interesse (gravado pela IA).
        </p>
      </div>

      <div>
        <Label className="text-xs">Mensagem antes das fotos (opcional)</Label>
        <Textarea
          className="text-sm min-h-[60px]"
          placeholder={`Ex: Aqui estão mais fotos do {{veiculo_interesse}} \ud83d\ude0d`}
          value={config.introMessage || ""}
          onChange={(e) => updateConfig("introMessage", e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Variáveis: {'{{nome}}'}, {'{{veiculo_interesse}}'}, {'{{loja}}'}
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-medium">Fotos e Legendas</Label>
          <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={addSlot}>
            <Plus className="w-3 h-3 mr-1" /> Adicionar
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          Defina a posição da foto (1 = primeira foto do veículo, 2 = segunda, etc.) e a legenda que aparecerá.
        </p>

        <div className="space-y-2">
          {photoSlots.map((slot, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-muted/30 rounded-md p-2">
              <div className="flex-shrink-0 w-14">
                <Label className="text-[10px] text-muted-foreground">Foto #</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={slot.position}
                  onChange={(e) => updateSlot(idx, "position", parseInt(e.target.value) || 1)}
                  className="h-7 text-xs w-full"
                />
              </div>
              <div className="flex-1">
                <Label className="text-[10px] text-muted-foreground">Legenda</Label>
                <Input
                  value={slot.caption}
                  onChange={(e) => updateSlot(idx, "caption", e.target.value)}
                  placeholder="Ex: Vista frontal"
                  className="h-7 text-xs"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 mt-4 text-destructive hover:text-destructive"
                onClick={() => removeSlot(idx)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>

        {photoSlots.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">
            Nenhuma foto configurada. Clique em "Adicionar" para definir quais fotos enviar.
          </p>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <Label className="text-xs">Intervalo entre fotos (segundos)</Label>
        <div className="flex items-center gap-2 mt-1">
          <Input
            type="number"
            min={0.5}
            max={10}
            step={0.5}
            value={config.delayBetweenPhotos || 1}
            onChange={(e) => updateConfig("delayBetweenPhotos", parseFloat(e.target.value) || 1)}
            className="h-8 text-sm w-24"
          />
          <span className="text-xs text-muted-foreground">segundos (0.5 a 10s)</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Tempo de espera entre o envio de cada foto. Ajuda a evitar que as fotos cheguem fora de ordem.
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <Label className="text-xs">Mensagem se não houver veículo (fallback)</Label>
        <Textarea
          className="text-sm min-h-[50px] mt-1"
          placeholder="Desculpe, não consegui identificar o veículo de interesse. Pode me dizer qual carro você gostou?"
          value={config.fallbackMessage || ""}
          onChange={(e) => updateConfig("fallbackMessage", e.target.value)}
        />
      </div>
    </div>
  );
}

// ─── Vehicle Presentation Config Component───────────────────────────────────────────────
function VehiclePresentationConfig({ config, onUpdate, node }: { config: any; onUpdate: (id: string, data: any) => void; node: Node }) {
  const photoSlots: Array<{ position: number; caption: string }> = config.photoSlots || [];

  const updateSlots = (newSlots: typeof photoSlots) => {
    onUpdate(node.id, {
      ...node.data,
      config: { ...config, photoSlots: newSlots },
    });
  };

  const updateSlot = (index: number, field: string, value: any) => {
    const newSlots = [...photoSlots];
    newSlots[index] = { ...newSlots[index], [field]: value };
    updateSlots(newSlots);
  };

  const addSlot = () => {
    const nextPos = photoSlots.length > 0 ? Math.max(...photoSlots.map(s => s.position)) + 1 : 1;
    updateSlots([...photoSlots, { position: nextPos, caption: `Foto ${nextPos}` }]);
  };

  const removeSlot = (index: number) => {
    updateSlots(photoSlots.filter((_, i) => i !== index));
  };

  const updateConfig = (key: string, value: any) => {
    onUpdate(node.id, {
      ...node.data,
      config: { ...config, [key]: value },
    });
  };

  const vehicleVars = [
    { var: "{{v_marca}}", desc: "Marca" },
    { var: "{{v_modelo}}", desc: "Modelo" },
    { var: "{{v_ano}}", desc: "Ano" },
    { var: "{{v_km}}", desc: "Quilometragem" },
    { var: "{{v_preco}}", desc: "Preço" },
    { var: "{{v_cor}}", desc: "Cor" },
    { var: "{{v_cambio}}", desc: "Câmbio" },
    { var: "{{v_combustivel}}", desc: "Combustível" },
    { var: "{{v_preco_normal}}", desc: "Preço Normal" },
    { var: "{{v_preco_promo}}", desc: "Preço Promoção" },
    { var: "{{v_loja}}", desc: "Loja" },
    { var: "{{v_tipo}}", desc: "Tipo (carro/moto)" },
    { var: "{{v_portas}}", desc: "Portas" },
    { var: "{{v_titulo}}", desc: "Título completo" },
    { var: "{{v_versao}}", desc: "Versão" },
    { var: "{{v_descricao}}", desc: "Descrição" },
  ];

  return (
    <div className="space-y-3">
      {/* Variáveis disponíveis */}
      <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-md p-2">
        <p className="text-[10px] font-medium text-indigo-300 mb-1">📊 Variáveis do Veículo</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {vehicleVars.map(v => (
            <p key={v.var} className="text-[9px] text-muted-foreground">
              <span className="font-mono text-indigo-400">{v.var}</span> {v.desc}
            </p>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground mt-1 border-t border-indigo-500/20 pt-1">
          + variáveis do lead: {'{{nome}}'}, {'{{telefone}}'}, {'{{nome_completo}}'}, {'{{cpf}}'}, etc.
        </p>
      </div>

      {/* Mensagem principal */}
      <div>
        <Label className="text-xs">Mensagem de apresentação</Label>
        <Textarea
          className="text-sm min-h-[120px] font-mono"
          placeholder={`Ex:\n🚗 *{{v_marca}} {{v_modelo}} {{v_ano}}*\n\n🟢 Preço: {{v_preco}}\n📍 Loja: {{v_loja}}\n⚙️ Câmbio: {{v_cambio}}\n⛽ Combustível: {{v_combustivel}}\n🚨 Cor: {{v_cor}}\n📰 KM: {{v_km}}\n🚪 Portas: {{v_portas}}`}
          value={config.message || ""}
          onChange={(e) => updateConfig("message", e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Use as variáveis acima para montar a mensagem. Suporta *negrito* e emojis.
        </p>
      </div>

      {/* Fotos e legendas */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-medium">Fotos com Legendas (opcional)</Label>
          <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={addSlot}>
            <Plus className="w-3 h-3 mr-1" /> Adicionar
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          Envie fotos do veículo com legendas personalizáveis. A posição indica qual foto do veículo usar (1 = primeira, 2 = segunda, etc.).
          As legendas também aceitam as variáveis do veículo.
        </p>

        <div className="space-y-2">
          {photoSlots.map((slot, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-muted/30 rounded-md p-2">
              <div className="flex-shrink-0 w-14">
                <Label className="text-[10px] text-muted-foreground">Foto #</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={slot.position}
                  onChange={(e) => updateSlot(idx, "position", parseInt(e.target.value) || 1)}
                  className="h-7 text-xs w-full"
                />
              </div>
              <div className="flex-1">
                <Label className="text-[10px] text-muted-foreground">Legenda</Label>
                <Input
                  value={slot.caption}
                  onChange={(e) => updateSlot(idx, "caption", e.target.value)}
                  placeholder="Ex: {{v_marca}} {{v_modelo}} - Vista frontal"
                  className="h-7 text-xs"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 mt-4 text-destructive hover:text-destructive"
                onClick={() => removeSlot(idx)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>

        {photoSlots.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">
            Nenhuma foto configurada. Clique em "Adicionar" para incluir fotos na apresentação.
          </p>
        )}
      </div>

      {/* Delay entre fotos */}
      {photoSlots.length > 0 && (
        <div className="border-t border-border pt-3">
          <Label className="text-xs">Intervalo entre fotos (segundos)</Label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={config.delayBetweenPhotos || 1}
              onChange={(e) => updateConfig("delayBetweenPhotos", parseFloat(e.target.value) || 1)}
              className="h-8 text-sm w-24"
            />
            <span className="text-xs text-muted-foreground">segundos (0.5 a 10s)</span>
          </div>
        </div>
      )}

      {/* Fallback */}
      <div className="border-t border-border pt-3">
        <Label className="text-xs">Mensagem se não houver veículo (fallback)</Label>
        <Textarea
          className="text-sm min-h-[50px] mt-1"
          placeholder="Desculpe, não consegui identificar o veículo de interesse. Pode me dizer qual carro você gostou?"
          value={config.fallbackMessage || ""}
          onChange={(e) => updateConfig("fallbackMessage", e.target.value)}
        />
      </div>
    </div>
  );
}

// ─── Update Lead Status Config Component ─────────────────────────────────────────────────────────
function UpdateLeadStatusConfig({ config, onUpdate, node }: { config: any; onUpdate: (id: string, data: any) => void; node: Node }) {
  const updateConfig = (key: string, value: any) => {
    onUpdate(node.id, {
      ...node.data,
      config: { ...config, [key]: value },
    });
  };

  // Calculate temperature preview
  const selectedStatus = config.funnelStatus || "";
  const tempMap: Record<string, string> = {
    novo: "frio", perdido: "frio",
    interesse_definido: "morno",
    pagamento_definido: "quente", dados_pessoais: "quente", dados_troca: "quente",
    encaminhado_vendedor: "muito_quente", negociando: "muito_quente", fechado: "muito_quente",
  };
  const calculatedTemp = tempMap[selectedStatus] || "";
  const tempInfo = calculatedTemp ? TEMPERATURE_LABELS[calculatedTemp] : null;

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Etapa do Funil</Label>
        <Select
          value={config.funnelStatus || ""}
          onValueChange={(v) => updateConfig("funnelStatus", v)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Selecione a etapa..." />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FUNNEL_STATUS_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          Define em qual etapa do funil o lead se encontra. A temperatura é calculada automaticamente.
        </p>
      </div>

      {/* Temperature preview */}
      {tempInfo && (
        <div className="bg-muted/30 rounded-md p-3 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Temperatura calculada</p>
              <p className={`text-sm font-semibold ${tempInfo.color}`}>{tempInfo.label}</p>
            </div>
            <Thermometer className={`h-5 w-5 ${tempInfo.color}`} />
          </div>
          <div className="mt-2 flex gap-1">
            {["frio", "morno", "quente", "muito_quente"].map((t) => (
              <div
                key={t}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  ["frio", "morno", "quente", "muito_quente"].indexOf(t) <= ["frio", "morno", "quente", "muito_quente"].indexOf(calculatedTemp)
                    ? t === "frio" ? "bg-blue-400" : t === "morno" ? "bg-yellow-400" : t === "quente" ? "bg-orange-400" : "bg-red-400"
                    : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Goto Flow Selector Component ─────────────────────────────────────────────────────────
function GotoFlowSelector({ config, onUpdate, node }: { config: any; onUpdate: (id: string, data: any) => void; node: Node }) { const flowsQuery = trpc.flow.list.useQuery();
  const flows = flowsQuery.data || [];

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Fluxo Destino</Label>
        <Select
          value={config.targetFlowId ? String(config.targetFlowId) : ""}
          onValueChange={(v) => {
            const flow = flows.find(f => String(f.id) === v);
            onUpdate(node.id, {
              ...node.data,
              config: {
                ...config,
                targetFlowId: parseInt(v),
                targetFlowName: flow?.name || "",
              },
            });
          }}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Selecione o fluxo destino..." />
          </SelectTrigger>
          <SelectContent>
            {flows.map(f => (
              <SelectItem key={f.id} value={String(f.id)}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          A conversa será redirecionada para o início deste fluxo. Os dados do lead são mantidos.
        </p>
      </div>
    </div>
  );
}

// ─── Main Editor Wrapper (provides ReactFlowProvider) ───────────────────────────────────────
export default function FlowEditor(props: { flowId: number; onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowEditorInner({ flowId, onBack }: { flowId: number; onBack: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [clipboard, setClipboard] = useState<Node | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { getViewport } = useReactFlow();
  const flowQuery = trpc.flow.getById.useQuery({ id: flowId });
  const saveMutation = trpc.flow.saveFlow.useMutation({
    onSuccess: () => {
      toast.success("Fluxo salvo com sucesso!");
      setHasChanges(false);
    },
    onError: (err) => toast.error(`Erro ao salvar: ${err.message}`),
  });

  // Load flow data into React Flow
  useEffect(() => {
    if (!flowQuery.data) return;
    const { nodes: dbNodes, edges: dbEdges } = flowQuery.data;

    const rfNodes: Node[] = dbNodes.map((n) => ({
      id: String(n.id),
      type: "flowNode",
      position: { x: n.positionX, y: n.positionY },
      data: {
        nodeType: n.nodeType,
        label: n.label || NODE_TYPES_CONFIG[n.nodeType]?.label || n.nodeType,
        config: (n.data as any) || {},
        dbId: n.id,
      },
    }));

    const rfEdges: Edge[] = dbEdges.map((e) => ({
      id: `e${e.id}`,
      source: String(e.sourceNodeId),
      target: String(e.targetNodeId),
      sourceHandle: e.sourceHandle || "default",
      label: e.label || undefined,
      animated: true,
      style: { stroke: "oklch(0.7 0.15 250)" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "oklch(0.7 0.15 250)" },
      data: { dbId: e.id },
    }));

    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [flowQuery.data]);

  const nodeTypes = useMemo(() => ({ flowNode: FlowNode }), []);

  const onConnect = useCallback((connection: Connection) => {
    const newEdge: Edge = {
      id: `e_${Date.now()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      animated: true,
      style: { stroke: "oklch(0.7 0.15 250)" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "oklch(0.7 0.15 250)" },
    };
    setEdges((eds) => addEdge(newEdge, eds));
    setHasChanges(true);
  }, []);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Get center of current viewport in flow coordinates
  const getViewportCenter = () => {
    const viewport = getViewport();
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return { x: 250, y: 200 };
    const rect = wrapper.getBoundingClientRect();
    const centerX = (rect.width / 2 - viewport.x) / viewport.zoom;
    const centerY = (rect.height / 2 - viewport.y) / viewport.zoom;
    return { x: centerX, y: centerY };
  };

  // Add new node at viewport center
  const addNode = (nodeType: string) => {
    const id = `new_${Date.now()}`;
    const config = NODE_TYPES_CONFIG[nodeType];
    const defaultData: any = {};

    if (nodeType === "send_buttons") {
      defaultData.buttons = [{ text: "Opção 1" }, { text: "Opção 2" }];
      defaultData.body = "";
    }
    if (nodeType === "send_list") {
      defaultData.sections = [{ title: "Opções", rows: [{ title: "Item 1", description: "" }] }];
      defaultData.body = "";
      defaultData.buttonText = "Ver Opções";
    }
    if (nodeType === "delay") {
      defaultData.seconds = 3;
    }

    const center = getViewportCenter();
    const newNode: Node = {
      id,
      type: "flowNode",
      position: { x: center.x - 80 + Math.random() * 40, y: center.y - 40 + Math.random() * 40 },
      data: {
        nodeType,
        label: config?.label || nodeType,
        config: defaultData,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNode(newNode);
    setHasChanges(true);
  };

  // Duplicate a node
  const duplicateNode = (node: Node) => {
    const id = `new_${Date.now()}`;
    const newNode: Node = {
      id,
      type: "flowNode",
      position: { x: node.position.x + 40, y: node.position.y + 60 },
      data: {
        ...JSON.parse(JSON.stringify(node.data)),
        dbId: undefined,
        label: `${node.data.label} (cópia)`,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNode(newNode);
    setHasChanges(true);
    toast.success("Nó duplicado!");
  };

  // Keyboard shortcuts for copy/paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedNode) {
        e.preventDefault();
        setClipboard(selectedNode);
        toast.success("Nó copiado!");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard) {
        e.preventDefault();
        const center = getViewportCenter();
        const id = `new_${Date.now()}`;
        const newNode: Node = {
          id,
          type: "flowNode",
          position: { x: center.x - 80 + Math.random() * 40, y: center.y - 40 + Math.random() * 40 },
          data: {
            ...JSON.parse(JSON.stringify(clipboard.data)),
            dbId: undefined,
            label: `${clipboard.data.label} (cópia)`,
          },
        };
        setNodes((nds) => [...nds, newNode]);
        setSelectedNode(newNode);
        setHasChanges(true);
        toast.success("Nó colado!");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNode, clipboard]);

  // Update node data
  const updateNodeData = (nodeId: string, data: any) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data } : n));
    setSelectedNode((prev) => prev && prev.id === nodeId ? { ...prev, data } : prev);
    setHasChanges(true);
  };

  // Delete node
  const deleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
    setHasChanges(true);
  };

  // Save flow
  const handleSave = () => {
    const saveNodes = nodes.map((n) => ({
      id: (n.data.dbId as number) || undefined,
      nodeType: n.data.nodeType as any,
      label: (n.data.label as string) || undefined,
      data: (n.data.config as any) || {},
      positionX: Math.round(n.position.x),
      positionY: Math.round(n.position.y),
    }));

    // Build node ID map for edges
    const nodeIdMap = new Map<string, number>();
    nodes.forEach((n, i) => {
      const dbId = (n.data.dbId as number) || -(i + 1);
      nodeIdMap.set(n.id, dbId);
    });

    const saveEdges = edges.map((e) => ({
      sourceNodeId: nodeIdMap.get(e.source) || 0,
      targetNodeId: nodeIdMap.get(e.target) || 0,
      sourceHandle: e.sourceHandle || "default",
      label: (e.label as string) || undefined,
    })).filter((e) => e.sourceNodeId !== 0 && e.targetNodeId !== 0);

    saveMutation.mutate({ flowId, nodes: saveNodes, edges: saveEdges });
  };

  const flow = flowQuery.data?.flow;
  const [showFlowSettings, setShowFlowSettings] = useState(false);
  const [showTriggerSettings, setShowTriggerSettings] = useState(false);
  const [flowAiPrompt, setFlowAiPrompt] = useState("");
  const [flowAgentId, setFlowAgentId] = useState<number | null>(null);
  const [flowTrigger, setFlowTrigger] = useState("");
  const [flowTriggerValue, setFlowTriggerValue] = useState("");
  const updateFlowMutation = trpc.flow.update.useMutation({
    onSuccess: () => {
      toast.success("Configurações do fluxo salvas!");
      flowQuery.refetch();
    },
  });
  const activeAgentsQuery = trpc.agent.listActive.useQuery();
  const activeAgents = activeAgentsQuery.data || [];

  const TRIGGER_OPTIONS: Record<string, string> = {
    first_contact: "Primeiro Contato",
    keyword: "Palavra-chave",
    button_click: "Clique em Botão",
    ad_click: "Anúncio (ID)",
    manual: "Manual",
    reactivation: "Reativação",
    category_interest: "Categoria",
    rescue: "⏰ Resgate (Lead Inativo)",
  };

  // Load flow AI prompt, agent and trigger
  useEffect(() => {
    if (flow?.aiPrompt) setFlowAiPrompt(flow.aiPrompt);
    if (flow?.agentId) setFlowAgentId(flow.agentId);
    if (flow?.trigger) setFlowTrigger(flow.trigger);
    if (flow?.triggerValue) setFlowTriggerValue(flow.triggerValue);
  }, [flow?.aiPrompt, flow?.agentId, flow?.trigger, flow?.triggerValue]);

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div className="h-5 w-px bg-border" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">{flow?.name || "Carregando..."}</h2>
            <p className="text-[10px] text-muted-foreground">{flow?.description || ""}</p>
          </div>
          {hasChanges && (
            <Badge variant="secondary" className="text-[10px] bg-yellow-500/10 text-yellow-500">
              Alterações não salvas
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setShowTriggerSettings(!showTriggerSettings); if (!showTriggerSettings) setShowFlowSettings(false); }}>
            <Settings2 className="h-3.5 w-3.5 mr-1" />
            Gatilho
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setShowFlowSettings(!showFlowSettings); if (!showFlowSettings) setShowTriggerSettings(false); }}>
            <Cpu className="h-3.5 w-3.5 mr-1" />
            Agente IA
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending || !hasChanges}>
            <Save className="h-3.5 w-3.5 mr-1" />
            {saveMutation.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      {/* Trigger Settings */}
      {showTriggerSettings && (
        <div className="border-b border-border bg-card/80 px-4 py-3">
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Settings2 className="h-3.5 w-3.5 text-primary" />
                  Gatilho de Ativação
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Defina quando este fluxo deve ser ativado automaticamente.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  updateFlowMutation.mutate({
                    id: flowId,
                    trigger: flowTrigger as any,
                    triggerValue: flowTriggerValue || undefined,
                  });
                }}
                disabled={updateFlowMutation.isPending}
              >
                {updateFlowMutation.isPending ? "Salvando..." : "Salvar Gatilho"}
              </Button>
            </div>
            <Select value={flowTrigger} onValueChange={(v) => setFlowTrigger(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o gatilho" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TRIGGER_OPTIONS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(flowTrigger === "keyword" || flowTrigger === "category_interest" || flowTrigger === "ad_click") && (
              <div>
                <Label className="text-xs">
                  {flowTrigger === "keyword" ? "Palavras-chave (separadas por vírgula)" : flowTrigger === "ad_click" ? "ID do Anúncio" : "Categoria"}
                </Label>
                <Input
                  value={flowTriggerValue}
                  onChange={(e) => setFlowTriggerValue(e.target.value)}
                  placeholder={flowTrigger === "keyword" ? "financiar, financiamento, parcela" : flowTrigger === "ad_click" ? "ID do anúncio Meta" : "SUV, Sedan, Hatch"}
                  className="h-8 text-sm"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Flow AI Agent & Prompt Settings */}
      {showFlowSettings && (
        <div className="border-b border-border bg-card/80 px-4 py-3">
          <div className="max-w-3xl space-y-4">
            {/* Agent Selector */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-primary" />
                  Agente de IA deste Fluxo
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Selecione qual agente responde nos nós "IA Livre" deste fluxo. Se nenhum for selecionado, usa o prompt legado abaixo.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  updateFlowMutation.mutate({
                    id: flowId,
                    agentId: flowAgentId,
                    aiPrompt: flowAiPrompt || null,
                  });
                }}
                disabled={updateFlowMutation.isPending}
              >
                {updateFlowMutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
            <Select
              value={flowAgentId ? String(flowAgentId) : "none"}
              onValueChange={(v) => setFlowAgentId(v === "none" ? null : parseInt(v, 10))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione um agente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum (usa prompt legado abaixo)</SelectItem>
                {activeAgents.map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    <span className="font-medium">{a.name}</span>
                    {a.description && <span className="text-muted-foreground ml-2 text-xs">{a.description}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Legacy Prompt (only shown when no agent selected) */}
            {!flowAgentId && (
              <div className="space-y-2 pt-2 border-t border-border/50">
                <Label className="text-sm font-medium text-muted-foreground">Prompt Legado (sem agente)</Label>
                <Textarea
                  value={flowAiPrompt}
                  onChange={(e) => setFlowAiPrompt(e.target.value)}
                  placeholder={`Ex: Você é um consultor de vendas da Auto Inova...`}
                  rows={5}
                  className="text-sm font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Variáveis disponíveis: {"{{nome}}"}, {"{{telefone}}"}, {"{{veiculo}}"}, {"{{cidade}}"}, {"{{troca}}"}, {"{{pagamento}}"}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Canvas + Sidebar */}
      <div className="flex-1 flex">
        {/* Node palette */}
        <div className="w-52 border-r border-border bg-card/50 overflow-y-auto p-3 space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Adicionar Nó</p>
          {Object.entries(NODE_TYPES_CONFIG).filter(([k]) => k !== "start").map(([key, cfg]) => {
            const Icon = cfg.icon;
            return (
              <button
                key={key}
                onClick={() => addNode(key)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-left transition-colors"
              >
                <Icon className={`h-3.5 w-3.5 ${cfg.color} shrink-0`} />
                <div>
                  <span className="text-xs font-medium text-foreground">{cfg.label}</span>
                  <p className="text-[9px] text-muted-foreground leading-tight">{cfg.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* React Flow Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes) => { onNodesChange(changes); setHasChanges(true); }}
            onEdgesChange={(changes) => { onEdgesChange(changes); setHasChanges(true); }}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
            deleteKeyCode={["Backspace", "Delete"]}
            className="bg-background"
          >
            <Background gap={15} size={1} color="oklch(0.3 0 0 / 0.15)" />
            <Controls className="!bg-card !border-border !shadow-lg" />
            <MiniMap
              className="!bg-card !border-border"
              nodeColor="oklch(0.6 0.15 250)"
              maskColor="oklch(0.1 0 0 / 0.7)"
            />
          </ReactFlow>

          {/* Properties panel overlay */}
          {selectedNode && (
            <div className="absolute top-4 right-4 z-10">
              <PropertiesPanel
                node={selectedNode}
                onUpdate={updateNodeData}
                onDelete={deleteNode}
                onDuplicate={duplicateNode}
                onClose={() => setSelectedNode(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
