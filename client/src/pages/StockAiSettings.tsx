import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Boxes, Save } from "lucide-react";

/**
 * Configuração "Estoque para IA": define QUAIS campos a IA vê de cada veículo
 * (com rótulo personalizável) e QUAIS veículos podem ser ofertados (curadoria).
 */
export default function StockAiSettings() {
  const q = trpc.vehicle.getAiConfig.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.vehicle.setAiConfig.useMutation({
    onSuccess: () => { toast.success("Config do estoque para IA salva"); utils.vehicle.getAiConfig.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const catalogo = q.data?.campos || [];
  const [fields, setFields] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [onlyKnown, setOnlyKnown] = useState(true);
  const [hideNoPrice, setHideNoPrice] = useState(true);
  const [hideNoPhoto, setHideNoPhoto] = useState(false);
  const [hideCats, setHideCats] = useState("");

  useEffect(() => {
    const c = q.data?.config;
    if (!c) return;
    setFields(c.fields || []);
    setLabels(c.labels || {});
    setOnlyKnown(c.onlyKnownVehicles);
    setHideNoPrice(c.hideNoPrice);
    setHideNoPhoto(c.hideNoPhoto);
    setHideCats((c.hideCategories || []).join(", "));
  }, [q.data]);

  const toggleField = (key: string) => {
    setFields(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const onSave = () => {
    if (fields.length === 0) { toast.error("Escolha pelo menos um campo."); return; }
    save.mutate({
      fields,
      labels,
      onlyKnownVehicles: onlyKnown,
      hideNoPrice,
      hideNoPhoto,
      hideCategories: hideCats.split(",").map(s => s.trim()).filter(Boolean),
    });
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" /> Estoque para IA
        </CardTitle>
        <CardDescription className="text-xs">
          Defina o que a IA enxerga de cada veículo e o que ela pode ofertar (limpa o "lixo" do feed).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        {/* Campos + rótulos */}
        <div>
          <Label className="text-xs font-medium">Campos que a IA mostra</Label>
          <p className="text-[11px] text-muted-foreground mb-2">Marque o campo e, se quiser, personalize o rótulo.</p>
          <div className="space-y-1.5">
            {catalogo.map((c: { key: string; label: string }) => {
              const on = fields.includes(c.key);
              return (
                <div key={c.key} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleField(c.key)}
                    className={`text-[11px] px-2 py-1 rounded border w-36 text-left transition-colors ${on ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {on ? "✓ " : ""}{c.label}
                  </button>
                  {on && c.key !== "titulo" && (
                    <Input
                      value={labels[c.key] ?? ""}
                      placeholder={`Rótulo (padrão: ${c.label})`}
                      onChange={(e) => setLabels(prev => ({ ...prev, [c.key]: e.target.value }))}
                      className="h-7 text-xs flex-1"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* Curadoria */}
        <div className="space-y-3">
          <Label className="text-xs font-medium">Curadoria (o que a IA pode ofertar)</Label>
          <div className="flex items-center justify-between">
            <span className="text-xs">Só carros e motos <span className="text-muted-foreground">(esconde barco e afins)</span></span>
            <Switch checked={onlyKnown} onCheckedChange={setOnlyKnown} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Esconder veículo sem preço</span>
            <Switch checked={hideNoPrice} onCheckedChange={setHideNoPrice} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Esconder veículo sem foto</span>
            <Switch checked={hideNoPhoto} onCheckedChange={setHideNoPhoto} />
          </div>
          <div>
            <Label className="text-xs">Esconder categorias (separadas por vírgula)</Label>
            <Input
              value={hideCats}
              placeholder="ex: barco, reboque, náutica"
              onChange={(e) => setHideCats(e.target.value)}
              className="h-8 text-sm mt-1"
            />
          </div>
        </div>

        <Button onClick={onSave} disabled={save.isPending} className="gap-2">
          <Save className="h-4 w-4" /> Salvar
        </Button>
      </CardContent>
    </Card>
  );
}
