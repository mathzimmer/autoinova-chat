/**
 * Página de Meta Ads — AutoInova Chat (Simplificada)
 * Foco: criar anúncios dentro de campanhas e conjuntos de anúncios já existentes.
 * Suporte a carrossel e personalizações de IA.
 */

import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Play, Pause, RefreshCw, Megaphone, Plus, TrendingUp,
  Eye, MousePointer, Users, DollarSign, Sparkles, Wand2, Copy,
  CheckCircle2, ChevronRight, ImageIcon, ArrowLeft, Search,
  LayoutGrid, Image as ImageSingle, Settings2,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}
function fmtPrice(price: number) {
  return price.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtNum(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("pt-BR");
}
function statusColor(s: string) {
  if (s === "active")   return "bg-green-500/15 text-green-400 border-green-500/30";
  if (s === "paused")   return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  if (s === "archived") return "bg-gray-500/15 text-muted-foreground border-gray-500/30";
  return "";
}
function statusLabel(s: string) {
  if (s === "active")   return "Ativo";
  if (s === "paused")   return "Pausado";
  if (s === "archived") return "Arquivado";
  return s;
}
function metaStatusLabel(s: string) {
  if (s === "ACTIVE") return "Ativo";
  if (s === "PAUSED") return "Pausado";
  if (s === "ARCHIVED") return "Arquivado";
  return s;
}
function metaStatusColor(s: string) {
  if (s === "ACTIVE") return "text-green-400";
  if (s === "PAUSED") return "text-yellow-400";
  return "text-muted-foreground";
}

// ─── Componente: Card de configuração ausente ─────────────────────────────────

function NotConfiguredBanner({ missingVars }: { missingVars: string[] }) {
  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 mb-6">
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-yellow-500/20 p-3 text-yellow-400 text-2xl">⚠️</div>
        <div>
          <h3 className="font-bold text-yellow-300 text-base mb-1">Meta Ads não configurado</h3>
          <p className="text-sm text-yellow-200/70 mb-3">
            Configure as seguintes variáveis de ambiente para ativar a criação de anúncios:
          </p>
          <div className="flex flex-col gap-1">
            {missingVars.map(v => (
              <code key={v} className="text-xs bg-black/30 text-yellow-300 px-2 py-1 rounded w-fit">{v}</code>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Estilos de IA ───────────────────────────────────────────────────────────

const AI_STYLES = [
  { value: "persuasivo", label: "Persuasivo", emoji: "🎯", desc: "Gatilhos emocionais e desejo de compra" },
  { value: "informativo", label: "Informativo", emoji: "📋", desc: "Dados técnicos e especificações" },
  { value: "urgente", label: "Urgente", emoji: "⚡", desc: "Escassez e oportunidade única" },
  { value: "premium", label: "Premium", emoji: "✨", desc: "Sofisticado, exclusividade e status" },
  { value: "jovem", label: "Jovem", emoji: "🔥", desc: "Descontraído e moderno" },
] as const;

// ─── Modal: Criar Anúncio (Fluxo Simplificado) ──────────────────────────────

type CreateAdStep = "campaign" | "adset" | "vehicle" | "customize" | "generating" | "review" | "publishing" | "done";

function CreateAdModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<CreateAdStep>("campaign");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaignName, setSelectedCampaignName] = useState("");
  const [selectedCampaignObjective, setSelectedCampaignObjective] = useState("");
  const [selectedAdSetId, setSelectedAdSetId] = useState<string | null>(null);
  const [selectedAdSetName, setSelectedAdSetName] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");

  // Carrossel
  const [adFormat, setAdFormat] = useState<"single" | "carousel">("single");
  const [carouselSelectedImages, setCarouselSelectedImages] = useState<string[]>([]);
  const [carouselCaptions, setCarouselCaptions] = useState<string[]>([]);

  // IA customization
  const [aiStyle, setAiStyle] = useState<string>("persuasivo");
  const [targetAudience, setTargetAudience] = useState("");
  const [highlights, setHighlights] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [editedTexts, setEditedTexts] = useState({ headline: "", description: "", primaryText: "" });
  const [vehicleInfo, setVehicleInfo] = useState<{
    id: number; brand: string; model: string; year: number; price: number; imageUrl: string | null;
  } | null>(null);

  // Queries
  const { data: campaigns, isLoading: loadingCampaigns } = trpc.metaAds.listCampaigns.useQuery(undefined, {
    enabled: step === "campaign",
  });
  const { data: adSets, isLoading: loadingAdSets } = trpc.metaAds.listAdSets.useQuery(
    { campaignId: selectedCampaignId! },
    { enabled: step === "adset" && !!selectedCampaignId }
  );
  const { data: vehicles, isLoading: loadingVehicles } = trpc.vehicle.list.useQuery(undefined, {
    enabled: step === "vehicle" || step === "customize",
  });

  const generateMutation = trpc.metaAds.generateAdText.useMutation();
  const createMutation = trpc.metaAds.createAdInAdSet.useMutation();

  const availableVehicles = useMemo(() => {
    const list = vehicles?.filter(v => v.available && v.imageUrl) ?? [];
    if (!vehicleSearch.trim()) return list;
    const q = vehicleSearch.toLowerCase();
    return list.filter(v =>
      `${v.brand} ${v.model} ${v.year}`.toLowerCase().includes(q)
    );
  }, [vehicles, vehicleSearch]);

  // Vehicle images for selection
  const vehicleImages = useMemo(() => {
    if (!selectedVehicleId || !vehicles) return [];
    const v = vehicles.find(v => v.id === selectedVehicleId);
    if (!v) return [];
    const imgs: string[] = [];
    if (v.imageUrl) imgs.push(v.imageUrl);
    if (v.images && Array.isArray(v.images)) {
      for (const img of v.images) {
        const url = typeof img === "string" ? img : (img as any)?.url || (img as any)?.src;
        if (url && !imgs.includes(url)) imgs.push(url);
      }
    }
    return imgs.slice(0, 10);
  }, [selectedVehicleId, vehicles]);

  // Handlers
  function selectCampaign(id: string, name: string, objective: string) {
    setSelectedCampaignId(id);
    setSelectedCampaignName(name);
    setSelectedCampaignObjective(objective);
    setStep("adset");
  }

  function selectAdSet(id: string, name: string) {
    setSelectedAdSetId(id);
    setSelectedAdSetName(name);
    setStep("vehicle");
  }

  function selectVehicle(v: any) {
    setSelectedVehicleId(v.id);
    setSelectedImageUrl(v.imageUrl);
    setVehicleInfo({
      id: v.id, brand: v.brand, model: v.model, year: v.year, price: v.price, imageUrl: v.imageUrl,
    });
  }

  function toggleCarouselImage(url: string) {
    setCarouselSelectedImages(prev => {
      if (prev.includes(url)) return prev.filter(u => u !== url);
      if (prev.length >= 10) { toast.error("Máximo de 10 imagens no carrossel"); return prev; }
      return [...prev, url];
    });
  }

  function goToCustomize() {
    if (!selectedVehicleId) return;
    // Pre-select first images for carousel
    if (adFormat === "carousel" && carouselSelectedImages.length === 0) {
      setCarouselSelectedImages(vehicleImages.slice(0, Math.min(5, vehicleImages.length)));
    }
    setStep("customize");
  }

  async function handleGenerate() {
    if (!selectedVehicleId) return;
    setStep("generating");
    try {
      const isCarousel = adFormat === "carousel" && carouselSelectedImages.length >= 2;
      const result = await generateMutation.mutateAsync({
        vehicleId: selectedVehicleId,
        style: aiStyle as any,
        targetAudience: targetAudience || undefined,
        highlights: highlights || undefined,
        extraInstructions: extraInstructions || undefined,
        numCarouselImages: isCarousel ? carouselSelectedImages.length : undefined,
      });
      setEditedTexts({
        headline: result.headline,
        description: result.description,
        primaryText: result.primaryText,
      });
      // Set carousel captions from IA
      if (result.carouselCaptions && Array.isArray(result.carouselCaptions)) {
        setCarouselCaptions(result.carouselCaptions);
      }
      setVehicleInfo(result.vehicle);
      setStep("review");
    } catch (e: any) {
      toast.error("Erro ao gerar texto: " + e.message);
      setStep("customize");
    }
  }

  async function handlePublish() {
    if (!selectedVehicleId || !selectedCampaignId || !selectedAdSetId) return;
    setStep("publishing");
    try {
      const isCarousel = adFormat === "carousel" && carouselSelectedImages.length >= 2;
      await createMutation.mutateAsync({
        vehicleId: selectedVehicleId,
        campaignId: selectedCampaignId,
        adSetId: selectedAdSetId,
        headline: editedTexts.headline,
        description: editedTexts.description,
        primaryText: editedTexts.primaryText,
        selectedImageUrl: selectedImageUrl || undefined,
        campaignObjective: selectedCampaignObjective || undefined,
        carouselImageUrls: isCarousel ? carouselSelectedImages : undefined,
        carouselCaptions: isCarousel ? carouselCaptions : undefined,
        pixelId: "587774608991001",
      });
      setStep("done");
      onCreated();
    } catch (e: any) {
      toast.error("Erro ao criar anúncio: " + e.message);
      setStep("review");
    }
  }

  function goBack() {
    if (step === "adset") setStep("campaign");
    else if (step === "vehicle") setStep("adset");
    else if (step === "customize") setStep("vehicle");
    else if (step === "review") setStep("customize");
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  }

  // Step indicator
  const steps = [
    { key: "campaign", label: "Campanha" },
    { key: "adset", label: "Conjunto" },
    { key: "vehicle", label: "Veículo" },
    { key: "customize", label: "IA" },
    { key: "review", label: "Revisar" },
  ];
  const stepKeys = ["campaign", "adset", "vehicle", "customize", "review"];
  const currentStepIndex = stepKeys.indexOf(step);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-bold text-lg text-foreground flex items-center gap-2">
              <Sparkles size={18} className="text-purple-400" />
              Criar Anúncio
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">Selecione campanha, conjunto e veículo</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
        </div>

        {/* Step indicator */}
        {!["generating", "publishing", "done"].includes(step) && (
          <div className="flex items-center gap-1 px-5 py-3 border-b border-border/50 overflow-x-auto">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1 shrink-0">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  i < currentStepIndex ? "bg-green-500/15 text-green-400" :
                  i === currentStepIndex ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {i < currentStepIndex ? <CheckCircle2 size={12} /> : <span className="w-3 text-center">{i + 1}</span>}
                  <span>{s.label}</span>
                </div>
                {i < steps.length - 1 && <ChevronRight size={12} className="text-gray-600 mx-0.5" />}
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">

          {/* Step 1: Selecionar Campanha */}
          {step === "campaign" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground mb-4">Selecione a campanha onde o anúncio será criado:</p>
              {loadingCampaigns ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
              ) : !campaigns?.length ? (
                <div className="text-center py-12 text-gray-500">
                  <Megaphone size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nenhuma campanha encontrada na conta.</p>
                  <p className="text-xs text-gray-600 mt-1">Crie uma campanha no Meta Ads Manager primeiro.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {campaigns.map(c => (
                    <button
                      key={c.id}
                      onClick={() => selectCampaign(c.id, c.name, c.objective)}
                      className="w-full flex items-center justify-between p-3.5 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-left group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground text-sm truncate">{c.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs ${metaStatusColor(c.status)}`}>{metaStatusLabel(c.status)}</span>
                          <span className="text-xs text-gray-600">·</span>
                          <span className="text-xs text-gray-500">{c.objective}</span>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-600 group-hover:text-purple-400 shrink-0 ml-2" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Selecionar AdSet */}
          {step === "adset" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={goBack} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /></button>
                <div>
                  <p className="text-sm text-muted-foreground">Selecione o conjunto de anúncios:</p>
                  <p className="text-xs text-gray-500">Campanha: <span className="text-purple-300">{selectedCampaignName}</span></p>
                </div>
              </div>
              {loadingAdSets ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
              ) : !adSets?.length ? (
                <div className="text-center py-12 text-gray-500">
                  <Megaphone size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nenhum conjunto de anúncios encontrado nesta campanha.</p>
                  <p className="text-xs text-gray-600 mt-1">Crie um conjunto de anúncios no Meta Ads Manager primeiro.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {adSets.map(a => (
                    <button
                      key={a.id}
                      onClick={() => selectAdSet(a.id, a.name)}
                      className="w-full flex items-center justify-between p-3.5 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-left group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground text-sm truncate">{a.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs ${metaStatusColor(a.status)}`}>{metaStatusLabel(a.status)}</span>
                          <span className="text-xs text-gray-600">·</span>
                          <span className="text-xs text-gray-500">
                            Orçamento: R$ {(parseInt(a.dailyBudget) / 100).toFixed(2)}/dia
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-600 group-hover:text-purple-400 shrink-0 ml-2" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Selecionar Veículo */}
          {step === "vehicle" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={goBack} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /></button>
                <div>
                  <p className="text-sm text-muted-foreground">Selecione o veículo para anunciar:</p>
                  <p className="text-xs text-gray-500">
                    <span className="text-purple-300">{selectedCampaignName}</span>
                    {" → "}
                    <span className="text-purple-300">{selectedAdSetName}</span>
                  </p>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={vehicleSearch}
                  onChange={e => setVehicleSearch(e.target.value)}
                  placeholder="Buscar veículo..."
                  className="w-full bg-muted border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground outline-none focus:border-purple-500"
                />
              </div>

              {loadingVehicles ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-[340px] overflow-y-auto">
                  {availableVehicles.map(v => {
                    const selected = selectedVehicleId === v.id;
                    return (
                      <button key={v.id} onClick={() => selectVehicle(v)}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                          selected ? "border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/30" : "border-border hover:border-muted-foreground/30"
                        }`}>
                        <img src={v.imageUrl!} alt={v.model} className="w-14 h-10 rounded-lg object-cover shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-foreground truncate">{v.brand} {v.model}</div>
                          <div className="text-xs text-muted-foreground">{v.year}</div>
                          <div className="text-xs text-purple-300 font-medium">
                            {fmtPrice(v.price)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {availableVehicles.length === 0 && !loadingVehicles && (
                <p className="text-sm text-gray-500 text-center py-4">Nenhum veículo com imagem disponível</p>
              )}
            </div>
          )}

          {/* Step 4: Personalizar IA e formato */}
          {step === "customize" && vehicleInfo && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <button onClick={goBack} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /></button>
                <p className="text-xs text-gray-500">
                  <span className="text-purple-300">{selectedCampaignName}</span>
                  {" → "}
                  <span className="text-purple-300">{selectedAdSetName}</span>
                </p>
              </div>

              {/* Vehicle preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30">
                {vehicleInfo.imageUrl && (
                  <img src={vehicleInfo.imageUrl} alt="" className="w-14 h-10 rounded-lg object-cover" />
                )}
                <div>
                  <div className="font-bold text-foreground text-sm">{vehicleInfo.brand} {vehicleInfo.model} {vehicleInfo.year}</div>
                  <div className="text-xs text-muted-foreground">{fmtPrice(vehicleInfo.price)}</div>
                </div>
              </div>

              {/* Formato do anúncio */}
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Formato do anúncio</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setAdFormat("single")}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all ${
                      adFormat === "single"
                        ? "border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/30"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <ImageSingle size={18} className={adFormat === "single" ? "text-purple-400" : "text-gray-500"} />
                    <div className="text-left">
                      <div className="text-sm font-medium text-foreground">Imagem única</div>
                      <div className="text-xs text-gray-500">1 foto principal</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setAdFormat("carousel")}
                    disabled={vehicleImages.length < 2}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all ${
                      adFormat === "carousel"
                        ? "border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/30"
                        : vehicleImages.length < 2
                          ? "border-border opacity-40 cursor-not-allowed"
                          : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <LayoutGrid size={18} className={adFormat === "carousel" ? "text-purple-400" : "text-gray-500"} />
                    <div className="text-left">
                      <div className="text-sm font-medium text-foreground">Carrossel</div>
                      <div className="text-xs text-gray-500">
                        {vehicleImages.length < 2 ? "Mín. 2 fotos" : `${vehicleImages.length} fotos disponíveis`}
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Seleção de imagens - Imagem única */}
              {adFormat === "single" && vehicleImages.length > 1 && (
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    <ImageIcon size={12} className="inline mr-1" />
                    Foto do anúncio
                  </label>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {vehicleImages.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedImageUrl(img)}
                        className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                          selectedImageUrl === img ? "border-purple-500 ring-1 ring-purple-500/40" : "border-transparent hover:border-gray-600"
                        }`}
                      >
                        <img src={img} alt={`Foto ${i + 1}`} className="w-16 h-12 object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Seleção de imagens - Carrossel */}
              {adFormat === "carousel" && (
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    <LayoutGrid size={12} className="inline mr-1" />
                    Fotos do carrossel ({carouselSelectedImages.length} selecionadas, mín. 2, máx. 10)
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {vehicleImages.map((img, i) => {
                      const isSelected = carouselSelectedImages.includes(img);
                      const idx = carouselSelectedImages.indexOf(img);
                      return (
                        <button
                          key={i}
                          onClick={() => toggleCarouselImage(img)}
                          className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-[4/3] ${
                            isSelected ? "border-purple-500 ring-1 ring-purple-500/40" : "border-transparent hover:border-gray-600"
                          }`}
                        >
                          <img src={img} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                          {isSelected && (
                            <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center text-foreground text-xs font-bold">
                              {idx + 1}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Estilo da IA */}
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                  <Sparkles size={12} className="inline mr-1" />
                  Estilo do texto
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {AI_STYLES.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setAiStyle(s.value)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-center transition-all ${
                        aiStyle === s.value
                          ? "border-purple-500 bg-purple-500/15"
                          : "border-border hover:border-muted-foreground/30"
                      }`}
                    >
                      <span className="text-lg">{s.emoji}</span>
                      <span className="text-xs font-medium text-foreground">{s.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  {AI_STYLES.find(s => s.value === aiStyle)?.desc}
                </p>
              </div>

              {/* Opções avançadas */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition-colors"
              >
                <Settings2 size={12} />
                {showAdvanced ? "Ocultar opções avançadas" : "Opções avançadas"}
                <ChevronRight size={12} className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`} />
              </button>

              {showAdvanced && (
                <div className="space-y-3 pl-2 border-l-2 border-purple-500/20">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Público-alvo (opcional)</label>
                    <input
                      value={targetAudience}
                      onChange={e => setTargetAudience(e.target.value)}
                      placeholder="Ex: Jovens profissionais, famílias, empresários..."
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Destaques a enfatizar (opcional)</label>
                    <input
                      value={highlights}
                      onChange={e => setHighlights(e.target.value)}
                      placeholder="Ex: Baixa quilometragem, único dono, revisões em dia..."
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Instruções extras para a IA (opcional)</label>
                    <Textarea
                      value={extraInstructions}
                      onChange={e => setExtraInstructions(e.target.value)}
                      placeholder="Ex: Mencionar financiamento disponível, não usar emojis, focar no conforto..."
                      className="bg-muted border-border text-foreground min-h-[60px] focus:border-purple-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: Gerando com IA */}
          {step === "generating" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <Sparkles size={40} className="text-purple-400 animate-pulse" />
                <Loader2 size={20} className="animate-spin text-purple-300 absolute -top-1 -right-1" />
              </div>
              <p className="text-muted-foreground font-medium">A IA está criando o anúncio…</p>
              <p className="text-xs text-gray-500 text-center max-w-xs">
                Analisando dados do veículo e gerando textos otimizados no estilo "{AI_STYLES.find(s => s.value === aiStyle)?.label}".
              </p>
            </div>
          )}

          {/* Step: Revisar e editar textos */}
          {step === "review" && vehicleInfo && (
            <div className="space-y-4">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 mb-1">
                <button onClick={goBack} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /></button>
                <p className="text-xs text-gray-500">
                  <span className="text-purple-300">{selectedCampaignName}</span>
                  {" → "}
                  <span className="text-purple-300">{selectedAdSetName}</span>
                </p>
              </div>

              {/* Vehicle preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30">
                {selectedImageUrl && (
                  <img src={selectedImageUrl} alt="" className="w-16 h-12 rounded-lg object-cover" />
                )}
                <div className="flex-1">
                  <div className="font-bold text-foreground text-sm">{vehicleInfo.brand} {vehicleInfo.model} {vehicleInfo.year}</div>
                  <div className="text-xs text-muted-foreground">{fmtPrice(vehicleInfo.price)}</div>
                </div>
                <Badge variant="outline" className={adFormat === "carousel" ? "text-purple-300 border-purple-500/40" : "text-blue-300 border-blue-500/40"}>
                  {adFormat === "carousel" ? (
                    <><LayoutGrid size={10} className="mr-1" /> Carrossel ({carouselSelectedImages.length})</>
                  ) : (
                    <><ImageSingle size={10} className="mr-1" /> Imagem única</>
                  )}
                </Badge>
              </div>

              {/* Editable fields */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Título (headline)</label>
                  <button onClick={() => copyText(editedTexts.headline)} className="text-gray-500 hover:text-foreground"><Copy size={12} /></button>
                </div>
                <input
                  value={editedTexts.headline}
                  onChange={e => setEditedTexts(t => ({ ...t, headline: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-purple-500"
                  maxLength={40}
                />
                <div className="text-xs text-gray-600 text-right mt-1">{editedTexts.headline.length}/40</div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Descrição</label>
                  <button onClick={() => copyText(editedTexts.description)} className="text-gray-500 hover:text-foreground"><Copy size={12} /></button>
                </div>
                <input
                  value={editedTexts.description}
                  onChange={e => setEditedTexts(t => ({ ...t, description: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-purple-500"
                  maxLength={90}
                />
                <div className="text-xs text-gray-600 text-right mt-1">{editedTexts.description.length}/90</div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Texto principal</label>
                  <button onClick={() => copyText(editedTexts.primaryText)} className="text-gray-500 hover:text-foreground"><Copy size={12} /></button>
                </div>
                <Textarea
                  value={editedTexts.primaryText}
                  onChange={e => setEditedTexts(t => ({ ...t, primaryText: e.target.value }))}
                  className="bg-muted border-border text-foreground min-h-[100px] focus:border-purple-500"
                />
              </div>

              {/* Carousel captions */}
              {adFormat === "carousel" && carouselSelectedImages.length >= 2 && (
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    <LayoutGrid size={12} className="inline mr-1" />
                    Legendas do carrossel
                  </label>
                  <div className="space-y-2">
                    {carouselSelectedImages.map((img, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <img src={img} alt={`Foto ${i + 1}`} className="w-10 h-8 rounded object-cover shrink-0" />
                        <span className="text-xs text-gray-500 shrink-0 w-4">{i + 1}</span>
                        <input
                          value={carouselCaptions[i] || ""}
                          onChange={e => {
                            const newCaptions = [...carouselCaptions];
                            newCaptions[i] = e.target.value;
                            setCarouselCaptions(newCaptions);
                          }}
                          placeholder={`Legenda da foto ${i + 1}...`}
                          maxLength={40}
                          className="flex-1 bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-purple-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Regenerate */}
              <button
                onClick={handleGenerate}
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <Wand2 size={12} /> Gerar novamente com IA
              </button>

              {/* Summary */}
              <div className="rounded-xl bg-muted border border-border p-3 text-sm space-y-1.5">
                <div className="flex justify-between"><span className="text-muted-foreground">Campanha</span><span className="text-foreground truncate ml-4 text-right">{selectedCampaignName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Conjunto</span><span className="text-foreground truncate ml-4 text-right">{selectedAdSetName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Formato</span><span className="text-foreground">{adFormat === "carousel" ? `Carrossel (${carouselSelectedImages.length} fotos)` : "Imagem única"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Estilo IA</span><span className="text-foreground">{AI_STYLES.find(s => s.value === aiStyle)?.emoji} {AI_STYLES.find(s => s.value === aiStyle)?.label}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Rastreamento</span><span className="text-green-400">Pixel AUTOINOVA IVOTI</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Advantage+</span><span className="text-green-400">Ativado</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Instagram</span><span className="text-green-400">Incluído</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Status inicial</span><span className="text-yellow-400">⏸ Pausado</span></div>
              </div>
            </div>
          )}

          {/* Step: Publicando */}
          {step === "publishing" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 size={40} className="animate-spin text-purple-400" />
              <p className="text-muted-foreground">Criando anúncio na Meta…</p>
              <p className="text-xs text-gray-500 text-center max-w-xs">
                {adFormat === "carousel"
                  ? `Fazendo upload de ${carouselSelectedImages.length} imagens, criando o carrossel e o anúncio. Aguarde…`
                  : "Fazendo upload da imagem, criando o criativo e o anúncio. Aguarde…"
                }
              </p>
            </div>
          )}

          {/* Step: Concluído */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-green-400" />
              </div>
              <div className="text-center">
                <p className="font-bold text-green-300 text-lg">Anúncio criado com sucesso!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  O anúncio {adFormat === "carousel" ? "em carrossel " : ""}foi criado <strong className="text-yellow-400">pausado</strong> dentro do conjunto de anúncios selecionado.
                </p>
                <p className="text-xs text-gray-500 mt-2">Revise no Meta Ads Manager e ative quando estiver pronto.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border">
          {step === "campaign" && (
            <Button variant="outline" onClick={onClose} className="w-full">Cancelar</Button>
          )}
          {step === "adset" && (
            <Button variant="outline" onClick={goBack} className="w-full">
              <ArrowLeft size={14} className="mr-2" /> Voltar
            </Button>
          )}
          {step === "vehicle" && (
            <>
              <Button variant="outline" onClick={goBack} className="flex-1">
                <ArrowLeft size={14} className="mr-2" /> Voltar
              </Button>
              <Button onClick={goToCustomize}
                disabled={!selectedVehicleId}
                className="flex-1 bg-purple-600 hover:bg-purple-700">
                Personalizar <ChevronRight size={14} className="ml-1" />
              </Button>
            </>
          )}
          {step === "customize" && (
            <>
              <Button variant="outline" onClick={goBack} className="flex-1">
                <ArrowLeft size={14} className="mr-2" /> Voltar
              </Button>
              <Button onClick={handleGenerate}
                disabled={adFormat === "carousel" && carouselSelectedImages.length < 2}
                className="flex-1 bg-purple-600 hover:bg-purple-700">
                <Sparkles size={14} className="mr-2" /> Gerar com IA
              </Button>
            </>
          )}
          {step === "review" && (
            <>
              <Button variant="outline" onClick={goBack} className="flex-1">
                <ArrowLeft size={14} className="mr-2" /> Voltar
              </Button>
              <Button onClick={handlePublish} className="flex-1 bg-purple-600 hover:bg-purple-700">
                <Megaphone size={14} className="mr-2" /> Criar anúncio
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={onClose} className="w-full">Fechar</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Componente: Card de anúncio ──────────────────────────────────────────────

function AdCard({ ad, vehicle, onRefresh }: { ad: any; vehicle: any; onRefresh: () => void }) {
  const activateMutation    = trpc.metaAds.activate.useMutation({ onSuccess: onRefresh });
  const pauseMutation       = trpc.metaAds.pause.useMutation({ onSuccess: onRefresh });
  const syncInsightsMutation = trpc.metaAds.syncInsights.useMutation({ onSuccess: onRefresh });
  const cpl = ad.leads > 0 ? ad.spendCents / 100 / ad.leads : null;

  const imageUrl = vehicle?.imageUrl || ad.thumbnailUrl;
  const adTitle = vehicle
    ? `${vehicle.brand} ${vehicle.model} ${vehicle.year}`
    : (ad.adName || `Anúncio #${ad.adId?.slice(-6)}`);
  const isImported = ad.source === "imported";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="relative h-36 bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt={adTitle} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Megaphone size={32} className="text-gray-600" />
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          {isImported && (
            <span className="text-xs font-bold px-2 py-1 rounded-full border bg-blue-500/15 text-blue-400 border-blue-500/30">
              Importado
            </span>
          )}
          <span className={`text-xs font-bold px-2 py-1 rounded-full border ${statusColor(ad.status)}`}>
            {statusLabel(ad.status)}
          </span>
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-bold text-foreground text-sm mb-1 truncate" title={adTitle}>
          {adTitle}
        </h3>
        <p className="text-xs text-gray-500 font-mono mb-3 truncate">Ad ID: {ad.adId}</p>

        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { icon: Eye,           label: "Impressões", value: fmtNum(ad.impressions) },
            { icon: MousePointer,  label: "Cliques",    value: fmtNum(ad.clicks) },
            { icon: Users,         label: "Leads",      value: fmtNum(ad.leads) },
            { icon: DollarSign,    label: "Gasto",      value: fmtBRL(ad.spendCents) },
          ].map(m => (
            <div key={m.label} className="bg-muted rounded-lg p-2 text-center">
              <m.icon size={12} className="text-gray-500 mx-auto mb-1" />
              <div className="text-sm font-bold text-foreground">{m.value}</div>
              <div className="text-xs text-gray-500">{m.label}</div>
            </div>
          ))}
        </div>

        {cpl !== null && (
          <div className="text-xs text-center text-muted-foreground mb-3">
            Custo por lead: <span className="font-bold text-foreground">{fmtBRL(cpl * 100)}</span>
          </div>
        )}

        <div className="flex gap-2">
          {ad.status === "paused" ? (
            <Button size="sm" onClick={() => activateMutation.mutate({ adId: ad.adId })}
              disabled={activateMutation.isPending}
              className="flex-1 bg-green-600 hover:bg-green-700 text-xs h-8">
              {activateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="mr-1" />}
              Ativar
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate({ adId: ad.adId })}
              disabled={pauseMutation.isPending}
              className="flex-1 text-xs h-8">
              {pauseMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} className="mr-1" />}
              Pausar
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => syncInsightsMutation.mutate({ adId: ad.adId })}
            disabled={syncInsightsMutation.isPending}
            className="text-xs h-8 px-3">
            {syncInsightsMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </Button>
        </div>

        {ad.lastInsightSync && (
          <p className="text-xs text-gray-600 text-center mt-2">
            Sync: {new Date(ad.lastInsightSync).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function MetaAdsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "paused" | "imported">("all");
  const [showConfig, setShowConfig] = useState(false);

  const { data: configStatus } = trpc.metaAds.isConfigured.useQuery();
  const { data: adsList, isLoading, refetch } = trpc.metaAds.list.useQuery();
  const syncAllMutation = trpc.metaAds.syncAll.useMutation({
    onSuccess: (r) => {
      const parts = [];
      if (r.imported > 0) parts.push(`${r.imported} importados`);
      if (r.updated > 0) parts.push(`${r.updated} atualizados`);
      if (r.errors > 0) parts.push(`${r.errors} erros`);
      toast.success(`Sincronização concluída: ${parts.join(", ") || "nenhuma alteração"}`);
      refetch();
    },
    onError: (e) => toast.error("Erro ao sincronizar: " + e.message),
  });

  const filteredAds = (adsList ?? []).filter(row => {
    if (filter === "all") return true;
    if (filter === "active") return row.ad.status === "active";
    if (filter === "paused") return row.ad.status === "paused";
    if (filter === "imported") return row.ad.source === "imported";
    return true;
  });

  const totals = (adsList ?? []).reduce(
    (acc, row) => ({
      impressions: acc.impressions + (row.ad.impressions ?? 0),
      clicks:      acc.clicks      + (row.ad.clicks      ?? 0),
      leads:       acc.leads       + (row.ad.leads        ?? 0),
      spend:       acc.spend       + (row.ad.spendCents   ?? 0),
      active:      acc.active      + (row.ad.status === "active" ? 1 : 0),
    }),
    { impressions: 0, clicks: 0, leads: 0, spend: 0, active: 0 }
  );

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-600/40 flex items-center justify-center">
                <Megaphone size={20} className="text-blue-400" />
              </div>
              Meta Ads
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Crie anúncios em campanhas e conjuntos existentes com IA</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={() => setShowConfig(v => !v)}>
              <Settings2 size={14} className="mr-2" /> Configurações
            </Button>
            <Button variant="outline" size="sm" onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}>
              {syncAllMutation.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
              Sincronizar
            </Button>
            <Button onClick={() => setShowCreateModal(true)}
              className="bg-purple-600 hover:bg-purple-700">
              <Plus size={16} className="mr-2" /> Criar anúncio
            </Button>
          </div>
        </div>

        {/* Configurações do anúncio */}
        {showConfig && <AdsConfigPanel />}

        {/* Not configured */}
        {configStatus && !configStatus.configured && (
          <NotConfiguredBanner missingVars={configStatus.missingVars} />
        )}

        {/* Totalizadores */}
        {(adsList?.length ?? 0) > 0 && (
          <div className="grid grid-cols-5 gap-4 mb-6">
            {[
              { label: "Ativos",      value: totals.active,      icon: Play,         color: "#22c55e" },
              { label: "Impressões",  value: fmtNum(totals.impressions), icon: Eye,  color: "#3b82f6" },
              { label: "Cliques",     value: fmtNum(totals.clicks),      icon: MousePointer, color: "#a855f7" },
              { label: "Leads",       value: fmtNum(totals.leads),       icon: Users,color: "#f59e0b" },
              { label: "Gasto total", value: fmtBRL(totals.spend),       icon: DollarSign, color: "#ef4444" },
            ].map(stat => (
              <div key={stat.label} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={14} style={{ color: stat.color }} />
                  <span className="text-xs text-muted-foreground">{stat.label}</span>
                </div>
                <div className="text-xl font-bold text-foreground">{stat.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        {(adsList?.length ?? 0) > 0 && (
          <div className="flex gap-2 mb-4">
            {([
              { key: "all", label: "Todos", count: adsList?.length ?? 0 },
              { key: "active", label: "Ativos", count: adsList?.filter(r => r.ad.status === "active").length ?? 0 },
              { key: "paused", label: "Pausados", count: adsList?.filter(r => r.ad.status === "paused").length ?? 0 },
              { key: "imported", label: "Importados", count: adsList?.filter(r => r.ad.source === "imported").length ?? 0 },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === f.key
                    ? "bg-blue-600 text-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>
        )}

        {/* Lista de anúncios */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : (adsList?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-500">
            <Megaphone size={48} className="opacity-20" />
            <div className="text-center">
              <p className="font-semibold text-muted-foreground">Nenhum anúncio encontrado</p>
              <p className="text-sm">Clique em "Sincronizar" para importar seus anúncios existentes, ou "Criar anúncio" para criar novos.</p>
            </div>
          </div>
        ) : filteredAds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-500">
            <Megaphone size={48} className="opacity-20" />
            <p className="text-sm">Nenhum anúncio com este filtro.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAds.map(row => (
              <AdCard
                key={row.ad.id}
                ad={row.ad}
                vehicle={row.vehicle}
                onRefresh={refetch}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showCreateModal && (
        <CreateAdModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); refetch(); }}
        />
      )}
    </div>
  );
}

// ─── Painel de Configurações do Anúncio ───────────────────────────────────────
function AdsConfigPanel() {
  const { data, refetch } = trpc.metaAds.getAdsConfig.useQuery();
  const saveMut = trpc.metaAds.saveAdsConfig.useMutation({
    onSuccess: () => { toast.success("Configurações salvas!"); refetch(); },
    onError: (e) => toast.error("Erro ao salvar: " + e.message),
  });
  const testMut = trpc.metaAds.testConnection.useMutation({
    onSuccess: (r: any) => r.ok
      ? toast.success(`✅ Conectado — Conta: ${r.account || "?"}${r.currency ? " (" + r.currency + ")" : ""}${r.page ? " · Página: " + r.page : ""}`)
      : toast.error("❌ " + (r.error || "Falha na conexão")),
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (data?.effective && !form) {
      const e = data.effective;
      setForm({
        pageId: e.pageId || "",
        instagramActorId: e.instagramActorId || "",
        whatsappNumber: e.whatsappNumber || "",
        dailyBudgetReais: ((e.dailyBudgetCents || 3000) / 100).toFixed(2),
        welcomeMessageTemplate: e.welcomeMessageTemplate || "",
        targetCityKey: e.targetCityKey || "",
        targetRadiusKm: e.targetRadiusKm || 80,
        ageMin: e.ageMin || 25,
        ageMax: e.ageMax || 65,
      });
    }
  }, [data, form]);

  if (!form) return <div className="mb-6 p-4 rounded-xl border border-border bg-card text-sm text-muted-foreground">Carregando configurações…</div>;

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const inputCls = "w-full h-8 text-sm rounded-md border border-border bg-background px-2";

  const onSave = () => {
    saveMut.mutate({
      pageId: form.pageId || undefined,
      instagramActorId: form.instagramActorId || undefined,
      whatsappNumber: form.whatsappNumber || undefined,
      dailyBudgetCents: Math.round(parseFloat(form.dailyBudgetReais || "30") * 100),
      welcomeMessageTemplate: form.welcomeMessageTemplate || undefined,
      targetCityKey: form.targetCityKey || undefined,
      targetRadiusKm: Number(form.targetRadiusKm) || 80,
      ageMin: Number(form.ageMin) || 25,
      ageMax: Number(form.ageMax) || 65,
    });
  };

  return (
    <div className="mb-6 p-4 rounded-xl border border-border bg-card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Settings2 size={16} /> Configurações do Anúncio</h3>
        <Button size="sm" variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
          {testMut.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
          Testar conexão
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">ID da Página (Facebook)</label>
          <input className={inputCls} value={form.pageId} onChange={(e) => set("pageId", e.target.value.trim())} placeholder="ex: 4901993" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Instagram Actor ID (opcional)</label>
          <input className={inputCls} value={form.instagramActorId} onChange={(e) => set("instagramActorId", e.target.value.trim())} placeholder="ex: 8045575383" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Número WhatsApp de destino</label>
          <input className={inputCls} value={form.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value.replace(/\D/g, ""))} placeholder="ex: 555131919081" />
          <p className="text-[10px] text-muted-foreground mt-0.5">No CTWA, o número real é o WhatsApp vinculado à Página. Este é o do link wa.me.</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Orçamento diário (R$)</label>
          <input className={inputCls} type="number" step="1" min="1" value={form.dailyBudgetReais} onChange={(e) => set("dailyBudgetReais", e.target.value)} />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Mensagem de boas-vindas do anúncio (o cliente envia ao clicar)</label>
        <Textarea rows={2} value={form.welcomeMessageTemplate}
          onChange={(e) => set("welcomeMessageTemplate", e.target.value)}
          placeholder="Olá, tenho interesse no veículo: {{marca}} {{modelo}} {{ano}} {{id}}" className="text-sm" />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Variáveis: <b>{"{{marca}}"}</b> <b>{"{{modelo}}"}</b> <b>{"{{ano}}"}</b> <b>{"{{preco}}"}</b> <b>{"{{id}}"}</b>. O ID é sempre incluído (o fluxo depende dele).
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Cidade (key Meta)</label>
          <input className={inputCls} value={form.targetCityKey} onChange={(e) => set("targetCityKey", e.target.value.trim())} placeholder="ex: 229180" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Raio (km)</label>
          <input className={inputCls} type="number" min="1" max="500" value={form.targetRadiusKm} onChange={(e) => set("targetRadiusKm", e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Idade mín.</label>
          <input className={inputCls} type="number" min="13" max="65" value={form.ageMin} onChange={(e) => set("ageMin", e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Idade máx.</label>
          <input className={inputCls} type="number" min="13" max="65" value={form.ageMax} onChange={(e) => set("ageMax", e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={onSave} disabled={saveMut.isPending} className="bg-purple-600 hover:bg-purple-700">
          {saveMut.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
          Salvar configurações
        </Button>
      </div>
    </div>
  );
}
