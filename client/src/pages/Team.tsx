import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { UserPlus, Shield, ShieldCheck, Headset, Wrench, RotateCcw, UserX, Pencil, Eye, EyeOff } from "lucide-react";

const cargoLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  admin: { label: "Administrador", icon: <ShieldCheck className="h-3.5 w-3.5" />, color: "bg-red-500/10 text-red-400 border-red-500/20" },
  gerente: { label: "Gerente", icon: <Shield className="h-3.5 w-3.5" />, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  vendedor: { label: "Vendedor", icon: <Headset className="h-3.5 w-3.5" />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  suporte: { label: "Suporte", icon: <Wrench className="h-3.5 w-3.5" />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
};

export default function Team() {
  const utils = trpc.useUtils();
  const { data: members, isLoading } = trpc.team.listAll.useQuery();
  const createMember = trpc.team.create.useMutation({
    onSuccess: () => {
      utils.team.listAll.invalidate();
      toast.success("Membro criado com sucesso!");
      setShowCreate(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateMember = trpc.team.update.useMutation({
    onSuccess: () => {
      utils.team.listAll.invalidate();
      toast.success("Membro atualizado!");
      setEditingId(null);
    },
    onError: (err) => toast.error(err.message),
  });
  const deactivateMember = trpc.team.deactivate.useMutation({
    onSuccess: () => {
      utils.team.listAll.invalidate();
      toast.success("Membro desativado!");
    },
    onError: (err) => toast.error(err.message),
  });
  const resetPassword = trpc.team.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("Senha redefinida com sucesso!");
      setResetPasswordId(null);
      setNewPassword("");
    },
    onError: (err) => toast.error(err.message),
  });

  // Form state
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargo, setCargo] = useState<"admin" | "gerente" | "vendedor" | "suporte">("vendedor");
  const [showPassword, setShowPassword] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCargo, setEditCargo] = useState<"admin" | "gerente" | "vendedor" | "suporte">("vendedor");

  // Reset password state
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setCargo("vendedor");
    setShowPassword(false);
  };

  const handleCreate = () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      toast.error("Preencha todos os campos");
      return;
    }
    createMember.mutate({ name, email, password, cargo });
  };

  const handleEdit = (member: any) => {
    setEditingId(member.id);
    setEditName(member.name);
    setEditEmail(member.email);
    setEditCargo(member.cargo);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    updateMember.mutate({
      id: editingId,
      name: editName,
      email: editEmail,
      cargo: editCargo,
    });
  };

  const handleReactivate = (id: number) => {
    updateMember.mutate({ id, status: "ativo" });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Equipe</h1>
          <p className="text-xs text-muted-foreground">Gerencie os membros da equipe e suas permissões</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <UserPlus className="h-4 w-4" />
              Novo Membro
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Membro da Equipe</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" />
              </div>
              <div className="space-y-2">
                <Label>Senha</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cargo</Label>
                <Select value={cargo} onValueChange={(val) => setCargo(val as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="gerente">Gerente</SelectItem>
                    <SelectItem value="vendedor">Vendedor</SelectItem>
                    <SelectItem value="suporte">Suporte</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancelar</Button>
              </DialogClose>
              <Button onClick={handleCreate} disabled={createMember.isPending}>
                {createMember.isPending ? "Criando..." : "Criar Membro"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : !members || members.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <UserPlus className="h-10 w-10 mb-3 opacity-50" />
            <p className="text-sm">Nenhum membro cadastrado</p>
            <p className="text-xs mt-1">Clique em "Novo Membro" para adicionar</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {members.map((member: any) => {
              const cargoInfo = cargoLabels[member.cargo] || cargoLabels.vendedor;
              const isEditing = editingId === member.id;
              const isInactive = member.status === "inativo";

              return (
                <Card key={member.id} className={`relative ${isInactive ? "opacity-60" : ""}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold ${isInactive ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                          {member.name?.charAt(0).toUpperCase() || "?"}
                        </div>
                        <div>
                          {isEditing ? (
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm font-semibold" />
                          ) : (
                            <CardTitle className="text-sm font-semibold">{member.name}</CardTitle>
                          )}
                          {isEditing ? (
                            <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-6 text-xs mt-1" />
                          ) : (
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                          )}
                        </div>
                      </div>
                      {isInactive && (
                        <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                          Inativo
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <Select value={editCargo} onValueChange={(val) => setEditCargo(val as any)}>
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Administrador</SelectItem>
                            <SelectItem value="gerente">Gerente</SelectItem>
                            <SelectItem value="vendedor">Vendedor</SelectItem>
                            <SelectItem value="suporte">Suporte</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className={`text-[10px] gap-1 ${cargoInfo.color}`}>
                          {cargoInfo.icon}
                          {cargoInfo.label}
                        </Badge>
                      )}
                    </div>

                    <div className="flex gap-1.5 pt-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" variant="default" className="h-7 text-xs flex-1" onClick={handleSaveEdit} disabled={updateMember.isPending}>
                            Salvar
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleEdit(member)}>
                            <Pencil className="h-3 w-3" /> Editar
                          </Button>
                          <Dialog open={resetPasswordId === member.id} onOpenChange={(open) => { if (!open) setResetPasswordId(null); }}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setResetPasswordId(member.id)}>
                                <RotateCcw className="h-3 w-3" /> Senha
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Redefinir Senha - {member.name}</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                  <Label>Nova Senha</Label>
                                  <Input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Mínimo 6 caracteres"
                                  />
                                </div>
                              </div>
                              <DialogFooter>
                                <DialogClose asChild>
                                  <Button variant="outline">Cancelar</Button>
                                </DialogClose>
                                <Button
                                  onClick={() => resetPassword.mutate({ id: member.id, newPassword })}
                                  disabled={resetPassword.isPending || newPassword.length < 6}
                                >
                                  {resetPassword.isPending ? "Redefinindo..." : "Redefinir Senha"}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                          {isInactive ? (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-400" onClick={() => handleReactivate(member.id)}>
                              Reativar
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(`Desativar ${member.name}?`)) {
                                  deactivateMember.mutate({ id: member.id });
                                }
                              }}
                            >
                              <UserX className="h-3 w-3" /> Desativar
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
