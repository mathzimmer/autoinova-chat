import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Shield,
  Clock,
  User,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

export default function VendorApiKeys() {
  const { data: apiKeys, refetch: refetchKeys, isLoading: keysLoading } = trpc.vendor.listApiKeys.useQuery();
  const { data: teamMembers, isLoading: teamLoading } = trpc.team.list.useQuery();

  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [keyName, setKeyName] = useState("Extensão Chrome");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const createMutation = trpc.vendor.createApiKey.useMutation({
    onSuccess: (data) => {
      setNewKeyValue(data.apiKey);
      setShowNewKeyDialog(true);
      setSelectedMemberId("");
      setKeyName("Extensão Chrome");
      refetchKeys();
      toast.success("Chave API criada com sucesso!");
    },
    onError: (err) => toast.error("Erro ao criar chave: " + err.message),
  });

  const revokeMutation = trpc.vendor.revokeApiKey.useMutation({
    onSuccess: () => {
      refetchKeys();
      toast.success("Chave revogada com sucesso.");
    },
    onError: (err) => toast.error("Erro ao revogar: " + err.message),
  });

  const handleCreate = () => {
    if (!selectedMemberId) {
      toast.error("Selecione um membro da equipe.");
      return;
    }
    createMutation.mutate({
      teamMemberId: parseInt(selectedMemberId),
      name: keyName.trim() || undefined,
    });
  };

  const handleCopy = async () => {
    if (newKeyValue) {
      await navigator.clipboard.writeText(newKeyValue);
      setCopied(true);
      toast.success("Chave copiada para a área de transferência!");
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const getMemberName = (teamMemberId: number) => {
    const member = teamMembers?.find((m: any) => m.id === teamMemberId);
    return member?.name || `Membro #${teamMemberId}`;
  };

  const isLoading = keysLoading || teamLoading;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl mx-auto pb-12">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Key className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">API Keys dos Vendedores</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie as chaves de acesso para a extensão Chrome dos vendedores
            </p>
          </div>
        </div>

        {/* Info Card */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2.5">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-card-foreground text-lg">Como funciona</CardTitle>
                <CardDescription className="mt-0.5">
                  Cada vendedor recebe uma chave API única para acessar seus leads pela extensão Chrome.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">1. Crie a chave</p>
                <p>Selecione o vendedor e gere uma chave API. Ela só será exibida uma vez.</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">2. Configure a extensão</p>
                <p>O vendedor cola a chave na extensão Chrome para autenticar.</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="font-medium text-card-foreground">3. Acesso aos leads</p>
                <p>O vendedor vê apenas os leads atribuídos a ele, com filtros e ações rápidas.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Create New Key */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2.5">
              <Plus className="h-5 w-5 text-green-500" />
              <div>
                <CardTitle className="text-card-foreground text-base">Criar Nova Chave</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  Gere uma nova chave API para um vendedor
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="flex-1 space-y-2">
                <Label className="text-sm text-muted-foreground">Vendedor</Label>
                <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue placeholder="Selecione um membro da equipe..." />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers?.map((member: any) => (
                      <SelectItem key={member.id} value={String(member.id)}>
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{member.name}</span>
                          <Badge variant="outline" className="text-[10px] ml-1">
                            {member.cargo}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-2">
                <Label className="text-sm text-muted-foreground">Nome da chave (opcional)</Label>
                <Input
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="Ex: Extensão Chrome"
                  className="bg-input border-border"
                />
              </div>
              <Button
                onClick={handleCreate}
                disabled={!selectedMemberId || createMutation.isPending}
                className="gap-1.5 shrink-0"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Gerar Chave
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Existing Keys */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Key className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-card-foreground text-base">Chaves Existentes</CardTitle>
                  <CardDescription className="mt-0.5 text-xs">
                    {apiKeys?.length ?? 0} chave(s) registrada(s)
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !apiKeys || apiKeys.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Key className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhuma chave API criada ainda.</p>
                <p className="text-xs mt-1">Use o formulário acima para criar a primeira.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {apiKeys.map((key: any) => (
                  <div
                    key={key.id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      key.active
                        ? "bg-muted/20 border-border"
                        : "bg-destructive/5 border-destructive/20 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`p-2 rounded-lg ${key.active ? "bg-green-500/10" : "bg-destructive/10"}`}>
                        <Key className={`h-4 w-4 ${key.active ? "text-green-500" : "text-destructive"}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-card-foreground">
                            {getMemberName(key.teamMemberId)}
                          </span>
                          {key.name && (
                            <Badge variant="outline" className="text-[10px]">
                              {key.name}
                            </Badge>
                          )}
                          {key.active ? (
                            <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">
                              Ativa
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">
                              Revogada
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <code className="font-mono text-[11px] bg-muted/50 px-1.5 py-0.5 rounded">
                            {key.keyPreview}
                          </code>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Criada: {new Date(key.createdAt).toLocaleDateString("pt-BR")}
                          </span>
                          {key.lastUsedAt && (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                              Último uso: {new Date(key.lastUsedAt).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {key.active && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-destructive hover:text-destructive shrink-0 ml-4"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Revogar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-card border-border">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-card-foreground flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5 text-yellow-500" />
                              Revogar chave de {getMemberName(key.teamMemberId)}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              A extensão Chrome do vendedor parará de funcionar imediatamente.
                              Você precisará criar uma nova chave se quiser restaurar o acesso.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-input border-border">Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => revokeMutation.mutate({ id: key.id })}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Revogar Chave
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* New Key Dialog */}
        <Dialog open={showNewKeyDialog} onOpenChange={(open) => {
          if (!open) {
            setShowNewKeyDialog(false);
            setNewKeyValue(null);
            setCopied(false);
          }
        }}>
          <DialogContent className="bg-card border-border sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-card-foreground flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Chave API Criada!
              </DialogTitle>
              <DialogDescription>
                Copie a chave abaixo. <strong className="text-yellow-500">Ela não será exibida novamente.</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/30 border border-border">
                <Label className="text-xs text-muted-foreground mb-2 block">Chave API</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-input p-2.5 rounded border border-border break-all select-all text-card-foreground">
                    {newKeyValue}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="shrink-0 gap-1.5"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        Copiada!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copiar
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                <p className="text-xs text-yellow-500/90">
                  Guarde esta chave em um local seguro. Se perder, será necessário criar uma nova.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => { setShowNewKeyDialog(false); setNewKeyValue(null); setCopied(false); }}>
                Entendi, já copiei
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
