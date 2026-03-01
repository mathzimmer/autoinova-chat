/**
 * Página de Meta Ads — AutoInova Chat (Simplificada)
 * Foco: criar anúncios dentro de campanhas e conjuntos de anúncios já existentes.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Play, Pause, RefreshCw, Megaphone, Plus, TrendingUp,
  Eye, MousePointer, Users, DollarSign, Sparkles, Wand2, Copy,
  CheckCircle2, ChevronRight, ImageIcon, ArrowLeft, Search,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}
function fmtNum(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("pt-BR");
}
function statusColor(s: string) {
  if (s === "active")   return "bg-green-500/15 text-green-400 border-green-500/30";
  if (s === "paused")   return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  if (s === "archived") return "bg-gray-500/15 text-gray-400 border-gray-500/30";
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
  return "text-gray-400";
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

// ─── Modal: Criar Anúncio (Fluxo Simplificado) ──────────────────────────────

type CreateAdStep = "campaign" | "adset" | "vehicle" | "generating" | "review" | "publishing" | "done";

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
    enabled: step === "vehicle",
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

  async function handleGenerate() {
    if (!selectedVehicleId) return;
    setStep("generating");
    try {
      const result = await generateMutation.mutateAsync({ vehicleId: selectedVehicleId });
      setEditedTexts({
        headline: result.headline,
        description: result.description,
        primaryText: result.primaryText,
      });
      setVehicleInfo(result.vehicle);
      setStep("review");
    } catch (e: any) {
      toast.error("Erro ao gerar texto: " + e.message);
      setStep("vehicle");
    }
  }

  async function handlePublish() {
    if (!selectedVehicleId || !selectedCampaignId || !selectedAdSetId) return;
    setStep("publishing");
    try {
      await createMutation.mutateAsync({
        vehicleId: selectedVehicleId,
        campaignId: selectedCampaignId,
        adSetId: selectedAdSetId,
        headline: editedTexts.headline,
        description: editedTexts.description,
        primaryText: editedTexts.primaryText,
        selectedImageUrl: selectedImageUrl || undefined,
        campaignObjective: selectedCampaignObjective || undefined,
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
    else if (step === "review") setStep("vehicle");
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
    { key: "review", label: "Revisar" },
  ];
  const currentStepIndex = steps.findIndex(s => s.key === step) ?? 0;

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
    return imgs.slice(0, 8);
  }, [selectedVehicleId, vehicles]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1520] border border-[#1e2d40] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#1e2d40]">
          <div>
            <h2 className="font-bold text-lg text-white flex items-center gap-2">
              <Sparkles size={18} className="text-purple-400" />
              Criar Anúncio
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">Selecione campanha, conjunto e veículo</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Step indicator */}
        {!["generating", "publishing", "done"].includes(step) && (
          <div className="flex items-center gap-1 px-5 py-3 border-b border-[#1e2d40]/50">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  i < currentStepIndex ? "bg-green-500/15 text-green-400" :
                  i === currentStepIndex ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40" :
                  "bg-[#1a1f2e] text-gray-500"
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
              <p className="text-sm text-gray-300 mb-4">Selecione a campanha onde o anúncio será criado:</p>
              {loadingCampaigns ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>
              ) : !campaigns?.length ? (
                <div className="text-center py-12 text-gray-500">
                  <Megaphone size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nenhuma campanha encontrada na sua conta Meta.</p>
                  <p className="text-xs text-gray-600 mt-1">Crie uma campanha no Meta Ads Manager primeiro.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {campaigns.map(c => (
                    <button
                      key={c.id}
                      onClick={() => selectCampaign(c.id, c.name, c.objective)}
                      className="w-full flex items-center justify-between p-3.5 rounded-xl border border-[#2a3040] hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-left group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-white text-sm truncate">{c.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs ${metaStatusColor(c.status)}`}>{metaStatusLabel(c.status)}</span>
                          <span className="text-xs text-gray-600">·</span>
                          <span className="text-xs text-gray-500">{c.objective}</span>
                          <span className="text-xs text-gray-600">·</span>
                          <span className="text-xs text-gray-600 font-mono">ID: {c.id}</span>
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
                <button onClick={goBack} className="text-gray-400 hover:text-white"><ArrowLeft size={16} /></button>
                <div>
                  <p className="text-sm text-gray-300">Selecione o conjunto de anúncios:</p>
                  <p className="text-xs text-gray-500">Campanha: <span className="text-purple-300">{selectedCampaignName}</span></p>
                </div>
              </div>
              {loadingAdSets ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>
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
                      className="w-full flex items-center justify-between p-3.5 rounded-xl border border-[#2a3040] hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-left group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-white text-sm truncate">{a.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs ${metaStatusColor(a.status)}`}>{metaStatusLabel(a.status)}</span>
                          <span className="text-xs text-gray-600">·</span>
                          <span className="text-xs text-gray-500">
                            Orçamento: R$ {(parseInt(a.dailyBudget) / 100).toFixed(2)}/dia
                          </span>
                          <span className="text-xs text-gray-600">·</span>
                          <span className="text-xs text-gray-600 font-mono">ID: {a.id}</span>
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
                <button onClick={goBack} className="text-gray-400 hover:text-white"><ArrowLeft size={16} /></button>
                <div>
                  <p className="text-sm text-gray-300">Selecione o veículo para anunciar:</p>
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
                  className="w-full bg-[#1a1f2e] border border-[#2a3040] rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                />
              </div>

              {loadingVehicles ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-[340px] overflow-y-auto">
                  {availableVehicles.map(v => {
                    const selected = selectedVehicleId === v.id;
                    return (
                      <button key={v.id} onClick={() => selectVehicle(v)}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                          selected ? "border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/30" : "border-[#2a3040] hover:border-[#3a4050]"
                        }`}>
                        <img src={v.imageUrl!} alt={v.model} className="w-14 h-10 rounded-lg object-cover shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{v.brand} {v.model}</div>
                          <div className="text-xs text-gray-400">{v.year}</div>
                          <div className="text-xs text-purple-300 font-medium">
                            {(v.price / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
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

          {/* Step: Gerando com IA */}
          {step === "generating" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <Sparkles size={40} className="text-purple-400 animate-pulse" />
                <Loader2 size={20} className="animate-spin text-purple-300 absolute -top-1 -right-1" />
              </div>
              <p className="text-gray-300 font-medium">A IA está criando o anúncio…</p>
              <p className="text-xs text-gray-500 text-center max-w-xs">
                Analisando dados do veículo e gerando textos otimizados para conversão.
              </p>
            </div>
          )}

          {/* Step: Revisar e editar textos */}
          {step === "review" && vehicleInfo && (
            <div className="space-y-4">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 mb-1">
                <button onClick={goBack} className="text-gray-400 hover:text-white"><ArrowLeft size={16} /></button>
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
                <div>
                  <div className="font-bold text-white text-sm">{vehicleInfo.brand} {vehicleInfo.model} {vehicleInfo.year}</div>
                  <div className="text-xs text-gray-400">
                    {(vehicleInfo.price / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>

              {/* Image selection */}
              {vehicleImages.length > 1 && (
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
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

              {/* Editable fields */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-400 uppercase tracking-wider">Título (headline)</label>
                  <button onClick={() => copyText(editedTexts.headline)} className="text-gray-500 hover:text-gray-300"><Copy size={12} /></button>
                </div>
                <input
                  value={editedTexts.headline}
                  onChange={e => setEditedTexts(t => ({ ...t, headline: e.target.value }))}
                  className="w-full bg-[#1a1f2e] border border-[#2a3040] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                  maxLength={40}
                />
                <div className="text-xs text-gray-600 text-right mt-1">{editedTexts.headline.length}/40</div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-400 uppercase tracking-wider">Descrição</label>
                  <button onClick={() => copyText(editedTexts.description)} className="text-gray-500 hover:text-gray-300"><Copy size={12} /></button>
                </div>
                <input
                  value={editedTexts.description}
                  onChange={e => setEditedTexts(t => ({ ...t, description: e.target.value }))}
                  className="w-full bg-[#1a1f2e] border border-[#2a3040] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                  maxLength={90}
                />
                <div className="text-xs text-gray-600 text-right mt-1">{editedTexts.description.length}/90</div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-400 uppercase tracking-wider">Texto principal</label>
                  <button onClick={() => copyText(editedTexts.primaryText)} className="text-gray-500 hover:text-gray-300"><Copy size={12} /></button>
                </div>
                <Textarea
                  value={editedTexts.primaryText}
                  onChange={e => setEditedTexts(t => ({ ...t, primaryText: e.target.value }))}
                  className="bg-[#1a1f2e] border-[#2a3040] text-white min-h-[100px] focus:border-purple-500"
                />
              </div>

              {/* Regenerate */}
              <button
                onClick={handleGenerate}
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <Wand2 size={12} /> Gerar novamente com IA
              </button>

              {/* Summary */}
              <div className="rounded-xl bg-[#1a1f2e] border border-[#2a3040] p-3 text-sm space-y-1.5">
                <div className="flex justify-between"><span className="text-gray-400">Campanha</span><span className="text-white truncate ml-4 text-right">{selectedCampaignName}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Conjunto</span><span className="text-white truncate ml-4 text-right">{selectedAdSetName}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Status inicial</span><span className="text-yellow-400">⏸ Pausado</span></div>
              </div>
            </div>
          )}

          {/* Step: Publicando */}
          {step === "publishing" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 size={40} className="animate-spin text-purple-400" />
              <p className="text-gray-300">Criando anúncio na Meta…</p>
              <p className="text-xs text-gray-500 text-center max-w-xs">
                Fazendo upload da imagem, criando o criativo e o anúncio. Aguarde…
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
                <p className="text-sm text-gray-400 mt-1">O anúncio foi criado <strong className="text-yellow-400">pausado</strong> dentro do conjunto de anúncios selecionado.</p>
                <p className="text-xs text-gray-500 mt-2">Revise no Meta Ads Manager e ative quando estiver pronto.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-[#1e2d40]">
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
              <Button onClick={handleGenerate}
                disabled={!selectedVehicleId}
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
    <div className="bg-[#0f1520] border border-[#1e2d40] rounded-xl overflow-hidden">
      <div className="relative h-36 bg-[#1a1f2e]">
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
        <h3 className="font-bold text-white text-sm mb-1 truncate" title={adTitle}>
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
            <div key={m.label} className="bg-[#1a1f2e] rounded-lg p-2 text-center">
              <m.icon size={12} className="text-gray-500 mx-auto mb-1" />
              <div className="text-sm font-bold text-white">{m.value}</div>
              <div className="text-xs text-gray-500">{m.label}</div>
            </div>
          ))}
        </div>

        {cpl !== null && (
          <div className="text-xs text-center text-gray-400 mb-3">
            Custo por lead: <span className="font-bold text-white">{fmtBRL(cpl * 100)}</span>
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
    <div className="h-full overflow-y-auto bg-[#080c12]">
      <div className="max-w-6xl mx-auto p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-600/40 flex items-center justify-center">
                <Megaphone size={20} className="text-blue-400" />
              </div>
              Meta Ads
            </h1>
            <p className="text-gray-400 text-sm mt-1">Crie anúncios em campanhas e conjuntos existentes com IA</p>
          </div>
          <div className="flex gap-3">
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
              <div key={stat.label} className="bg-[#0f1520] border border-[#1e2d40] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={14} style={{ color: stat.color }} />
                  <span className="text-xs text-gray-400">{stat.label}</span>
                </div>
                <div className="text-xl font-bold text-white">{stat.value}</div>
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
                    ? "bg-blue-600 text-white"
                    : "bg-[#1a1f2e] text-gray-400 hover:text-white hover:bg-[#252b3b]"
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
            <Loader2 size={32} className="animate-spin text-gray-400" />
          </div>
        ) : (adsList?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-500">
            <Megaphone size={48} className="opacity-20" />
            <div className="text-center">
              <p className="font-semibold text-gray-400">Nenhum anúncio encontrado</p>
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
