'use client';
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, UserCheck, Phone, Car, CreditCard, ArrowLeftRight, Target, Zap, ZapOff, Pencil, Save, X, Mail, StickyNote, DollarSign, ExternalLink, Link2, FileText, UserCog, Trash2, Copy, GitBranch, PlayCircle, PauseCircle, Megaphone, Loader2, ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";

const FUNNEL_STAGES: { value: string; label: string }[] = [
  { value: "novo", label: "Novo" },
  { value: "interesse_definido", label: "Interesse definido" },
  { value: "pagamento_definido", label: "Pagamento definido" },
  { value: "dados_pessoais", label: "Dados pessoais" },
  { value: "dados_troca", label: "Dados da troca" },
  { value: "encaminhado_vendedor", label: "Com vendedor" },
  { value: "negociando", label: "Negociando" },
  { value: "fechado", label: "Fechado ✅" },
  { value: "perdido", label: "Perdido" },
];

const TEMP_BADGE: Record<string, { label: string; cls: string }> = {
  frio: { label: "🧊 Frio", cls: "border-sky-500/40 text-sky-400" },
  morno: { label: "🌤 Morno", cls: "border-yellow-500/40 text-yellow-400" },
  quente: { label: "🔥 Quente", cls: "border-orange-500/40 text-orange-400" },
  muito_quente: { label: "🔥🔥 Muito quente", cls: "border-red-500/40 text-red-400" },
};

type Props = {
  conversationId: number;
};

export default function ConversationPanel({ conversationId }: Props) {
  const utils = trpc.useUtils();
  const { data: conversation } = trpc.conversation.getById.useQuery({ id: conversationId });
  const { data: lead, refetch: refetchLead } = trpc.lead.getByConversation.useQuery({ conversationId });
  const { data: vehicles } = trpc.vehicle.list.useQuery();
  const { data: teamMembers } = trpc.team.list.useQuery();
  const assignAgent = trpc.conversation.assignAgent.useMutation({
    onSuccess: () => {
      utils.conversation.getById.invalidate({ id: conversationId });
      utils.conversation.list.invalidate();
      toast.success("Agente atribuído!");
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Find the linked vehicle
  const linkedVehicle = lead?.vehicleId && vehicles ? vehicles.find((v: any) => v.id === lead.vehicleId) : null;

  // ── Fluxo por conversa ──
  const { data: savedFlows } = trpc.flow.list.useQuery();
  const { data: activeFlowSession, refetch: refetchFlowSession } = trpc.flow.getActiveSession.useQuery(
    { conversationId },
    { refetchInterval: 10000 }
  );
  const [flowToStart, setFlowToStart] = useState<number | null>(null);
  const startFlowMutation = trpc.flow.startForConversation.useMutation({
    onSuccess: (res) => {
      toast.success(`Fluxo iniciado (${res.messagesSent} mensagem(ns) enviada(s))`);
      refetchFlowSession();
      utils.message.list.invalidate({ conversationId });
    },
    onError: (err) => toast.error(err.message),
  });
  const pauseFlowMutation = trpc.flow.pauseSession.useMutation({
    onSuccess: () => { toast.success("Fluxo pausado"); refetchFlowSession(); },
  });

  // ── Agente de IA da conversa ──
  const { data: agentsList } = trpc.agent.listActive.useQuery();
  const setConvAgent = trpc.conversation.setAgent.useMutation({
    onSuccess: () => {
      utils.conversation.getById.invalidate({ id: conversationId });
      toast.success("Agente da conversa atualizado");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Linha do tempo do lead ──
  const { data: timeline, refetch: refetchTimeline } = trpc.activity.timeline.useQuery(
    { conversationId },
    { refetchInterval: 30000 }
  );
  const [noteText, setNoteText] = useState("");
  const addNoteMutation = trpc.activity.addNote.useMutation({
    onSuccess: () => { setNoteText(""); refetchTimeline(); toast.success("Nota adicionada"); },
    onError: (e) => toast.error(e.message),
  });

  // ── Análise de IA (temperatura da conversa) ──
  const analyzeMutation = trpc.lead.analyze.useMutation({
    onSuccess: (r) => { toast.success(`Análise: ${r.temperature} (score ${r.score})`); refetchLead(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Funil (dispara CAPI no servidor) ──
  const updateFunnel = trpc.lead.update.useMutation({
    onSuccess: () => { refetchLead(); toast.success("Etapa do funil atualizada"); },
    onError: (err) => toast.error(err.message),
  });

  // Nomes customizados das etapas (Configurações → Personalização)
  const { data: customFunnelLabels } = trpc.settings.getFunnelLabels.useQuery(undefined, { staleTime: 60000 });
  const stageLabel = (stage: { value: string; label: string }) =>
    customFunnelLabels?.[stage.value] || stage.label;

  // ── Transferência para instância do vendedor ──
  const { data: evoInstances } = trpc.evolution.listInstances.useQuery(undefined, {
    enabled: conversation?.channel !== "evolution",
  });
  const [transferInstance, setTransferInstance] = useState("");
  const [transferMsg, setTransferMsg] = useState("");
  const transferMutation = trpc.conversation.transferToInstance.useMutation({
    onSuccess: () => {
      toast.success("Transferido! A conversa oficial foi finalizada e o vendedor assumiu pela instância.");
      utils.conversation.getById.invalidate({ id: conversationId });
      utils.conversation.list.invalidate();
      setTransferInstance(""); setTransferMsg("");
    },
    onError: (err) => toast.error(err.message),
  });

  // Origem do lead (atribuição)
  const leadOrigin = (() => {
    if (!lead) return null;
    const l = lead as any;
    if (l.ctwaId) return { label: "Anúncio WhatsApp (CTWA)", detail: l.utmCampaign || null, cls: "border-green-500/40 text-green-400" };
    if (l.metaLeadId) return { label: "Lead Ads (formulário)", detail: l.utmCampaign || null, cls: "border-blue-500/40 text-blue-400" };
    if (l.gclid || l.gbraid || l.wbraid) return { label: "Google Ads", detail: l.utmCampaign || null, cls: "border-amber-500/40 text-amber-400" };
    if (l.utmSource) return { label: `Origem: ${l.utmSource}`, detail: l.utmCampaign || null, cls: "border-violet-500/40 text-violet-400" };
    return { label: "Orgânico / direto", detail: null, cls: "border-border text-muted-foreground" };
  })();

  // Contact editing state
  const [editingContact, setEditingContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
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
      setContactPhone(conversation.phone || "");
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
    const phoneDigits = contactPhone.replace(/\D/g, "");
    updateContact.mutate({
      id: conversationId,
      contactName: contactName.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      contactNotes: contactNotes.trim() || undefined,
      // Só envia o telefone se foi alterado (corrige contatos @lid)
      phone: phoneDigits && phoneDigits !== conversation?.phone ? phoneDigits : undefined,
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

  const handleCopyLead = async () => {
    if (!lead || !conversation) return;
    
    // Consolidar dados de troca
    const tradeDataParts: string[] = [];
    if (lead.tradeVehicle) tradeDataParts.push(`Veículo: ${lead.tradeVehicle}`);
    if (lead.tradeYear) tradeDataParts.push(`Ano: ${lead.tradeYear}`);
    if (lead.tradeKm) tradeDataParts.push(`KM: ${lead.tradeKm}`);
    const tradeData = tradeDataParts.length > 0 ? tradeDataParts.join(" | ") : "";
    
    // Mapear status
    const statusLabel = lead.status === "new" ? "Novo" : 
                        lead.status === "qualifying" ? "Qualificando" : 
                        lead.status === "qualified" ? "Qualificado" : 
                        lead.status === "contacted" ? "Contatado" : 
                        lead.status === "converted" ? "Convertido" : 
                        lead.status === "lost" ? "Perdido" : lead.status;
    
    // Montar texto completo
    const leadText = `
═══ DADOS DO LEAD ═══
Nome: ${conversation.contactName || "N/A"}
Telefone: ${conversation.phone}

═══ STATUS ═══
Status: ${statusLabel}
Etapa Funil: ${lead.funnelStatus || "N/A"}
Temperatura: ${lead.temperature || "N/A"}

═══ VEÍCULO DE INTERESSE ═══
Veículo: ${lead.vehicleInterest || "N/A"}
${linkedVehicle ? `Vinculado: ${linkedVehicle.brand} ${linkedVehicle.model} ${linkedVehicle.year}
Valor: R$ ${linkedVehicle.price?.toLocaleString("pt-BR") || "N/A"}` : ""}

═══ TROCA ═══
Tem Troca: ${lead.hasTrade ? "Sim" : "Não"}
${tradeData ? `Dados: ${tradeData}` : ""}

═══ PAGAMENTO ═══
Forma: ${lead.paymentMethod || "N/A"}
Entrada: ${lead.downPayment || "N/A"}

═══ NOTAS ═══
${(lead as any).notes || "N/A"}
    `.trim();
    
    try {
      await navigator.clipboard.writeText(leadText);
      toast.success("Lead copiado para clipboard!");
    } catch (err) {
      toast.error("Erro ao copiar lead");
    }
  };

  if (!conversation) return null;

  return (
    <div className="h-full flex flex-col bg-card border-l border-border overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold text-card-foreground mb-1">Painel de Controle</h3>
        <p className="text-xs text-muted-foreground">Gerenciar atendimento</p>
      </div>

      {/* ── ATENDIMENTO (IA + estado + atendente unificados) ── */}
      <div className="p-4 border-b border-border shrink-0 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Atendimento</h4>
        {conversation.aiActive ? (
          <Button
            onClick={() => toggleAI.mutate({ id: conversationId, aiActive: false })}
            variant="outline"
            className="w-full justify-start gap-2 h-8 text-sm border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
            disabled={toggleAI.isPending}
          >
            <UserCheck className="h-4 w-4" />
            Assumir Conversa
          </Button>
        ) : (
          <Button
            onClick={() => toggleAI.mutate({ id: conversationId, aiActive: true })}
            variant="outline"
            className="w-full justify-start gap-2 h-8 text-sm border-primary/30 text-primary hover:bg-primary/10"
            disabled={toggleAI.isPending}
          >
            <Bot className="h-4 w-4" />
            Reativar IA
          </Button>
        )}
        {conversation.aiActive && (agentsList || []).length > 0 && (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block flex items-center gap-1">
              <Bot className="h-3 w-3" /> Agente de IA
            </label>
            <Select
              value={(conversation as any).agentId ? String((conversation as any).agentId) : "auto"}
              onValueChange={(v) => setConvAgent.mutate({ conversationId, agentId: v === "auto" ? null : Number(v) })}
            >
              <SelectTrigger className="h-8 text-sm bg-input border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automático (padrão/instância)</SelectItem>
                {(agentsList || []).map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Estado</label>
            <Select value={conversation.status} onValueChange={(val) => updateStatus.mutate({ id: conversationId, status: val as any })}>
              <SelectTrigger className="h-8 text-sm bg-input border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Aberta</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="resolved">Resolvida</SelectItem>
                <SelectItem value="closed">Fechada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Atendente</label>
            <Select
              value={conversation.assignedTo?.toString() || "none"}
              onValueChange={(val) => assignAgent.mutate({ id: conversationId, agentId: val === "none" ? null : Number(val) })}
            >
              <SelectTrigger className="h-8 text-sm bg-input border-border"><SelectValue placeholder="Ninguém" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ninguém</SelectItem>
                {(teamMembers || []).map((m: any) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── FUNIL DE VENDA (dispara eventos Meta CAPI) ── */}
      <div className="p-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Funil de Venda</h4>
          {lead?.temperature && TEMP_BADGE[lead.temperature] && (
            <Badge variant="outline" className={`text-[10px] ${TEMP_BADGE[lead.temperature].cls}`}>
              {TEMP_BADGE[lead.temperature].label}
            </Badge>
          )}
        </div>
        <Select
          value={lead?.funnelStatus || "novo"}
          onValueChange={(val) => updateFunnel.mutate({ conversationId, funnelStatus: val as any })}
          disabled={updateFunnel.isPending}
        >
          <SelectTrigger className="h-8 text-sm bg-input border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FUNNEL_STAGES.map(s => <SelectItem key={s.value} value={s.value}>{stageLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          size="sm" variant="outline"
          className="w-full mt-2 h-8 text-xs border-violet-500/30 text-violet-600 hover:bg-violet-500/10"
          onClick={() => analyzeMutation.mutate({ conversationId })}
          disabled={analyzeMutation.isPending}
        >
          {analyzeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Bot className="h-3.5 w-3.5 mr-1" />}
          Analisar temperatura com IA
        </Button>
        {/* Barra de progresso do funil */}
        <div className="flex gap-0.5 mt-2">
          {FUNNEL_STAGES.slice(0, 8).map((s, i) => {
            const currentIdx = FUNNEL_STAGES.findIndex(f => f.value === (lead?.funnelStatus || "novo"));
            const isLost = lead?.funnelStatus === "perdido";
            return (
              <div
                key={s.value}
                title={s.label}
                className={`h-1.5 flex-1 rounded-full ${isLost ? "bg-red-500/30" : i <= currentIdx ? "bg-primary" : "bg-secondary"}`}
              />
            );
          })}
        </div>
        {leadOrigin && (
          <div className="flex items-center gap-1.5 mt-2.5">
            <Megaphone className="h-3 w-3 text-muted-foreground shrink-0" />
            <Badge variant="outline" className={`text-[10px] ${leadOrigin.cls}`}>{leadOrigin.label}</Badge>
            {leadOrigin.detail && <span className="text-[10px] text-muted-foreground truncate" title={leadOrigin.detail}>{leadOrigin.detail}</span>}
          </div>
        )}
      </div>

      {/* ── TRANSFERIR PARA VENDEDOR (só conversas da matriz) ── */}
      {conversation.channel !== "evolution" && (evoInstances || []).length > 0 && (
        <div className="p-4 border-b border-border shrink-0">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Transferir para Vendedor</h4>
          <Select value={transferInstance} onValueChange={(v) => {
            setTransferInstance(v);
            if (!transferMsg) {
              const first = (conversation.contactName || "").split(" ")[0];
              setTransferMsg(`Olá${first ? ` ${first}` : ""}! Aqui é da Auto Inova 😊 Vou continuar seu atendimento por este número. Pode falar comigo por aqui!`);
            }
          }}>
            <SelectTrigger className="h-8 text-sm bg-input border-border">
              <SelectValue placeholder="Escolher instância do vendedor..." />
            </SelectTrigger>
            <SelectContent>
              {(evoInstances || []).map((i: any) => (
                <SelectItem key={i.id} value={i.instanceName} disabled={i.status !== "connected"}>
                  {i.displayName || i.instanceName} {i.status !== "connected" ? "(desconectada)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {transferInstance && (
            <>
              <Textarea
                value={transferMsg}
                onChange={e => setTransferMsg(e.target.value)}
                placeholder="Mensagem que o vendedor enviará ao cliente..."
                className="text-sm bg-input border-border min-h-[70px] mt-2"
              />
              <Button
                size="sm"
                className="w-full mt-2"
                disabled={!transferMsg.trim() || transferMutation.isPending}
                onClick={() => transferMutation.mutate({ conversationId, instanceName: transferInstance, message: transferMsg.trim() })}
              >
                {transferMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <UserCheck className="h-3.5 w-3.5 mr-1" />}
                Transferir e finalizar aqui
              </Button>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                O cliente recebe a mensagem pelo número do vendedor; esta conversa é finalizada com nota interna da transferência. O lead e o funil continuam os mesmos.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── FLUXO AUTOMATIZADO ── */}
      <div className="p-4 border-b border-border shrink-0">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Fluxo Automatizado</h4>
        {activeFlowSession ? (
          <div className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/25 rounded-md px-2.5 py-2">
            <GitBranch className="h-4 w-4 text-violet-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-violet-300 font-medium truncate">{(activeFlowSession as any).flowName}</p>
              <p className="text-[10px] text-violet-400/70">Ativo — rodando nesta conversa</p>
            </div>
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 shrink-0"
              onClick={() => pauseFlowMutation.mutate({ conversationId })}
              disabled={pauseFlowMutation.isPending}
            >
              <PauseCircle className="h-3.5 w-3.5 mr-1" /> Pausar
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={flowToStart?.toString() || ""} onValueChange={v => setFlowToStart(Number(v))}>
              <SelectTrigger className="h-8 text-sm bg-input border-border flex-1"><SelectValue placeholder="Escolher fluxo salvo..." /></SelectTrigger>
              <SelectContent>
                {((savedFlows as any[]) || []).map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 shrink-0"
              disabled={!flowToStart || startFlowMutation.isPending}
              onClick={() => flowToStart && startFlowMutation.mutate({ conversationId, flowId: flowToStart })}
            >
              {startFlowMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><PlayCircle className="h-3.5 w-3.5 mr-1" /> Iniciar</>}
            </Button>
          </div>
        )}
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
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={handleCancelContact}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        {editingContact ? (
          <div className="space-y-2.5">
            <FieldInput label="Nome" value={contactName} onChange={setContactName} placeholder="Nome do contato" />
            <FieldInput label="Telefone (com DDI, só dígitos)" value={contactPhone} onChange={setContactPhone} placeholder="5551999998888" />
            <FieldInput label="Email" value={contactEmail} onChange={setContactEmail} placeholder="email@example.com" />
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
            <Badge variant="outline" className={`text-xs ${
              conversation.channel === "instagram" ? "border-pink-500/50 text-pink-400" :
              conversation.channel === "facebook" ? "border-blue-500/50 text-blue-400" :
              "border-green-500/50 text-green-400"
            }`}>
              {conversation.channel === "instagram" ? "Instagram" :
               conversation.channel === "facebook" ? "Facebook" : "WhatsApp"}
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
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-primary" onClick={() => setEditingLead(true)}>
                <Pencil className="h-3 w-3 mr-1" />
                Editar
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-primary" onClick={handleCopyLead} title="Copiar dados do lead para vendedor">
                <Copy className="h-3 w-3 mr-1" />
                Copiar
              </Button>
            </div>
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
            <FieldInput label="Intenção" value={leadIntention} onChange={setLeadIntention} placeholder="compra, troca, informação..." />
            <FieldInput label="Veículo de Interesse (Texto)" value={leadVehicleInterest} onChange={setLeadVehicleInterest} placeholder="Ex: Toyota Corolla 2024" />
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Veículo do Estoque</label>
              <Select value={leadVehicleId?.toString() || "none"} onValueChange={(val) => setLeadVehicleId(val === "none" ? null : parseInt(val))}>
                <SelectTrigger className="h-8 text-sm bg-input border-border">
                  <SelectValue placeholder="Selecione um veículo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum (limpar)</SelectItem>
                  {vehicles && vehicles.length > 0 && (
                    vehicles.map((v: any) => (
                      <SelectItem key={v.id} value={v.id.toString()}>
                        {v.year} {v.brand} {v.model} - {v.km?.toLocaleString()}km
                      </SelectItem>
                    ))
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
          </div>
        ) : lead ? (
          <div className="space-y-3">
            {lead.intention && <LeadField icon={<Target className="h-3.5 w-3.5" />} label="Intenção" value={lead.intention} />}
            {lead.vehicleInterest && <LeadField icon={<Car className="h-3.5 w-3.5" />} label="Veículo de Interesse" value={lead.vehicleInterest} />}
            {linkedVehicle && (
              <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Link2 className="h-3 w-3 text-primary" />
                    <span className="text-[10px] text-primary uppercase tracking-wider font-semibold">Veículo Vinculado</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      updateLead.mutate({ conversationId, vehicleId: null as any });
                    }}
                    title="Remover veículo vinculado"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
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
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-3">Nenhum dado de lead coletado ainda. A IA coletará automaticamente durante a conversa.</p>
        )}
      </div>

      {/* ── LINHA DO TEMPO DO LEAD ── */}
      <div className="p-4 border-t border-border shrink-0">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
          <ClipboardList className="h-3.5 w-3.5" /> Linha do Tempo
        </h4>
        {/* Adicionar nota */}
        <div className="flex items-start gap-1.5 mb-3">
          <Textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="Adicionar anotação..."
            className="text-sm bg-input border-border min-h-[38px] flex-1"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" disabled={!noteText.trim() || addNoteMutation.isPending}
            onClick={() => addNoteMutation.mutate({ conversationId, note: noteText.trim() })}>
            {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        {/* Eventos */}
        <div className="space-y-2.5 max-h-72 overflow-y-auto">
          {(timeline || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem eventos ainda.</p>
          ) : (timeline || []).map((ev: any) => <TimelineItem key={ev.id} ev={ev} />)}
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ ev }: { ev: any }) {
  const d = ev.details || {};
  const when = new Date(ev.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  const meta: Record<string, { icon: string; color: string; text: string }> = {
    lead_entrou: { icon: "📥", color: "text-sky-500", text: `Lead entrou via ${d.instance || (d.channel === "evolution" ? "instância" : "WhatsApp oficial")}` },
    etapa_funil: { icon: "📊", color: "text-primary", text: `Funil: ${d.de || "?"} → ${d.para || "?"}` },
    negocio_fechado: { icon: "🎉", color: "text-green-600", text: "Negócio fechado!" },
    atribuido_atendente: { icon: "👤", color: "text-blue-500", text: `Atribuído${d.para ? ` a ${d.para}` : ""}${d.de ? ` (era ${d.de})` : ""}` },
    liberado_atendente: { icon: "🔓", color: "text-muted-foreground", text: "Atendente liberado (IA reativada)" },
    nota: { icon: "📝", color: "text-amber-600", text: d.note || "" },
  };
  const m = meta[ev.action] || { icon: "•", color: "text-muted-foreground", text: ev.action };
  return (
    <div className="flex gap-2 text-xs">
      <span className="shrink-0">{m.icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`${m.color} ${ev.action === "nota" ? "" : "font-medium"} whitespace-pre-wrap break-words`}>{m.text}</p>
        <p className="text-[10px] text-muted-foreground">{ev.userName} · {when}</p>
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
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-sm text-card-foreground break-all">{value}</span>
    </div>
  );
}

function LeadField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
        <p className="text-sm text-card-foreground break-words">{value}</p>
      </div>
    </div>
  );
}
