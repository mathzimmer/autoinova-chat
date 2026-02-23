import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Target, Phone, Car, CreditCard, ArrowLeftRight, Users } from "lucide-react";

export default function Leads() {
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: leads } = trpc.lead.list.useQuery({ status: statusFilter }, { refetchInterval: 15000 });

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
          {leads.map((lead) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
