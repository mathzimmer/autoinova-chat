import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Car, Plus, Fuel, Gauge, Calendar } from "lucide-react";
import { toast } from "sonner";

export default function Vehicles() {
  const [open, setOpen] = useState(false);
  const { data: vehicles, refetch } = trpc.vehicle.list.useQuery();
  const createMutation = trpc.vehicle.create.useMutation({
    onSuccess: () => {
      refetch();
      setOpen(false);
      toast.success("Veículo adicionado com sucesso");
    },
    onError: (err) => toast.error(err.message),
  });

  const [form, setForm] = useState({
    brand: "", model: "", year: new Date().getFullYear(), price: 0,
    mileage: 0, color: "", transmission: "manual" as "manual" | "automatic",
    fuel: "", category: "", description: "",
  });

  const handleSubmit = () => {
    if (!form.brand || !form.model || !form.price) {
      toast.error("Preencha marca, modelo e preço");
      return;
    }
    createMutation.mutate(form);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Veículos</h1>
          <p className="text-sm text-muted-foreground mt-1">Estoque da concessionária</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Adicionar Veículo
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-card-foreground">Novo Veículo</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <Label className="text-xs text-muted-foreground">Marca</Label>
                <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="bg-input border-border mt-1" placeholder="Ex: Toyota" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Modelo</Label>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="bg-input border-border mt-1" placeholder="Ex: Corolla" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Ano</Label>
                <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: parseInt(e.target.value) })} className="bg-input border-border mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Preço (R$)</Label>
                <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) })} className="bg-input border-border mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Km</Label>
                <Input type="number" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: parseInt(e.target.value) })} className="bg-input border-border mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Cor</Label>
                <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="bg-input border-border mt-1" placeholder="Ex: Prata" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Câmbio</Label>
                <Select value={form.transmission} onValueChange={(v) => setForm({ ...form, transmission: v as any })}>
                  <SelectTrigger className="bg-input border-border mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="automatic">Automático</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Combustível</Label>
                <Input value={form.fuel} onChange={(e) => setForm({ ...form, fuel: e.target.value })} className="bg-input border-border mt-1" placeholder="Ex: Flex" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Categoria</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-input border-border mt-1" placeholder="Ex: SUV, Sedan, Hatch" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Descrição</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-input border-border mt-1" placeholder="Descrição opcional" />
              </div>
            </div>
            <Button onClick={handleSubmit} className="w-full mt-4" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Salvando..." : "Salvar Veículo"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Vehicle Grid */}
      {!vehicles || vehicles.length === 0 ? (
        <div className="text-center py-16">
          <Car className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-muted-foreground">Nenhum veículo cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">Adicione veículos ao estoque para que a IA possa apresentá-los aos clientes.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehicles.map((v) => (
            <Card key={v.id} className="bg-card border-border hover:border-primary/30 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-card-foreground">{v.brand} {v.model}</h3>
                    <p className="text-lg font-bold text-primary">R$ {v.price.toLocaleString("pt-BR")}</p>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">{v.category || "Geral"}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" /> {v.year}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Gauge className="h-3 w-3" /> {v.mileage?.toLocaleString("pt-BR") || "0"} km
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Car className="h-3 w-3" /> {v.transmission === "automatic" ? "Automático" : "Manual"}
                  </div>
                  {v.fuel && (
                    <div className="flex items-center gap-1.5">
                      <Fuel className="h-3 w-3" /> {v.fuel}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
