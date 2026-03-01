import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Users, Car, Bot, Clock, Zap, Target, TrendingUp, AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

export default function Dashboard() {
  const { data: stats } = trpc.dashboard.stats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: conversations } = trpc.conversation.list.useQuery({ status: "open" });
  const { data: leads } = trpc.lead.list.useQuery({ status: "all" });
  const { data: tokenStatus, refetch: refetchTokens } = trpc.tokenHealth.status.useQuery(undefined, {
    refetchInterval: 60000, // Refresh every minute
  });
  const checkTokensMutation = trpc.tokenHealth.check.useMutation({
    onSuccess: () => {
      refetchTokens();
      toast.success("Verificação de tokens concluída");
    },
    onError: (err) => {
      toast.error("Erro ao verificar tokens: " + err.message);
    },
  });

  const failedTokens = tokenStatus?.filter((t: any) => t.status === "failed") || [];
  const hasTokenIssues = failedTokens.length > 0;

  return (
    <div className="p-6 pb-16 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Visão geral do atendimento Auto Inova</p>
      </div>

      {/* Token Health Alert Banner */}
      {hasTokenIssues && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-400">Atenção: Token(s) com problema</p>
              <div className="mt-2 space-y-1.5">
                {failedTokens.map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-red-300/90">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">{t.name}</span>
                    <span className="text-red-300/70">— {t.message}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-red-300/70 mt-2">
                Acesse o Meta Business Manager para gerar novos tokens. Algumas funcionalidades podem estar indisponíveis.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={() => checkTokensMutation.mutate()}
              disabled={checkTokensMutation.isPending}
            >
              {checkTokensMutation.isPending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Verificar</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Token Health Summary (when all OK) */}
      {tokenStatus && tokenStatus.length > 0 && !hasTokenIssues && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            <div className="flex-1 flex items-center gap-4">
              {tokenStatus.map((t: any, i: number) => (
                <span key={i} className="text-xs text-green-400/80">
                  {t.name}: <span className="font-medium text-green-400">OK</span>
                </span>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground hover:text-foreground h-7 px-2"
              onClick={() => checkTokensMutation.mutate()}
              disabled={checkTokensMutation.isPending}
              title="Verificar tokens agora"
            >
              {checkTokensMutation.isPending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={<MessageSquare className="h-5 w-5" />}
          label="Total Conversas"
          value={stats?.totalConversations ?? 0}
          accent="text-primary"
          bgAccent="bg-primary/10"
        />
        <MetricCard
          icon={<Zap className="h-5 w-5" />}
          label="Conversas Abertas"
          value={stats?.openConversations ?? 0}
          accent="text-green-400"
          bgAccent="bg-green-500/10"
        />
        <MetricCard
          icon={<Target className="h-5 w-5" />}
          label="Leads Qualificados"
          value={stats?.qualifiedLeads ?? 0}
          accent="text-yellow-400"
          bgAccent="bg-yellow-500/10"
        />
        <MetricCard
          icon={<Car className="h-5 w-5" />}
          label="Veículos Disponíveis"
          value={stats?.totalVehicles ?? 0}
          accent="text-blue-400"
          bgAccent="bg-blue-500/10"
        />
      </div>

      {/* AI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          icon={<Bot className="h-5 w-5" />}
          label="Interações IA"
          value={stats?.totalCalls ?? 0}
          accent="text-purple-400"
          bgAccent="bg-purple-500/10"
        />
        <MetricCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Tokens Utilizados"
          value={stats?.totalTokens ? Number(stats.totalTokens).toLocaleString("pt-BR") : "0"}
          accent="text-orange-400"
          bgAccent="bg-orange-500/10"
        />
        <MetricCard
          icon={<Clock className="h-5 w-5" />}
          label="Tempo Médio Resposta IA"
          value={stats?.avgResponseTime ? `${Math.round(Number(stats.avgResponseTime))}ms` : "0ms"}
          accent="text-cyan-400"
          bgAccent="bg-cyan-500/10"
        />
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Conversations */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Conversas Ativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {!conversations || conversations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma conversa ativa</p>
              ) : (
                <div className="space-y-2">
                  {conversations.slice(0, 10).map((conv) => (
                    <div key={conv.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors">
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium text-secondary-foreground">
                          {(conv.contactName || conv.phone || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-card-foreground truncate">{conv.contactName || conv.phone}</p>
                        <p className="text-xs text-muted-foreground truncate">{conv.lastMessagePreview || "Sem mensagens"}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {conv.aiActive ? (
                          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">IA</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400">Humano</Badge>
                        )}
                        {conv.lastMessageAt && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false, locale: ptBR })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Recent Leads */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-yellow-400" />
              Leads Recentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {!leads || leads.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead registrado</p>
              ) : (
                <div className="space-y-2">
                  {leads.slice(0, 10).map((lead) => (
                    <div key={lead.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors">
                      <div className="h-8 w-8 rounded-full bg-yellow-500/10 flex items-center justify-center shrink-0">
                        <Target className="h-4 w-4 text-yellow-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-card-foreground truncate">{lead.name || lead.phone}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {lead.vehicleInterest || lead.intention || "Sem informações"}
                        </p>
                      </div>
                      <Badge
                        variant={lead.status === "qualified" ? "default" : "outline"}
                        className="text-[10px] capitalize shrink-0"
                      >
                        {lead.status === "new" ? "Novo" :
                         lead.status === "qualifying" ? "Qualificando" :
                         lead.status === "qualified" ? "Qualificado" :
                         lead.status === "contacted" ? "Contatado" :
                         lead.status === "converted" ? "Convertido" :
                         lead.status === "lost" ? "Perdido" : lead.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, accent, bgAccent }: { icon: React.ReactNode; label: string; value: string | number; accent: string; bgAccent: string }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-lg ${bgAccent} flex items-center justify-center shrink-0`}>
            <span className={accent}>{icon}</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold text-card-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
