import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Clock, Play, Settings, History, MessageSquare, Send,
  Loader2, RefreshCw, AlertTriangle, CheckCircle2, Zap,
  FileText, ChevronLeft, ChevronRight,
} from "lucide-react";

export default function FollowUpPage() {
  const [activeTab, setActiveTab] = useState<"config" | "history" | "templates">("config");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-600/40 flex items-center justify-center">
                <Zap size={20} className="text-amber-400" />
              </div>
              Follow-Up Automático
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure o reengajamento automático de leads inativos via WhatsApp
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { id: "config" as const, label: "Configurações", icon: Settings },
            { id: "history" as const, label: "Histórico", icon: History },
            { id: "templates" as const, label: "Templates WhatsApp", icon: FileText },
          ].map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={activeTab === tab.id
                ? "bg-amber-600 hover:bg-amber-700"
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
        {activeTab === "templates" && <TemplatesTab />}
      </div>
    </div>
  );
}

// ─── Config Tab ──────────────────────────────────────────────────────────────

function ConfigTab() {
  const { data: config, isLoading, refetch } = trpc.followUp.getConfig.useQuery();
  const { data: stats } = trpc.followUp.stats.useQuery();
  const saveMutation = trpc.followUp.saveConfig.useMutation({
    onSuccess: () => {
      toast.success("Configurações salvas! O job de follow-up foi reiniciado.");
      refetch();
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });
  const runNowMutation = trpc.followUp.runNow.useMutation({
    onSuccess: (result) => {
      toast.success(`Follow-up executado: ${result.sent} enviados, ${result.skipped} pulados, ${result.errors} erros`);
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });

  const [form, setForm] = useState({
    enabled: true,
    maxAttempts: 3,
    inactiveHours: 24,
    intervalHours: 6,
    maxPerRun: 20,
    useTemplateAfter24h: true,
    templateName: "follow_up_reengajamento",
    messages: [
      "Primeira tentativa. Abordagem: curiosidade e disponibilidade. Tom: amigável e leve.",
      "Segunda tentativa. Abordagem: urgência suave (estoque limitado ou novidade). Tom: prestativo.",
      "Terceira e última tentativa. Abordagem: encerramento gentil. Deixar a porta aberta. Tom: respeitoso.",
    ],
  });

  useEffect(() => {
    if (config) {
      setForm({
        enabled: config.enabled,
        maxAttempts: config.maxAttempts,
        inactiveHours: config.inactiveHours,
        intervalHours: config.intervalHours,
        maxPerRun: config.maxPerRun,
        useTemplateAfter24h: config.useTemplateAfter24h,
        templateName: config.templateName,
        messages: config.messages,
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
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total enviados", value: stats.total, icon: Send, color: "#3b82f6" },
            { label: "Últimas 24h", value: stats.last24h, icon: Clock, color: "#22c55e" },
            { label: "Últimos 7 dias", value: stats.last7d, icon: History, color: "#a855f7" },
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

      <div className="grid grid-cols-2 gap-6">
        {/* Main Settings */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-lg">Configurações Gerais</CardTitle>
            <CardDescription>Defina quando e como o follow-up automático deve funcionar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-foreground">Follow-up ativo</Label>
                <p className="text-xs text-gray-500">Ativar/desativar o envio automático</p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm(f => ({ ...f, enabled: v }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Horas de inatividade</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={form.inactiveHours}
                  onChange={(e) => setForm(f => ({ ...f, inactiveHours: parseInt(e.target.value) || 24 }))}
                  className="bg-muted border-border text-foreground mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Tempo sem resposta para acionar follow-up</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Intervalo entre execuções (h)</Label>
                <Input
                  type="number"
                  min={1}
                  max={72}
                  value={form.intervalHours}
                  onChange={(e) => setForm(f => ({ ...f, intervalHours: parseInt(e.target.value) || 6 }))}
                  className="bg-muted border-border text-foreground mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">A cada quantas horas o job roda</p>
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

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-foreground">Usar template após 24h</Label>
                <p className="text-xs text-gray-500">Enviar template aprovado pela Meta quando fora da janela de 24h</p>
              </div>
              <Switch
                checked={form.useTemplateAfter24h}
                onCheckedChange={(v) => setForm(f => ({ ...f, useTemplateAfter24h: v }))}
              />
            </div>

            {form.useTemplateAfter24h && (
              <div>
                <Label className="text-muted-foreground">Nome do template</Label>
                <Input
                  value={form.templateName}
                  onChange={(e) => setForm(f => ({ ...f, templateName: e.target.value }))}
                  className="bg-muted border-border text-foreground mt-1"
                  placeholder="follow_up_reengajamento"
                />
                <p className="text-xs text-gray-500 mt-1">Nome exato do template aprovado no Meta Business Manager</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {saveMutation.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
                Salvar configurações
              </Button>
              <Button
                variant="outline"
                onClick={() => runNowMutation.mutate()}
                disabled={runNowMutation.isPending}
                className="border-border text-muted-foreground"
              >
                {runNowMutation.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Play size={14} className="mr-2" />}
                Executar agora
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Message Templates */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-lg">Instruções por Tentativa</CardTitle>
            <CardDescription>
              A IA usará estas instruções para gerar mensagens personalizadas para cada tentativa de follow-up
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {form.messages.map((msg, idx) => (
              <div key={idx}>
                <Label className="text-muted-foreground">
                  <Badge variant="outline" className="mr-2 border-amber-600/40 text-amber-400">
                    Tentativa {idx + 1}
                  </Badge>
                </Label>
                <Textarea
                  value={msg}
                  onChange={(e) => {
                    const newMsgs = [...form.messages];
                    newMsgs[idx] = e.target.value;
                    setForm(f => ({ ...f, messages: newMsgs }));
                  }}
                  className="bg-muted border-border text-foreground mt-2 min-h-[80px]"
                  placeholder={`Instruções para a tentativa ${idx + 1}...`}
                />
              </div>
            ))}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm(f => ({ ...f, messages: [...f.messages, ""] }))}
                className="border-border text-muted-foreground"
                disabled={form.messages.length >= 10}
              >
                + Adicionar tentativa
              </Button>
              {form.messages.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm(f => ({ ...f, messages: f.messages.slice(0, -1) }))}
                  className="border-red-600/40 text-red-400 hover:text-red-300"
                >
                  Remover última
                </Button>
              )}
            </div>

            <div className="mt-4 p-3 rounded-lg bg-amber-900/10 border border-amber-600/20">
              <p className="text-xs text-amber-400/80">
                <MessageSquare size={12} className="inline mr-1" />
                A IA gera mensagens únicas para cada lead usando estas instruções como guia.
                Ela personaliza com o nome do cliente, veículo de interesse e dados do lead.
              </p>
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
  const { data, isLoading } = trpc.followUp.history.useQuery({ limit: pageSize, offset: page * pageSize });

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

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground text-lg">Histórico de Follow-ups</CardTitle>
        <CardDescription>{total} mensagens enviadas no total</CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <History size={48} className="mx-auto mb-3 opacity-20" />
            <p>Nenhum follow-up enviado ainda</p>
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
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Mensagem</th>
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Enviado em</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-border/50 hover:bg-muted">
                      <td className="py-3 px-3 text-foreground">{log.contactName || "—"}</td>
                      <td className="py-3 px-3 text-muted-foreground font-mono text-xs">{log.phone}</td>
                      <td className="py-3 px-3">
                        <Badge variant="outline" className="border-amber-600/40 text-amber-400">
                          #{log.attemptNumber}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-muted-foreground max-w-xs truncate">{log.message}</td>
                      <td className="py-3 px-3 text-muted-foreground text-xs">
                        {log.sentAt ? new Date(log.sentAt).toLocaleString("pt-BR") : "—"}
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

// ─── Templates Tab ───────────────────────────────────────────────────────────

function TemplatesTab() {
  const { data: templates, isLoading, refetch } = trpc.whatsappTemplate.list.useQuery();

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-foreground text-lg">Templates de Mensagem WhatsApp</CardTitle>
              <CardDescription>
                Templates aprovados pela Meta para envio fora da janela de 24h.
                Gerencie seus templates no{" "}
                <a
                  href="https://business.facebook.com/wa/manage/message-templates/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  Meta Business Manager
                </a>
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-border text-muted-foreground"
            >
              <RefreshCw size={14} className="mr-2" />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!templates || templates.length === 0 ? (
            <div className="text-center py-12">
              <FileText size={48} className="mx-auto mb-3 text-gray-600 opacity-20" />
              <p className="text-muted-foreground font-medium">Nenhum template encontrado</p>
              <p className="text-gray-500 text-sm mt-1">
                Crie templates no Meta Business Manager e eles aparecerão aqui após aprovação.
              </p>
              <div className="mt-4 p-4 rounded-lg bg-blue-900/10 border border-blue-600/20 max-w-lg mx-auto text-left">
                <p className="text-xs text-blue-400/80 font-medium mb-2">Como criar um template:</p>
                <ol className="text-xs text-blue-400/60 space-y-1 list-decimal list-inside">
                  <li>Acesse o Meta Business Manager</li>
                  <li>Vá em WhatsApp {">"} Configurações da conta {">"} Templates de mensagem</li>
                  <li>Clique em "Criar template"</li>
                  <li>Escolha categoria "Marketing" ou "Utilitário"</li>
                  <li>Defina o nome (ex: follow_up_reengajamento)</li>
                  <li>Escreva o corpo da mensagem com variáveis (ex: {"{{1}}"} para nome)</li>
                  <li>Envie para aprovação (leva de minutos a 24h)</li>
                </ol>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((tpl, idx) => (
                <div
                  key={idx}
                  className="bg-muted border border-border rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-foreground font-medium">{tpl.name}</span>
                    <Badge
                      variant="outline"
                      className={
                        tpl.status === "APPROVED"
                          ? "border-green-600/40 text-green-400"
                          : tpl.status === "REJECTED"
                          ? "border-red-600/40 text-red-400"
                          : "border-yellow-600/40 text-yellow-400"
                      }
                    >
                      {tpl.status === "APPROVED" ? "Aprovado" : tpl.status === "REJECTED" ? "Rejeitado" : "Pendente"}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    Idioma: {tpl.language} · Categoria: {tpl.category}
                  </div>
                  {tpl.components?.map((comp, ci) => (
                    <div key={ci} className="text-sm text-muted-foreground mt-1">
                      {comp.type === "BODY" && comp.text && (
                        <p className="bg-card rounded p-2 text-xs">{comp.text}</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
