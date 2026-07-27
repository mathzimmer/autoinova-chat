import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Faq = {
  id: number;
  category: string;
  title: string;
  content: string;
  isActive: boolean;
  updatedAt: string;
};

const CATEGORY_SUGGESTIONS = [
  "Financiamento",
  "Documentação",
  "Horários",
  "Troca / Avaliação",
  "Garantia",
  "Entrega",
  "Formas de pagamento",
  "Localização",
];

const emptyForm = { category: "", title: "", content: "", isActive: true };

export default function KnowledgeBase() {
  const utils = trpc.useUtils();
  const { data: faqs, isLoading } = trpc.knowledgeBase.list.useQuery();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const createMut = trpc.knowledgeBase.create.useMutation({
    onSuccess: () => { utils.knowledgeBase.list.invalidate(); setOpen(false); toast.success("Item cadastrado na base"); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.knowledgeBase.update.useMutation({
    onSuccess: () => { utils.knowledgeBase.list.invalidate(); setOpen(false); toast.success("Item atualizado"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.knowledgeBase.delete.useMutation({
    onSuccess: () => { utils.knowledgeBase.list.invalidate(); toast.success("Item removido"); },
    onError: (e) => toast.error(e.message),
  });

  const list = (faqs as Faq[] | undefined) || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(f =>
      f.title.toLowerCase().includes(q) ||
      f.content.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q)
    );
  }, [list, search]);

  const byCategory = useMemo(() => {
    const map = new Map<string, Faq[]>();
    for (const f of filtered) {
      const arr = map.get(f.category) || [];
      arr.push(f);
      map.set(f.category, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setOpen(true);
  }
  function openEdit(f: Faq) {
    setEditingId(f.id);
    setForm({ category: f.category, title: f.title, content: f.content, isActive: f.isActive });
    setOpen(true);
  }
  function save() {
    if (!form.category.trim() || !form.title.trim() || !form.content.trim()) {
      toast.error("Preencha categoria, título e conteúdo");
      return;
    }
    if (editingId) updateMut.mutate({ id: editingId, ...form });
    else createMut.mutate(form);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" /> Base de Conhecimento
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Cadastre as informações da loja (financiamento, documentação, horários...). A IA consulta esta base
            automaticamente para responder os clientes com precisão.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="h-4 w-4 mr-1" /> Novo item
        </Button>
      </div>

      <div className="relative my-4">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título, conteúdo ou categoria..."
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="text-lg font-medium text-foreground mb-1">Base vazia</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm">
              Comece cadastrando as perguntas mais frequentes dos clientes. Ex: "Como funciona o financiamento?".
            </p>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Cadastrar primeiro item</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {byCategory.map(([cat, items]) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-xs border-primary/40 text-primary">{cat}</Badge>
                <span className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "item" : "itens"}</span>
              </div>
              <div className="space-y-2">
                {items.map((f) => (
                  <Card key={f.id} className={f.isActive ? "" : "opacity-60"}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-card-foreground truncate">{f.title}</p>
                            {!f.isActive && <Badge variant="secondary" className="text-[10px]">Inativo</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">{f.content}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Switch
                            checked={f.isActive}
                            onCheckedChange={(v) => updateMut.mutate({ id: f.id, isActive: v })}
                            title={f.isActive ? "Ativo (a IA usa)" : "Inativo"}
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(f)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => { if (confirm(`Remover "${f.title}" da base?`)) deleteMut.mutate({ id: f.id }); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar item" : "Novo item da base"}</DialogTitle>
            <DialogDescription>A IA usa o título para achar o tema e o conteúdo como resposta.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Categoria</Label>
              <Input
                list="kb-categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Ex: Financiamento"
              />
              <datalist id="kb-categories">
                {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <Label className="text-xs">Título / Pergunta</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex: Como funciona o financiamento?"
              />
            </div>
            <div>
              <Label className="text-xs">Resposta / Conteúdo</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Trabalhamos com financiamento em até 60x, entrada a partir de 20%..."
                className="min-h-[120px]"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Ativo (a IA usa este item)</Label>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editingId ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
