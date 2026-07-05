import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Car, MessageSquare, Clock, GripVertical, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Kanban do Funil de Vendas.
 * Arrastar um lead entre colunas atualiza o funnelStatus — e dispara
 * automaticamente os eventos Meta CAPI no servidor.
 */

const COLUMNS: { value: string; label: string; color: string }[] = [
  { value: "novo", label: "Novo", color: "#64748b" },
  { value: "interesse_definido", label: "Interesse definido", color: "#0ea5e9" },
  { value: "pagamento_definido", label: "Pagamento definido", color: "#8b5cf6" },
  { value: "dados_pessoais", label: "Dados pessoais", color: "#a855f7" },
  { value: "dados_troca", label: "Dados da troca", color: "#d946ef" },
  { value: "encaminhado_vendedor", label: "Com vendedor", color: "#f59e0b" },
  { value: "negociando", label: "Negociando", color: "#f97316" },
  { value: "fechado", label: "Fechado ✅", color: "#22c55e" },
  { value: "perdido", label: "Perdido", color: "#ef4444" },
];

const TEMP_EMOJI: Record<string, string> = {
  frio: "🧊", morno: "🌤", quente: "🔥", muito_quente: "🔥🔥",
};

export default function Funnel() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: leads, isLoading } = trpc.lead.listWithDetails.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => utils.lead.listWithDetails.invalidate(),
    onError: (err) => {
      toast.error(err.message);
      utils.lead.listWithDetails.invalidate();
    },
  });

  const byColumn = useMemo(() => {
    const map = new Map<string, any[]>();
    COLUMNS.forEach(c => map.set(c.value, []));
    for (const lead of (leads as any[]) || []) {
      const col = lead.funnelStatus || "novo";
      if (!map.has(col)) map.set(col, []);
      map.get(col)!.push(lead);
    }
    return map;
  }, [leads]);

  // Valor total em negociação por coluna (preço do veículo vinculado)
  const columnValue = (col: string) =>
    (byColumn.get(col) || []).reduce((sum, l) => sum + (l.linkedVehicle?.price || 0), 0);

  const handleDrop = (col: string) => {
    setDragOverCol(null);
    if (draggingId === null) return;
    const lead = ((leads as any[]) || []).find(l => l.id === draggingId);
    setDraggingId(null);
    if (!lead || lead.funnelStatus === col) return;
    // Atualização otimista via cache
    utils.lead.listWithDetails.setData(undefined, (old: any) =>
      (old || []).map((l: any) => l.id === lead.id ? { ...l, funnelStatus: col } : l)
    );
    updateLead.mutate({ conversationId: lead.conversationId, funnelStatus: col as any });
    if (col === "fechado") toast.success("🎉 Venda fechada! Evento Purchase enviado à Meta.");
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold text-foreground">Funil de Vendas</h1>
        <span className="text-xs text-muted-foreground ml-2">
          Arraste os cards entre as etapas — a Meta recebe os eventos automaticamente
        </span>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Carregando funil...</div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full gap-3 p-4 min-w-max">
            {COLUMNS.map(col => {
              const items = byColumn.get(col.value) || [];
              const totalValue = columnValue(col.value);
              return (
                <div
                  key={col.value}
                  onDragOver={e => { e.preventDefault(); setDragOverCol(col.value); }}
                  onDragLeave={() => setDragOverCol(v => v === col.value ? null : v)}
                  onDrop={() => handleDrop(col.value)}
                  className={`w-64 shrink-0 flex flex-col rounded-xl bg-card border transition-colors ${
                    dragOverCol === col.value ? "border-primary ring-1 ring-primary" : "border-border"
                  }`}
                >
                  {/* Column header */}
                  <div className="shrink-0 px-3 py-2 border-b border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                        <span className="text-sm font-semibold text-card-foreground">{col.label}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
                    </div>
                    {totalValue > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        R$ {totalValue.toLocaleString("pt-BR")} em veículos
                      </p>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {items.map(lead => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={() => setDraggingId(lead.id)}
                        onDragEnd={() => setDraggingId(null)}
                        className={`group rounded-lg border border-border bg-background p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-all ${
                          draggingId === lead.id ? "opacity-40" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {TEMP_EMOJI[lead.temperature] || ""} {lead.name || lead.conversation?.contactName || lead.phone}
                          </p>
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100" />
                        </div>
                        {(lead.vehicleInterest || lead.linkedVehicle) && (
                          <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-1">
                            <Car className="h-3 w-3 shrink-0" />
                            {lead.linkedVehicle
                              ? `${lead.linkedVehicle.brand} ${lead.linkedVehicle.model} ${lead.linkedVehicle.year}`
                              : lead.vehicleInterest}
                          </p>
                        )}
                        {lead.linkedVehicle?.price ? (
                          <p className="text-xs font-semibold text-green-600 mt-0.5">
                            R$ {Number(lead.linkedVehicle.price).toLocaleString("pt-BR")}
                          </p>
                        ) : null}
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {lead.updatedAt ? formatDistanceToNow(new Date(lead.updatedAt), { addSuffix: false, locale: ptBR }) : ""}
                          </span>
                          <button
                            onClick={() => setLocation(`/inbox?conv=${lead.conversationId}`)}
                            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                            title="Abrir conversa"
                          >
                            <MessageSquare className="h-3 w-3" /> Conversa
                          </button>
                        </div>
                        {lead.assignedAgent && (
                          <p className="text-[10px] text-blue-500 mt-0.5 truncate">👤 {lead.assignedAgent.name}</p>
                        )}
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className="text-[11px] text-muted-foreground/60 text-center py-4">Solte um card aqui</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
