import { trpc } from "@/lib/trpc";
import { useInboxSocket } from "@/hooks/useSocket";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Bot, User, MessageSquare, Circle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Props = {
  selectedId: number | null;
  onSelect: (id: number) => void;
};

export default function ConversationList({ selectedId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: conversations, refetch } = trpc.conversation.list.useQuery(
    { status: statusFilter, search: search || undefined },
    { refetchInterval: 10000 }
  );
  const { socket, connected } = useInboxSocket();

  useEffect(() => {
    if (!socket) return;
    const handler = () => { refetch(); };
    socket.on("conversation_updated", handler);
    return () => { socket.off("conversation_updated", handler); };
  }, [socket, refetch]);

  const statusTabs = [
    { value: "all", label: "Todas" },
    { value: "open", label: "Abertas" },
    { value: "pending", label: "Pendentes" },
    { value: "resolved", label: "Resolvidas" },
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

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {!conversations || conversations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nenhuma conversa encontrada</p>
            </div>
          ) : (
            conversations.map((conv) => (
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
                        {conv.lastMessagePreview || "Sem mensagens"}
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
                  </div>
                </div>
              </button>
            ))
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
