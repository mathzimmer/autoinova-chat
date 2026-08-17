import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ClipboardCheck, Loader2, ChevronDown, ChevronRight } from "lucide-react";

/**
 * Card compacto da avaliação do atendimento (Coach). Mostra a nota + semáforo;
 * expande para etapas (início/meio/fim), pontos fortes, erros e o porquê.
 * A avaliação roda sozinha ao marcar ganho/perdido/encerrar — aqui há também
 * um botão "Avaliar agora" para rodar sob demanda.
 */
export default function AttendanceEvaluationCard({ conversationId }: { conversationId: number }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const q = trpc.coach.lastEvaluation.useQuery({ conversationId }, { refetchOnWindowFocus: false });
  const evaluate = trpc.coach.evaluate.useMutation({
    onSuccess: () => { utils.coach.lastEvaluation.invalidate({ conversationId }); toast.success("Atendimento avaliado."); },
    onError: (e) => toast.error("Erro ao avaliar: " + e.message),
  });

  const ev: any = q.data;
  const score = ev?.scoreOverall ?? null;
  const color = score == null ? "bg-[#e9edef] text-[#8696a0]"
    : score >= 75 ? "bg-emerald-500/15 text-emerald-600"
      : score >= 50 ? "bg-yellow-500/15 text-yellow-600"
        : "bg-red-500/15 text-red-600";
  const dot = score == null ? "⚪" : score >= 75 ? "🟢" : score >= 50 ? "🟡" : "🔴";

  return (
    <div className="mb-2 rounded-lg border border-[#e9edef] bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <ClipboardCheck className="h-3.5 w-3.5 text-[#54656f]" />
        <span className="text-xs font-semibold text-[#54656f] flex-1">Avaliação do atendimento</span>
        {ev && (
          <button onClick={() => setOpen(o => !o)} className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${color}`}>
            {dot} {score}
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        )}
        <button
          onClick={() => evaluate.mutate({ conversationId, outcome: "encerrado" })}
          disabled={evaluate.isPending}
          className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#e9edef] text-[#54656f] hover:bg-[#dfe5e7] disabled:opacity-50 flex items-center gap-1"
          title="Rodar a avaliação agora"
        >
          {evaluate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {ev ? "Reavaliar" : "Avaliar"}
        </button>
      </div>

      {ev && open && (
        <div className="px-3 pb-2 text-[11px] text-[#111b21] space-y-1.5">
          <div className="flex gap-3 text-[#54656f]">
            <span>Início: <b className="text-[#111b21]">{ev.scoreInicio}</b></span>
            <span>Meio: <b className="text-[#111b21]">{ev.scoreMeio}</b></span>
            <span>Fim: <b className="text-[#111b21]">{ev.scoreFim}</b></span>
            {ev.outcome && <span className="ml-auto uppercase text-[9px] font-bold text-[#8696a0]">{ev.outcome}</span>}
          </div>
          {ev.reason && <p><b>Por quê:</b> {ev.reason}</p>}
          {Array.isArray(ev.strengths) && ev.strengths.length > 0 && (
            <div><b className="text-emerald-600">Fortes:</b> {ev.strengths.join(" · ")}</div>
          )}
          {Array.isArray(ev.errors) && ev.errors.length > 0 && (
            <div><b className="text-red-600">Erros:</b> {ev.errors.join(" · ")}</div>
          )}
          {Array.isArray(ev.tips) && ev.tips.length > 0 && (
            <div><b className="text-[#00a884]">Melhorar:</b> {ev.tips.join(" · ")}</div>
          )}
        </div>
      )}
    </div>
  );
}
