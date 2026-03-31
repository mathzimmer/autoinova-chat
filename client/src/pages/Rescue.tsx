import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Clock, Play, Settings, History, Loader2, CheckCircle2, AlertTriangle,
  LifeBuoy, ChevronLeft, ChevronRight, Thermometer, Info, Zap,
  MessageSquareWarning, ArrowRight,
} from "lucide-react";

export default function RescuePage() {
  const [activeTab, setActiveTab] = useState<"config" | "history" | "variables">("config");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-600/40 flex items-center justify-center">
                <LifeBuoy size={20} className="text-red-400" />
              </div>
              Resgate de Leads Inativos
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure o gatilho de tempo para resgatar leads que pararam de responder, com contexto do funil
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { id: "config" as const, label: "Configurações", icon: Settings },
            { id: "history" as const, label: "Histórico", icon: History },
            { id: "variables" as const, label: "Variáveis de Contexto", icon: Info },
          ].map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={activeTab === tab.id
                ? "bg-red-600 hover:bg-red-700"
                : "border-border text-muted-foreground hover:text-foreground"
              }
            >
              <tab.icon size={14} className="mr-2" />
              {tab.label}
            </Button>
          ))}
        </div>

        {activeTab === "config" && <ConfigTab />}
        {activeTab === "history" && <HistoryTab />}
        {activeTab === "variables" && <VariablesTab />}
      </div>
    </div>
  );
}

// ─── Config Tab ──────────────────────────────────────────────────────────────

function ConfigTab() {
  const { data: config, isLoading, refetch } = trpc.rescue.getConfig.useQuery();
  const { data: stats } = trpc.rescue.stats.useQuery();
  const { data: rescueFlows } = trpc.rescue.listRescueFlows.useQuery();
  const saveMutation = trpc.rescue.saveConfig.useMutation({
    onSuccess: () => {
      toast.success("Configurações de resgate salvas! O job foi reiniciado.");
      refetch();
    },
    onError: (err: any) => toast.error("Erro: " + err.message),
  });
  const runNowMutation = trpc.rescue.runNow.useMutation({
    onSuccess: (result: any) => {
      toast.success(`Resgate executado: ${result.sent} enviados, ${result.skipped} pulados, ${result.errors} erros`);
    },
    onError: (err: any) => toast.error("Erro: " + err.message),
  });

  const [form, setForm] = useState({
    enabled: false,
    inactivityMinutes: 30,
    maxAttempts: 3,
    intervalMinutes: 60,
    rescueFlowId: null as number | null,
    maxPerRun: 20,
    checkIntervalMinutes: 2,
  });

  useEffect(() => {
    if (config) {
      setForm({
        enabled: config.enabled,
        inactivityMinutes: config.inactivityMinutes,
        maxAttempts: config.maxAttempts,
        intervalMinutes: config.intervalMinutes,
        rescueFlowId: config.rescueFlowId,
        maxPerRun: config.maxPerRun,
        checkIntervalMinutes: config.checkIntervalMinutes,
      });
    }
  }, [config]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total enviados", value: stats.total, icon: LifeBuoy, color: "#3b82f6" },
            { label: "Últimas 24h", value: stats.last24h, icon: Clock, color: "#22c55e" },
            { label: "Últimos 7 dias", value: stats.last7d, icon: History, color: "#a855f7" },
            { label: "Respondidos", value: stats.responded, icon: CheckCircle2, color: "#22c55e" },
            { label: "Status", value: form.enabled ? "Ativo" : "Desativado", icon: form.enabled ? CheckCircle2 : AlertTriangle, color: form.enabled ? "#22c55e" : "#ef4444" },
          ].map(stat => (
            <div key={stat.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon size={14} style={{ color: stat.color }} />
                <span className="text-xs text-muted-foreground">{stat.label}</span>
              </div>
              <div className="text-xl font-bold text-foreground">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Main Settings */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-lg">Configurações do Resgate</CardTitle>
            <CardDescription>Defina quando e como o resgate automático deve funcionar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-foreground">Resgate ativo</Label>
                <p className="text-xs text-gray-500">Ativar/desativar o resgate automático de leads</p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm(f => ({ ...f, enabled: v }))}
              />
            </div>

            <div>
              <Label className="text-muted-foreground">Fluxo de resgate</Label>
              <Select
                value={form.rescueFlowId ? String(form.rescueFlowId) : "none"}
                onValueChange={(v) => setForm(f => ({ ...f, rescueFlowId: v === "none" ? null : Number(v) }))}
              >
                <SelectTrigger className="bg-muted border-border text-foreground mt-1">
                  <SelectValue placeholder="Selecione um fluxo de resgate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum fluxo selecionado</SelectItem>
                  {rescueFlows?.map((flow) => (
                    <SelectItem key={flow.id} value={String(flow.id)}>
                      {flow.name} {flow.active ? "" : "(inativo)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                Apenas fluxos com gatilho "Resgate" aparecem aqui.{" "}
                {(!rescueFlows || rescueFlows.length === 0) && (
                  <span className="text-amber-400">
                    Crie um fluxo com gatilho "Resgate" no Editor de Fluxos primeiro.
                  </span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Minutos de inatividade</Label>
                <Input
                  type="number"
                  min={5}
                  max={10080}
                  value={form.inactivityMinutes}
                  onChange={(e) => setForm(f => ({ ...f, inactivityMinutes: parseInt(e.target.value) || 30 }))}
                  className="bg-muted border-border text-foreground mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Tempo sem resposta do cliente para acionar resgate</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Intervalo entre tentativas (min)</Label>
                <Input
                  type="number"
                  min={5}
                  max={10080}
                  value={form.intervalMinutes}
                  onChange={(e) => setForm(f => ({ ...f, intervalMinutes: parseInt(e.target.value) || 60 }))}
                  className="bg-muted border-border text-foreground mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Espera mínima entre tentativas de resgate</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Máximo de tentativas</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={form.maxAttempts}
                  onChange={(e) => setForm(f => ({ ...f, maxAttempts: parseInt(e.target.value) || 3 }))}
                  className="bg-muted border-border text-foreground mt-1"
                />
              </div>
              <div>
                <Label className="text-muted-foreground">Máximo por execução</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={form.maxPerRun}
                  onChange={(e) => setForm(f => ({ ...f, maxPerRun: parseInt(e.target.value) || 20 }))}
                  className="bg-muted border-border text-foreground mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-muted-foreground">Frequência de verificação (min)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={form.checkIntervalMinutes}
                onChange={(e) => setForm(f => ({ ...f, checkIntervalMinutes: parseInt(e.target.value) || 2 }))}
                className="bg-muted border-border text-foreground mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">A cada quantos minutos o sistema verifica leads inativos</p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                {saveMutation.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
                Salvar configurações
              </Button>
              <Button
                variant="outline"
                onClick={() => runNowMutation.mutate()}
                disabled={runNowMutation.isPending || !form.rescueFlowId}
                className="border-border text-muted-foreground"
              >
                {runNowMutation.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Play size={14} className="mr-2" />}
                Executar agora
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* How it works */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-lg flex items-center gap-2">
              <Thermometer size={18} className="text-red-400" />
              Como funciona
            </CardTitle>
            <CardDescription>O resgate considera o status do funil para mensagens contextualizadas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {[
                {
                  step: "1",
                  title: "Detecção de inatividade",
                  desc: "O sistema verifica a cada poucos minutos se há leads que pararam de responder há mais de X minutos.",
                  color: "text-blue-400",
                },
                {
                  step: "2",
                  title: "Filtragem inteligente",
                  desc: "Leads fechados, perdidos ou encaminhados a vendedor são ignorados. Apenas leads em etapas ativas do funil são resgatados.",
                  color: "text-amber-400",
                },
                {
                  step: "3",
                  title: "Execução contextualizada",
                  desc: "O fluxo de resgate recebe todas as variáveis do lead (nome, veículo, etapa do funil, temperatura, troca, pagamento) para mensagens personalizadas.",
                  color: "text-green-400",
                },
                {
                  step: "4",
                  title: "Controle de tentativas",
                  desc: "O sistema respeita o limite de tentativas e o intervalo mínimo entre elas. Se o cliente responder, a tentativa é marcada como respondida.",
                  color: "text-purple-400",
                },
              ].map(item => (
                <div key={item.step} className="flex gap-3 items-start">
                  <div className={`w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-bold ${item.color} shrink-0 mt-0.5`}>
                    {item.step}
                  </div>
                  <div>
                    <p className="text-foreground text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 rounded-lg bg-red-900/10 border border-red-600/20">
              <p className="text-xs text-red-400/80">
                <MessageSquareWarning size={12} className="inline mr-1" />
                O fluxo de resgate pode usar nós de condição para enviar mensagens diferentes baseadas na etapa do funil.
                Exemplo: se o lead está em "interesse_definido", enviar mensagem sobre o veículo; se está em "dados_troca", perguntar sobre a avaliação.
              </p>
            </div>

            <div className="mt-2 p-3 rounded-lg bg-blue-900/10 border border-blue-600/20">
              <p className="text-xs text-blue-400/80 font-medium mb-2">
                <Info size={12} className="inline mr-1" />
                Exemplo de fluxo de resgate:
              </p>
              <div className="flex items-center gap-2 text-xs text-blue-400/60 flex-wrap">
                <Badge variant="outline" className="border-blue-600/30 text-blue-400/70">Início</Badge>
                <ArrowRight size={10} className="text-blue-400/40" />
                <Badge variant="outline" className="border-blue-600/30 text-blue-400/70">Condição: etapa_funil</Badge>
                <ArrowRight size={10} className="text-blue-400/40" />
                <Badge variant="outline" className="border-blue-600/30 text-blue-400/70">Mensagem personalizada</Badge>
                <ArrowRight size={10} className="text-blue-400/40" />
                <Badge variant="outline" className="border-blue-600/30 text-blue-400/70">Botões de resposta</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────

function HistoryTab() {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const { data, isLoading } = trpc.rescue.history.useQuery({ limit: pageSize, offset: page * pageSize });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const statusColors: Record<string, string> = {
    sent: "border-blue-600/40 text-blue-400",
    responded: "border-green-600/40 text-green-400",
    expired: "border-gray-600/40 text-gray-400",
    cancelled: "border-red-600/40 text-red-400",
  };

  const statusLabels: Record<string, string> = {
    sent: "Enviado",
    responded: "Respondido",
    expired: "Expirado",
    cancelled: "Cancelado",
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground text-lg">Histórico de Resgates</CardTitle>
        <CardDescription>{total} tentativas de resgate no total</CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <History size={48} className="mx-auto mb-3 opacity-20" />
            <p>Nenhum resgate enviado ainda</p>
            <p className="text-xs mt-1">Configure e ative o resgate para começar</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Contato</th>
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Telefone</th>
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Tentativa</th>
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Enviado em</th>
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Respondido em</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-border/50 hover:bg-muted">
                      <td className="py-3 px-3 text-foreground">{log.contactName || "—"}</td>
                      <td className="py-3 px-3 text-muted-foreground font-mono text-xs">{log.phone}</td>
                      <td className="py-3 px-3">
                        <Badge variant="outline" className="border-red-600/40 text-red-400">
                          #{log.attemptNumber}
                        </Badge>
                      </td>
                      <td className="py-3 px-3">
                        <Badge variant="outline" className={statusColors[log.status] || ""}>
                          {statusLabels[log.status] || log.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-muted-foreground text-xs">
                        {log.sentAt ? new Date(log.sentAt).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground text-xs">
                        {log.respondedAt ? new Date(log.respondedAt).toLocaleString("pt-BR") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-gray-500">
                  Página {page + 1} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(p => p - 1)}
                    className="border-border text-muted-foreground"
                  >
                    <ChevronLeft size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(p => p + 1)}
                    className="border-border text-muted-foreground"
                  >
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Variables Tab ──────────────────────────────────────────────────────────

function VariablesTab() {
  const variables = [
    { name: "{{nome}}", desc: "Nome do contato", example: "João" },
    { name: "{{nome_completo}}", desc: "Nome completo do lead", example: "João da Silva" },
    { name: "{{telefone}}", desc: "Telefone do lead", example: "5551999999999" },
    { name: "{{veiculo}}", desc: "Veículo de interesse", example: "Hilux SRV 2022" },
    { name: "{{intencao}}", desc: "Intenção do lead (comprar, trocar, etc.)", example: "comprar" },
    { name: "{{pagamento}}", desc: "Forma de pagamento", example: "Financiamento" },
    { name: "{{entrada}}", desc: "Valor de entrada", example: "R$ 20.000" },
    { name: "{{troca}}", desc: "Veículo de troca", example: "Gol 2018" },
    { name: "{{cidade}}", desc: "Cidade do lead", example: "Porto Alegre" },
    { name: "{{email}}", desc: "E-mail do lead", example: "joao@email.com" },
    { name: "{{cpf}}", desc: "CPF do lead", example: "123.456.789-00" },
    { name: "{{notas}}", desc: "Notas/resumo da conversa", example: "Cliente interessado em Hilux, quer financiar" },
    { name: "{{etapa_funil}}", desc: "Etapa atual do funil de vendas", example: "interesse_definido" },
    { name: "{{temperatura}}", desc: "Temperatura do lead (frio/morno/quente/muito_quente)", example: "morno" },
    { name: "{{tentativa_resgate}}", desc: "Número da tentativa de resgate atual", example: "1" },
  ];

  const funnelStages = [
    { status: "novo", temp: "frio", emoji: "❄️", desc: "Lead acabou de chegar, sem interação significativa" },
    { status: "interesse_definido", temp: "morno", emoji: "🌤️", desc: "Demonstrou interesse em veículo específico" },
    { status: "pagamento_definido", temp: "quente", emoji: "🔥", desc: "Definiu forma de pagamento (financiamento, à vista, etc.)" },
    { status: "dados_pessoais", temp: "quente", emoji: "🔥", desc: "Enviou dados pessoais (CPF, nome completo)" },
    { status: "dados_troca", temp: "quente", emoji: "🔥", desc: "Informou dados do veículo de troca" },
    { status: "encaminhado_vendedor", temp: "muito_quente", emoji: "🔥🔥", desc: "Foi encaminhado para vendedor" },
    { status: "negociando", temp: "muito_quente", emoji: "🔥🔥", desc: "Em negociação ativa com vendedor" },
    { status: "fechado", temp: "muito_quente", emoji: "✅", desc: "Negócio fechado" },
    { status: "perdido", temp: "frio", emoji: "❌", desc: "Lead perdido / desistiu" },
  ];

  return (
    <div className="space-y-6">
      {/* Variables Reference */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-lg">Variáveis Disponíveis no Fluxo de Resgate</CardTitle>
          <CardDescription>
            Use estas variáveis nos nós de mensagem do fluxo de resgate para personalizar as mensagens
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium">Variável</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium">Descrição</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium">Exemplo</th>
                </tr>
              </thead>
              <tbody>
                {variables.map(v => (
                  <tr key={v.name} className="border-b border-border/50 hover:bg-muted">
                    <td className="py-2.5 px-3">
                      <code className="bg-muted px-2 py-0.5 rounded text-xs text-red-400 font-mono">{v.name}</code>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{v.desc}</td>
                    <td className="py-2.5 px-3 text-foreground text-xs">{v.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Funnel Stages Reference */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-lg flex items-center gap-2">
            <Thermometer size={18} className="text-red-400" />
            Etapas do Funil e Temperaturas
          </CardTitle>
          <CardDescription>
            Use a condição "etapa_funil" no fluxo de resgate para enviar mensagens diferentes por etapa
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium">Etapa</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium">Temperatura</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {funnelStages.map(s => (
                  <tr key={s.status} className="border-b border-border/50 hover:bg-muted">
                    <td className="py-2.5 px-3">
                      <code className="bg-muted px-2 py-0.5 rounded text-xs text-foreground font-mono">{s.status}</code>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-sm">{s.emoji} {s.temp}</span>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs">{s.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-amber-900/10 border border-amber-600/20">
            <p className="text-xs text-amber-400/80">
              <Zap size={12} className="inline mr-1" />
              <strong>Dica:</strong> No fluxo de resgate, use um nó de condição com campo "etapa_funil" para ramificar a conversa.
              Exemplo: se etapa_funil = "interesse_definido", envie "Oi {"{{nome}}"}, ainda está interessado no {"{{veiculo}}"}?".
              Se etapa_funil = "dados_troca", envie "{"{{nome}}"}, já avaliamos seu {"{{troca}}"} para troca!".
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
