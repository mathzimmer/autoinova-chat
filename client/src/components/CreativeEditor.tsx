import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Plus, X, Check, ImageDown } from "lucide-react";

export type Selo = { id: string; text: string; x: number; y: number }; // x,y fração 0..1

const SUGESTOES = [
  "Baixa KM", "Pneus novos", "IPVA pago", "Revisões na concessionária",
  "Teto solar", "7 lugares", "Único dono", "Garantia de fábrica",
];

/**
 * Editor de criativos: preview 9:16 ao vivo (2 fotos empilhadas + faixa de preço),
 * selos arrastáveis e personalizáveis, e geração das 3 proporções no servidor.
 */
export function CreativeEditor({
  vehicleId, photos, price, specs,
  onGenerated,
}: {
  vehicleId: number;
  photos: string[];
  price: string;
  specs: string;
  onGenerated?: (creatives: Record<string, string>, selos: Selo[]) => void;
}) {
  const [selos, setSelos] = useState<Selo[]>([]);
  const [novo, setNovo] = useState("");
  const [generated, setGenerated] = useState<Record<string, string> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);

  const gen = trpc.metaAds.generateCreativesPreview.useMutation();

  const top = photos[0];
  const bot = photos[1] || photos[0];

  function addSelo(text: string) {
    const t = text.trim();
    if (!t) return;
    setSelos((s) => [...s, { id: Math.random().toString(36).slice(2), text: t, x: 0.06, y: 0.06 + s.length * 0.08 }]);
    setNovo("");
  }
  function removeSelo(id: string) { setSelos((s) => s.filter((x) => x.id !== id)); }

  function onPointerDown(e: React.PointerEvent, id: string) {
    dragId.current = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragId.current || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const x = Math.min(0.9, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(0.92, Math.max(0, (e.clientY - r.top) / r.height));
    setSelos((s) => s.map((sl) => (sl.id === dragId.current ? { ...sl, x, y } : sl)));
  }
  function onPointerUp() { dragId.current = null; }

  async function gerar() {
    try {
      const res = await gen.mutateAsync({
        vehicleId,
        selos: selos.map(({ text, x, y }) => ({ text, x, y })),
      });
      setGenerated(res.creatives);
      onGenerated?.(res.creatives, selos);
      toast.success("Criativos gerados!");
    } catch (e: any) {
      toast.error("Erro ao gerar criativos: " + e.message);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Preview ao vivo 9:16 com selos arrastáveis */}
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Preview 9:16 — arraste os selos para posicionar</p>
        <div
          ref={boxRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative mx-auto rounded-xl overflow-hidden bg-[#141416] select-none touch-none"
          style={{ width: 240, height: 427 }}
        >
          {/* duas fotos empilhadas */}
          <div className="absolute inset-x-0 top-0" style={{ height: "42.5%", backgroundImage: `url(${top})`, backgroundSize: "cover", backgroundPosition: "center" }} />
          <div className="absolute inset-x-0" style={{ top: "42.5%", height: "42.5%", backgroundImage: `url(${bot})`, backgroundSize: "cover", backgroundPosition: "center" }} />
          <div className="absolute inset-x-0 bg-white" style={{ top: "42.5%", height: 2 }} />
          {/* faixa inferior */}
          <div className="absolute inset-x-0 bottom-0 bg-[#141416]" style={{ height: "15%" }}>
            <div className="absolute inset-x-0 top-0 bg-[#c81420]" style={{ height: 3 }} />
            <div className="px-3 pt-2">
              <div className="text-white font-bold text-lg leading-none">{price}</div>
              <div className="text-[9px] text-gray-300 mt-1 truncate">{specs}</div>
            </div>
          </div>
          {/* selos */}
          {selos.map((s) => (
            <div
              key={s.id}
              onPointerDown={(e) => onPointerDown(e, s.id)}
              className="absolute flex items-center gap-1 px-2 py-1 rounded-full bg-[#141416]/90 text-white text-[10px] font-semibold cursor-move whitespace-nowrap"
              style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
            >
              <span className="flex items-center justify-center h-3 w-3 rounded-full bg-[#25d366]"><Check className="h-2 w-2 text-white" strokeWidth={4} /></span>
              {s.text}
            </div>
          ))}
        </div>
      </div>

      {/* Controles: selos + gerar */}
      <div className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Adicionar selo</p>
          <div className="flex gap-2">
            <Input value={novo} onChange={(e) => setNovo(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && addSelo(novo)}
                   placeholder="Ex.: Teto solar" className="h-8 text-sm" />
            <Button size="sm" className="h-8" onClick={() => addSelo(novo)}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {SUGESTOES.map((s) => (
              <button key={s} onClick={() => addSelo(s)}
                      className="text-[11px] px-2 py-1 rounded-full border border-border hover:bg-secondary">
                + {s}
              </button>
            ))}
          </div>
        </div>

        {selos.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Selos adicionados</p>
            {selos.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm bg-secondary/40 rounded px-2 py-1">
                <span>{s.text}</span>
                <button onClick={() => removeSelo(s.id)} className="text-muted-foreground hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}

        <Button onClick={gerar} disabled={gen.isPending} className="w-full gap-2">
          {gen.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</> : <><ImageDown className="h-4 w-4" /> Gerar criativos (1:1 · 4:5 · 9:16)</>}
        </Button>

        {generated && (
          <div className="grid grid-cols-3 gap-2 pt-1">
            {(["1x1", "4x5", "9x16"] as const).map((a) => generated[a] && (
              <a key={a} href={generated[a]} target="_blank" rel="noreferrer" className="block">
                <img src={generated[a]} alt={a} className="w-full rounded-lg border border-border" />
                <p className="text-[10px] text-center text-muted-foreground mt-0.5">{a}</p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
