import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Car, RefreshCw, Fuel, Gauge, Calendar, ExternalLink, Search, Tag, Palette } from "lucide-react";
import { toast } from "sonner";

export default function Vehicles() {
  const { data: vehicles, refetch, isLoading } = trpc.vehicle.list.useQuery();
  const syncMutation = trpc.vehicle.syncStock.useMutation({
    onSuccess: (result) => {
      refetch();
      toast.success(`Estoque sincronizado: ${result.created} novos, ${result.updated} atualizados, ${result.deactivated} removidos (${(result.duration / 1000).toFixed(1)}s)`);
    },
    onError: (err) => toast.error("Erro ao sincronizar: " + err.message),
  });

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fuelFilter, setFuelFilter] = useState("all");
  const [sortBy, setSortBy] = useState("price_asc");

  // Compute unique brands, categories, fuels from data
  const filterOptions = useMemo(() => {
    if (!vehicles) return { brands: [], categories: [], fuels: [] };
    const brands = Array.from(new Set(vehicles.filter(v => v.available).map(v => v.brand))).sort();
    const categories = Array.from(new Set(vehicles.filter(v => v.available && v.category).map(v => v.category!))).sort();
    const fuels = Array.from(new Set(vehicles.filter(v => v.available && v.fuel).map(v => v.fuel!))).sort();
    return { brands, categories, fuels };
  }, [vehicles]);

  // Filter and sort
  const filteredVehicles = useMemo(() => {
    if (!vehicles) return [];
    let result = vehicles.filter(v => v.available);

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(v =>
        v.brand.toLowerCase().includes(term) ||
        v.model.toLowerCase().includes(term) ||
        v.title?.toLowerCase().includes(term) ||
        v.color?.toLowerCase().includes(term)
      );
    }
    if (brandFilter !== "all") {
      result = result.filter(v => v.brand === brandFilter);
    }
    if (categoryFilter !== "all") {
      result = result.filter(v => v.category === categoryFilter);
    }
    if (fuelFilter !== "all") {
      result = result.filter(v => v.fuel === fuelFilter);
    }

    // Sort
    switch (sortBy) {
      case "price_asc": result.sort((a, b) => a.price - b.price); break;
      case "price_desc": result.sort((a, b) => b.price - a.price); break;
      case "year_desc": result.sort((a, b) => b.year - a.year); break;
      case "mileage_asc": result.sort((a, b) => (a.mileage || 0) - (b.mileage || 0)); break;
    }

    return result;
  }, [vehicles, searchTerm, brandFilter, categoryFilter, fuelFilter, sortBy]);

  const totalAvailable = vehicles?.filter(v => v.available).length || 0;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Estoque de Veículos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalAvailable} veículo{totalAvailable !== 1 ? "s" : ""} disponíve{totalAvailable !== 1 ? "is" : "l"}
            {filteredVehicles.length !== totalAvailable && ` (${filteredVehicles.length} filtrado${filteredVehicles.length !== 1 ? "s" : ""})`}
          </p>
        </div>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Sincronizando..." : "Sincronizar Estoque"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por marca, modelo, cor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-input border-border"
          />
        </div>
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-[150px] bg-input border-border">
            <SelectValue placeholder="Marca" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas marcas</SelectItem>
            {filterOptions.brands.map(b => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[150px] bg-input border-border">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {filterOptions.categories.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fuelFilter} onValueChange={setFuelFilter}>
          <SelectTrigger className="w-[140px] bg-input border-border">
            <SelectValue placeholder="Combustível" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {filterOptions.fuels.map(f => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px] bg-input border-border">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="price_asc">Menor preço</SelectItem>
            <SelectItem value="price_desc">Maior preço</SelectItem>
            <SelectItem value="year_desc">Mais novo</SelectItem>
            <SelectItem value="mileage_asc">Menor km</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Vehicle Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="bg-card border-border animate-pulse">
              <div className="h-40 bg-muted rounded-t-lg" />
              <CardContent className="p-4 space-y-2">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-5 bg-muted rounded w-1/2" />
                <div className="h-3 bg-muted rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredVehicles.length === 0 ? (
        <div className="text-center py-16">
          <Car className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-muted-foreground">Nenhum veículo encontrado</p>
          <p className="text-xs text-muted-foreground mt-1">Tente ajustar os filtros ou sincronize o estoque.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredVehicles.map((v) => {
            const hasPromo = v.promotionPrice && v.regularPrice && v.promotionPrice < v.regularPrice;
            const mainImage = v.imageUrl || (Array.isArray(v.images) && v.images.length > 0 ? (v.images as string[])[0] : null);

            return (
              <Card key={v.id} className="bg-card border-border hover:border-primary/30 transition-all group overflow-hidden">
                {/* Image */}
                <div className="relative h-44 bg-muted overflow-hidden">
                  {mainImage ? (
                    <img
                      src={mainImage}
                      alt={v.title || `${v.brand} ${v.model}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Car className="h-12 w-12 text-muted-foreground/20" />
                    </div>
                  )}
                  {hasPromo && (
                    <Badge className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-1.5 py-0.5">
                      PROMOÇÃO
                    </Badge>
                  )}
                  {v.condition && (
                    <Badge variant="outline" className="absolute top-2 right-2 bg-background/80 backdrop-blur text-[10px] capitalize">
                      {v.condition}
                    </Badge>
                  )}
                </div>

                <CardContent className="p-3.5">
                  {/* Title */}
                  <h3 className="text-sm font-semibold text-card-foreground leading-tight line-clamp-2 mb-1.5">
                    {v.brand} {v.model}
                  </h3>

                  {/* Price */}
                  <div className="mb-2.5">
                    {hasPromo ? (
                      <>
                        <p className="text-xs text-muted-foreground line-through">
                          R$ {v.regularPrice!.toLocaleString("pt-BR")}
                        </p>
                        <p className="text-lg font-bold text-primary">
                          R$ {v.promotionPrice!.toLocaleString("pt-BR")}
                        </p>
                      </>
                    ) : (
                      <p className="text-lg font-bold text-primary">
                        R$ {v.price.toLocaleString("pt-BR")}
                      </p>
                    )}
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground mb-3">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 shrink-0" /> {v.fabricYear || v.year}/{v.year}
                    </div>
                    <div className="flex items-center gap-1">
                      <Gauge className="h-3 w-3 shrink-0" /> {v.mileage?.toLocaleString("pt-BR") || "0"} km
                    </div>
                    <div className="flex items-center gap-1">
                      <Fuel className="h-3 w-3 shrink-0" /> {v.fuel || "N/I"}
                    </div>
                    <div className="flex items-center gap-1">
                      <Tag className="h-3 w-3 shrink-0" /> {v.transmission === "automatic" || v.transmission === "automatico" ? "Automático" : "Manual"}
                    </div>
                    {v.color && (
                      <div className="flex items-center gap-1">
                        <Palette className="h-3 w-3 shrink-0" /> <span className="capitalize">{v.color}</span>
                      </div>
                    )}
                    {v.category && (
                      <div className="flex items-center gap-1">
                        <Car className="h-3 w-3 shrink-0" /> {v.category}
                      </div>
                    )}
                  </div>

                  {/* Link */}
                  {v.url && (
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Ver no site
                    </a>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
