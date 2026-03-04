import { trpc } from "@/lib/trpc";
import { useInboxSocket } from "@/hooks/useSocket";
import { useEffect, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Bot, User, MessageSquare, Circle, UserCheck, Users, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Props = {
  selectedId: number | null;
  onSelect: (id: number) => void;
};

export default function ConversationList({ selectedId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState<"all" | "mine" | "unassigned" | "ai">("all");
  const { data: conversations, refetch } = trpc.conversation.list.useQuery(
    { status: statusFilter, search: search || undefined },
    { refetchInterval: 10000 }
  );
  const { data: teamMembers } = trpc.team.list.useQuery();
  const { data: teamMe } = trpc.teamAuth.me.useQuery();
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

    return filtered;
  }, [conversations, agentFilter, isRestrictedRole, myTeamMemberId]);

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
          <div className="flex items-center gap-1.5">
            <Circle className={`h-2 w-2 ${connected ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"}`} />
            <span className="text-xs text-muted-foreground">{connected ? "Online" : "Offline"}</span>
          </div>
        </div>
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
              return (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-all h-auto ${
                    selectedId === conv.id
                      ? "bg-accent border border-primary/30"
                      : "hover:bg-accent/50 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
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

                      {/* Row 3: Agent (only if assigned) */}
                      {agentName && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <UserCheck className="h-3 w-3 text-blue-400 shrink-0" />
                          <span className="text-[10px] text-blue-400 font-medium truncate">{agentName}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
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
