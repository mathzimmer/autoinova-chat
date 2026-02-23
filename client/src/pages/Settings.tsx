import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Settings as SettingsIcon, Bot, Save, RotateCcw, Info, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { data: promptData, refetch, isLoading } = trpc.settings.getPrompt.useQuery();

  const [prompt, setPrompt] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const saveMutation = trpc.settings.savePrompt.useMutation({
    onSuccess: () => {
      refetch();
      setHasChanges(false);
      toast.success("Prompt salvo com sucesso! A IA já está usando o novo prompt.");
    },
    onError: (err) => toast.error("Erro ao salvar: " + err.message),
  });

  const resetMutation = trpc.settings.resetPrompt.useMutation({
    onSuccess: (data) => {
      setPrompt(data.defaultPrompt);
      setHasChanges(false);
      refetch();
      toast.success("Prompt restaurado para o padrão.");
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
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <SettingsIcon className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
          <p className="text-sm text-muted-foreground">Personalize o comportamento do agente de IA</p>
        </div>
      </div>

      {/* Prompt Editor Card */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Bot className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-card-foreground text-lg">Prompt do Agente de IA</CardTitle>
                <CardDescription className="mt-0.5">
                  Este é o prompt de sistema que define como a IA se comporta ao atender os clientes.
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
                  Padrão
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
              <p>O prompt define a personalidade, regras e fluxo de atendimento da IA. Você pode personalizar:</p>
              <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                <li>Nome da empresa, endereço, telefone e horários</li>
                <li>Tom de voz e estilo de comunicação</li>
                <li>Fluxo de qualificação de leads</li>
                <li>Regras específicas do seu negócio</li>
                <li>Informações sobre financiamento e condições</li>
              </ul>
              <p className="mt-1.5">A IA sempre terá acesso ao estoque real de veículos via ferramenta de busca, independente do prompt.</p>
            </div>
          </div>

          {/* Textarea */}
          {isLoading ? (
            <div className="h-[400px] bg-muted rounded-lg animate-pulse" />
          ) : (
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={(e) => handlePromptChange(e.target.value)}
                className="min-h-[400px] bg-input border-border font-mono text-sm leading-relaxed resize-y"
                placeholder="Digite o prompt do agente de IA..."
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
                    Restaurar Padrão
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card border-border">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-card-foreground flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      Restaurar prompt padrão?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso vai substituir o prompt personalizado pelo prompt padrão do sistema.
                      Todas as personalizações serão perdidas. Essa ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-input border-border">Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => resetMutation.mutate()}
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
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
              className="gap-1.5"
            >
              {saveMutation.isPending ? (
                <>Salvando...</>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Salvar Prompt
                </>
              )}
            </Button>
          </div>

          {/* Last saved info */}
          {promptData?.isCustom && !hasChanges && (
            <div className="flex items-center gap-1.5 text-xs text-green-500/80">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Prompt personalizado ativo. A IA está usando este prompt para responder os clientes.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tips Card */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-card-foreground text-sm">Dicas para um bom prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div className="p-3 rounded-lg bg-muted/30 space-y-1">
              <p className="font-medium text-card-foreground">Identidade</p>
              <p>Defina claramente quem é a IA: nome da empresa, localização, segmento. Ex: "Você é a assistente da Auto Inova, em Ivoti-RS".</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 space-y-1">
              <p className="font-medium text-card-foreground">Tom de voz</p>
              <p>Especifique o estilo: formal, informal, amigável. Para WhatsApp, um tom conversacional funciona melhor.</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 space-y-1">
              <p className="font-medium text-card-foreground">Regras do negócio</p>
              <p>Inclua políticas de preço, financiamento, troca. Ex: "Não forneça valores exatos de parcela".</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 space-y-1">
              <p className="font-medium text-card-foreground">Qualificação</p>
              <p>Liste as informações que a IA deve coletar: nome, veículo de interesse, forma de pagamento, se tem troca.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
