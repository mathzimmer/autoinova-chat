import { trpc } from "@/lib/trpc";
import { Sparkles, Loader2, RefreshCw, ChevronRight } from "lucide-react";

/**
 * Faixa compacta do Copiloto do Vendedor, acima do campo de escrever.
 * Liga/desliga POR CONVERSA (padrão desligado). Quando ligado, sugere
 * automaticamente 2–3 respostas + próximo passo a cada mensagem nova do cliente.
 * "Usar" joga o texto no campo de mensagem (o vendedor revisa e envia).
 */
export default function SellerCopilotPanel({
  conversationId, enabled, onToggle, onUse, lastMessageId, toggling,
}: {
  conversationId: number;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  onUse: (text: string) => void;
  lastMessageId?: number;
  toggling?: boolean;
}) {
  const q = trpc.copilot.suggest.useQuery(
    { conversationId, lastMessageId, count: 3 },
    { enabled: enabled && !!lastMessageId, staleTime: Infinity, refetchOnWindowFocus: false },
  );

  return (
    <div className="mb-2 rounded-lg border border-[#e9edef] bg-[#f7f9fa]">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Sparkles className={`h-3.5 w-3.5 ${enabled ? "text-[#00a884]" : "text-[#8696a0]"}`} />
        <span className="text-xs font-semibold text-[#54656f] flex-1">Copiloto do vendedor</span>
        {enabled && (
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching || !lastMessageId}
            title="Regenerar sugestões"
            className="text-[#54656f] hover:text-[#111b21] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
          </button>
        )}
        <button
          onClick={() => onToggle(!enabled)}
          disabled={toggling}
          className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors disabled:opacity-50 ${
            enabled ? "bg-[#00a884]/15 text-[#00a884]" : "bg-[#e9edef] text-[#8696a0]"
          }`}
          title={enabled ? "Desativar copiloto nesta conversa" : "Ativar copiloto nesta conversa"}
        >
          {enabled ? "ATIVADO" : "DESATIVADO"}
        </button>
      </div>

      {enabled && (
        <div className="px-3 pb-2">
          {q.isFetching && !q.data && (
            <div className="flex items-center gap-2 text-xs text-[#54656f] py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo a conversa...
            </div>
          )}

          {!q.isFetching && (!q.data || q.data.suggestions.length === 0) && (
            <p className="text-[11px] text-[#8696a0] py-1">
              {lastMessageId ? "Sem sugestão no momento." : "Aguardando mensagem do cliente para sugerir."}
            </p>
          )}

          {q.data && q.data.suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {q.data.suggestions.map((s: string, i: number) => (
                <button
                  key={i}
                  onClick={() => onUse(s)}
                  className="text-left text-xs text-[#111b21] bg-white border border-[#e9edef] rounded-md px-2.5 py-1.5 hover:border-[#00a884] hover:bg-[#00a884]/5 transition-colors"
                  title="Usar esta resposta (vai para o campo de mensagem)"
                >
                  {s}
                </button>
              ))}
              {q.data.proximoPasso && (
                <div className="flex items-start gap-1 text-[11px] text-[#54656f] mt-0.5">
                  <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-[#00a884]" />
                  <span><b>Próximo passo:</b> {q.data.proximoPasso}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
