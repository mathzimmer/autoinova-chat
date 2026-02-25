import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Brain, Search, UserCheck, FileText, ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock, Zap, BarChart3, Filter } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const TOOL_LABELS: Record<string, { label: string; icon: typeof Search; color: string }> = {
  buscar_veiculos: { label: "Buscar Veículos", icon: Search, color: "text-blue-400" },
  atualizar_lead: { label: "Atualizar Lead", icon: UserCheck, color: "text-green-400" },
  resumo_estoque: { label: "Resumo Estoque", icon: FileText, color: "text-purple-400" },
  rotear_para_vendedor: { label: "Rotear p/ Vendedor", icon: UserCheck, color: "text-orange-400" },
};

export default function AiAudit() {
  const [toolFilter, setToolFilter] = useState<string>("__all__");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const { data: stats } = trpc.aiDecision.stats.useQuery();
  const { data: decisionsData, isLoading } = trpc.aiDecision.list.useQuery({
    toolName: toolFilter !== "__all__" ? toolFilter : undefined,
    limit: pageSize,
    offset: page * pageSize,
  });

  const decisions = decisionsData?.decisions || [];
  const total = decisionsData?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="h-full overflow-auto p-6 pb-16">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Auditoria IA</h1>
              <p className="text-sm text-muted-foreground">Registro de todas as decisões e tool calls do agente de IA</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Zap className="h-4 w-4" />
                  <span className="text-xs">Total Decisões</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{stats.totalDecisions.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span className="text-xs">Taxa de Sucesso</span>
                </div>
                <p className="text-2xl font-bold text-green-400">{stats.successRate}%</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Clock className="h-4 w-4 text-blue-400" />
                  <span className="text-xs">Tempo Médio</span>
                </div>
                <p className="text-2xl font-bold text-blue-400">{stats.avgResponseTime}ms</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <BarChart3 className="h-4 w-4 text-purple-400" />
                  <span className="text-xs">Tools Usadas</span>
                </div>
                <p className="text-2xl font-bold text-purple-400">{stats.toolBreakdown?.length || 0}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tool Breakdown */}
        {stats?.toolBreakdown && stats.toolBreakdown.length > 0 && (
          <Card className="bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Distribuição por Tool</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {stats.toolBreakdown.map((tool: any) => {
                  const info = TOOL_LABELS[tool.toolName] || { label: tool.toolName, icon: Zap, color: "text-muted-foreground" };
                  const Icon = info.icon;
                  const successRate = tool.count > 0 ? Math.round((tool.successCount / tool.count) * 100) : 0;
                  return (
                    <div key={tool.toolName} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
                      <Icon className={`h-5 w-5 ${info.color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{info.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {tool.count}x | {successRate}% sucesso | ~{Math.round(tool.avgTime)}ms
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={toolFilter} onValueChange={(v) => { setToolFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filtrar por tool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as tools</SelectItem>
              <SelectItem value="buscar_veiculos">Buscar Veículos</SelectItem>
              <SelectItem value="atualizar_lead">Atualizar Lead</SelectItem>
              <SelectItem value="resumo_estoque">Resumo Estoque</SelectItem>
              <SelectItem value="rotear_para_vendedor">Rotear p/ Vendedor</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {total} registro{total !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Decisions Table */}
        <Card className="bg-card/50">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando decisões...</div>
            ) : decisions.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Nenhuma decisão registrada ainda.</p>
                <p className="text-xs mt-1">As decisões serão registradas conforme a IA atende clientes.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/20">
                      <th className="text-left p-3 font-medium text-muted-foreground">Data/Hora</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Conv.</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Tool</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Argumentos</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Resultado</th>
                      <th className="text-center p-3 font-medium text-muted-foreground">Qtd</th>
                      <th className="text-center p-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Tempo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisions.map((d: any) => {
                      const info = TOOL_LABELS[d.toolName] || { label: d.toolName, icon: Zap, color: "text-muted-foreground" };
                      const Icon = info.icon;
                      const args = d.toolArgs || {};
                      const argsSummary = Object.entries(args)
                        .filter(([_, v]) => v !== undefined && v !== null && v !== "")
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(", ");
                      
                      return (
                        <tr key={d.id} className="border-b border-border/50 hover:bg-secondary/10 transition-colors">
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(d.createdAt), "dd/MM HH:mm:ss", { locale: ptBR })}
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className="text-xs font-mono">
                              #{d.conversationId}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <Icon className={`h-3.5 w-3.5 ${info.color}`} />
                              <span className="text-xs font-medium">{info.label}</span>
                            </div>
                          </td>
                          <td className="p-3 max-w-[250px]">
                            <p className="text-xs text-muted-foreground truncate" title={argsSummary}>
                              {argsSummary || "—"}
                            </p>
                          </td>
                          <td className="p-3 max-w-[200px]">
                            <p className="text-xs text-muted-foreground truncate" title={d.toolResultSummary || ""}>
                              {d.toolResultSummary ? d.toolResultSummary.substring(0, 80) + (d.toolResultSummary.length > 80 ? "..." : "") : "—"}
                            </p>
                          </td>
                          <td className="p-3 text-center">
                            {d.resultCount !== null && d.resultCount !== undefined ? (
                              <Badge variant={d.resultCount > 0 ? "default" : "secondary"} className="text-xs">
                                {d.resultCount}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {d.success ? (
                              <CheckCircle className="h-4 w-4 text-green-400 mx-auto" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                            )}
                          </td>
                          <td className="p-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                            {d.responseTimeMs ? `${d.responseTimeMs}ms` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Página {page + 1} de {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
