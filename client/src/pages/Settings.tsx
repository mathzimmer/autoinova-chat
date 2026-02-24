import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Settings as SettingsIcon, Bot, Save, RotateCcw, Info, CheckCircle2, AlertTriangle, Shield, ShoppingCart, Sparkles, ChevronDown, Lock, Eye } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { data: promptData, refetch, isLoading } = trpc.settings.getPrompt.useQuery();

  const [prompt, setPrompt] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [showCore, setShowCore] = useState(false);
  const [showCommercial, setShowCommercial] = useState(false);

  const saveMutation = trpc.settings.savePrompt.useMutation({
    onSuccess: () => {
      refetch();
      setHasChanges(false);
      toast.success("Personalidade salva com sucesso! A IA já está usando o novo tom.");
    },
    onError: (err) => toast.error("Erro ao salvar: " + err.message),
  });

  const resetMutation = trpc.settings.resetPrompt.useMutation({
    onSuccess: (data) => {
      setPrompt(data.defaultPrompt);
      setHasChanges(false);
      refetch();
      toast.success("Personalidade restaurada para o padrão.");
    },
    onError: (err) => toast.error("Erro ao restaurar: " + err.message),
  });

  useEffect(() => {
    if (promptData) {
      setPrompt(promptData.prompt);
    }
  }, [promptData]);

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    setHasChanges(value !== promptData?.prompt);
  };

  const handleSave = () => {
    if (prompt.trim().length < 10) {
      toast.error("O prompt deve ter pelo menos 10 caracteres.");
      return;
    }
    saveMutation.mutate({ prompt: prompt.trim() });
  };

  const charCount = prompt.length;
  const lineCount = prompt.split("\n").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl mx-auto pb-12">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <SettingsIcon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
            <p className="text-sm text-muted-foreground">Arquitetura de prompt em 4 camadas</p>
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
                  O prompt é montado em 4 camadas, na ordem abaixo. Você pode editar apenas a Personalidade.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-red-500" />
                  <p className="font-medium text-xs text-red-500">1. Nucleo</p>
                  <Lock className="h-3 w-3 text-red-500/50" />
                </div>
                <p className="text-[11px] text-muted-foreground">Regras criticas do sistema. Formato, prioridade, limpeza.</p>
              </div>
              <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/10 space-y-1">
                <div className="flex items-center gap-1.5">
                  <ShoppingCart className="h-3.5 w-3.5 text-orange-500" />
                  <p className="font-medium text-xs text-orange-500">2. Motor Comercial</p>
                  <Lock className="h-3 w-3 text-orange-500/50" />
                </div>
                <p className="text-[11px] text-muted-foreground">Fluxo de venda, busca de veiculos, qualificacao.</p>
              </div>
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/10 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-xs text-primary">3. Personalidade</p>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/30 text-primary">Editavel</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">Tom de voz, estrategia, dados da loja.</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-1">
                <div className="flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="font-medium text-xs text-muted-foreground">4. Contexto</p>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">Auto</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">Nome, telefone, lead, historico. Montado automaticamente.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Layer 1: Core (Read-only, collapsible) */}
        <Collapsible open={showCore} onOpenChange={setShowCore}>
          <Card className="bg-card border-border">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Shield className="h-5 w-5 text-red-500" />
                    <div>
                      <CardTitle className="text-card-foreground text-base flex items-center gap-2">
                        Camada 1: Nucleo
                        <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-500">
                          <Lock className="h-3 w-3 mr-1" />
                          Imutavel
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-0.5 text-xs">
                        Regras criticas de integridade. Protegem o formato e o comportamento base da IA.
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-muted-foreground" />
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showCore ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="relative">
                  <Textarea
                    value={promptData?.corePrompt || "Carregando..."}
                    readOnly
                    className="min-h-[200px] bg-muted/30 border-border font-mono text-xs leading-relaxed resize-y opacity-70 cursor-not-allowed"
                  />
                  <div className="absolute top-2 right-2">
                    <Badge variant="outline" className="text-[9px] border-red-500/20 text-red-500/60">
                      Somente leitura
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Layer 2: Commercial (Read-only, collapsible) */}
        <Collapsible open={showCommercial} onOpenChange={setShowCommercial}>
          <Card className="bg-card border-border">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <ShoppingCart className="h-5 w-5 text-orange-500" />
                    <div>
                      <CardTitle className="text-card-foreground text-base flex items-center gap-2">
                        Camada 2: Motor Comercial
                        <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-500">
                          <Lock className="h-3 w-3 mr-1" />
                          Imutavel
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-0.5 text-xs">
                        Processo estrutural de venda. Busca de veiculos, qualificacao, fluxo comercial.
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-muted-foreground" />
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showCommercial ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="relative">
                  <Textarea
                    value={promptData?.commercialPrompt || "Carregando..."}
                    readOnly
                    className="min-h-[150px] bg-muted/30 border-border font-mono text-xs leading-relaxed resize-y opacity-70 cursor-not-allowed"
                  />
                  <div className="absolute top-2 right-2">
                    <Badge variant="outline" className="text-[9px] border-orange-500/20 text-orange-500/60">
                      Somente leitura
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Layer 3: Personality (Editable) */}
        <Card className="bg-card border-border ring-1 ring-primary/20">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle className="text-card-foreground text-lg flex items-center gap-2">
                    Camada 3: Personalidade
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                      Editavel
                    </Badge>
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Tom de voz, estrategia comercial e informacoes da loja. Edite livremente sem risco de quebrar regras criticas.
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {promptData?.isCustom ? (
                  <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                    Personalizado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs border-muted-foreground/30 text-muted-foreground">
                    Padrao
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Info Box */}
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground leading-relaxed">
                <p>Aqui voce define a personalidade da IA. As regras criticas (formato, busca, lead) sao protegidas automaticamente nas camadas acima. Voce pode personalizar:</p>
                <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                  <li>Nome da empresa, endereco, telefone e horarios</li>
                  <li>Tom de voz e estilo de comunicacao</li>
                  <li>Estrategia comercial e abordagem de venda</li>
                  <li>Informacoes sobre financiamento e condicoes</li>
                </ul>
              </div>
            </div>

            {/* Textarea */}
            {isLoading ? (
              <div className="h-[300px] bg-muted rounded-lg animate-pulse" />
            ) : (
              <div className="relative">
                <Textarea
                  value={prompt}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  className="min-h-[300px] bg-input border-border font-mono text-sm leading-relaxed resize-y"
                  placeholder="Defina a personalidade e estrategia da IA..."
                />
                <div className="absolute bottom-2 right-2 flex items-center gap-3 text-[10px] text-muted-foreground/60">
                  <span>{charCount} caracteres</span>
                  <span>{lineCount} linhas</span>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      disabled={!promptData?.isCustom || resetMutation.isPending}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restaurar Padrao
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-card-foreground flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        Restaurar personalidade padrao?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Isso vai substituir a personalidade personalizada pela padrao do sistema.
                        As regras criticas (Nucleo e Motor Comercial) nao serao afetadas.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-input border-border">Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => resetMutation.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Restaurar Padrao
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {hasChanges && (
                  <span className="text-xs text-yellow-500 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Alteracoes nao salvas
                  </span>
                )}
              </div>

              <Button
                onClick={handleSave}
                disabled={!hasChanges || saveMutation.isPending}
                className="gap-1.5"
              >
                {saveMutation.isPending ? (
                  <>Salvando...</>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salvar Personalidade
                  </>
                )}
              </Button>
            </div>

            {/* Last saved info */}
            {promptData?.isCustom && !hasChanges && (
              <div className="flex items-center gap-1.5 text-xs text-green-500/80">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Personalidade customizada ativa. A IA esta usando este tom para responder os clientes.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Layer 4: Context (Info only) */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2.5">
              <Bot className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-card-foreground text-base flex items-center gap-2">
                  Camada 4: Contexto Dinamico
                  <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">
                    Automatico
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  Montado automaticamente a cada mensagem. Inclui nome do cliente, telefone, dados do lead e historico da conversa.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">Dados do cliente</p>
                <p>Nome, telefone, observacoes do contato. Injetados automaticamente do CRM.</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">Dados do lead</p>
                <p>Veiculo de interesse, troca, pagamento, notas. Marcados como "podem estar desatualizados".</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">Historico de mensagens</p>
                <p>Ultimas 30 mensagens da conversa. A IA usa para manter contexto e continuidade.</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">Estado da conversa</p>
                <p>Se a conversa foi reativada (cliente retornou), a IA e informada para cumprimentar pelo retorno.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
