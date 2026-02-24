import { trpc } from "@/lib/trpc";
import { useInboxSocket } from "@/hooks/useSocket";
import { useEffect, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
        // Vendedores can see unassigned to pick up
        filtered = filtered.filter((c) => !c.assignedTo);
      } else if (agentFilter === "ai") {
        filtered = filtered.filter((c) => c.aiActive && !c.assignedTo);
      }
    } else {
      // Admin/gerente/owner can see all
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
    <div className="flex flex-col h-full bg-sidebar border-r border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
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

      {/* Status Tabs */}
      <div className="flex gap-1 p-2 px-4 border-b border-border">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
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
      <div className="flex gap-1 p-2 px-4 border-b border-border">
        {agentTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setAgentFilter(tab.value as any)}
            className={`px-2 py-1 text-[10px] rounded-md font-medium transition-colors flex items-center gap-1 ${
              agentFilter === tab.value
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent"
            }`}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
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
                  className={`w-full text-left p-3 rounded-lg mb-1 transition-all ${
                    selectedId === conv.id
                      ? "bg-accent border border-primary/30"
                      : "hover:bg-accent/50 border border-transparent"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative shrink-0">
                      <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                        <span className="text-sm font-medium text-secondary-foreground">
                          {(conv.contactName || conv.phone || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium text-foreground truncate">
                          {conv.contactName || conv.phone}
                        </span>
                        {conv.lastMessageAt && (
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                            {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false, locale: ptBR })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground truncate pr-2">
                          {(conv.lastMessagePreview || "Sem mensagens").replace(/\{?\[?(FOTO|IMAGEM|IMAGE|ID:\d+)\]?\}?/gi, "").trim() || "Sem mensagens"}
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {conv.unreadCount > 0 && (
                            <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center text-[10px] px-1.5 bg-primary text-primary-foreground">
                              {conv.unreadCount}
                            </Badge>
                          )}
                          <StatusDot status={conv.status} />
                        </div>
                      </div>
                      {/* Agent indicator */}
                      {agentName && (
                        <div className="flex items-center gap-1 mt-1">
                          <UserCheck className="h-3 w-3 text-blue-400" />
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
      </ScrollArea>
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
  return <div className={`h-2 w-2 rounded-full ${colors[status] || "bg-gray-500"}`} />;
}
