/**
 * Página de Meta Ads — AutoInova Chat
 * Adicionar à navegação em AppLayout.tsx e ao roteador em App.tsx:
 *
 *   import MetaAdsPage from "./pages/MetaAds";
 *   <Route path="/meta-ads" element={<MetaAdsPage />} />
 *
 * E no menu lateral, adicionar item:
 *   { path: "/meta-ads", label: "Meta Ads", icon: <Megaphone /> }
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Play, Pause, RefreshCw, Megaphone, Plus, TrendingUp, Eye, MousePointer, Users, DollarSign, CheckSquare, Square, Sparkles, Wand2, Copy } from "lucide-react";

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

// ─── Componente: Card de configuração ausente ─────────────────────────────────

function NotConfiguredBanner({ missingVars }: { missingVars: string[] }) {
  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 mb-6">
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-yellow-500/20 p-3 text-yellow-400 text-2xl">⚠️</div>
        <div>
          <h3 className="font-bold text-yellow-300 text-base mb-1">Meta Ads não configurado</h3>
          <p className="text-sm text-yellow-200/70 mb-3">
            Configure as seguintes variáveis de ambiente no seu servidor (Railway) para ativar a criação automática de anúncios:
          </p>
          <div className="flex flex-col gap-1">
            {missingVars.map(v => (
              <code key={v} className="text-xs bg-black/30 text-yellow-300 px-2 py-1 rounded w-fit">{v}</code>
            ))}
          </div>
          <p className="text-xs text-yellow-200/50 mt-3">
            Veja o Guia de Implantação, Fase 5 — Meta Ads, para obter esses valores.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Componente: Modal de criar anúncio ──────────────────────────────────────

function CreateAdModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);
  const [budget, setBudget] = useState(30);
  const [campaignId, setCampaignId] = useState("");
  const [step, setStep] = useState<"select" | "confirm" | "loading" | "done">("select");
  const [results, setResults] = useState<any[]>([]);

  const { data: vehicles, isLoading: loadingVehicles } = trpc.vehicle.list.useQuery();
  const createMutation = trpc.metaAds.createAd.useMutation();
  const batchMutation  = trpc.metaAds.createBatch.useMutation();

  const availableVehicles = vehicles?.filter(v => v.available && v.imageUrl) ?? [];

  function toggleVehicle(id: number) {
    setSelectedVehicleIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function handleCreate() {
    setStep("loading");
    try {
      if (mode === "single" && selectedVehicleIds.length === 1) {
        const r = await createMutation.mutateAsync({
          vehicleId: selectedVehicleIds[0],
          dailyBudgetBRL: budget,
          campaignId: campaignId || undefined,
        });
        setResults([{ vehicleId: selectedVehicleIds[0], success: true, adId: r.adId }]);
      } else {
        const r = await batchMutation.mutateAsync({
          vehicleIds: selectedVehicleIds,
          dailyBudgetBRL: budget,
          campaignId: campaignId || undefined,
        });
        setResults(r.results);
      }
      setStep("done");
      onCreated();
    } catch (e: any) {
      toast.error("Erro ao criar anúncio: " + e.message);
      setStep("confirm");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1520] border border-[#1e2d40] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#1e2d40]">
          <div>
            <h2 className="font-bold text-lg text-white">Criar Anúncio no Meta Ads</h2>
            <p className="text-sm text-gray-400">Facebook + Instagram — Geração de Leads</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === "select" && (
            <div className="space-y-5">
              {/* Modo */}
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Modo</label>
                <div className="flex gap-3">
                  {[["single","Um veículo"],["batch","Vários veículos"]].map(([k,l]) => (
                    <button key={k} onClick={() => { setMode(k as any); setSelectedVehicleIds([]); }}
                      className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-all ${mode === k ? "border-blue-500 bg-blue-500/15 text-blue-400" : "border-[#2a3040] text-gray-400"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Selecionar veículos */}
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                  Veículos{mode === "batch" ? ` (${selectedVehicleIds.length} selecionados)` : ""}
                </label>
                {loadingVehicles ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                    {availableVehicles.map(v => {
                      const selected = selectedVehicleIds.includes(v.id);
                      return (
                        <button key={v.id} onClick={() => {
                          if (mode === "single") setSelectedVehicleIds([v.id]);
                          else toggleVehicle(v.id);
                        }}
                          className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all ${selected ? "border-blue-500 bg-blue-500/15" : "border-[#2a3040] hover:border-[#3a4050]"}`}>
                          {mode === "batch" && (
                            selected
                              ? <CheckSquare size={14} className="text-blue-400 shrink-0" />
                              : <Square size={14} className="text-gray-500 shrink-0" />
                          )}
                          <img src={v.imageUrl!} alt={v.model} className="w-10 h-8 rounded object-cover shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-white truncate">{v.brand} {v.model}</div>
                            <div className="text-xs text-gray-400">{v.year} · {(v.price / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</div>
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

              {/* Orçamento */}
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                  Orçamento diário: <span className="text-blue-400 font-bold">R$ {budget}</span>
                </label>
                <input type="range" min={5} max={200} step={5} value={budget}
                  onChange={e => setBudget(parseInt(e.target.value))}
                  className="w-full accent-blue-500" />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>R$ 5</span><span>R$ 200/dia</span>
                </div>
              </div>

              {/* Campanha existente (opcional) */}
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                  ID da campanha existente <span className="text-gray-600">(opcional — deixe em branco para criar nova)</span>
                </label>
                <input value={campaignId} onChange={e => setCampaignId(e.target.value)}
                  placeholder="12345678901234567"
                  className="w-full bg-[#1a1f2e] border border-[#2a3040] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 font-mono" />
              </div>
            </div>
          )}

          {step === "confirm" && (
            <div className="space-y-4">
              <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-4">
                <h3 className="font-bold text-blue-300 mb-3">Confirme a criação</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">Veículos</span><span className="text-white">{selectedVehicleIds.length}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Orçamento diário por anúncio</span><span className="text-white">R$ {budget}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Campanha</span><span className="text-white">{campaignId || "Nova campanha"}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Status inicial</span><span className="text-yellow-400">⏸ Pausado</span></div>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Os anúncios serão criados <strong className="text-gray-300">pausados</strong>. Revise no Meta Ads Manager e ative manualmente quando estiver satisfeito com os criativos.
              </p>
            </div>
          )}

          {step === "loading" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 size={40} className="animate-spin text-blue-400" />
              <p className="text-gray-300">Criando anúncios na Meta…</p>
              <p className="text-xs text-gray-500 text-center max-w-xs">
                Isso pode levar alguns segundos por veículo. Não feche esta janela.
              </p>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/30">
                <span className="text-3xl">✅</span>
                <div>
                  <div className="font-bold text-green-300">Anúncios criados!</div>
                  <div className="text-sm text-green-200/70">Acesse o Meta Ads Manager para revisar e ativar.</div>
                </div>
              </div>
              {results.map(r => (
                <div key={r.vehicleId} className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${r.success ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                  <span>{r.success ? "✅" : "❌"}</span>
                  <span className="text-gray-300">Veículo #{r.vehicleId}</span>
                  {r.adId && <span className="text-xs text-gray-500 font-mono ml-auto">Ad: {r.adId}</span>}
                  {r.error && <span className="text-xs text-red-400 ml-auto">{r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-[#1e2d40]">
          {step === "select" && (
            <>
              <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button onClick={() => setStep("confirm")}
                disabled={selectedVehicleIds.length === 0}
                className="flex-1 bg-blue-600 hover:bg-blue-700">
                Continuar →
              </Button>
            </>
          )}
          {step === "confirm" && (
            <>
              <Button variant="outline" onClick={() => setStep("select")} className="flex-1">← Voltar</Button>
              <Button onClick={handleCreate} className="flex-1 bg-blue-600 hover:bg-blue-700">
                <Megaphone size={16} className="mr-2" /> Criar anúncios
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

  // Determinar imagem e nome (suporta anúncios importados e do CRM)
  const imageUrl = vehicle?.imageUrl || ad.thumbnailUrl;
  const adTitle = vehicle
    ? `${vehicle.brand} ${vehicle.model} ${vehicle.year}`
    : (ad.adName || `Anúncio #${ad.adId?.slice(-6)}`);
  const isImported = ad.source === "imported";

  return (
    <div className="bg-[#0f1520] border border-[#1e2d40] rounded-xl overflow-hidden">
      {/* Imagem */}
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
        {/* Nome */}
        <h3 className="font-bold text-white text-sm mb-1 truncate" title={adTitle}>
          {adTitle}
        </h3>
        <p className="text-xs text-gray-500 font-mono mb-3 truncate">Ad ID: {ad.adId}</p>

        {/* Métricas */}
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

        {/* CPL */}
        {cpl !== null && (
          <div className="text-xs text-center text-gray-400 mb-3">
            Custo por lead: <span className="font-bold text-white">{fmtBRL(cpl * 100)}</span>
            {" · "} Orçamento: <span className="text-white">{fmtBRL(ad.dailyBudgetCents)}/dia</span>
          </div>
        )}

        {/* Botões */}
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

        {/* Última sync */}
        {ad.lastInsightSync && (
          <p className="text-xs text-gray-600 text-center mt-2">
            Sync: {new Date(ad.lastInsightSync).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Modal: Criar anúncio com IA ────────────────────────────────────────────────

function AiAdModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [budget, setBudget] = useState(30);
  const [campaignId, setCampaignId] = useState("");
  const [step, setStep] = useState<"select" | "generating" | "review" | "publishing" | "done">("select");
  const [aiResult, setAiResult] = useState<{
    headline: string;
    description: string;
    primaryText: string;
    callToAction: string;
    vehicle: { id: number; brand: string; model: string; year: number; price: number; imageUrl: string | null };
  } | null>(null);
  const [editedTexts, setEditedTexts] = useState({ headline: "", description: "", primaryText: "" });

  const { data: vehicles, isLoading: loadingVehicles } = trpc.vehicle.list.useQuery();
  const generateMutation = trpc.metaAds.generateAdText.useMutation();
  const createWithTextMutation = trpc.metaAds.createAdWithText.useMutation();

  const availableVehicles = vehicles?.filter(v => v.available && v.imageUrl) ?? [];

  async function handleGenerate() {
    if (!selectedVehicleId) return;
    setStep("generating");
    try {
      const result = await generateMutation.mutateAsync({ vehicleId: selectedVehicleId });
      setAiResult(result);
      setEditedTexts({
        headline: result.headline,
        description: result.description,
        primaryText: result.primaryText,
      });
      setStep("review");
    } catch (e: any) {
      toast.error("Erro ao gerar texto: " + e.message);
      setStep("select");
    }
  }

  async function handlePublish() {
    if (!selectedVehicleId) return;
    setStep("publishing");
    try {
      await createWithTextMutation.mutateAsync({
        vehicleId: selectedVehicleId,
        headline: editedTexts.headline,
        description: editedTexts.description,
        primaryText: editedTexts.primaryText,
        dailyBudgetBRL: budget,
        campaignId: campaignId || undefined,
      });
      setStep("done");
      onCreated();
    } catch (e: any) {
      toast.error("Erro ao criar anúncio: " + e.message);
      setStep("review");
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1520] border border-[#1e2d40] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#1e2d40]">
          <div>
            <h2 className="font-bold text-lg text-white flex items-center gap-2">
              <Sparkles size={18} className="text-purple-400" />
              Criar Anúncio com IA
            </h2>
            <p className="text-sm text-gray-400">A IA gera textos otimizados usando os dados do veículo</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Select vehicle */}
          {step === "select" && (
            <div className="space-y-5">
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Selecione o veículo</label>
                {loadingVehicles ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                    {availableVehicles.map(v => {
                      const selected = selectedVehicleId === v.id;
                      return (
                        <button key={v.id} onClick={() => setSelectedVehicleId(v.id)}
                          className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all ${selected ? "border-purple-500 bg-purple-500/15" : "border-[#2a3040] hover:border-[#3a4050]"}`}>
                          <img src={v.imageUrl!} alt={v.model} className="w-10 h-8 rounded object-cover shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-white truncate">{v.brand} {v.model}</div>
                            <div className="text-xs text-gray-400">{v.year} · {(v.price / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Budget */}
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                  Orçamento diário: <span className="text-purple-400 font-bold">R$ {budget}</span>
                </label>
                <input type="range" min={5} max={200} step={5} value={budget}
                  onChange={e => setBudget(parseInt(e.target.value))}
                  className="w-full accent-purple-500" />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>R$ 5</span><span>R$ 200/dia</span>
                </div>
              </div>

              {/* Campaign ID */}
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                  ID da campanha <span className="text-gray-600">(opcional)</span>
                </label>
                <input value={campaignId} onChange={e => setCampaignId(e.target.value)}
                  placeholder="Deixe em branco para criar nova"
                  className="w-full bg-[#1a1f2e] border border-[#2a3040] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500 font-mono" />
              </div>
            </div>
          )}

          {/* Step 2: Generating */}
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

          {/* Step 3: Review AI-generated text */}
          {step === "review" && aiResult && (
            <div className="space-y-5">
              {/* Vehicle preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30">
                {aiResult.vehicle.imageUrl && (
                  <img src={aiResult.vehicle.imageUrl} alt="" className="w-16 h-12 rounded-lg object-cover" />
                )}
                <div>
                  <div className="font-bold text-white text-sm">{aiResult.vehicle.brand} {aiResult.vehicle.model} {aiResult.vehicle.year}</div>
                  <div className="text-xs text-gray-400">{(aiResult.vehicle.price / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</div>
                </div>
              </div>

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

              {/* Regenerate button */}
              <button
                onClick={handleGenerate}
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <Wand2 size={12} /> Gerar novamente
              </button>

              {/* Budget summary */}
              <div className="rounded-xl bg-[#1a1f2e] border border-[#2a3040] p-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Orçamento diário</span><span className="text-white">R$ {budget}</span></div>
                <div className="flex justify-between mt-1"><span className="text-gray-400">Campanha</span><span className="text-white">{campaignId || "Nova campanha"}</span></div>
                <div className="flex justify-between mt-1"><span className="text-gray-400">Status inicial</span><span className="text-yellow-400">⏸ Pausado</span></div>
              </div>
            </div>
          )}

          {/* Step 4: Publishing */}
          {step === "publishing" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 size={40} className="animate-spin text-purple-400" />
              <p className="text-gray-300">Publicando anúncio na Meta…</p>
            </div>
          )}

          {/* Step 5: Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center">
                <CheckSquare size={28} className="text-green-400" />
              </div>
              <div className="text-center">
                <p className="font-bold text-green-300 text-lg">Anúncio criado com sucesso!</p>
                <p className="text-sm text-gray-400 mt-1">O anúncio foi criado pausado. Revise no Meta Ads Manager e ative quando estiver pronto.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-[#1e2d40]">
          {step === "select" && (
            <>
              <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button onClick={handleGenerate}
                disabled={!selectedVehicleId}
                className="flex-1 bg-purple-600 hover:bg-purple-700">
                <Sparkles size={14} className="mr-2" /> Gerar com IA
              </Button>
            </>
          )}
          {step === "review" && (
            <>
              <Button variant="outline" onClick={() => setStep("select")} className="flex-1">← Voltar</Button>
              <Button onClick={handlePublish} className="flex-1 bg-purple-600 hover:bg-purple-700">
                <Megaphone size={14} className="mr-2" /> Publicar anúncio
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

// ─── Página principal ─────────────────────────────────────────────────────────

export default function MetaAdsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
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

  // Filtrar anúncios
  const filteredAds = (adsList ?? []).filter(row => {
    if (filter === "all") return true;
    if (filter === "active") return row.ad.status === "active";
    if (filter === "paused") return row.ad.status === "paused";
    if (filter === "imported") return row.ad.source === "imported";
    return true;
  });

  // Totalizadores
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
            <p className="text-gray-400 text-sm mt-1">Crie e gerencie anúncios no Facebook e Instagram diretamente do CRM</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}>
              {syncAllMutation.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
              Sincronizar Meta
            </Button>
            <Button onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 hover:bg-blue-700">
              <Plus size={16} className="mr-2" /> Criar anúncio
            </Button>
            <Button onClick={() => setShowAiModal(true)}
              className="bg-purple-600 hover:bg-purple-700">
              <Sparkles size={16} className="mr-2" /> Criar com IA
            </Button>
          </div>
        </div>

        {/* Banner de configuração ausente */}
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
              <p className="text-sm">Clique em "Sincronizar Meta" para importar seus anúncios existentes, ou "Criar anúncio" para criar novos.</p>
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

      {/* AI Modal */}
      {showAiModal && (
        <AiAdModal
          onClose={() => setShowAiModal(false)}
          onCreated={() => { setShowAiModal(false); refetch(); }}
        />
      )}
    </div>
  );
}
