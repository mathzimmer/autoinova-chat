import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Phone,
  Store,
  Users,
  ArrowUpDown,
  BarChart3,
  Loader2,
  Camera,
  X,
} from "lucide-react";

interface SellerForm {
  name: string;
  phone: string;
  storeLocation: string;
  sortOrder: number;
}

export default function Sellers() {
  const [filterStore, setFilterStore] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SellerForm>({
    name: "",
    phone: "",
    storeLocation: "",
    sortOrder: 0,
  });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const sellersQuery = trpc.seller.list.useQuery(
    filterStore !== "all" ? { storeLocation: filterStore } : undefined
  );
  const storesQuery = trpc.seller.storeLocations.useQuery();
  const assignmentsQuery = trpc.seller.assignments.useQuery(undefined);

  // Mutations
  const utils = trpc.useUtils();
  const createMutation = trpc.seller.create.useMutation({
    onSuccess: () => {
      utils.seller.list.invalidate();
      toast.success("Vendedor cadastrado com sucesso!");
      closeDialog();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.seller.update.useMutation({
    onSuccess: () => {
      utils.seller.list.invalidate();
      toast.success("Vendedor atualizado!");
      closeDialog();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.seller.delete.useMutation({
    onSuccess: () => {
      utils.seller.list.invalidate();
      toast.success("Vendedor removido!");
      setDeleteConfirm(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const uploadPhotoMutation = trpc.seller.uploadPhoto.useMutation({
    onSuccess: () => {
      utils.seller.list.invalidate();
    },
    onError: (err) => toast.error("Erro ao enviar foto: " + err.message),
  });

  // Stats
  const sellers = sellersQuery.data || [];
  const stores = storesQuery.data || [];
  const assignments = assignmentsQuery.data || [];

  const stats = useMemo(() => {
    const totalSellers = sellers.length;
    const activeSellers = sellers.filter((s) => s.isActive).length;
    const totalAssignments = assignments.length;
    const storeGroups = new Map<string, number>();
    sellers.forEach((s) => {
      storeGroups.set(s.storeLocation, (storeGroups.get(s.storeLocation) || 0) + 1);
    });
    return { totalSellers, activeSellers, totalAssignments, storeGroups };
  }, [sellers, assignments]);

  function openCreate() {
    setEditingId(null);
    setForm({
      name: "",
      phone: "",
      storeLocation: stores[0] || "Auto Inova - Matriz",
      sortOrder: sellers.length,
    });
    setPhotoPreview(null);
    setPhotoFile(null);
    setDialogOpen(true);
  }

  function openEdit(seller: any) {
    setEditingId(seller.id);
    setForm({
      name: seller.name,
      phone: seller.phone,
      storeLocation: seller.storeLocation,
      sortOrder: seller.sortOrder,
    });
    setPhotoPreview(seller.photoUrl || null);
    setPhotoFile(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setPhotoPreview(null);
    setPhotoFile(null);
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A foto deve ter no máximo 5MB");
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function uploadPhoto(sellerId: number): Promise<string | undefined> {
    if (!photoFile) return undefined;
    setUploadingPhoto(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data:image/xxx;base64, prefix
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(photoFile);
      });
      const result = await uploadPhotoMutation.mutateAsync({
        sellerId,
        photoBase64: base64,
        mimeType: photoFile.type,
      });
      return result.url;
    } catch {
      return undefined;
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.phone.trim() || !form.storeLocation.trim()) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...form });
      // Upload photo separately if changed
      if (photoFile) {
        await uploadPhoto(editingId);
      }
    } else {
      createMutation.mutate(form, {
        onSuccess: async (data) => {
          if (photoFile && data.id) {
            await uploadPhoto(data.id);
          }
        },
      });
    }
  }

  function handleToggleActive(seller: any) {
    updateMutation.mutate({ id: seller.id, isActive: !seller.isActive });
  }

  const isPending = createMutation.isPending || updateMutation.isPending || uploadingPhoto;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Vendedores</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Gerencie a equipe de vendedores e a fila de atendimento por loja
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Vendedor
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalSellers}</p>
                  <p className="text-xs text-muted-foreground">Total Vendedores</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Users className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.activeSellers}</p>
                  <p className="text-xs text-muted-foreground">Ativos</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Store className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.storeGroups.size}</p>
                  <p className="text-xs text-muted-foreground">Lojas</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalAssignments}</p>
                  <p className="text-xs text-muted-foreground">Atribuições</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground">Filtrar por loja:</Label>
          <Select value={filterStore} onValueChange={setFilterStore}>
            <SelectTrigger className="w-[250px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map((store) => (
                <SelectItem key={store} value={store}>
                  {store}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sellers Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {filterStore === "all"
                ? "Todos os Vendedores"
                : `Vendedores - ${filterStore}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sellersQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : sellers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhum vendedor cadastrado</p>
                <p className="text-xs mt-1">Clique em "Novo Vendedor" para começar</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </TableHead>
                    <TableHead>Vendedor</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Loja</TableHead>
                    <TableHead className="text-center">Atribuições</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sellers.map((seller) => (
                    <TableRow key={seller.id}>
                      <TableCell className="text-muted-foreground text-sm">
                        #{seller.sortOrder + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {seller.photoUrl ? (
                            <img
                              src={seller.photoUrl}
                              alt={seller.name}
                              className="h-9 w-9 rounded-full object-cover border border-border"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                              {seller.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="font-medium">{seller.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          {seller.phone}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          <Store className="h-3 w-3 mr-1" />
                          {seller.storeLocation}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm font-medium">
                          {seller.totalAssignments}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={seller.isActive}
                          onCheckedChange={() => handleToggleActive(seller)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(seller)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirm(seller.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Editar Vendedor" : "Novo Vendedor"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Photo Upload */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  {photoPreview ? (
                    <div className="relative">
                      <img
                        src={photoPreview}
                        alt="Foto do vendedor"
                        className="h-24 w-24 rounded-full object-cover border-2 border-border"
                      />
                      <button
                        type="button"
                        onClick={() => { setPhotoPreview(null); setPhotoFile(null); }}
                        className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="h-24 w-24 rounded-full bg-muted border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera className="h-6 w-6 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground mt-1">Foto</span>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handlePhotoSelect}
                  />
                </div>
                {photoPreview && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera className="h-3.5 w-3.5 mr-1" />
                    Trocar foto
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  placeholder="Nome do vendedor"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefone (WhatsApp) *</Label>
                <Input
                  placeholder="5551999999999"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Formato: código do país + DDD + número (sem espaços ou traços)
                </p>
              </div>
              <div className="space-y-2">
                <Label>Loja *</Label>
                <Select
                  value={form.storeLocation}
                  onValueChange={(v) => setForm({ ...form, storeLocation: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a loja" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store} value={store}>
                        {store}
                      </SelectItem>
                    ))}
                    {!stores.includes("Auto Inova - Matriz") && (
                      <SelectItem value="Auto Inova - Matriz">Auto Inova - Matriz</SelectItem>
                    )}
                    {!stores.includes("Auto Inova - Loja 2") && (
                      <SelectItem value="Auto Inova - Loja 2">Auto Inova - Loja 2</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Posição na fila</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Define a ordem do vendedor na fila de rodízio (0 = primeiro)
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={deleteConfirm !== null}
          onOpenChange={() => setDeleteConfirm(null)}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Confirmar Exclusão</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Tem certeza que deseja remover este vendedor? Esta ação não pode ser
              desfeita.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteConfirm && deleteMutation.mutate({ id: deleteConfirm })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
