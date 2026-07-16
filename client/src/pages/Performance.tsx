/**
 * Performance — avaliação contínua do atendimento com IA.
 * Modo por INSTÂNCIA (número) ou por ATENDENTE. Nota composta (5 pilares) +
 * coaching + chat interno com a IA.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Trophy, Clock, DollarSign, AlertTriangle, Sparkles, Send, Loader2,
  ChevronRight, Target, Gauge, Smartphone, UserRound,
} from "lucide-react";

const PERIODS = [
  { label: "7 dias", value: 7 },
  { label: "30 dias", value: 30 },
  { label: "90 dias", value: 90 },
];

function fmtDuration(sec: number): string {
  if (!sec) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  return `${(sec / 3600).toFixed(1)}h`;
}
function brl(cents: number): string {
  return "R$ " + (cents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function scoreColor(s: number): string {
  if (s >= 75) return "text-green-600";
  if (s >= 50) return "text-yellow-600";
  if (s >= 30) return "text-orange-500";
  return "text-red-500";
}
function scoreBg(s: number): string {
  if (s >= 75) return "bg-green-500";
  if (s >= 50) return "bg-yellow-500";
  if (s >= 30) return "bg-orange-500";
  return "bg-red-500";
}

type Mode = "instance" | "member";

export default function Performance() {
  const [sinceDays, setSinceDays] = useState(30);
  const [mode, setMode] = useState<Mode>("instance");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const byInstance = trpc.performance.overviewByInstance.useQuery({ sinceDays }, { enabled: mode === "instance" });
  const byMember = trpc.performance.overview.useQuery({ sinceDays }, { enabled: mode === "member" });

  const evaluateInstance = trpc.performance.evaluateInstance.useMutation({
    onSuccess: () => { toast.success("Avaliação da IA concluída"); byInstance.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const evaluateMember = trpc.performance.evaluate.useMutation({
    onSuccess: () => { toast.success("Avaliação da IA concluída"); byMember.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const loading = mode === "instance" ? byInstance.isLoading : byMember.isLoading;
  // Normaliza as duas fontes num formato comum de linha
  const rows = (mode === "instance" ? (byInstance.data || []) : (byMember.data || [])).map((r: any) => ({
    key: mode === "instance" ? String(r.instanceName) : String(r.memberId),
    title: mode === "instance" ? r.label : r.name,
    subtitle: mode === "instance" ? "instância / número" : r.cargo,
    memberId: r.memberId as number | undefined,
    instanceName: r.instanceName as string | undefined,
    score: r.score, conversionRate: r.conversionRate,
    leadsReceived: r.leadsReceived, leadsConverted: r.leadsConverted,
    avgFirstResponseSec: r.avgFirstResponseSec, valueSoldCents: r.valueSoldCents, leadsNoReply: r.leadsNoReply,
    conversionScore: r.conversionScore, speedScore: r.speedScore, conductScore: r.conductScore,
    valueScore: r.valueScore, activityScore: r.activityScore,
  }));

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Trophy className="text-purple-500" size={26} />
        <h1 className="text-2xl font-bold">Performance {mode === "instance" ? "por Instância" : "de Vendedores"}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Avaliação contínua do atendimento com nota, indicadores e coaching da IA.
      </p>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {/* Modo: instância x atendente */}
        <div className="flex rounded-lg overflow-hidden border border-border">
          <button onClick={() => { setMode("instance"); setSelectedKey(null); }}
            className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${mode === "instance" ? "bg-purple-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
            <Smartphone size={14} /> Instância
          </button>
          <button onClick={() => { setMode("member"); setSelectedKey(null); }}
            className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${mode === "member" ? "bg-purple-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
            <UserRound size={14} /> Atendente
          </button>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-border">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setSinceDays(p.value)}
              className={`px-3 py-1.5 text-sm ${sinceDays === p.value ? "bg-purple-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Ranking */}
        <div className="lg:col-span-2 space-y-3">
          {loading && <div className="text-muted-foreground text-sm">Calculando indicadores…</div>}
          {!loading && rows.length === 0 && (
            <div className="text-muted-foreground text-sm border border-dashed border-border rounded-xl p-8 text-center">
              {mode === "instance" ? "Nenhuma instância com atividade no período." : "Nenhum atendente com atividade no período."}
            </div>
          )}
          {rows.map((m, i) => (
            <div key={m.key}
              onClick={() => setSelectedKey(m.key === selectedKey ? null : m.key)}
              className={`bg-card border rounded-xl p-4 cursor-pointer transition ${selectedKey === m.key ? "border-purple-500 ring-1 ring-purple-500/30" : "border-border hover:border-purple-500/40"}`}>
              <div className="flex items-center gap-4">
                <div className="text-lg font-bold text-muted-foreground w-6 text-center">{i + 1}</div>
                <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-full border-4 ${scoreColor(m.score)}`} style={{ borderColor: "currentColor" }}>
                  <span className={`text-xl font-extrabold ${scoreColor(m.score)}`}>{m.score}</span>
                  <span className="text-[9px] text-muted-foreground -mt-1">/100</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{m.title}</span>
                    <span className="text-[10px] uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{m.subtitle}</span>
                    {m.conductScore === 0 && <span className="text-[10px] text-purple-400">sem análise IA</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Target size={12} /> Conversão {(m.conversionRate * 100).toFixed(0)}% ({m.leadsConverted}/{m.leadsReceived})</span>
                    <span className="flex items-center gap-1"><Clock size={12} /> 1ª resp {fmtDuration(m.avgFirstResponseSec)}</span>
                    <span className="flex items-center gap-1"><DollarSign size={12} /> {brl(m.valueSoldCents)}</span>
                    {m.leadsNoReply > 0 && <span className="flex items-center gap-1 text-red-500"><AlertTriangle size={12} /> {m.leadsNoReply} sem resposta</span>}
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 mt-2">
                    {[
                      { k: "Conv", v: m.conversionScore },
                      { k: "Veloc", v: m.speedScore },
                      { k: "Cond", v: m.conductScore },
                      { k: "Valor", v: m.valueScore },
                      { k: "Ativ", v: m.activityScore },
                    ].map(p => (
                      <div key={p.k} title={`${p.k}: ${p.v}`}>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${scoreBg(p.v)}`} style={{ width: `${p.v}%` }} />
                        </div>
                        <div className="text-[9px] text-muted-foreground text-center mt-0.5">{p.k}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <ChevronRight size={18} className={`text-muted-foreground transition ${selectedKey === m.key ? "rotate-90" : ""}`} />
              </div>

              {selectedKey === m.key && (
                <CoachDetail
                  mode={mode}
                  memberId={m.memberId}
                  instanceName={m.instanceName}
                  onEvaluate={() => {
                    if (mode === "instance" && m.instanceName) evaluateInstance.mutate({ instanceName: m.instanceName, sinceDays });
                    else if (m.memberId != null) evaluateMember.mutate({ memberId: m.memberId, sinceDays });
                  }}
                  evaluating={mode === "instance"
                    ? (evaluateInstance.isPending && evaluateInstance.variables?.instanceName === m.instanceName)
                    : (evaluateMember.isPending && evaluateMember.variables?.memberId === m.memberId)}
                />
              )}
            </div>
          ))}
        </div>

        {/* Chat com a IA */}
        <div className="lg:col-span-1">
          <PerformanceChat sinceDays={sinceDays} mode={mode} />
        </div>
      </div>
    </div>
  );
}

function CoachDetail({ mode, memberId, instanceName, onEvaluate, evaluating }: {
  mode: Mode; memberId?: number; instanceName?: string; onEvaluate: () => void; evaluating: boolean;
}) {
  const memberEval = trpc.performance.lastEvaluation.useQuery({ memberId: memberId ?? 0 }, { enabled: mode === "member" && memberId != null });
  const instanceEval = trpc.performance.lastInstanceEvaluation.useQuery({ instanceName: instanceName ?? "" }, { enabled: mode === "instance" && !!instanceName });
  const ev: any = mode === "instance" ? instanceEval.data : memberEval.data;

  return (
    <div className="mt-4 pt-4 border-t border-border" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold flex items-center gap-1.5"><Sparkles size={15} className="text-purple-500" /> Coaching da IA</div>
        <button onClick={onEvaluate} disabled={evaluating}
          className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg">
          {evaluating ? <Loader2 size={13} className="animate-spin" /> : <Gauge size={13} />}
          {evaluating ? "Analisando…" : ev ? "Reavaliar" : "Avaliar com IA"}
        </button>
      </div>

      {!ev && !evaluating && (
        <p className="text-xs text-muted-foreground">Ainda sem análise qualitativa. Clique em “Avaliar com IA” para a IA ler as conversas e gerar diagnóstico + dicas.</p>
      )}

      {ev && (
        <div className="space-y-3 text-sm">
          {ev.summary && <p className="text-muted-foreground italic">{ev.summary}</p>}
          {!!ev.strengths?.length && (
            <div>
              <div className="text-xs font-semibold text-green-600 mb-1">Pontos fortes</div>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">{ev.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {!!ev.improvements?.length && (
            <div>
              <div className="text-xs font-semibold text-orange-500 mb-1">A melhorar</div>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">{ev.improvements.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {!!ev.tips?.length && (
            <div>
              <div className="text-xs font-semibold text-purple-500 mb-1">Dicas práticas</div>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">{ev.tips.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground">
            Última avaliação: {ev.createdAt ? new Date(ev.createdAt).toLocaleString("pt-BR") : "—"}
          </div>
        </div>
      )}
    </div>
  );
}

function PerformanceChat({ sinceDays, mode }: { sinceDays: number; mode: Mode }) {
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = trpc.performance.chat.useMutation({
    onSuccess: (r) => setHistory(h => [...h, { role: "assistant", content: r.reply }]),
    onError: (e) => { toast.error(e.message); setHistory(h => h.slice(0, -1)); },
  });

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [history, chat.isPending]);

  function send() {
    const text = input.trim();
    if (!text || chat.isPending) return;
    const next = [...history, { role: "user" as const, content: text }];
    setHistory(next);
    setInput("");
    chat.mutate({ history: next, sinceDays, groupBy: mode });
  }

  const suggestions = mode === "instance"
    ? ["Qual instância converte melhor?", "Qual número está mais lento?", "Onde estamos perdendo vendas?", "Qual instância deixa mais lead sem resposta?"]
    : ["Quem está performando melhor e por quê?", "Quem precisa de atenção agora?", "Onde estamos perdendo vendas?", "Quem está deixando lead sem resposta?"];

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-[560px] sticky top-4">
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Sparkles size={16} className="text-purple-500" />
        <span className="font-semibold text-sm">Converse com a IA</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Pergunte sobre a performance {mode === "instance" ? "das instâncias" : "do time"}. Ex.:</p>
            {suggestions.map(s => (
              <button key={s} onClick={() => { setInput(s); }}
                className="block w-full text-left text-xs bg-muted hover:bg-muted/70 rounded-lg px-3 py-2 text-muted-foreground">
                {s}
              </button>
            ))}
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-purple-600 text-white" : "bg-muted text-foreground"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {chat.isPending && (
          <div className="flex justify-start"><div className="bg-muted rounded-2xl px-3 py-2"><Loader2 size={15} className="animate-spin text-muted-foreground" /></div></div>
        )}
      </div>
      <div className="p-3 border-t border-border flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(); }}
          placeholder="Pergunte…"
          className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500" />
        <button onClick={send} disabled={chat.isPending || !input.trim()}
          className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg px-3">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
