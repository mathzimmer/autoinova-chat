import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, UserCheck, Phone, Car, CreditCard, ArrowLeftRight, Target, Zap, ZapOff } from "lucide-react";
import { toast } from "sonner";

type Props = {
  conversationId: number;
};

export default function ConversationPanel({ conversationId }: Props) {
  const utils = trpc.useUtils();
  const { data: conversation } = trpc.conversation.getById.useQuery({ id: conversationId });
  const { data: lead } = trpc.lead.getByConversation.useQuery({ conversationId });

  const toggleAI = trpc.conversation.toggleAI.useMutation({
    onSuccess: (data) => {
      utils.conversation.getById.invalidate({ id: conversationId });
      utils.conversation.list.invalidate();
      toast.success(data?.aiActive ? "IA reativada" : "IA pausada - você assumiu o atendimento");
    },
  });

  const updateStatus = trpc.conversation.updateStatus.useMutation({
    onSuccess: () => {
      utils.conversation.getById.invalidate({ id: conversationId });
      utils.conversation.list.invalidate();
      toast.success("Status atualizado");
    },
  });

  if (!conversation) return null;

  return (
    <div className="h-full flex flex-col bg-card border-l border-border overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-semibold text-card-foreground mb-1">Painel de Controle</h3>
        <p className="text-xs text-muted-foreground">Gerenciar atendimento</p>
      </div>

      {/* AI Control */}
      <div className="p-4 border-b border-border">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Controle da IA</h4>
        <div className="space-y-2">
          {conversation.aiActive ? (
            <Button
              onClick={() => toggleAI.mutate({ id: conversationId, aiActive: false })}
              variant="outline"
              className="w-full justify-start gap-2 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
              disabled={toggleAI.isPending}
            >
              <UserCheck className="h-4 w-4" />
              Assumir Conversa
            </Button>
          ) : (
            <Button
              onClick={() => toggleAI.mutate({ id: conversationId, aiActive: true })}
              variant="outline"
              className="w-full justify-start gap-2 border-primary/30 text-primary hover:bg-primary/10"
              disabled={toggleAI.isPending}
            >
              <Bot className="h-4 w-4" />
              Reativar IA
            </Button>
          )}
          <div className="flex items-center gap-2 p-2 rounded-md bg-secondary/50">
            {conversation.aiActive ? (
              <>
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-xs text-primary font-medium">IA respondendo automaticamente</span>
              </>
            ) : (
              <>
                <ZapOff className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">IA pausada - atendimento humano</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="p-4 border-b border-border">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Status da Conversa</h4>
        <Select
          value={conversation.status}
          onValueChange={(value) => updateStatus.mutate({ id: conversationId, status: value as any })}
        >
          <SelectTrigger className="bg-input border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Aberta</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="resolved">Resolvida</SelectItem>
            <SelectItem value="closed">Fechada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Contact Info */}
      <div className="p-4 border-b border-border">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Contato</h4>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-card-foreground">{conversation.phone}</span>
          </div>
          {conversation.contactName && (
            <div className="flex items-center gap-2 text-sm">
              <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-card-foreground">{conversation.contactName}</span>
            </div>
          )}
          <Badge variant="outline" className="text-xs">
            {conversation.channel === "whatsapp" ? "WhatsApp" : conversation.channel}
          </Badge>
        </div>
      </div>

      {/* Lead Info */}
      {lead && (
        <div className="p-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Dados do Lead</h4>
          <div className="space-y-3">
            {lead.intention && (
              <LeadField icon={<Target className="h-3.5 w-3.5" />} label="Intenção" value={lead.intention} />
            )}
            {lead.vehicleInterest && (
              <LeadField icon={<Car className="h-3.5 w-3.5" />} label="Veículo de Interesse" value={lead.vehicleInterest} />
            )}
            {lead.hasTrade !== null && lead.hasTrade !== undefined && (
              <LeadField icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Tem Troca" value={lead.hasTrade ? "Sim" : "Não"} />
            )}
            {lead.tradeVehicle && (
              <LeadField icon={<Car className="h-3.5 w-3.5" />} label="Veículo Troca" value={`${lead.tradeVehicle} ${lead.tradeYear || ""} ${lead.tradeKm ? `- ${lead.tradeKm} km` : ""}`} />
            )}
            {lead.paymentMethod && (
              <LeadField icon={<CreditCard className="h-3.5 w-3.5" />} label="Pagamento" value={lead.paymentMethod} />
            )}
            {lead.downPayment && (
              <LeadField icon={<CreditCard className="h-3.5 w-3.5" />} label="Entrada" value={lead.downPayment} />
            )}
            <Separator className="my-2" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status do Lead</span>
              <Badge variant={lead.status === "qualified" ? "default" : "outline"} className="text-xs capitalize">
                {lead.status === "new" ? "Novo" :
                 lead.status === "qualifying" ? "Qualificando" :
                 lead.status === "qualified" ? "Qualificado" :
                 lead.status === "contacted" ? "Contatado" :
                 lead.status === "converted" ? "Convertido" :
                 lead.status === "lost" ? "Perdido" : lead.status}
              </Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-sm text-card-foreground">{value}</p>
      </div>
    </div>
  );
}
