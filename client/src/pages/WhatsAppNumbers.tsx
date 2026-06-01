import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Smartphone, RefreshCw, CheckCircle2, XCircle, Info } from "lucide-react";
import { toast } from "sonner";

type WaNumber = {
  id: number;
  phoneNumberId: string;
  displayName: string;
  phoneDisplay: string | null;
  isActive: boolean;
  sellerId: number | null;
  assignedUserId: number | null;
  notes: string | null;
  createdAt: Date;
};

type FormData = {
  phoneNumberId: string;
  displayName: string;
  phoneDisplay: string;
  accessToken: string;
  notes: string;
};

const emptyForm: FormData = {
  phoneNumberId: "",
  displayName: "",
  phoneDisplay: "",
  accessToken: "",
  notes: "",
};

export default function WhatsAppNumbers() {
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  const { data: numbers = [], refetch, isLoading } = trpc.whatsappNumbers.list.useQuery();

  const createMutation = trpc.whatsappNumbers.create.useMutation({
    onSuccess: () => {
      toast.success("Número cadastrado com sucesso!");
      setShowDialog(false);
      setForm(emptyForm);
      refetch();
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  const updateMutation = trpc.whatsappNumbers.update.useMutation({
    onSuccess: () => {
      toast.success("Número atualizado com sucesso!");
      setShowDialog(false);
      setEditingId(null);
      setForm(emptyForm);
      refetch();
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  const deleteMutation = trpc.whatsappNumbers.delete.useMutation({
    onSuccess: () => {
      toast.success("Número removido.");
      setDeleteId(null);
      refetch();
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  const toggleActiveMutation = trpc.whatsappNumbers.update.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowDialog(true);
  }

  function openEdit(num: WaNumber) {
    setEditingId(num.id);
    setForm({
      phoneNumberId: num.phoneNumberId,
      displayName: num.displayName,
      phoneDisplay: num.phoneDisplay || "",
      accessToken: "",
      notes: num.notes || "",
    });
    setShowDialog(true);
  }

  function handleSubmit() {
    if (!form.phoneNumberId.trim()) {
      toast.error("Phone Number ID é obrigatório");
      return;
    }
    if (!form.displayName.trim()) {
      toast.error("Nome de exibição é obrigatório");
      return;
    }

    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        displayName: form.displayName,
        phoneDisplay: form.phoneDisplay || undefined,
        accessToken: form.accessToken || undefined,
        notes: form.notes || undefined,
      });
    } else {
      createMutation.mutate({
        phoneNumberId: form.phoneNumberId,
        displayName: form.displayName,
        phoneDisplay: form.phoneDisplay || undefined,
        accessToken: form.accessToken || undefined,
        notes: form.notes || undefined,
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Smartphone className="h-6 w-6 text-green-500" />
            Números WhatsApp Cloud API
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie os números WhatsApp Business cadastrados na sua WABA (Meta Business).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Adicionar Número
          </Button>
        </div>
      </div>

      {/* Info card */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Como funciona</p>
              <p>Cada número aqui cadastrado usa a <strong>WhatsApp Cloud API oficial da Meta</strong> — sem QR code, sem risco de ban. O número real do cliente sempre aparece corretamente.</p>
              <p>O webhook já está configurado em <code className="bg-muted px-1 rounded text-xs">/api/webhook/whatsapp</code> e roteia automaticamente as mensagens para o número correto pelo <code className="bg-muted px-1 rounded text-xs">phone_number_id</code>.</p>
              <p>Para obter o <strong>Phone Number ID</strong>: acesse o Meta Business Manager → WhatsApp → Configurações de API → selecione o número.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Números cadastrados ({numbers.length})</CardTitle>
          <CardDescription>Números ativos recebem e enviam mensagens via Cloud API</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : numbers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Smartphone className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Nenhum número cadastrado</p>
              <p className="text-sm mt-1">Adicione seu primeiro número WhatsApp Cloud API</p>
              <Button onClick={openCreate} className="mt-4" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Número
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome / Número</TableHead>
                  <TableHead>Phone Number ID</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(numbers as WaNumber[]).map((num) => (
                  <TableRow key={num.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{num.displayName}</p>
                        {num.phoneDisplay && (
                          <p className="text-xs text-muted-foreground">{num.phoneDisplay}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">{num.phoneNumberId}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={num.phoneNumberId ? "outline" : "secondary"} className="text-xs">
                        {num.phoneNumberId ? "Token global" : "Token próprio"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {num.isActive ? (
                          <><CheckCircle2 className="h-4 w-4 text-green-500" /><span className="text-xs text-green-500">Ativo</span></>
                        ) : (
                          <><XCircle className="h-4 w-4 text-red-500" /><span className="text-xs text-red-500">Inativo</span></>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                        {num.notes || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActiveMutation.mutate({ id: num.id, isActive: !num.isActive })}
                          title={num.isActive ? "Desativar" : "Ativar"}
                        >
                          {num.isActive ? <XCircle className="h-4 w-4 text-orange-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(num)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteId(num.id)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
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
      <Dialog open={showDialog} onOpenChange={(o) => { setShowDialog(o); if (!o) { setEditingId(null); setForm(emptyForm); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Número" : "Adicionar Número WhatsApp"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Atualize as informações do número."
                : "Cadastre um número WhatsApp Business da sua WABA."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="phoneNumberId">Phone Number ID *</Label>
              <Input
                id="phoneNumberId"
                placeholder="Ex: 123456789012345"
                value={form.phoneNumberId}
                onChange={(e) => setForm(f => ({ ...f, phoneNumberId: e.target.value }))}
                disabled={!!editingId}
              />
              <p className="text-xs text-muted-foreground">Encontrado no Meta Business Manager → WhatsApp → Configurações de API</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="displayName">Nome de exibição *</Label>
              <Input
                id="displayName"
                placeholder="Ex: Vendas - João Silva"
                value={form.displayName}
                onChange={(e) => setForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phoneDisplay">Número (exibição)</Label>
              <Input
                id="phoneDisplay"
                placeholder="Ex: +55 (51) 99999-9999"
                value={form.phoneDisplay}
                onChange={(e) => setForm(f => ({ ...f, phoneDisplay: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Número formatado para exibição na interface</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="accessToken">Access Token (opcional)</Label>
              <Input
                id="accessToken"
                type="password"
                placeholder="Token específico deste número (deixe vazio para usar o token global)"
                value={form.accessToken}
                onChange={(e) => setForm(f => ({ ...f, accessToken: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Se vazio, usa o <code>WHATSAPP_SYSTEM_USER_TOKEN</code> global</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                placeholder="Observações sobre este número..."
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar número"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover número?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá o número do sistema. As conversas e mensagens existentes serão mantidas, mas novas mensagens não serão recebidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
              className="bg-red-600 hover:bg-red-700"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
