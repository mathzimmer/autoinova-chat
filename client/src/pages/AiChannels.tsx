import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bot, Loader2, Info } from "lucide-react";
import { toast } from "sonner";

const TYPE_STYLE: Record<string, string> = {
  Evolution: "border-green-500/40 text-green-500",
  Zernio: "border-sky-500/40 text-sky-500",
  Oficial: "border-violet-500/40 text-violet-500",
  Meta: "border-pink-500/40 text-pink-500",
};

export default function AiChannels() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.automationAi.listConnections.useQuery();
  const setAuto = trpc.automationAi.setConnectionAiAuto.useMutation({
    onSuccess: () => { utils.automationAi.listConnections.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const list = (data as any[]) || [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" /> IA automática por conexão
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Defina em quais conexões a IA responde <b>sozinha</b> nas conversas novas. Desligada (padrão), a IA
          só entra quando um fluxo a chamar ou quando um atendente colocar a conversa em "IA".
        </p>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-md p-3 my-4">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          O botão global de IA (na barra lateral) continua funcionando como <b>freio de emergência</b>:
          se ele estiver desligado, nenhuma IA responde, independente do que estiver marcado aqui.
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nenhuma conexão encontrada.</p>
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <Card key={c.key}>
              <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2.5">
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${TYPE_STYLE[c.type] || "border-border text-muted-foreground"}`}>{c.type}</Badge>
                  <span className="text-sm font-medium text-card-foreground truncate">{c.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs ${c.aiAuto ? "text-primary" : "text-muted-foreground"}`}>
                    {c.aiAuto ? "IA automática" : "Só por fluxo/manual"}
                  </span>
                  <Switch
                    checked={c.aiAuto}
                    onCheckedChange={(v) => setAuto.mutate({ key: c.key, enabled: v })}
                    disabled={setAuto.isPending}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
