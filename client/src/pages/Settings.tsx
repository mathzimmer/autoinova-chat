import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Settings as SettingsIcon, Bot, Save, RotateCcw, Info, CheckCircle2, AlertTriangle, Shield, ShoppingCart, Sparkles, Timer, Loader2, Smartphone, Copy, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
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

function DebounceConfig() {
  const { data, isLoading } = trpc.settings.getDebounceDelay.useQuery();
  const [localDelay, setLocalDelay] = useState(8);
  const [hasChanges, setHasChanges] = useState(false);

  const saveMutation = trpc.settings.saveDebounceDelay.useMutation({
    onSuccess: (result) => {
      setHasChanges(false);
      toast.success(`Tempo de agrupamento atualizado para ${result.delayMs / 1000} segundos`);
    },
    onError: (err) => toast.error("Erro ao salvar: " + err.message),
  });

  useEffect(() => {
    if (data) {
      setLocalDelay(data.delayMs / 1000);
    }
  }, [data]);

  const handleSliderChange = (value: number[]) => {
    const newVal = value[0];
    setLocalDelay(newVal);
    setHasChanges(newVal !== (data?.delayMs ?? 8000) / 1000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-card-foreground">
            Esperar <span className="text-primary font-bold text-lg">{localDelay}</span> segundo{localDelay !== 1 ? "s" : ""} após a última mensagem
          </p>
          <p className="text-xs text-muted-foreground">
            Mínimo: 1s | Recomendado: 5-10s | Máximo: 30s
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate({ delayMs: localDelay * 1000 })}
          disabled={!hasChanges || saveMutation.isPending}
          size="sm"
          className="gap-1.5"
        >
          {saveMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
          ) : (
            <><Save className="h-4 w-4" /> Salvar</>
          )}
        </Button>
      </div>
      <Slider
        value={[localDelay]}
        onValueChange={handleSliderChange}
        min={1}
        max={30}
        step={1}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>1s (rápido)</span>
        <span>5s</span>
        <span>10s</span>
        <span>15s</span>
        <span>20s</span>
        <span>30s (lento)</span>
      </div>
      {hasChanges && (
        <div className="flex items-center gap-1.5 text-xs text-yellow-500">
          <AlertTriangle className="h-3 w-3" />
          Alteração não salva
        </div>
      )}
    </div>
  );
}

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

        {/* Debounce / Agrupamento de mensagens */}
        <Card className="bg-card border-border ring-1 ring-primary/20">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2.5">
              <Timer className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-card-foreground text-base">Tempo de Agrupamento de Mensagens</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  Quando o cliente envia várias mensagens em sequência, a IA espera esse tempo após a última mensagem antes de responder.
                  Isso evita respostas duplicadas e permite que a IA processe todas as mensagens de uma vez.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <DebounceConfig />
          </CardContent>
        </Card>

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

        {/* WhatsApp Embedded Signup */}
        <WhatsAppConnectCard />
      </div>
    </div>
  );
}

// ─── WhatsApp Embedded Signup ────────────────────────────────────────────────

declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
  }
}

const META_APP_ID = "1168218527728605";
const META_CONFIG_ID = "1294053642801963";

function WhatsAppConnectCard() {
  const [sdkReady, setSdkReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    wabaId?: string;
    phoneNumberId?: string;
    token?: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Load Facebook SDK
  useEffect(() => {
    if (window.FB) { setSdkReady(true); return; }
    window.fbAsyncInit = function () {
      window.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: true, version: "v25.0" });
      setSdkReady(true);
    };
    if (!document.getElementById("fb-sdk")) {
      const script = document.createElement("script");
      script.id = "fb-sdk";
      script.src = "https://connect.facebook.net/pt_BR/sdk.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // Listen for session info from Meta popup
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WA_EMBEDDED_SIGNUP") {
          console.log("[EmbeddedSignup] Event:", data);
          if (
            data.event === "FINISH" ||
            data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
          ) {
            setResult(prev => ({
              ...prev,
              wabaId: data.data?.waba_id,
              phoneNumberId: data.data?.phone_number_id,
            }));
          }
          if (data.event === "CANCEL" || data.event === "ERROR") {
            setLoading(false);
            toast.error("Fluxo cancelado ou erro: " + (data.data?.error_message || data.event));
          }
        }
      } catch {}
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const launchSignup = () => {
    if (!window.FB) {
      toast.error("Facebook SDK ainda carregando, aguarde...");
      return;
    }
    setLoading(true);
    setResult(null);

    // FB.login must be called synchronously in a user click handler
    window.FB.login(
      async (response: any) => {
        if (response?.authResponse?.code) {
          const code = response.authResponse.code;
          try {
            const r = await fetch("/api/whatsapp/exchange-token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code }),
            });
            const data = await r.json();
            if (data.token) {
              setResult(prev => ({ ...prev, token: data.token }));
              toast.success("WhatsApp conectado com sucesso!");
            } else {
              toast.error("Erro ao trocar token: " + (data.error || "desconhecido"));
            }
          } catch {
            toast.error("Erro de conexão ao trocar token.");
          }
        } else {
          toast.error("Fluxo cancelado ou sem autorização.");
        }
        setLoading(false);
      },
      {
        config_id: META_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
          version: "v4",
        },
      }
    );
  };

  const copyToClipboard = (value: string, key: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const credentialRow = (label: string, value: string | undefined, key: string) => {
    if (!value) return null;
    return (
      <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-xs font-mono text-foreground truncate">{value}</p>
        </div>
        <button
          onClick={() => copyToClipboard(value, key)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          title="Copiar"
        >
          {copied === key ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    );
  };

  const hasCredentials = result?.wabaId || result?.phoneNumberId || result?.token;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-[#25D366]/15 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#25D366]">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div>
            <CardTitle className="text-card-foreground text-base flex items-center gap-2">
              Conectar WhatsApp
              <Badge variant="outline" className="text-[10px] border-[#25D366]/30 text-[#25D366]">
                Cadastro Incorporado
              </Badge>
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              Integre um número WhatsApp Business ao CRM via fluxo oficial da Meta. Funciona em coexistência com o app WhatsApp Business.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasCredentials ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Clique no botão abaixo para abrir o fluxo oficial da Meta. Você poderá conectar seu número existente do WhatsApp Business ou criar uma nova conta.
            </p>
            <Button
              onClick={launchSignup}
              disabled={loading}
              className="bg-[#25D366] hover:bg-[#25D366]/90 text-white gap-2"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Aguardando fluxo Meta...</>
              ) : !sdkReady ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Carregando SDK...</>
              ) : (
                <><Smartphone className="h-4 w-4" /> Conectar WhatsApp</>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground/60">
              Uma janela popup da Meta será aberta. Certifique-se de que popups estão permitidos neste site.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-500 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Integração concluída! Copie as credenciais abaixo.
            </div>
            <div className="space-y-2">
              {credentialRow("WABA ID (WHATSAPP_WABA_ID)", result?.wabaId, "waba")}
              {credentialRow("Phone Number ID (WHATSAPP_PHONE_NUMBER_ID)", result?.phoneNumberId, "phone")}
              {credentialRow("Access Token (WHATSAPP_SYSTEM_USER_TOKEN)", result?.token, "token")}
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-600 dark:text-yellow-400">
              <strong>Próximo passo:</strong> Adicione essas credenciais no arquivo <code>.env</code> do VPS e reinicie o container:<br />
              <code className="mt-1 block">docker restart autoinova</code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setResult(null); setLoading(false); }}
              className="text-xs"
            >
              Conectar outro número
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
