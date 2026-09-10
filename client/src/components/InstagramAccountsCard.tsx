import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Instagram, Save } from "lucide-react";
import { toast } from "sonner";

/** Cadastro das contas de Instagram (multi-conta). Cada conta vira uma aba no inbox. */
export default function InstagramAccountsCard() {
  const cfg = trpc.settings.getInstagramAccounts.useQuery();
  const [rows, setRows] = useState<Array<{ igId: string; name: string; token: string; tokenPreview?: string }>>([]);
  useEffect(() => {
    if (cfg.data) setRows(cfg.data.map((a: any) => ({ igId: a.igId, name: a.name || "", token: "", tokenPreview: a.tokenPreview })));
  }, [cfg.data]);
  const save = trpc.settings.saveInstagramAccounts.useMutation({
    onSuccess: () => { cfg.refetch(); toast.success("Contas de Instagram salvas!"); },
    onError: (e) => toast.error("Erro: " + e.message),
  });
  const upd = (i: number, k: string, v: string) => setRows((r) => r.map((row, j) => j === i ? { ...row, [k]: v } : row));
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-card-foreground text-base flex items-center gap-2"><Instagram className="h-4 w-4 text-primary" /> Contas de Instagram</CardTitle>
        <CardDescription className="mt-0.5">Cada conta vira uma aba no inbox. Cole o ID e o token gerados no painel da Meta (deixe o token vazio pra manter o atual).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col gap-2 border border-border rounded-md p-2 sm:flex-row sm:items-center">
            <Input value={row.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder="Nome (ex: autoinovaev)" className="sm:w-40" />
            <Input value={row.igId} onChange={(e) => upd(i, "igId", e.target.value)} placeholder="ID da conta (1784...)" className="sm:w-48" />
            <Input value={row.token} onChange={(e) => upd(i, "token", e.target.value)} placeholder={row.tokenPreview ? `token salvo (${row.tokenPreview})` : "token de acesso"} className="flex-1" />
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>Remover</Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setRows((r) => [...r, { igId: "", name: "", token: "" }])}>+ Adicionar conta</Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ accounts: rows.filter((r) => r.igId.trim()).map((r) => ({ igId: r.igId.trim(), name: r.name.trim() || undefined, token: r.token.trim() || undefined })) })}>
            <Save className="h-3.5 w-3.5 mr-1" /> Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
