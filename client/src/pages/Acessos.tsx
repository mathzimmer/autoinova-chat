import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw, Circle, ShieldCheck } from "lucide-react";

function fmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function duracao(from: string | Date, to?: string | Date | null): string {
  const a = new Date(from).getTime();
  const b = to ? new Date(to).getTime() : Date.now();
  const min = Math.max(0, Math.round((b - a) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function desde(d: string | Date): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h}h`;
}

export default function Acessos() {
  const online = trpc.accessAudit.online.useQuery(undefined, { refetchInterval: 30_000 });
  const history = trpc.accessAudit.history.useQuery({ limit: 150 }, { refetchInterval: 60_000 });

  const onlineIds = useMemo(
    () => new Set((online.data?.sessions || []).map((s: any) => s.id)),
    [online.data]
  );

  const refresh = () => { online.refetch(); history.refetch(); };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Auditoria de acesso</h1>
            <p className="text-sm text-muted-foreground">Quem está online agora e o histórico de entradas e saídas da equipe.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="w-4 h-4 mr-2" /> Atualizar
        </Button>
      </div>

      {/* Online agora */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Circle className="w-3 h-3 fill-green-500 text-green-500" />
            Online agora
            <Badge variant="secondary">{online.data?.sessions?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(online.data?.sessions?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém online no momento.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {online.data!.sessions.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.memberName || s.memberEmail || `Membro #${s.teamMemberId}`}</p>
                    <p className="text-xs text-muted-foreground">Entrou {desde(s.loginAt)} · ativo {desde(s.lastSeenAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Considera online quem teve atividade nos últimos {online.data?.windowMin ?? 3} minutos.
          </p>
        </CardContent>
      </Card>

      {/* Histórico */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de sessões</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Membro</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Entrou</TableHead>
                  <TableHead>Saiu</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                      Nenhuma sessão registrada ainda.
                    </TableCell>
                  </TableRow>
                ) : (
                  (history.data || []).map((s: any) => {
                    const isOnline = onlineIds.has(s.id) && !s.logoutAt;
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="font-medium">{s.memberName || `Membro #${s.teamMemberId}`}</div>
                          {s.memberEmail && <div className="text-xs text-muted-foreground">{s.memberEmail}</div>}
                        </TableCell>
                        <TableCell>
                          {isOnline ? (
                            <Badge className="bg-green-500 hover:bg-green-500">Online</Badge>
                          ) : s.logoutAt ? (
                            <Badge variant="outline">Encerrada</Badge>
                          ) : (
                            <Badge variant="secondary">Inativa</Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{fmt(s.loginAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {s.logoutAt ? fmt(s.logoutAt) : <span className="text-muted-foreground">—</span>}
                          {s.endReason === "novo_login" && <span className="ml-1 text-xs text-muted-foreground">(novo login)</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{duracao(s.loginAt, s.logoutAt)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.ip || "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
