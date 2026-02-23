import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Users, Car, Bot, Clock, Zap, Target, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Dashboard() {
  const { data: stats } = trpc.dashboard.stats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: conversations } = trpc.conversation.list.useQuery({ status: "open" });
  const { data: leads } = trpc.lead.list.useQuery({ status: "all" });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Visão geral do atendimento Auto Inova</p>
      </div>

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
