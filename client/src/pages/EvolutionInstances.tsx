import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Smartphone, Plus, RefreshCw, Wifi, WifiOff, QrCode,
  Trash2, LogOut, RotateCcw, MessageSquare, Users, Settings
} from "lucide-react";
import { Link } from "wouter";

type Instance = {
  id: number;
  instanceName: string;
  displayName: string | null;
  phone: string | null;
  status: "connecting" | "connected" | "disconnected" | "qr_code";
  qrCode: string | null;
  profilePicUrl: string | null;
  lastConnectedAt: number | null;
  webhookConfigured: boolean;
};

export default function EvolutionInstances() {
  const [createOpen, setCreateOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [newName, setNewName] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [pollingInstance, setPollingInstance] = useState<string | null>(null);

  const instancesQuery = trpc.evolution.listInstances.useQuery(undefined, {
    refetchInterval: pollingInstance ? 5000 : 30000,
  });

  const syncMutation = trpc.evolution.syncInstances.useMutation({
    onSuccess: () => {
      instancesQuery.refetch();
      toast.success("Instâncias sincronizadas com a Evolution API");
    },
    onError: (e) => toast.error("Erro ao sincronizar: " + e.message),
  });

  const createMutation = trpc.evolution.createInstance.useMutation({
    onSuccess: (data) => {
      instancesQuery.refetch();
      setCreateOpen(false);
      setNewName("");
      setNewDisplay("");
      toast.success("Instância criada! Escaneie o QR code para conectar.");
      // Open QR dialog
      if (data.qrCode) {
        setSelectedInstance({
          id: data.id,
          instanceName: data.instanceName,
          displayName: data.instanceName,
          phone: null,
          status: "qr_code",
          qrCode: data.qrCode,
          profilePicUrl: null,
          lastConnectedAt: null,
          webhookConfigured: true,
        });
        setQrOpen(true);
        setPollingInstance(data.instanceName);
      }
    },
    onError: (e) => toast.error("Erro ao criar instância: " + e.message),
  });

  const qrQuery = trpc.evolution.getQrCode.useQuery(
    { instanceName: pollingInstance || "" },
    { enabled: !!pollingInstance && qrOpen, refetchInterval: 20000 }
  );

  const statusQuery = trpc.evolution.getStatus.useQuery(
    { instanceName: pollingInstance || "" },
    { enabled: !!pollingInstance, refetchInterval: 5000 }
  );

  // Stop polling when connected
  useEffect(() => {
    if (statusQuery.data?.status === "connected" && pollingInstance) {
      setPollingInstance(null);
      instancesQuery.refetch();
      toast.success(`✅ WhatsApp conectado! Número ${pollingInstance} está online.`);
      setQrOpen(false);
    }
  }, [statusQuery.data?.status]);

  const logoutMutation = trpc.evolution.logoutInstance.useMutation({
    onSuccess: () => { instancesQuery.refetch(); toast.success("Instância desconectada"); },
    onError: (e) => toast.error("Erro ao desconectar: " + e.message),
  });

  const restartMutation = trpc.evolution.restartInstance.useMutation({
    onSuccess: () => { instancesQuery.refetch(); toast.success("Instância reiniciada"); },
    onError: (e) => toast.error("Erro ao reiniciar: " + e.message),
  });

  const deleteMutation = trpc.evolution.deleteInstance.useMutation({
    onSuccess: () => { instancesQuery.refetch(); toast.success("Instância removida"); },
    onError: (e) => toast.error("Erro ao remover: " + e.message),
  });

  const instances = instancesQuery.data || [];

  const statusColor = (status: Instance["status"]) => {
    if (status === "connected") return "bg-green-500";
    if (status === "qr_code" || status === "connecting") return "bg-yellow-500";
    return "bg-red-500";
  };

  const statusLabel = (status: Instance["status"]) => {
    if (status === "connected") return "Conectado";
    if (status === "qr_code") return "Aguardando QR";
    if (status === "connecting") return "Conectando";
    return "Desconectado";
  };

  const handleOpenQr = (inst: Instance) => {
    setSelectedInstance(inst);
    setPollingInstance(inst.instanceName);
    setQrOpen(true);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-green-500" />
            Números WhatsApp
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie os números dos vendedores conectados via WhatsApp Web
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Sincronizar
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Número
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Wifi className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{instances.filter(i => i.status === "connected").length}</p>
                <p className="text-sm text-muted-foreground">Conectados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <WifiOff className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{instances.filter(i => i.status === "disconnected").length}</p>
                <p className="text-sm text-muted-foreground">Desconectados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Users className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{instances.length}</p>
                <p className="text-sm text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instance Cards */}
      {instancesQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-40" />
            </Card>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <Smartphone className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum número cadastrado</h3>
            <p className="text-muted-foreground mb-4">
              Adicione os números WhatsApp dos seus vendedores para monitorar as conversas
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Primeiro Número
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {instances.map((inst) => (
            <Card key={inst.id} className="relative overflow-hidden">
              {/* Status indicator bar */}
              <div className={`absolute top-0 left-0 right-0 h-1 ${statusColor(inst.status)}`} />
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {inst.profilePicUrl ? (
                      <img src={inst.profilePicUrl} className="w-10 h-10 rounded-full object-cover" alt="" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                        <Smartphone className="w-5 h-5 text-green-500" />
                      </div>
                    )}
                    <div>
                      <CardTitle className="text-base">{inst.displayName || inst.instanceName}</CardTitle>
                      <p className="text-xs text-muted-foreground">{inst.phone || inst.instanceName}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    <span className={`w-2 h-2 rounded-full mr-1 ${statusColor(inst.status)}`} />
                    {statusLabel(inst.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {inst.lastConnectedAt && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Última conexão: {new Date(inst.lastConnectedAt).toLocaleString("pt-BR")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {inst.status !== "connected" && (
                    <Button size="sm" variant="outline" onClick={() => handleOpenQr(inst)} className="flex-1">
                      <QrCode className="w-3 h-3 mr-1" />
                      Conectar
                    </Button>
                  )}
                  {inst.status === "connected" && (
                    <Link href={`/inbox?instance=${encodeURIComponent(inst.instanceName)}`}>
                      <Button size="sm" variant="outline" className="flex-1">
                        <MessageSquare className="w-3 h-3 mr-1" />
                        Mensagens
                      </Button>
                    </Link>
                  )}
                  {inst.status === "connected" && (
                    <Button size="sm" variant="outline" onClick={() => logoutMutation.mutate({ instanceName: inst.instanceName })}>
                      <LogOut className="w-3 h-3" />
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => restartMutation.mutate({ instanceName: inst.instanceName })}>
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => {
                      if (confirm(`Remover instância "${inst.instanceName}"?`)) {
                        deleteMutation.mutate({ id: inst.id, instanceName: inst.instanceName });
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Instance Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Número WhatsApp</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome da Instância *</Label>
              <Input
                placeholder="ex: vendedor-joao"
                value={newName}
                onChange={e => setNewName(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Apenas letras minúsculas, números e hífens</p>
            </div>
            <div>
              <Label>Nome de Exibição</Label>
              <Input
                placeholder="ex: João Vendedor"
                value={newDisplay}
                onChange={e => setNewDisplay(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate({ instanceName: newName, displayName: newDisplay || undefined })}
              disabled={!newName || createMutation.isPending}
            >
              {createMutation.isPending ? "Criando..." : "Criar e Gerar QR Code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog open={qrOpen} onOpenChange={(open) => { setQrOpen(open); if (!open) setPollingInstance(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5" />
              Conectar WhatsApp
            </DialogTitle>
          </DialogHeader>
          <div className="text-center py-4">
            {selectedInstance?.qrCode || qrQuery.data?.qrCode ? (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Abra o WhatsApp no celular → Dispositivos Vinculados → Vincular Dispositivo → Escaneie o código
                </p>
                <div className="bg-white p-3 rounded-lg inline-block">
                  <img
                    src={`data:image/png;base64,${(qrQuery.data?.qrCode || selectedInstance?.qrCode || "").replace("data:image/png;base64,", "")}`}
                    alt="QR Code"
                    className="w-56 h-56"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-3 animate-pulse">
                  Aguardando conexão... O QR code atualiza automaticamente.
                </p>
              </>
            ) : (
              <div className="py-8">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2">Gerando QR code...</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
