import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import StockAiSettings from "./StockAiSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  BrainCircuit, Flame, Snowflake, Sun, Zap, Plus, Trash2, Tag,
  FileText, Car, Layers, CheckCircle2, Save, Info, Sparkles
} from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  novo: "Novo Contacto",
  interesse_definido: "Interesse Definido",
  pagamento_definido: "Forma de Pagamento",
  dados_pessoais: "Dados Pessoais",
  dados_troca: "Veículo de Troca",
  encaminhado_vendedor: "Encaminhado ao Vendedor",
  negociando: "Em Negociação",
  fechado: "Venda Concluída",
  perdido: "Lead Perdido / Desistência",
};

const TEMPERATURE_OPTIONS = [
  { value: "frio", label: "Frio ❄️", color: "border-blue-500/30 bg-blue-500/10 text-blue-500" },
  { value: "morno", label: "Morno 🌤️", color: "border-yellow-500/30 bg-yellow-500/10 text-yellow-500" },
  { value: "quente", label: "Quente 🔥", color: "border-orange-500/30 bg-orange-500/10 text-orange-500" },
  { value: "muito_quente", label: "Muito Quente 💥", color: "border-red-500/30 bg-red-500/10 text-red-500" },
];

export default function CrmAiSettings() {
  const configQuery = trpc.settings.getAiCrmConfig.useQuery();
  const utils = trpc.useUtils();

  const [temperatureMap, setTemperatureMap] = useState<Record<string, "frio" | "morno" | "quente" | "muito_quente">>({});
  const [autoTags, setAutoTags] = useState<Array<{ keyword: string; tag: string }>>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [newTag, setNewTag] = useState("");
  const [timelineLogging, setTimelineLogging] = useState({
    logStageChange: true,
    logDataCollected: true,
    logOnSellerTransfer: true,
    noteStyle: "objetivo" as "objetivo" | "detalhado",
  });
  const [stockRules, setStockRules] = useState({
    preferSameStore: true,
    requirePhoto: false,
    autoSearchOnVehicleInterest: true,
  });
  const [funnelStageInstructions, setFunnelStageInstructions] = useState<Record<string, string>>({});

  useEffect(() => {
    if (configQuery.data) {
      setTemperatureMap((configQuery.data.temperatureMap as any) || {});
      setAutoTags(configQuery.data.autoTags || []);
      setTimelineLogging(configQuery.data.timelineLogging || {
        logStageChange: true,
        logDataCollected: true,
        logOnSellerTransfer: true,
        noteStyle: "objetivo",
      });
      setStockRules(configQuery.data.stockRules || {
        preferSameStore: true,
        requirePhoto: false,
        autoSearchOnVehicleInterest: true,
      });
      setFunnelStageInstructions(configQuery.data.funnelStageInstructions || {});
    }
  }, [configQuery.data]);

  const saveMutation = trpc.settings.saveAiCrmConfig.useMutation({
    onSuccess: () => {
      toast.success("Parametrização do CRM por IA salva com sucesso!");
      utils.settings.getAiCrmConfig.invalidate();
    },
    onError: (err) => toast.error("Erro ao salvar parametrização: " + err.message),
  });

  const handleAddAutoTag = () => {
    if (!newKeyword.trim() || !newTag.trim()) {
      toast.error("Preencha a palavra-chave e o nome da etiqueta.");
      return;
    }
    setAutoTags([...autoTags, { keyword: newKeyword.trim(), tag: newTag.trim() }]);
    setNewKeyword("");
    setNewTag("");
  };

  const handleRemoveAutoTag = (index: number) => {
    setAutoTags(autoTags.filter((_, i) => i !== index));
  };

  const handleSaveAll = () => {
    saveMutation.mutate({
      temperatureMap,
      autoTags,
      timelineLogging,
      stockRules,
      funnelStageInstructions,
    });
  };

  if (configQuery.isLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Carregando configurações da IA do CRM...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-primary" />
            Parametrização da IA do CRM
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Defina como a inteligência artificial evolui etapas, atribui temperaturas aos leads, aplica etiquetas e gera notas no histórico.
          </p>
        </div>
        <Button onClick={handleSaveAll} disabled={saveMutation.isPending} className="gap-2 shadow-sm">
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "Salvando..." : "Salvar Parametrização"}
        </Button>
      </div>

      {/* Estoque para IA (curadoria + campos) */}
      <StockAiSettings />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CARD 1: Funil de Vendas e Temperaturas */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              1. Etapas do Funil & Atribuição de Temperatura
            </CardTitle>
            <CardDescription className="text-xs">
              Escolha a temperatura atribuída automaticamente ao lead conforme a IA o avança pelas etapas de qualificação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {Object.entries(STAGE_LABELS).map(([stageKey, stageLabel]) => {
              const currentTemp = temperatureMap[stageKey] || "frio";
              return (
                <div key={stageKey} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card/50 gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground truncate">{stageLabel}</p>
                    <span className="text-[10px] text-muted-foreground font-mono">{stageKey}</span>
                  </div>
                  <Select
                    value={currentTemp}
                    onValueChange={(val: "frio" | "morno" | "quente" | "muito_quente") => {
                      setTemperatureMap({ ...temperatureMap, [stageKey]: val });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPERATURE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* CARD 2: Auto-Etiquetagem por Palavra-Chave */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4 text-blue-500" />
              2. Auto-Etiquetagem por Palavras-Chave
            </CardTitle>
            <CardDescription className="text-xs">
              Quando a IA detectar palavras-chave na conversa, ela aplicará a etiqueta automaticamente e notificará o CRM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {/* Lista de regras atuais */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {autoTags.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-4">
                  Nenhuma regra de auto-etiquetagem cadastrada.
                </p>
              ) : (
                autoTags.map((rule, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/30">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Palavra-chave:</span>
                      <Badge variant="outline" className="font-mono bg-background">{rule.keyword}</Badge>
                      <span className="text-muted-foreground">➔ Etiqueta:</span>
                      <Badge className="bg-primary/15 text-primary border-primary/20">{rule.tag}</Badge>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveAutoTag(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <Separator />

            {/* Adicionar nova regra */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Adicionar Nova Regra</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Palavra-chave (ex: troca)"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="Nome da Etiqueta (ex: Com Troca)"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleAddAutoTag} className="w-full h-8 text-xs gap-1">
                <Plus className="h-3.5 w-3.5" /> Adicionar Regra de Etiqueta
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CARD 3: Linha do Tempo e Resumos Automáticos */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-500" />
              3. Comentários & Histórico da Linha do Tempo
            </CardTitle>
            <CardDescription className="text-xs">
              Configure quando a IA escreve resumos nas notas do lead e registra atividades para o operador.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Registrar log a cada mudança de etapa</Label>
                <p className="text-[11px] text-muted-foreground">Grava um evento no histórico quando a IA avança o funil.</p>
              </div>
              <Switch
                checked={timelineLogging.logStageChange}
                onCheckedChange={(val) => setTimelineLogging({ ...timelineLogging, logStageChange: val })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Registrar log ao capturar dados relevantes</Label>
                <p className="text-[11px] text-muted-foreground">Salva resumo ao identificar valor de entrada, usado na troca ou cidade.</p>
              </div>
              <Switch
                checked={timelineLogging.logDataCollected}
                onCheckedChange={(val) => setTimelineLogging({ ...timelineLogging, logDataCollected: val })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Resumo obrigatório ao transferir ao vendedor</Label>
                <p className="text-[11px] text-muted-foreground">Cria uma nota consolidada para o vendedor antes de passar o chat.</p>
              </div>
              <Switch
                checked={timelineLogging.logOnSellerTransfer}
                onCheckedChange={(val) => setTimelineLogging({ ...timelineLogging, logOnSellerTransfer: val })}
              />
            </div>

            <div className="space-y-1.5 pt-2">
              <Label className="text-xs font-semibold">Estilo de Resumo das Notas</Label>
              <Select
                value={timelineLogging.noteStyle}
                onValueChange={(val: "objetivo" | "detalhado") => setTimelineLogging({ ...timelineLogging, noteStyle: val })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="objetivo">Objetivo (2-3 linhas diretas ao ponto)</SelectItem>
                  <SelectItem value="detalhado">Detalhado (Ficha completa com todos os campos)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* CARD 4: Conexão com Estoque */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4 text-purple-500" />
              4. Vínculo Automático com Veículos do Estoque
            </CardTitle>
            <CardDescription className="text-xs">
              Regras para busca, combinação de modelos e apresentação de fotos de carros durante a conversa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Busca automática ao mencionar veículo</Label>
                <p className="text-[11px] text-muted-foreground">A IA pesquisa o estoque imediatamente quando o cliente diz um modelo.</p>
              </div>
              <Switch
                checked={stockRules.autoSearchOnVehicleInterest}
                onCheckedChange={(val) => setStockRules({ ...stockRules, autoSearchOnVehicleInterest: val })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Priorizar loja/unidade do vendedor</Label>
                <p className="text-[11px] text-muted-foreground">Dá preferência aos carros fisicamente localizados na loja do atendente.</p>
              </div>
              <Switch
                checked={stockRules.preferSameStore}
                onCheckedChange={(val) => setStockRules({ ...stockRules, preferSameStore: val })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Apenas veículos com fotos cadastradas</Label>
                <p className="text-[11px] text-muted-foreground">Oculta carros do estoque que ainda não possuem galeria de imagens.</p>
              </div>
              <Switch
                checked={stockRules.requirePhoto}
                onCheckedChange={(val) => setStockRules({ ...stockRules, requirePhoto: val })}
              />
            </div>

            <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span>A IA vincula automaticamente o <b>ID do Veículo (`vehicleId`)</b> ao lead assim que ele demonstra interesse por uma unidade específica.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
