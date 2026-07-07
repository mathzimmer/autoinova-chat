import { trpc } from "@/lib/trpc";
import { useInboxSocket } from "@/hooks/useSocket";
import { useEffect, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Search, Bot, User, MessageSquare, Circle, UserCheck, Users, Inbox, Plus, Loader2, Send, CheckSquare, Archive, Trash2, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type Props = {
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** "matriz" (padrão) ou nome da instância Evolution */
  instance?: string;
};

const PAGE_SIZE = 100;

export default function ConversationList({ selectedId, onSelect, instance = "matriz" }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState<"all" | "mine" | "unassigned" | "ai">("all");
  const [labelFilter, setLabelFilter] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showArchived, setShowArchived] = useState(false);
  const { data: conversations, refetch } = trpc.conversation.list.useQuery(
    { status: statusFilter, search: search || undefined, instance, limit, archived: showArchived },
    { refetchInterval: 10000 }
  );

  // Reseta a paginação ao trocar de fonte/filtro
  useEffect(() => { setLimit(PAGE_SIZE); }, [instance, statusFilter, search, showArchived]);

  // ── Seleção múltipla ──
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const utils = trpc.useUtils();
  const clearSelection = () => { setSelectedIds(new Set()); setSelectionMode(false); };
  const toggleSelect = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const archiveMutation = trpc.conversation.setArchived.useMutation({
    onSuccess: (r) => { toast.success(`${r.count} conversa(s) ${showArchived ? "desarquivada(s)" : "arquivada(s)"}`); clearSelection(); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.conversation.bulkDelete.useMutation({
    onSuccess: (r) => { toast.success(`${r.count} conversa(s) excluída(s)`); clearSelection(); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Nova conversa ──
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newFirstMsg, setNewFirstMsg] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce: busca enquanto digita, sem martelar o servidor
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(contactQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [contactQuery]);

  const { data: contactResults, isFetching: searchingContacts } = trpc.contact.search.useQuery(
    { q: debouncedQuery },
    { enabled: showNewDialog && debouncedQuery.length >= 2 }
  );

  // Conversa já existente com o número digitado (na fonte atual)?
  const phoneDigits = newPhone.replace(/\D/g, "");
  const { data: existingConv } = trpc.conversation.findByPhone.useQuery(
    { phone: phoneDigits, instance },
    { enabled: showNewDialog && phoneDigits.length >= 10 }
  );
  const startNewMutation = trpc.conversation.startNew.useMutation({
    onSuccess: (res) => {
      if (res.sendError) {
        toast.warning(res.windowExpired
          ? "Conversa criada, mas a janela de 24h está fechada — use um template para iniciar."
          : `Conversa criada, mas a mensagem falhou: ${res.sendError}`);
      } else {
        toast.success("Conversa iniciada!");
      }
      setShowNewDialog(false);
      setNewName(""); setNewPhone(""); setNewFirstMsg(""); setContactQuery("");
      refetch();
      onSelect(res.conversationId);
    },
    onError: (err) => toast.error(err.message),
  });
  const { data: teamMembers } = trpc.team.list.useQuery();
  const { data: teamMe } = trpc.teamAuth.me.useQuery();
  const { data: allLabels } = trpc.label.list.useQuery();
  const { data: labelAssignments } = trpc.label.assignments.useQuery(undefined, { refetchInterval: 30000 });

  // conversationId -> labels
  const convLabelMap = useMemo(() => {
    const map = new Map<number, { id: number; name: string; color: string }[]>();
    if (!labelAssignments || !allLabels) return map;
    const labelById = new Map(allLabels.map((l: any) => [l.id, l]));
    for (const a of labelAssignments as any[]) {
      const label = labelById.get(a.labelId);
      if (!label) continue;
      if (!map.has(a.conversationId)) map.set(a.conversationId, []);
      map.get(a.conversationId)!.push(label);
    }
    return map;
  }, [labelAssignments, allLabels]);
  const { socket, connected } = useInboxSocket();

  const isTeamMember = teamMe?.isTeamMember ?? false;
  const myTeamMemberId = teamMe?.teamMember?.id;
  const myCargo = teamMe?.teamMember?.cargo;
  const isRestrictedRole = isTeamMember && (myCargo === "vendedor" || myCargo === "suporte");

  useEffect(() => {
    if (!socket) return;
    const handler = () => { refetch(); };
    socket.on("conversation_updated", handler);
    return () => { socket.off("conversation_updated", handler); };
  }, [socket, refetch]);

  // Set default filter for restricted roles
  useEffect(() => {
    if (isRestrictedRole && agentFilter === "all") {
      setAgentFilter("mine");
    }
  }, [isRestrictedRole]);

  // Filter conversations by agent assignment
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    let filtered = conversations;

    // Restricted roles (vendedor/suporte) can only see their own conversations
    if (isRestrictedRole && myTeamMemberId) {
      if (agentFilter === "mine" || agentFilter === "all") {
        filtered = filtered.filter((c) => c.assignedTo === myTeamMemberId);
      } else if (agentFilter === "unassigned") {
        filtered = filtered.filter((c) => !c.assignedTo);
      } else if (agentFilter === "ai") {
        filtered = filtered.filter((c) => c.aiActive && !c.assignedTo);
      }
    } else {
      if (agentFilter === "mine" && myTeamMemberId) {
        filtered = filtered.filter((c) => c.assignedTo === myTeamMemberId);
      } else if (agentFilter === "unassigned") {
        filtered = filtered.filter((c) => !c.assignedTo);
      } else if (agentFilter === "ai") {
        filtered = filtered.filter((c) => c.aiActive);
      }
    }

    // Filtro por etiqueta
    if (labelFilter !== null) {
      filtered = filtered.filter((c) => (convLabelMap.get(c.id) || []).some((l) => l.id === labelFilter));
    }

    return filtered;
  }, [conversations, agentFilter, isRestrictedRole, myTeamMemberId, labelFilter, convLabelMap]);

  // Get agent name by ID
  const getAgentName = (agentId: number | null) => {
    if (!agentId || !teamMembers) return null;
    const member = teamMembers.find((m: any) => m.id === agentId);
    return member?.name || null;
  };

  const statusTabs = [
    { value: "all", label: "Todas" },
    { value: "open", label: "Abertas" },
    { value: "pending", label: "Pendentes" },
    { value: "resolved", label: "Resolvidas" },
  ];

  const agentTabs = isRestrictedRole
    ? [
        { value: "mine", label: "Minhas", icon: UserCheck },
        { value: "unassigned", label: "Sem agente", icon: Inbox },
      ]
    : [
        { value: "all", label: "Todas", icon: Users },
        ...(isTeamMember ? [{ value: "mine" as const, label: "Minhas", icon: UserCheck }] : []),
        { value: "unassigned", label: "Sem agente", icon: Inbox },
        { value: "ai", label: "IA ativa", icon: Bot },
      ];

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-border overflow-hidden">
      {/* Header - fixed height */}
      <div className="shrink-0 p-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-sidebar-foreground flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Conversas
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Circle className={`h-2 w-2 ${connected ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"}`} />
              <span className="text-xs text-muted-foreground">{connected ? "Online" : "Offline"}</span>
            </div>
            <Button
              size="icon" variant="ghost"
              className={`h-7 w-7 ${selectionMode ? "text-primary bg-primary/10" : "text-muted-foreground"} hover:bg-accent`}
              onClick={() => { setSelectionMode(v => !v); setSelectedIds(new Set()); }}
              title="Selecionar várias"
            >
              <CheckSquare className="h-4 w-4" />
            </Button>
            <Button
              size="icon" variant="ghost"
              className={`h-7 w-7 ${showArchived ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground"} hover:bg-accent`}
              onClick={() => setShowArchived(v => !v)}
              title={showArchived ? "Ver ativas" : "Ver arquivadas"}
            >
              <Archive className="h-4 w-4" />
            </Button>
            <Button
              size="icon" variant="ghost"
              className="h-7 w-7 text-primary hover:bg-primary/10"
              onClick={() => setShowNewDialog(true)}
              title="Iniciar nova conversa"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Barra de ações em massa ── */}
        {selectionMode && (
          <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-accent/50 border border-border">
            <span className="text-xs font-medium text-foreground flex-1">{selectedIds.size} selecionada(s)</span>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={selectedIds.size === 0 || archiveMutation.isPending}
              onClick={() => archiveMutation.mutate({ ids: Array.from(selectedIds), archived: !showArchived })}>
              <Archive className="h-3.5 w-3.5 mr-1" />{showArchived ? "Desarquivar" : "Arquivar"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive" disabled={selectedIds.size === 0 || deleteMutation.isPending}
              onClick={() => { if (confirm(`Excluir ${selectedIds.size} conversa(s) permanentemente? Isso apaga as mensagens.`)) deleteMutation.mutate({ ids: Array.from(selectedIds) }); }}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />Excluir
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearSelection}>Cancelar</Button>
          </div>
        )}
        {showArchived && !selectionMode && (
          <div className="mb-2 text-xs text-amber-600 flex items-center gap-1"><Archive className="h-3 w-3" /> Vendo conversas arquivadas</div>
        )}

        {/* ── Dialog nova conversa ── */}
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Nova conversa</DialogTitle>
              <DialogDescription>
                Fonte: <b>{instance === "matriz" ? "Matriz (oficial)" : instance}</b> — busque um contato ou digite os dados.
                {instance === "matriz" && " Fora da janela de 24h, será preciso enviar um template."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={contactQuery}
                  onChange={e => setContactQuery(e.target.value)}
                  placeholder="Buscar contato existente..."
                  className="pl-9 h-9 text-sm"
                />
                {debouncedQuery.length >= 2 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                    {(contactResults || []).map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => { setNewName(c.name || ""); setNewPhone(c.phone || ""); setContactQuery(""); setDebouncedQuery(""); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between"
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-muted-foreground text-xs shrink-0">{c.phone}</span>
                      </button>
                    ))}
                    {!searchingContacts && (contactResults || []).length === 0 && (
                      <button
                        onClick={() => {
                          const digits = debouncedQuery.replace(/\D/g, "");
                          if (digits.length >= 8) setNewPhone(digits); else setNewName(debouncedQuery);
                          setContactQuery(""); setDebouncedQuery("");
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent text-primary flex items-center gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Nenhum contato encontrado — criar "{debouncedQuery}"
                      </button>
                    )}
                    {searchingContacts && (
                      <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Conversa já existente com este número */}
              {existingConv && (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  <span className="text-xs text-amber-700 flex-1">
                    Já existe conversa com este número{existingConv.contactName ? ` (${existingConv.contactName})` : ""} nesta fonte.
                  </span>
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs shrink-0"
                    onClick={() => { setShowNewDialog(false); onSelect(existingConv.id); }}
                  >
                    Abrir conversa
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome" className="h-9 text-sm" />
                <Input value={newPhone} onChange={e => setNewPhone(e.target.value.replace(/[^\d]/g, ""))} placeholder="5551999998888" className="h-9 text-sm" />
              </div>
              <Textarea
                value={newFirstMsg}
                onChange={e => setNewFirstMsg(e.target.value)}
                placeholder="Primeira mensagem (opcional)..."
                className="text-sm min-h-16"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancelar</Button>
              <Button
                disabled={newPhone.replace(/\D/g, "").length < 10 || startNewMutation.isPending}
                onClick={() => startNewMutation.mutate({
                  name: newName.trim() || undefined,
                  phone: newPhone,
                  instance,
                  firstMessage: newFirstMsg.trim() || undefined,
                })}
              >
                {startNewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                Iniciar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-input border-border text-sm h-9"
          />
        </div>
      </div>

      {/* Filters - fixed height, no wrapping */}
      <div className="shrink-0 border-b border-border">
        {/* Status Tabs */}
        <div className="flex px-3 py-1.5 gap-0.5">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`h-7 px-2.5 text-xs rounded-md font-medium transition-colors whitespace-nowrap ${
                statusFilter === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* Agent Filter Tabs */}
        <div className="flex px-3 py-1.5 gap-0.5">
          {agentTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setAgentFilter(tab.value as any)}
              className={`h-6 px-2 text-[10px] rounded font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${
                agentFilter === tab.value
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent"
              }`}
            >
              <tab.icon className="h-3 w-3 shrink-0" />
              {tab.label}
            </button>
          ))}
        </div>
        {/* Label Filter Chips */}
        {(allLabels || []).length > 0 && (
          <div className="flex px-3 pb-1.5 gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {(allLabels || []).map((l: any) => (
              <button
                key={l.id}
                onClick={() => setLabelFilter(v => v === l.id ? null : l.id)}
                className="h-5 px-2 text-[10px] rounded-full font-medium transition-all whitespace-nowrap shrink-0"
                style={labelFilter === l.id
                  ? { backgroundColor: l.color, color: "#fff" }
                  : { backgroundColor: l.color + "22", color: l.color, border: `1px solid ${l.color}55` }}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conversation List - scrollable area takes remaining space */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <div className="p-1.5">
          {filteredConversations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {isRestrictedRole && agentFilter === "mine"
                  ? "Nenhuma conversa atribuída a você"
                  : "Nenhuma conversa encontrada"}
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const agentName = getAgentName(conv.assignedTo);
              const isChecked = selectedIds.has(conv.id);
              return (
                <button
                  key={conv.id}
                  onClick={() => selectionMode ? toggleSelect(conv.id) : onSelect(conv.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-all h-auto ${
                    selectionMode && isChecked
                      ? "bg-primary/10 border border-primary/40"
                      : selectedId === conv.id
                      ? "bg-accent border border-primary/30"
                      : "hover:bg-accent/50 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {selectionMode && (
                      <div className={`h-4 w-4 rounded border shrink-0 flex items-center justify-center ${isChecked ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                        {isChecked && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                    )}
                    {/* Avatar - fixed size with platform icon */}
                    <div className="relative shrink-0">
                      {conv.contactPhoto ? (
                        <img
                          src={conv.contactPhoto}
                          alt={conv.contactName || ""}
                          className="h-10 w-10 rounded-full object-cover"
                          onError={(e) => {
                            // Fallback to initials if image fails
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            target.nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                      ) : null}
                      <div className={`h-10 w-10 rounded-full bg-secondary flex items-center justify-center ${conv.contactPhoto ? 'hidden' : ''}`}>
                        <span className="text-sm font-medium text-secondary-foreground">
                          {(conv.contactName || conv.phone || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                      {/* Platform icon - top left */}
                      <PlatformIcon channel={conv.channel} />
                      {/* AI/Agent badge - bottom right */}
                      {conv.aiActive && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                          <Bot className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      )}
                      {!conv.aiActive && conv.assignedTo && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-blue-500 flex items-center justify-center">
                          <User className="h-2.5 w-2.5 text-white" />
                        </div>
                      )}
                    </div>

                    {/* Content - flexible, truncated */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      {/* Row 1: Name + Time */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {conv.contactName || conv.phone}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {conv.unreadCount > 0 && (
                            <Badge variant="default" className="h-4 min-w-4 flex items-center justify-center text-[9px] px-1 bg-primary text-primary-foreground rounded-full">
                              {conv.unreadCount}
                            </Badge>
                          )}
                          <StatusDot status={conv.status} />
                        </div>
                      </div>

                      {/* Row 2: Preview + Time */}
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-xs text-muted-foreground truncate">
                          {(conv.lastMessagePreview || "Sem mensagens").replace(/\{?\[?(FOTO|IMAGEM|IMAGE|ID:\d+)\]?\}?/gi, "").trim() || "Sem mensagens"}
                        </p>
                        {conv.lastMessageAt && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false, locale: ptBR })}
                          </span>
                        )}
                      </div>

                      {/* Row 3: Agent + Labels */}
                      {(agentName || (convLabelMap.get(conv.id) || []).length > 0) && (
                        <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                          {agentName && (
                            <>
                              <UserCheck className="h-3 w-3 text-blue-400 shrink-0" />
                              <span className="text-[10px] text-blue-400 font-medium truncate shrink-0 max-w-24">{agentName}</span>
                            </>
                          )}
                          {(convLabelMap.get(conv.id) || []).slice(0, 2).map((l) => (
                            <span key={l.id} className="text-[9px] px-1.5 rounded-full font-medium shrink-0" style={{ backgroundColor: l.color + "22", color: l.color, border: `1px solid ${l.color}55` }}>
                              {l.name}
                            </span>
                          ))}
                          {(convLabelMap.get(conv.id) || []).length > 2 && (
                            <span className="text-[9px] text-muted-foreground shrink-0">+{(convLabelMap.get(conv.id) || []).length - 2}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
          {/* Paginação: carregar mais */}
          {(conversations || []).length >= limit && (
            <button
              onClick={() => setLimit(l => l + PAGE_SIZE)}
              className="w-full py-2 mt-1 text-xs text-primary hover:bg-accent/50 rounded-lg font-medium"
            >
              Carregar mais conversas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlatformIcon({ channel }: { channel: string }) {
  if (channel === "instagram") {
    return (
      <div className="absolute -top-0.5 -left-0.5 h-4 w-4 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)" }}>
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 text-white fill-current">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      </div>
    );
  }
  if (channel === "facebook") {
    return (
      <div className="absolute -top-0.5 -left-0.5 h-4 w-4 rounded-full bg-[#1877F2] flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 text-white fill-current">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </div>
    );
  }
  // WhatsApp (default)
  return (
    <div className="absolute -top-0.5 -left-0.5 h-4 w-4 rounded-full bg-[#25D366] flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 text-white fill-current">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-green-500",
    pending: "bg-yellow-500",
    resolved: "bg-blue-500",
    closed: "bg-gray-500",
  };
  return <div className={`h-2 w-2 rounded-full shrink-0 ${colors[status] || "bg-gray-500"}`} />;
}
