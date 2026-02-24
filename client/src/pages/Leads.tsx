import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, Phone, Car, CreditCard, ArrowLeftRight, Users, FileText, UserCheck, ExternalLink } from "lucide-react";

export default function Leads() {
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: leads } = trpc.lead.list.useQuery({ status: statusFilter }, { refetchInterval: 15000 });
  const { data: vehicles } = trpc.vehicle.list.useQuery();
  const { data: teamMembers } = trpc.team.list.useQuery();
  const { data: conversations } = trpc.conversation.list.useQuery({});

  // Build lookup maps
  const vehicleMap = useMemo(() => {
    const map = new Map<number, any>();
    vehicles?.forEach((v: any) => map.set(v.id, v));
    return map;
  }, [vehicles]);

  const teamMemberMap = useMemo(() => {
    const map = new Map<number, any>();
    teamMembers?.forEach((m: any) => map.set(m.id, m));
    return map;
  }, [teamMembers]);

  const conversationMap = useMemo(() => {
    const map = new Map<number, any>();
    conversations?.forEach((c: any) => map.set(c.id, c));
    return map;
  }, [conversations]);

  const statusTabs = [
    { value: "all", label: "Todos" },
    { value: "new", label: "Novos" },
    { value: "qualifying", label: "Qualificando" },
    { value: "qualified", label: "Qualificados" },
    { value: "contacted", label: "Contatados" },
    { value: "converted", label: "Convertidos" },
    { value: "lost", label: "Perdidos" },
  ];

  const statusColors: Record<string, string> = {
    new: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    qualifying: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    qualified: "bg-green-500/10 text-green-400 border-green-500/30",
    contacted: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    converted: "bg-primary/10 text-primary border-primary/30",
    lost: "bg-red-500/10 text-red-400 border-red-500/30",
  };

  const statusLabels: Record<string, string> = {
    new: "Novo",
    qualifying: "Qualificando",
    qualified: "Qualificado",
    contacted: "Contatado",
    converted: "Convertido",
    lost: "Perdido",
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-6 w-6 text-yellow-400" />
          Leads
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Acompanhamento de leads qualificados pela IA</p>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 flex-wrap">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Leads Grid */}
      {!leads || leads.length === 0 ? (
        <div className="text-center py-16">
          <Target className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-muted-foreground">Nenhum lead encontrado</p>
          <p className="text-xs text-muted-foreground mt-1">Os leads são criados automaticamente pela IA durante o atendimento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {leads.map((lead) => {
            const linkedVehicle = lead.vehicleId ? vehicleMap.get(lead.vehicleId) : null;
            const conversation = conversationMap.get(lead.conversationId);
            const assignedAgent = conversation?.assignedTo ? teamMemberMap.get(conversation.assignedTo) : null;

            return (
              <Card key={lead.id} className="bg-card border-border hover:border-primary/20 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-card-foreground">
                      {lead.name || lead.phone}
                    </CardTitle>
                    <Badge variant="outline" className={`text-[10px] ${statusColors[lead.status] || ""}`}>
                      {statusLabels[lead.status] || lead.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    <span>{lead.phone}</span>
                  </div>

                  {/* Agente atribuído */}
                  {assignedAgent && (
                    <div className="flex items-center gap-2 text-xs">
                      <UserCheck className="h-3 w-3 text-blue-400" />
                      <span className="text-blue-400 font-medium">{assignedAgent.name}</span>
                      <Badge variant="outline" className="text-[9px] py-0 px-1 border-blue-500/30 text-blue-400">
                        {assignedAgent.cargo}
                      </Badge>
                    </div>
                  )}

                  {lead.intention && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Target className="h-3 w-3" />
                      <span className="capitalize">{lead.intention}</span>
                    </div>
                  )}

                  {lead.vehicleInterest && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Car className="h-3 w-3" />
                      <span>{lead.vehicleInterest}</span>
                    </div>
                  )}

                  {/* Veículo vinculado do estoque */}
                  {linkedVehicle && (
                    <div className="mt-1 p-2 rounded-md bg-primary/5 border border-primary/20">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Car className="h-3 w-3 text-primary" />
                        <span className="text-[10px] text-primary uppercase tracking-wider font-semibold">Veículo Vinculado</span>
                      </div>
                      <p className="text-xs text-card-foreground font-medium">
                        {linkedVehicle.brand} {linkedVehicle.model}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        <span>{linkedVehicle.year}</span>
                        <span>·</span>
                        <span>{linkedVehicle.color}</span>
                        <span>·</span>
                        <span className="text-primary font-semibold">
                          R$ {linkedVehicle.price?.toLocaleString("pt-BR")}
                        </span>
                      </div>
                      {linkedVehicle.url && (
                        <a
                          href={linkedVehicle.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          Ver anúncio
                        </a>
                      )}
                    </div>
                  )}

                  {lead.hasTrade && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ArrowLeftRight className="h-3 w-3" />
                      <span>Troca: {lead.tradeVehicle} {lead.tradeYear}</span>
                    </div>
                  )}
                  {lead.paymentMethod && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CreditCard className="h-3 w-3" />
                      <span>{lead.paymentMethod} {lead.downPayment ? `- Entrada: ${lead.downPayment}` : ""}</span>
                    </div>
                  )}
                  {(lead as any).notes && (
                    <div className="mt-2 p-2 rounded-md bg-muted/50 border border-border">
                      <div className="flex items-center gap-1.5 mb-1">
                        <FileText className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Resumo</span>
                      </div>
                      <p className="text-xs text-card-foreground leading-relaxed whitespace-pre-wrap line-clamp-3">{(lead as any).notes}</p>
                    </div>
                  )}
                  {lead.score !== null && lead.score !== undefined && lead.score > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Score</span>
                        <span className="font-semibold text-primary">{lead.score}/100</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
