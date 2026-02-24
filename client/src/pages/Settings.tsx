import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Settings as SettingsIcon, Bot, Save, RotateCcw, Info, CheckCircle2, AlertTriangle, Shield, ShoppingCart, Sparkles } from "lucide-react";
import { toast } from "sonner";

type LayerKey = "core" | "commercial" | "personality";

interface LayerConfig {
  key: LayerKey;
  title: string;
  description: string;
  icon: React.ReactNode;
  iconColor: string;
  borderColor: string;
  bgColor: string;
  badgeColor: string;
  minHeight: string;
  placeholder: string;
}

const LAYERS: LayerConfig[] = [
  {
    key: "core",
    title: "Camada 1: Núcleo",
    description: "Regras críticas de integridade. Formato das mensagens, prioridade, limpeza de resposta, tratamento de áudio e imagens.",
    icon: <Shield className="h-5 w-5 text-red-500" />,
    iconColor: "text-red-500",
    borderColor: "border-red-500/20",
    bgColor: "bg-red-500/5",
    badgeColor: "border-red-500/30 text-red-500",
    minHeight: "min-h-[250px]",
    placeholder: "Defina as regras críticas do sistema...",
  },
  {
    key: "commercial",
    title: "Camada 2: Motor Comercial",
    description: "Processo estrutural de venda. Busca de veículos, qualificação de leads, fluxo comercial.",
    icon: <ShoppingCart className="h-5 w-5 text-orange-500" />,
    iconColor: "text-orange-500",
    borderColor: "border-orange-500/20",
    bgColor: "bg-orange-500/5",
    badgeColor: "border-orange-500/30 text-orange-500",
    minHeight: "min-h-[200px]",
    placeholder: "Defina o fluxo comercial e busca de veículos...",
  },
  {
    key: "personality",
    title: "Camada 3: Personalidade",
    description: "Tom de voz, estratégia comercial e informações da loja. Defina como a IA se comunica.",
    icon: <Sparkles className="h-5 w-5 text-primary" />,
    iconColor: "text-primary",
    borderColor: "border-primary/20",
    bgColor: "bg-primary/5",
    badgeColor: "border-primary/30 text-primary",
    minHeight: "min-h-[200px]",
    placeholder: "Defina a personalidade e estratégia da IA...",
  },
];

export default function Settings() {
  const { data: promptData, refetch, isLoading } = trpc.settings.getPrompt.useQuery();

  const [corePrompt, setCorePrompt] = useState("");
  const [commercialPrompt, setCommercialPrompt] = useState("");
  const [personalityPrompt, setPersonalityPrompt] = useState("");
  const [coreHasChanges, setCoreHasChanges] = useState(false);
  const [commercialHasChanges, setCommercialHasChanges] = useState(false);
  const [personalityHasChanges, setPersonalityHasChanges] = useState(false);

  const saveMutation = trpc.settings.savePrompt.useMutation({
    onSuccess: (_data, variables) => {
      refetch();
      const layerNames: Record<string, string> = { core: "Núcleo", commercial: "Motor Comercial", personality: "Personalidade" };
      if (variables.layer === "core") setCoreHasChanges(false);
      if (variables.layer === "commercial") setCommercialHasChanges(false);
      if (variables.layer === "personality") setPersonalityHasChanges(false);
      toast.success(`${layerNames[variables.layer]} salva com sucesso! A IA já está usando a nova configuração.`);
    },
    onError: (err) => toast.error("Erro ao salvar: " + err.message),
  });

  const resetMutation = trpc.settings.resetPrompt.useMutation({
    onSuccess: (data, variables) => {
      if (variables.layer === "core") { setCorePrompt(data.defaultPrompt); setCoreHasChanges(false); }
      if (variables.layer === "commercial") { setCommercialPrompt(data.defaultPrompt); setCommercialHasChanges(false); }
      if (variables.layer === "personality") { setPersonalityPrompt(data.defaultPrompt); setPersonalityHasChanges(false); }
      refetch();
      const layerNames: Record<string, string> = { core: "Núcleo", commercial: "Motor Comercial", personality: "Personalidade" };
      toast.success(`${layerNames[variables.layer]} restaurada para o padrão.`);
    },
    onError: (err) => toast.error("Erro ao restaurar: " + err.message),
  });

  useEffect(() => {
    if (promptData) {
      setCorePrompt(promptData.corePrompt);
      setCommercialPrompt(promptData.commercialPrompt);
      setPersonalityPrompt(promptData.personalityPrompt);
    }
  }, [promptData]);

  const getPromptValue = (key: LayerKey) => {
    if (key === "core") return corePrompt;
    if (key === "commercial") return commercialPrompt;
    return personalityPrompt;
  };

  const setPromptValue = (key: LayerKey, value: string) => {
    if (key === "core") {
      setCorePrompt(value);
      setCoreHasChanges(value !== promptData?.corePrompt);
    }
    if (key === "commercial") {
      setCommercialPrompt(value);
      setCommercialHasChanges(value !== promptData?.commercialPrompt);
    }
    if (key === "personality") {
      setPersonalityPrompt(value);
      setPersonalityHasChanges(value !== promptData?.personalityPrompt);
    }
  };

  const getHasChanges = (key: LayerKey) => {
    if (key === "core") return coreHasChanges;
    if (key === "commercial") return commercialHasChanges;
    return personalityHasChanges;
  };

  const getIsCustom = (key: LayerKey) => {
    if (!promptData) return false;
    if (key === "core") return promptData.coreIsCustom;
    if (key === "commercial") return promptData.commercialIsCustom;
    return promptData.personalityIsCustom;
  };

  const handleSave = (key: LayerKey) => {
    const value = getPromptValue(key);
    if (value.trim().length < 10) {
      toast.error("O prompt deve ter pelo menos 10 caracteres.");
      return;
    }
    saveMutation.mutate({ layer: key, prompt: value.trim() });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl mx-auto pb-12">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <SettingsIcon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Configurações da IA</h1>
            <p className="text-sm text-muted-foreground">Arquitetura de prompt em 4 camadas — todas editáveis</p>
          </div>
        </div>

        {/* Architecture Overview */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2.5">
              <Info className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-card-foreground text-lg">Como funciona o prompt da IA</CardTitle>
                <CardDescription className="mt-0.5">
                  O prompt é montado em 4 camadas, na ordem abaixo. Todas as 3 primeiras são editáveis. A 4a é automática.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-red-500" />
                  <p className="font-medium text-xs text-red-500">1. Núcleo</p>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-500/30 text-red-500">Editável</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">Regras críticas do sistema. Formato, prioridade, limpeza.</p>
              </div>
              <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/10 space-y-1">
                <div className="flex items-center gap-1.5">
                  <ShoppingCart className="h-3.5 w-3.5 text-orange-500" />
                  <p className="font-medium text-xs text-orange-500">2. Motor Comercial</p>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-500/30 text-orange-500">Editável</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">Fluxo de venda, busca de veículos, qualificação.</p>
              </div>
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/10 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-xs text-primary">3. Personalidade</p>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/30 text-primary">Editável</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">Tom de voz, estratégia, dados da loja.</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-1">
                <div className="flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="font-medium text-xs text-muted-foreground">4. Contexto</p>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">Auto</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">Nome, telefone, lead, histórico. Montado automaticamente.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Editable Layers */}
        {LAYERS.map((layer) => {
          const value = getPromptValue(layer.key);
          const hasChanges = getHasChanges(layer.key);
          const isCustom = getIsCustom(layer.key);
          const charCount = value.length;
          const lineCount = value.split("\n").length;

          return (
            <Card key={layer.key} className={`bg-card ${layer.borderColor} ring-1 ${hasChanges ? "ring-yellow-500/30" : isCustom ? `ring-${layer.key === "core" ? "red" : layer.key === "commercial" ? "orange" : "primary"}-500/20` : "ring-border"}`}>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {layer.icon}
                    <div>
                      <CardTitle className="text-card-foreground text-base flex items-center gap-2">
                        {layer.title}
                        <Badge variant="outline" className={`text-[10px] ${layer.badgeColor}`}>
                          Editável
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-0.5 text-xs">
                        {layer.description}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isCustom ? (
                      <Badge variant="outline" className={`text-xs ${layer.badgeColor}`}>
                        Personalizado
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs border-muted-foreground/30 text-muted-foreground">
                        Padrão
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Textarea */}
                {isLoading ? (
                  <div className={`${layer.minHeight} bg-muted rounded-lg animate-pulse`} />
                ) : (
                  <div className="relative">
                    <Textarea
                      value={value}
                      onChange={(e) => setPromptValue(layer.key, e.target.value)}
                      className={`${layer.minHeight} bg-input border-border font-mono text-sm leading-relaxed resize-y`}
                      placeholder={layer.placeholder}
                    />
                    <div className="absolute bottom-2 right-2 flex items-center gap-3 text-[10px] text-muted-foreground/60">
                      <span>{charCount} caracteres</span>
                      <span>{lineCount} linhas</span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-muted-foreground"
                          disabled={!isCustom || resetMutation.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Restaurar Padrão
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-card border-border">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-card-foreground flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-yellow-500" />
                            Restaurar {layer.title} para o padrão?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Isso vai substituir a configuração personalizada pela padrão do sistema para esta camada.
                            As outras camadas não serão afetadas.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-input border-border">Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => resetMutation.mutate({ layer: layer.key })}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Restaurar Padrão
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    {hasChanges && (
                      <span className="text-xs text-yellow-500 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Alterações não salvas
                      </span>
                    )}
                  </div>

                  <Button
                    onClick={() => handleSave(layer.key)}
                    disabled={!hasChanges || saveMutation.isPending}
                    size="sm"
                    className="gap-1.5"
                  >
                    {saveMutation.isPending ? (
                      <>Salvando...</>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Salvar
                      </>
                    )}
                  </Button>
                </div>

                {/* Last saved info */}
                {isCustom && !hasChanges && (
                  <div className="flex items-center gap-1.5 text-xs text-green-500/80">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Configuração personalizada ativa.
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Layer 4: Context (Info only) */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2.5">
              <Bot className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-card-foreground text-base flex items-center gap-2">
                  Camada 4: Contexto Dinâmico
                  <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">
                    Automático
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  Montado automaticamente a cada mensagem. Inclui nome do cliente, telefone, dados do lead e histórico da conversa.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">Dados do cliente</p>
                <p>Nome, telefone, observações do contato. Injetados automaticamente do CRM.</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">Dados do lead</p>
                <p>Veículo de interesse, troca, pagamento, notas. Marcados como "podem estar desatualizados".</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">Histórico de mensagens</p>
                <p>Últimas 30 mensagens da conversa. A IA usa para manter contexto e continuidade.</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">Estado da conversa</p>
                <p>Se a conversa foi reativada (cliente retornou), a IA é informada para cumprimentar pelo retorno.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
