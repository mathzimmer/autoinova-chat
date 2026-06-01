import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Users, Plus, Search, Upload, Send, Trash2, Edit, Phone, Mail,
  Tag, FileSpreadsheet, CheckCircle, XCircle, MessageSquare, Filter,
  ChevronLeft, ChevronRight, X, Download, GitMerge, AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";

// ─── Types ──────────────────────────────────────────────────────
interface Contact {
  id: number;
  name: string;
  phone: string;
  email?: string | null;
  tags?: string[] | null;
  notes?: string | null;
  source: string;
  conversationId?: number | null;
  leadId?: number | null;
  isActive: boolean;
  createdAt: string | Date;
}

interface ImportRow {
  name: string;
  phone: string;
  email?: string;
  tags?: string[];
  notes?: string;
}

// ─── Helpers ────────────────────────────────────────────────────
function formatPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.length === 13) return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`;
  if (clean.length === 12) return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 8)}-${clean.slice(8)}`;
  if (clean.length === 11) return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  return phone;
}

function normalizePhone(phone: string): string {
  let clean = phone.replace(/\D/g, "");
  if (clean.length === 11 && clean.startsWith("0")) clean = clean.slice(1);
  if (clean.length === 10 || clean.length === 11) clean = "55" + clean;
  return clean;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  excel: "Excel",
  whatsapp: "WhatsApp",
  lead: "Lead",
};

// ─── Main Component ─────────────────────────────────────────────
export default function ContactsPage() {
  const { user } = useAuth();
  // toast from sonner is already imported
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [page, setPage] = useState(0);
  const [selectedContacts, setSelectedContacts] = useState<Set<number>>(new Set());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [importData, setImportData] = useState<ImportRow[]>([]);
  const [importFileName, setImportFileName] = useState("");

  // Form state
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formNotes, setFormNotes] = useState("");

  // Template state
  const [selectedTemplate, setSelectedTemplate] = useState("");
  // Duplicates state
  const [showDuplicatesDialog, setShowDuplicatesDialog] = useState(false);
  // Campaign state
  const [showCampaignDialog, setShowCampaignDialog] = useState(false);
  const [selectedContactForCampaign, setSelectedContactForCampaign] = useState<Contact | null>(null);
  const [showBulkCampaignDialog, setShowBulkCampaignDialog] = useState(false);
  const [selectedBulkCampaignId, setSelectedBulkCampaignId] = useState<string>("");
  const [filterByCampaign, setFilterByCampaign] = useState<string>(""); // "all", "active", or campaign ID

  const [pageSize, setPageSize] = useState(50);

  const openCampaignDialog = (contact: Contact) => {
    setSelectedContactForCampaign(contact);
    setShowCampaignDialog(true);
  };

  // Queries
  const contactsQuery = trpc.contact.list.useQuery({
    search: search || undefined,
    tag: selectedTag || undefined,
    source: selectedSource || undefined,
    limit: pageSize,
    offset: page * pageSize,
    campaignParticipant: filterByCampaign === "active" ? true : undefined,
  });
  const tagsQuery = trpc.contact.tags.useQuery();
  const templatesQuery = trpc.whatsappTemplate.list.useQuery();
  const templatesConfigured = trpc.whatsappTemplate.isConfigured.useQuery();
  const campaignsQuery = trpc.campaign.list.useQuery();
  // TODO: Implementar endpoint contactHistory no backend para histórico de campanhas por contato

  // Mutations
  const createMutation = trpc.contact.create.useMutation({
    onSuccess: () => {
      toast.success("Contato criado com sucesso");
      contactsQuery.refetch();
      setShowCreateDialog(false);
      resetForm();
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });

  const updateMutation = trpc.contact.update.useMutation({
    onSuccess: () => {
      toast.success("Contato atualizado");
      contactsQuery.refetch();
      setShowEditDialog(false);
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });

  const deleteMutation = trpc.contact.delete.useMutation({
    onSuccess: () => {
      toast.success("Contato removido");
      contactsQuery.refetch();
    },
  });

  const bulkImportMutation = trpc.contact.bulkImport.useMutation({
    onSuccess: (result) => {
      toast.success(`Importação concluída: ${result.created} criados, ${result.skipped} duplicados ignorados`);
      contactsQuery.refetch();
      setShowImportDialog(false);
      setImportData([]);
    },
    onError: (err) => toast.error("Erro na importação: " + err.message),
  });

  const sendTemplateMutation = trpc.contact.sendTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template enviado com sucesso");
    },
    onError: (err) => toast.error("Erro ao enviar: " + err.message),
  });

  const sendBulkMutation = trpc.contact.sendTemplateBulk.useMutation({
    onSuccess: (result) => {
      toast.success(`Envio em massa concluído: ${result.sent} enviados, ${result.failed} falharam`);
      setShowTemplateDialog(false);
      setSelectedContacts(new Set());
    },
    onError: (err) => toast.error("Erro no envio em massa: " + err.message),
  });

  const addContactToCampaignMutation = trpc.campaign.addContact.useMutation({
    onSuccess: () => {
      toast.success("Contato adicionado a campanha");
      campaignsQuery.refetch();
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });

  const removeContactFromCampaignMutation = trpc.campaign.removeContact.useMutation({
    onSuccess: () => {
      toast.success("Contato removido da campanha");
      campaignsQuery.refetch();
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });

  const addContactsToCampaignMutation = trpc.campaign.addContacts.useMutation({
    onSuccess: () => {
      toast.success("Contatos adicionados a campanha");
      campaignsQuery.refetch();
    },
    onError: (err) => toast.error("Erro: " + err.message),
  });

  const syncMutation = trpc.contact.syncFromConversations.useMutation({
    onSuccess: (result) => {
      toast.success(`Sincronização concluída: ${result.created} criados, ${result.updated} atualizados, ${result.skipped} já existiam`);
      contactsQuery.refetch();
    },
    onError: (err) => toast.error("Erro na sincronização: " + err.message),
  });

  const duplicatesQuery = trpc.contact.findDuplicates.useQuery(undefined, {
    enabled: showDuplicatesDialog,
  });

  const mergeMutation = trpc.contact.merge.useMutation({
    onSuccess: () => {
      toast.success("Contatos mesclados com sucesso");
      duplicatesQuery.refetch();
      contactsQuery.refetch();
    },
    onError: (err) => toast.error("Erro ao mesclar: " + err.message),
  });

  const autoMergeMutation = trpc.contact.autoMerge.useMutation({
    onSuccess: (result) => {
      toast.success(`Auto-merge concluído: ${result.merged} contatos mesclados`);
      duplicatesQuery.refetch();
      contactsQuery.refetch();
      if (result.merged === 0) {
        setShowDuplicatesDialog(false);
      }
    },
    onError: (err) => toast.error("Erro no auto-merge: " + err.message),
  });

  const contacts = contactsQuery.data?.contacts || [];
  const total = contactsQuery.data?.total || 0;
  const tags = tagsQuery.data || [];
  const templates = (templatesQuery.data as any)?.data || [];
  const approvedTemplates = templates.filter((t: any) => t.status === "APPROVED");

  // Helpers
  const resetForm = () => {
    setFormName(""); setFormPhone(""); setFormEmail(""); setFormTags(""); setFormNotes("");
  };

  const openEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormName(contact.name);
    setFormPhone(contact.phone);
    setFormEmail(contact.email || "");
    setFormTags((contact.tags || []).join(", "));
    setFormNotes(contact.notes || "");
    setShowEditDialog(true);
  };

  const handleCreate = () => {
    createMutation.mutate({
      name: formName,
      phone: normalizePhone(formPhone),
      email: formEmail || undefined,
      tags: formTags ? formTags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
      notes: formNotes || undefined,
    });
  };

  const handleUpdate = () => {
    if (!editingContact) return;
    updateMutation.mutate({
      id: editingContact.id,
      name: formName,
      phone: normalizePhone(formPhone),
      email: formEmail || undefined,
      tags: formTags ? formTags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
      notes: formNotes || undefined,
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja remover este contato?")) {
      deleteMutation.mutate({ id });
    }
  };

  // Excel import
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<any>(sheet);

        const rows: ImportRow[] = jsonData.map((row: any) => ({
          name: String(row.nome || row.name || row.Nome || row.Name || "").trim(),
          phone: normalizePhone(String(row.telefone || row.phone || row.Telefone || row.Phone || row.celular || row.Celular || "")),
          email: String(row.email || row.Email || row["e-mail"] || row["E-mail"] || "").trim() || undefined,
          tags: row.tags || row.Tags ? String(row.tags || row.Tags).split(",").map((t: string) => t.trim()).filter(Boolean) : undefined,
          notes: String(row.notas || row.notes || row.Notas || row.Notes || row.observacao || row.Observacao || "").trim() || undefined,
        })).filter((r: ImportRow) => r.name && r.phone);

        setImportData(rows);
        setShowImportDialog(true);
      } catch {
        toast.error("Erro ao ler arquivo. Verifique se é um Excel válido.");
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [toast]);

  const handleImport = () => {
    if (importData.length === 0) return;
    bulkImportMutation.mutate({ contacts: importData });
  };

  // Template send
  const handleSendTemplate = (contactId: number, phone: string) => {
    if (!selectedTemplate) {
      toast.error("Selecione um template");
      return;
    }
    sendTemplateMutation.mutate({ contactId, phone, templateName: selectedTemplate });
  };

  const handleBulkSendTemplate = () => {
    if (!selectedTemplate || selectedContacts.size === 0) return;
    sendBulkMutation.mutate({
      contactIds: Array.from(selectedContacts),
      templateName: selectedTemplate,
    });
  };

  const toggleSelect = (id: number) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedContacts.size === contacts.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(contacts.map(c => c.id)));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  if (!user) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Agenda de Contatos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie seus contatos e envie templates de marketing
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDuplicatesDialog(true)}
          >
            <GitMerge className="h-4 w-4 mr-1" />
            Duplicados
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <Users className="h-4 w-4 mr-1" />
            {syncMutation.isPending ? "Sincronizando..." : "Sincronizar Conversas"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Importar Excel
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileUpload}
          />
          {selectedContacts.size > 0 && (
            <>
              <Button size="sm" variant="default" onClick={() => setShowTemplateDialog(true)}>
                <Send className="h-4 w-4 mr-1" /> Enviar Template ({selectedContacts.size})
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowBulkCampaignDialog(true)}>
                <MessageSquare className="h-4 w-4 mr-1" /> Adicionar a Campanha ({selectedContacts.size})
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => { resetForm(); setShowCreateDialog(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Novo Contato
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone ou email..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                className="pl-9"
              />
            </div>
            <Select value={selectedTag} onValueChange={v => { setSelectedTag(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="w-[180px]">
                <Tag className="h-4 w-4 mr-1" />
                <SelectValue placeholder="Tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as tags</SelectItem>
                {tags.map(tag => (
                  <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedSource} onValueChange={v => { setSelectedSource(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="w-[150px]">
                <Filter className="h-4 w-4 mr-1" />
                <SelectValue placeholder="Origem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="excel">Excel</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterByCampaign || "all"} onValueChange={v => { setFilterByCampaign(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="w-[200px]">
                <MessageSquare className="h-4 w-4 mr-1" />
                <SelectValue placeholder="Campanhas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os contatos</SelectItem>
                <SelectItem value="active">Participaram de campanhas</SelectItem>
                {campaignsQuery.data?.campaigns?.map((campaign: any) => (
                  <SelectItem key={campaign.id} value={campaign.id.toString()}>
                    {campaign.name} ({campaign.totalContacts || 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={pageSize.toString()} onValueChange={v => { setPageSize(Number(v)); setPage(0); }}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Por página" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50 por página</SelectItem>
                <SelectItem value="100">100 por página</SelectItem>
                <SelectItem value="500">500 por página</SelectItem>
                <SelectItem value="1000">1000 por página</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold">{total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold">{selectedContacts.size}</div>
            <div className="text-xs text-muted-foreground">Selecionados</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold">{tags.length}</div>
            <div className="text-xs text-muted-foreground">Tags</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold">{approvedTemplates.length}</div>
            <div className="text-xs text-muted-foreground">Templates</div>
          </CardContent>
        </Card>
      </div>

      {/* Contacts Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left w-10">
                    <Checkbox
                      checked={contacts.length > 0 && selectedContacts.size === contacts.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                  <th className="p-3 text-left font-medium">Nome</th>
                  <th className="p-3 text-left font-medium">Telefone</th>
                  <th className="p-3 text-left font-medium hidden md:table-cell">Email</th>
                  <th className="p-3 text-left font-medium hidden lg:table-cell">Tags</th>
                  <th className="p-3 text-left font-medium hidden sm:table-cell">Origem</th>
                  <th className="p-3 text-left font-medium hidden md:table-cell">Campanhas</th>
                  <th className="p-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {contactsQuery.isLoading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Carregando...</td></tr>
                ) : contacts.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhum contato encontrado. Crie um novo ou importe via Excel.
                  </td></tr>
                ) : contacts.map(contact => (
                  <tr key={contact.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <Checkbox
                        checked={selectedContacts.has(contact.id)}
                        onCheckedChange={() => toggleSelect(contact.id)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{contact.name}</div>
                      {contact.notes && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{contact.notes}</div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono text-xs">{formatPhone(contact.phone)}</span>
                      </div>
                    </td>
                    <td className="p-3 hidden md:table-cell">
                      {contact.email ? (
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs">{contact.email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="p-3 hidden lg:table-cell">
                      <div className="flex gap-1 flex-wrap">
                        {(contact.tags || []).map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 hidden sm:table-cell">
                      <Badge variant="outline" className="text-xs">
                        {SOURCE_LABELS[contact.source] || contact.source}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1">
                        {(() => {
                          const activeCampaigns = campaignsQuery.data?.campaigns?.filter((c: any) => 
                            (c.contactIds || []).includes(contact.id) && (c.status === 'running' || c.status === 'scheduled')
                          ) || [];
                          
                          if (activeCampaigns.length === 0) {
                            return <span className="text-xs text-muted-foreground">-</span>;
                          }
                          
                          return activeCampaigns.map((campaign: any) => (
                            <Badge key={campaign.id} variant="default" className="text-xs bg-blue-600 hover:bg-blue-700">
                              {campaign.name}
                            </Badge>
                          ));
                        })()}
                      </div>
                    </td>
                    <td className="p-3 hidden md:table-cell">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => openCampaignDialog(contact)}
                      >
                        <MessageSquare className="h-3 w-3 mr-1" />
                        Gerenciar
                      </Button>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {templatesConfigured.data && approvedTemplates.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Enviar template"
                            onClick={() => {
                              if (!selectedTemplate) {
                                setSelectedContacts(new Set([contact.id]));
                                setShowTemplateDialog(true);
                              } else {
                                handleSendTemplate(contact.id, contact.phone);
                              }
                            }}
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(contact)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(contact.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <span className="text-xs text-muted-foreground">
                {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} de {total}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Download template */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Modelo de Planilha
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Baixe o modelo para importar contatos. Colunas: nome, telefone, email, tags, notas
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => {
              const ws = XLSX.utils.aoa_to_sheet([
                ["nome", "telefone", "email", "tags", "notas"],
                ["João Silva", "5511999998888", "joao@email.com", "vip, financiamento", "Cliente interessado em SUV"],
                ["Maria Santos", "5521988887777", "", "troca", ""],
              ]);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "Contatos");
              XLSX.writeFile(wb, "modelo_contatos.xlsx");
            }}>
              <Download className="h-4 w-4 mr-1" /> Baixar Modelo
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Contato</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Nome completo" />
            </div>
            <div>
              <Label>Telefone *</Label>
              <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="5511999998888" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="email@exemplo.com" />
            </div>
            <div>
              <Label>Tags (separadas por vírgula)</Label>
              <Input value={formTags} onChange={e => setFormTags(e.target.value)} placeholder="vip, financiamento, troca" />
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Observações sobre o contato" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!formName || !formPhone || createMutation.isPending}>
              {createMutation.isPending ? "Criando..." : "Criar Contato"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Contato</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} />
            </div>
            <div>
              <Label>Telefone *</Label>
              <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={formEmail} onChange={e => setFormEmail(e.target.value)} />
            </div>
            <div>
              <Label>Tags (separadas por vírgula)</Label>
              <Input value={formTags} onChange={e => setFormTags(e.target.value)} />
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={!formName || !formPhone || updateMutation.isPending}>
              {updateMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Importar Contatos
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Arquivo: <strong>{importFileName}</strong> — {importData.length} contatos encontrados
            </p>
            <div className="max-h-[300px] overflow-auto border rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2 text-left">Nome</th>
                    <th className="p-2 text-left">Telefone</th>
                    <th className="p-2 text-left">Email</th>
                    <th className="p-2 text-left">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {importData.slice(0, 100).map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2 font-mono">{row.phone}</td>
                      <td className="p-2">{row.email || "-"}</td>
                      <td className="p-2">{(row.tags || []).join(", ") || "-"}</td>
                    </tr>
                  ))}
                  {importData.length > 100 && (
                    <tr><td colSpan={4} className="p-2 text-center text-muted-foreground">
                      ... e mais {importData.length - 100} contatos
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportData([]); }}>Cancelar</Button>
            <Button onClick={handleImport} disabled={bulkImportMutation.isPending}>
              {bulkImportMutation.isPending ? "Importando..." : `Importar ${importData.length} contatos`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicates Dialog */}
      <Dialog open={showDuplicatesDialog} onOpenChange={setShowDuplicatesDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5" />
              Contatos Duplicados
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {duplicatesQuery.isLoading ? (
              <p className="text-center text-muted-foreground py-8">Analisando contatos...</p>
            ) : !duplicatesQuery.data || duplicatesQuery.data.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                <p className="font-medium">Nenhum duplicado encontrado!</p>
                <p className="text-sm text-muted-foreground mt-1">Todos os contatos possuem telefones únicos.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 inline mr-1 text-amber-500" />
                    {duplicatesQuery.data.length} grupo(s) de duplicados encontrado(s)
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => autoMergeMutation.mutate()}
                    disabled={autoMergeMutation.isPending}
                  >
                    <GitMerge className="h-4 w-4 mr-1" />
                    {autoMergeMutation.isPending ? "Mesclando..." : "Mesclar Todos Automaticamente"}
                  </Button>
                </div>
                {duplicatesQuery.data.map((group: any) => (
                  <Card key={group.normalizedPhone} className="border-amber-500/30">
                    <CardHeader className="pb-2 pt-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        {formatPhone(group.normalizedPhone)}
                        <Badge variant="secondary" className="text-xs">{group.contacts.length} registros</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3">
                      <div className="space-y-2">
                        {group.contacts.map((contact: Contact, idx: number) => (
                          <div key={contact.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
                            <div className="flex-1">
                              <div className="font-medium">{contact.name}</div>
                              <div className="text-xs text-muted-foreground">
                                Tel: {contact.phone} | Origem: {SOURCE_LABELS[contact.source] || contact.source}
                                {contact.email && ` | Email: ${contact.email}`}
                                {contact.conversationId && " | Com conversa"}
                              </div>
                              {contact.tags && contact.tags.length > 0 && (
                                <div className="flex gap-1 mt-1">
                                  {contact.tags.map(tag => (
                                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            {idx > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="ml-2"
                                onClick={() => mergeMutation.mutate({
                                  primaryId: group.contacts[0].id,
                                  secondaryId: contact.id,
                                })}
                                disabled={mergeMutation.isPending}
                              >
                                <GitMerge className="h-3 w-3 mr-1" />
                                Mesclar com #{group.contacts[0].id}
                              </Button>
                            )}
                            {idx === 0 && (
                              <Badge variant="default" className="text-xs">Principal</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDuplicatesDialog(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Send Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Enviar Template de Marketing
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enviar para <strong>{selectedContacts.size}</strong> contato(s) selecionado(s)
            </p>
            <div>
              <Label>Template</Label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um template aprovado" />
                </SelectTrigger>
                <SelectContent>
                  {approvedTemplates.map((t: any) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name} ({t.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!templatesConfigured.data && (
              <p className="text-xs text-amber-500">
                Templates do WhatsApp não estão configurados. Configure em Configurações &gt; WhatsApp.
              </p>
            )}
            {approvedTemplates.length === 0 && templatesConfigured.data && (
              <p className="text-xs text-amber-500">
                Nenhum template aprovado encontrado. Crie templates no Meta Business Suite.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>Cancelar</Button>
            <Button
              onClick={handleBulkSendTemplate}
              disabled={!selectedTemplate || selectedContacts.size === 0 || sendBulkMutation.isPending}
            >
              {sendBulkMutation.isPending ? "Enviando..." : `Enviar para ${selectedContacts.size} contatos`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Campaign Dialog */}
      <Dialog open={showCampaignDialog} onOpenChange={setShowCampaignDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Campanhas: {selectedContactForCampaign?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Available Campaigns */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">Selecionar Campanhas</Label>
              <div className="border rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-2">
                {campaignsQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando campanhas...</p>
                ) : !campaignsQuery.data?.campaigns || campaignsQuery.data.campaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma campanha disponível</p>
                ) : (
                  campaignsQuery.data?.campaigns?.map((campaign: any) => (
                    <label key={campaign.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer">
                      <Checkbox
                        checked={(campaign.contactIds || []).includes(selectedContactForCampaign?.id || 0)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            addContactToCampaignMutation.mutate({
                              campaignId: campaign.id,
                              contactId: selectedContactForCampaign?.id || 0,
                            });
                          } else {
                            removeContactFromCampaignMutation.mutate({
                              campaignId: campaign.id,
                              contactId: selectedContactForCampaign?.id || 0,
                            });
                          }
                        }}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{campaign.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {campaign.status === 'running' ? (
                            <span className="text-amber-500">🔴 Ativa</span>
                          ) : campaign.status === 'completed' ? (
                            <span className="text-green-500">✓ Concluída</span>
                          ) : (
                            <span className="text-muted-foreground">{campaign.status}</span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Campaign History - TODO: Implementar no backend */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <p className="text-sm text-blue-400">
                <strong>ℹ️ Histórico:</strong> Em desenvolvimento. Será exibido o histórico de campanhas que este contato participou.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCampaignDialog(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Campaign Dialog */}
      <Dialog open={showBulkCampaignDialog} onOpenChange={setShowBulkCampaignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Contatos a Campanha</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-semibold mb-2 block">Selecionar Campanha</Label>
              <Select value={selectedBulkCampaignId} onValueChange={setSelectedBulkCampaignId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha uma campanha" />
                </SelectTrigger>
                <SelectContent>
                  {campaignsQuery.data?.campaigns?.map((campaign: any) => (
                    <SelectItem key={campaign.id} value={campaign.id.toString()}>
                      {campaign.name} ({campaign.totalContacts || 0} contatos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <p className="text-sm text-blue-400">
                <strong>Contatos selecionados:</strong> {selectedContacts.size}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkCampaignDialog(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (selectedBulkCampaignId) {
                  addContactsToCampaignMutation.mutate({
                    campaignId: parseInt(selectedBulkCampaignId),
                    contactIds: Array.from(selectedContacts),
                  });
                  setShowBulkCampaignDialog(false);
                  setSelectedContacts(new Set());
                }
              }}
              disabled={!selectedBulkCampaignId || addContactsToCampaignMutation.isPending}
            >
              {addContactsToCampaignMutation.isPending ? "Adicionando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
