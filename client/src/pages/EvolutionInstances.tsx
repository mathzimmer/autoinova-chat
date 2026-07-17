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
  const { data: teamMembers } = trpc.team.list.useQuery();
  const assignUserMutation = trpc.evolution.assignUser.useMutation({
    onSuccess: () => { instancesQuery.refetch(); toast.success("Vendedor vinculado à instância"); },
    onError: (e) => toast.error("Erro ao vincular: " + e.message),
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

  // ── Zernio (coexistência oficial) — cadastro separado da Evolution ──
  const [zCreateOpen, setZCreateOpen] = useState(false);
  const [zAccountId, setZAccountId] = useState("");
  const [zDisplay, setZDisplay] = useState("");
  const [zApiKey, setZApiKey] = useState("");

  const zernioQuery = trpc.zernio.listInstances.useQuery(undefined, { refetchInterval: 60000 });
  const zAvailableQuery = trpc.zernio.availableAccounts.useQuery(
    zApiKey ? { apiKey: zApiKey } : undefined,
    { enabled: zCreateOpen },
  );
  const zCreateMutation = trpc.zernio.createInstance.useMutation({
    onSuccess: () => {
      zernioQuery.refetch();
      setZCreateOpen(false); setZAccountId(""); setZDisplay(""); setZApiKey("");
      toast.success("Instância Zernio cadastrada!");
    },
    onError: (e) => toast.error("Erro ao cadastrar Zernio: " + e.message),
  });
  const zAssignUserMutation = trpc.zernio.assignUser.useMutation({
    onSuccess: () => { zernioQuery.refetch(); toast.success("Vendedor vinculado à instância Zernio"); },
    onError: (e) => toast.error("Erro: " + e.message),
  });
  const zDeleteMutation = trpc.zernio.deleteInstance.useMutation({
    onSuccess: () => { zernioQuery.refetch(); toast.success("Instância Zernio removida"); },
    onError: (e) => toast.error("Erro ao remover: " + e.message),
  });
  const zernioInstances = zernioQuery.data || [];

  // ── API Oficial adicional (multi-número) ──
  const [oCreateOpen, setOCreateOpen] = useState(false);
  const [oPhoneNumberId, setOPhoneNumberId] = useState("");
  const [oDisplay, setODisplay] = useState("");
  const [oPhoneDisplay, setOPhoneDisplay] = useState("");
  const [oToken, setOToken] = useState("");

  const officialQuery = trpc.whatsappNumber.listInstances.useQuery(undefined, { refetchInterval: 60000 });
  const oCreateMutation = trpc.whatsappNumber.createInstance.useMutation({
    onSuccess: () => {
      officialQuery.refetch();
      setOCreateOpen(false); setOPhoneNumberId(""); setODisplay(""); setOPhoneDisplay(""); setOToken("");
      toast.success("Número oficial cadastrado!");
    },
    onError: (e) => toast.error("Erro ao cadastrar número: " + e.message),
  });
  const oDeleteMutation = trpc.whatsappNumber.deleteInstance.useMutation({
    onSuccess: () => { officialQuery.refetch(); toast.success("Número oficial removido"); },
    onError: (e) => toast.error("Erro ao remover: " + e.message),
  });
  const officialInstances = officialQuery.data || [];

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
          <Button size="sm" variant="secondary" onClick={() => setZCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Zernio
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar API Oficial
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
                {/* Vendedor vinculado a esta instância (dono dos leads transferidos pra cá) */}
                <div className="mb-3">
                  <label className="text-[10px] text-muted-foreground uppercase block mb-1">Vendedor desta instância</label>
                  <select
                    className="w-full h-8 text-sm rounded-md border border-border bg-background px-2"
                    value={(inst as any).assignedUserId ?? ""}
                    onChange={(e) => assignUserMutation.mutate({ id: inst.id, userId: e.target.value ? parseInt(e.target.value) : null })}
                  >
                    <option value="">— Sem vendedor —</option>
                    {(teamMembers || []).map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name || m.email || `Usuário ${m.id}`}</option>
                    ))}
                  </select>
                </div>
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

      {/* ── Seção Zernio (coexistência oficial) ── */}
      <div className="mt-10">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-semibold">Zernio (coexistência oficial)</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Números em coexistência via Zernio — WhatsApp oficial no mesmo número do app. Cada conta vira uma aba própria no inbox.
        </p>
        {zernioInstances.length === 0 ? (
          <Card className="text-center py-10 border-dashed">
            <CardContent>
              <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground mb-4">Nenhuma instância Zernio cadastrada</p>
              <Button variant="secondary" onClick={() => setZCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Cadastrar Zernio
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {zernioInstances.map((inst: any) => (
              <Card key={inst.id} className="relative overflow-hidden">
                <div className={`absolute top-0 left-0 right-0 h-1 ${inst.status === "connected" ? "bg-blue-500" : "bg-red-500"}`} />
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-blue-500" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{inst.displayName}</CardTitle>
                        <p className="text-xs text-muted-foreground">{inst.phone || inst.accountId}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      <span className={`w-2 h-2 rounded-full mr-1 ${inst.status === "connected" ? "bg-blue-500" : "bg-red-500"}`} />
                      Zernio
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Vendedor dono desta instância (vê só ela no inbox) */}
                  <div className="mb-3">
                    <label className="text-[10px] text-muted-foreground uppercase block mb-1">Vendedor desta instância</label>
                    <select
                      className="w-full text-xs rounded-md border border-border bg-background h-8 px-2"
                      value={(inst as any).assignedUserId ?? ""}
                      onChange={(e) => zAssignUserMutation.mutate({ id: inst.id, userId: e.target.value ? parseInt(e.target.value) : null })}
                    >
                      <option value="">Todos (sem restrição)</option>
                      {(teamMembers || []).map((m: any) => (
                        <option key={m.id} value={m.id}>{m.name}{m.cargo ? ` · ${m.cargo}` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/inbox?instance=${encodeURIComponent(inst.instanceName)}`}>
                      <Button size="sm" variant="outline" className="flex-1">
                        <MessageSquare className="w-3 h-3 mr-1" />
                        Mensagens
                      </Button>
                    </Link>
                    <Button
                      size="sm" variant="outline" className="text-red-500 hover:text-red-600"
                      onClick={() => { if (confirm(`Remover instância Zernio "${inst.displayName}"?`)) zDeleteMutation.mutate({ id: inst.id }); }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialog: cadastrar Zernio */}
      <Dialog open={zCreateOpen} onOpenChange={setZCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar instância Zernio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome de Exibição</Label>
              <Input placeholder="ex: Recepção / Bianca" value={zDisplay} onChange={e => setZDisplay(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Account ID (Zernio) *</Label>
              <Input placeholder="ex: 6a52a4ba3ecd8aa344b8c656" value={zAccountId} onChange={e => setZAccountId(e.target.value.trim())} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">
                O ID da conta WhatsApp no Zernio. {zAvailableQuery.data && zAvailableQuery.data.length > 0 ? "Ou escolha abaixo:" : "Você encontra no painel do Zernio (Accounts)."}
              </p>
              {(zAvailableQuery.data || []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {(zAvailableQuery.data || []).map((a: any) => (
                    <button
                      key={a.accountId}
                      type="button"
                      onClick={() => { setZAccountId(a.accountId); if (!zDisplay) setZDisplay(a.displayName || a.phone || ""); }}
                      className={`px-2 py-1 rounded text-xs border ${zAccountId === a.accountId ? "bg-blue-600 text-white border-blue-600" : "bg-secondary text-muted-foreground"}`}
                    >
                      {a.displayName || a.phone || a.accountId}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label>API Key (opcional)</Label>
              <Input placeholder="deixe vazio para usar a chave global do servidor" value={zApiKey} onChange={e => setZApiKey(e.target.value.trim())} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">Só preencha se esta conta usa uma chave Zernio diferente da configurada no servidor.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => zCreateMutation.mutate({ accountId: zAccountId, displayName: zDisplay || undefined, apiKey: zApiKey || undefined })}
              disabled={!zAccountId || zCreateMutation.isPending}
            >
              {zCreateMutation.isPending ? "Cadastrando..." : "Cadastrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Seção API Oficial adicional ── */}
      <div className="mt-10">
        <div className="flex items-center gap-2 mb-3">
          <Wifi className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">API Oficial (números adicionais)</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Números oficiais da WhatsApp Cloud API além do número da Matriz. Cada um vira uma aba própria no inbox, com IA e fluxos.
        </p>
        {officialInstances.length === 0 ? (
          <Card className="text-center py-10 border-dashed">
            <CardContent>
              <Wifi className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground mb-4">Nenhum número oficial adicional</p>
              <Button variant="secondary" onClick={() => setOCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Cadastrar Número Oficial
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {officialInstances.map((inst: any) => (
              <Card key={inst.id} className="relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <Wifi className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{inst.displayName}</CardTitle>
                        <p className="text-xs text-muted-foreground">{inst.phone || inst.phoneNumberId}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">Oficial</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/inbox?instance=${encodeURIComponent(inst.instanceName)}`}>
                      <Button size="sm" variant="outline" className="flex-1">
                        <MessageSquare className="w-3 h-3 mr-1" />
                        Mensagens
                      </Button>
                    </Link>
                    <Button
                      size="sm" variant="outline" className="text-red-500 hover:text-red-600"
                      onClick={() => { if (confirm(`Remover número oficial "${inst.displayName}"?`)) oDeleteMutation.mutate({ id: inst.id }); }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialog: cadastrar API Oficial */}
      <Dialog open={oCreateOpen} onOpenChange={setOCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar número API Oficial</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome de Exibição *</Label>
              <Input placeholder="ex: Pós-venda" value={oDisplay} onChange={e => setODisplay(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Phone Number ID (Meta) *</Label>
              <Input placeholder="ex: 1186992007834259" value={oPhoneNumberId} onChange={e => setOPhoneNumberId(e.target.value.trim())} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">Encontrado no painel da Meta (WhatsApp → API Setup).</p>
            </div>
            <div>
              <Label>Número (exibição)</Label>
              <Input placeholder="ex: +55 51 99999-9999" value={oPhoneDisplay} onChange={e => setOPhoneDisplay(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Access Token (opcional)</Label>
              <Input placeholder="deixe vazio para usar o token global do servidor" value={oToken} onChange={e => setOToken(e.target.value.trim())} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">Só preencha se este número usa um token diferente do configurado no .env.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => oCreateMutation.mutate({ phoneNumberId: oPhoneNumberId, displayName: oDisplay, phoneDisplay: oPhoneDisplay || undefined, accessToken: oToken || undefined })}
              disabled={!oPhoneNumberId || !oDisplay || oCreateMutation.isPending}
            >
              {oCreateMutation.isPending ? "Cadastrando..." : "Cadastrar"}
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
