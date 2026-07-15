/**
 * Performance de Vendedores — avaliação contínua do atendimento com IA.
 * Nota composta (5 pilares) + coaching + chat interno com a IA.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  TrendingUp, Clock, Trophy, MessageSquare, DollarSign, AlertTriangle,
  Sparkles, Send, Loader2, ChevronRight, Target, Gauge,
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

export default function Performance() {
  const [sinceDays, setSinceDays] = useState(30);
  const [instanceName, setInstanceName] = useState<string>("");
  const [selectedMember, setSelectedMember] = useState<number | null>(null);

  const filters = { sinceDays, instanceName: instanceName || undefined };
  const overview = trpc.performance.overview.useQuery(filters);
  const instances = trpc.performance.instances.useQuery();
  const utils = trpc.useUtils();

  const evaluate = trpc.performance.evaluate.useMutation({
    onSuccess: () => { toast.success("Avaliação da IA concluída"); overview.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const team = overview.data || [];
  const selected = team.find(t => t.memberId === selectedMember) || null;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Trophy className="text-purple-500" size={26} />
        <h1 className="text-2xl font-bold">Performance de Vendedores</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Avaliação contínua do atendimento com nota, indicadores e coaching da IA.
      </p>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex rounded-lg overflow-hidden border border-border">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setSinceDays(p.value)}
              className={`px-3 py-1.5 text-sm ${sinceDays === p.value ? "bg-purple-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <select value={instanceName} onChange={e => setInstanceName(e.target.value)}
          className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm outline-none">
          <option value="">Todas as instâncias</option>
          {(instances.data || []).map(i => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Ranking */}
        <div className="lg:col-span-2 space-y-3">
          {overview.isLoading && <div className="text-muted-foreground text-sm">Calculando indicadores…</div>}
          {!overview.isLoading && team.length === 0 && (
            <div className="text-muted-foreground text-sm border border-dashed border-border rounded-xl p-8 text-center">
              Nenhum atendente com atividade no período.
            </div>
          )}
          {team.map((m, i) => (
            <div key={m.memberId}
              onClick={() => setSelectedMember(m.memberId === selectedMember ? null : m.memberId)}
              className={`bg-card border rounded-xl p-4 cursor-pointer transition ${selectedMember === m.memberId ? "border-purple-500 ring-1 ring-purple-500/30" : "border-border hover:border-purple-500/40"}`}>
              <div className="flex items-center gap-4">
                <div className="text-lg font-bold text-muted-foreground w-6 text-center">{i + 1}</div>
                <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-full border-4 ${scoreColor(m.score)}`}
                  style={{ borderColor: "currentColor" }}>
                  <span className={`text-xl font-extrabold ${scoreColor(m.score)}`}>{m.score}</span>
                  <span className="text-[9px] text-muted-foreground -mt-1">/100</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{m.name}</span>
                    <span className="text-[10px] uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{m.cargo}</span>
                    {m.conductScore === 0 && <span className="text-[10px] text-purple-400">sem análise IA</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Target size={12} /> Conversão {(m.conversionRate * 100).toFixed(0)}% ({m.leadsConverted}/{m.leadsReceived})</span>
                    <span className="flex items-center gap-1"><Clock size={12} /> 1ª resp {fmtDuration(m.avgFirstResponseSec)}</span>
                    <span className="flex items-center gap-1"><DollarSign size={12} /> {brl(m.valueSoldCents)}</span>
                    {m.leadsNoReply > 0 && <span className="flex items-center gap-1 text-red-500"><AlertTriangle size={12} /> {m.leadsNoReply} sem resposta</span>}
                  </div>
                  {/* barras dos pilares */}
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
                <ChevronRight size={18} className={`text-muted-foreground transition ${selectedMember === m.memberId ? "rotate-90" : ""}`} />
              </div>

              {/* Detalhe expandido */}
              {selectedMember === m.memberId && (
                <SellerDetail memberId={m.memberId} sinceDays={sinceDays} instanceName={instanceName || undefined}
                  onEvaluate={() => evaluate.mutate({ memberId: m.memberId, sinceDays, instanceName: instanceName || undefined })}
                  evaluating={evaluate.isPending && evaluate.variables?.memberId === m.memberId} />
              )}
            </div>
          ))}
        </div>

        {/* Chat com a IA */}
        <div className="lg:col-span-1">
          <PerformanceChat sinceDays={sinceDays} instanceName={instanceName || undefined} />
        </div>
      </div>
    </div>
  );
}

function SellerDetail({ memberId, sinceDays, instanceName, onEvaluate, evaluating }: {
  memberId: number; sinceDays: number; instanceName?: string; onEvaluate: () => void; evaluating: boolean;
}) {
  const last = trpc.performance.lastEvaluation.useQuery({ memberId });
  const ev = last.data;
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
              <ul className="list-disc pl-4 space-y-0.5 text-xs">{ev.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {!!ev.improvements?.length && (
            <div>
              <div className="text-xs font-semibold text-orange-500 mb-1">A melhorar</div>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">{ev.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {!!ev.tips?.length && (
            <div>
              <div className="text-xs font-semibold text-purple-500 mb-1">Dicas práticas</div>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">{ev.tips.map((s, i) => <li key={i}>{s}</li>)}</ul>
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

function PerformanceChat({ sinceDays, instanceName }: { sinceDays: number; instanceName?: string }) {
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
    chat.mutate({ history: next, sinceDays, instanceName });
  }

  const suggestions = [
    "Quem está performando melhor e por quê?",
    "Quem precisa de atenção agora?",
    "Onde estamos perdendo vendas?",
    "Quem está deixando lead sem resposta?",
  ];

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-[560px] sticky top-4">
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Sparkles size={16} className="text-purple-500" />
        <span className="font-semibold text-sm">Converse com a IA</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Pergunte sobre a performance do time. Ex.:</p>
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
          placeholder="Pergunte sobre o time…"
          className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500" />
        <button onClick={send} disabled={chat.isPending || !input.trim()}
          className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg px-3">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
