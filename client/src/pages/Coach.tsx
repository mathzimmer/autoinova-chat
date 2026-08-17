import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, AlertTriangle, Flame, TrendingUp, Trophy, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { Link } from "wouter";

function scoreColor(s: number) {
  return s >= 75 ? "text-emerald-600" : s >= 50 ? "text-yellow-600" : "text-red-500";
}

export default function Coach() {
  const team = trpc.team.list.useQuery();
  const overview = trpc.coach.teamOverview.useQuery();
  const alerts = trpc.coach.alerts.useQuery();
  const lessons = trpc.coach.lessons.useQuery({ limit: 20 });
  const [sellerId, setSellerId] = useState<number | null>(null);
  const coaching = trpc.coach.sellerCoaching.useQuery({ sellerId: sellerId || 0 }, { enabled: !!sellerId });

  const nameOf = (id: number | null) => {
    if (!id) return "Sem vendedor";
    const m = (team.data as any[])?.find((x) => x.id === id);
    return m?.name || `#${id}`;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-primary" /> Coach de Vendas
        </h1>
        <p className="text-muted-foreground mt-1">Avaliação dos atendimentos, coaching por vendedor e o que a loja aprendeu.</p>
      </div>

      {/* Alertas */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500" /> Leads esfriando</CardTitle>
            <CardDescription>Cliente esperando resposta há um tempo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {alerts.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (alerts.data?.esfriando?.length ? alerts.data.esfriando.map((a: any) => (
              <Link key={a.conversationId} href={`/inbox?conversation=${a.conversationId}`}>
                <div className="flex items-center gap-2 text-sm rounded-md border border-border px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer">
                  <span className="flex-1 truncate">{a.contactName || a.phone}</span>
                  <span className="text-xs text-muted-foreground">{nameOf(a.sellerId)}</span>
                  <span className="text-xs font-bold text-orange-500">{a.minutos}min</span>
                </div>
              </Link>
            )) : <p className="text-sm text-muted-foreground">Nada esfriando agora. 👍</p>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" /> Atendimentos abaixo do padrão</CardTitle>
            <CardDescription>Avaliações recentes com nota baixa.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {alerts.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (alerts.data?.foraDoPadrao?.length ? alerts.data.foraDoPadrao.map((a: any) => (
              <Link key={a.conversationId} href={`/inbox?conversation=${a.conversationId}`}>
                <div className="flex items-center gap-2 text-sm rounded-md border border-border px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer">
                  <span className="flex-1 truncate">{nameOf(a.sellerId)} — {a.reason || a.outcome}</span>
                  <span className="text-xs font-bold text-red-500">{a.scoreOverall}</span>
                </div>
              </Link>
            )) : <p className="text-sm text-muted-foreground">Nenhum abaixo do padrão. 🎉</p>)}
          </CardContent>
        </Card>
      </div>

      {/* Ranking por vendedor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Trophy className="w-4 h-4 text-yellow-500" /> Notas por vendedor (90 dias)</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (overview.data?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground text-left">
                  <tr><th className="py-1">Vendedor</th><th>Atend.</th><th>Início</th><th>Meio</th><th>Fim</th><th>Geral</th></tr>
                </thead>
                <tbody>
                  {overview.data.map((r: any) => (
                    <tr key={r.sellerId} className="border-t border-border">
                      <td className="py-1.5">{nameOf(r.sellerId)}</td>
                      <td>{r.count}</td>
                      <td>{r.avgInicio}</td>
                      <td>{r.avgMeio}</td>
                      <td>{r.avgFim}</td>
                      <td className={`font-bold ${scoreColor(r.avgOverall)}`}>{r.avgOverall}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">Ainda sem avaliações. Elas aparecem ao encerrar/ganhar/perder conversas.</p>)}
        </CardContent>
      </Card>

      {/* Coaching por vendedor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Coaching por vendedor</CardTitle>
          <CardDescription>Erros recorrentes e o que repetir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={sellerId ? String(sellerId) : ""} onValueChange={(v) => setSellerId(Number(v))}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Escolha um vendedor" /></SelectTrigger>
            <SelectContent>
              {(team.data as any[])?.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {sellerId && (coaching.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : coaching.data && (
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center gap-1 text-xs font-bold text-red-500 mb-1"><ThumbsDown className="w-3.5 h-3.5" /> Erros recorrentes</div>
                {coaching.data.topErros?.length ? coaching.data.topErros.map((e: string, i: number) => <p key={i} className="text-sm">• {e}</p>) : <p className="text-sm text-muted-foreground">—</p>}
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 mb-1"><ThumbsUp className="w-3.5 h-3.5" /> Faça mais isso</div>
                {coaching.data.facaMais?.length ? coaching.data.facaMais.map((e: string, i: number) => <p key={i} className="text-sm">• {e}</p>) : <p className="text-sm text-muted-foreground">—</p>}
              </div>
              {coaching.data.resumo && <p className="md:col-span-2 text-sm text-muted-foreground italic">{coaching.data.resumo} (média {coaching.data.avgOverall}, {coaching.data.count} atendimentos)</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Lições */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="w-4 h-4 text-primary" /> O que a loja aprendeu</CardTitle>
          <CardDescription>Lições de negócios ganhos e perdidos — usadas nas dicas ao vivo.</CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-2">
          {lessons.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (lessons.data?.length ? lessons.data.map((l: any) => (
            <div key={l.id} className={`text-sm rounded-md border px-2.5 py-1.5 ${l.kind === "ganhou" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
              <span className={`text-[10px] font-bold uppercase mr-1 ${l.kind === "ganhou" ? "text-emerald-600" : "text-red-500"}`}>{l.kind}</span>
              {l.lesson}
            </div>
          )) : <p className="text-sm text-muted-foreground">Ainda sem lições. Marque negócios como ganho/perdido para começar.</p>)}
        </CardContent>
      </Card>
    </div>
  );
}
