import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import ConversationList from "@/components/ConversationList";
import ChatView from "@/components/ChatView";
import ConversationPanel from "@/components/ConversationPanel";
import { MessageSquare, PanelRightOpen, PanelRightClose, Building2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSearch } from "wouter";

/**
 * Inbox unificado — uma única caixa de entrada.
 * Seletor de fonte no topo: Matriz (Cloud API oficial) + instâncias Evolution (vendedores).
 */
export default function Inbox() {
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  // "matriz" = WhatsApp oficial (Cloud API + Instagram/Facebook); ou nome da instância Evolution
  const [source, setSource] = useState<string>("matriz");
  const searchString = useSearch();

  const { data: instances } = trpc.evolution.listInstances.useQuery(undefined, {
    refetchInterval: 30000,
  });
  // Contas Zernio (coexistência oficial) — cada uma é uma aba/instância separada
  const { data: zernioInstances } = trpc.zernio.listInstances.useQuery(undefined, {
    refetchInterval: 60000,
  });

  // Auto-select conversation (?conv=123) ou instância (?instance=nome) via URL
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const convId = params.get("conv");
    const instanceParam = params.get("instance");
    if (convId) {
      const id = parseInt(convId, 10);
      if (!isNaN(id) && id > 0) {
        setSource("matriz");
        setSelectedConversationId(id);
      }
    } else if (instanceParam) {
      setSource(instanceParam);
      setSelectedConversationId(null);
    }
  }, [searchString]);

  const statusDot = (status: string) => (
    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
      status === "connected" ? "bg-green-400" : status === "connecting" || status === "qr_code" ? "bg-yellow-400" : "bg-red-400"
    }`} />
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Seletor de fonte (instância) ── */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-border bg-sidebar overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <button
          onClick={() => { setSource("matriz"); setSelectedConversationId(null); }}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
            source === "matriz"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          <Building2 className="h-3 w-3" />
          Matriz (oficial)
        </button>
        {(instances || []).map((inst: any) => (
          <button
            key={inst.id}
            onClick={() => { setSource(inst.instanceName); setSelectedConversationId(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
              source === inst.instanceName
                ? "bg-green-600 text-white"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
            title={inst.status === "connected" ? "Conectada" : "Desconectada"}
          >
            {statusDot(inst.status)}
            <Smartphone className="h-3 w-3" />
            {inst.displayName || inst.instanceName}
          </button>
        ))}
        {(zernioInstances || []).map((inst: any) => (
          <button
            key={inst.instanceName}
            onClick={() => { setSource(inst.instanceName); setSelectedConversationId(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
              source === inst.instanceName
                ? "bg-blue-600 text-white"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
            title={`Zernio (coexistência) — ${inst.phone || ""}`}
          >
            {statusDot(inst.status)}
            <MessageSquare className="h-3 w-3" />
            {inst.displayName || inst.phone || "Zernio"}
          </button>
        ))}
      </div>

      {/* ── Conteúdo da fonte selecionada (mesmo formato para matriz e Evolution) ── */}
      {(
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left: Conversation List */}
          <div className={`w-80 shrink-0 ${selectedConversationId ? "hidden lg:flex lg:flex-col" : "flex flex-col w-full lg:w-80"}`}>
            <ConversationList
              selectedId={selectedConversationId}
              onSelect={(id) => setSelectedConversationId(id)}
              instance={source}
            />
          </div>

          {/* Center: Chat */}
          <div className={`flex-1 min-w-0 ${!selectedConversationId ? "hidden lg:flex" : "flex"} flex-col h-full`}>
            {selectedConversationId ? (
              <div className="flex flex-col h-full">
                <ChatView
                  conversationId={selectedConversationId}
                  onBack={() => setSelectedConversationId(null)}
                  panelToggle={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPanel(!showPanel)}
                      className={`h-8 w-8 shrink-0 ${showPanel ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      title={showPanel ? "Fechar painel" : "Abrir painel de controle"}
                    >
                      {showPanel ? (
                        <PanelRightClose className="h-4 w-4" />
                      ) : (
                        <PanelRightOpen className="h-4 w-4" />
                      )}
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-background">
                <div className="text-center">
                  <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="h-10 w-10 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground mb-2">Auto Inova - Matriz Chat</h2>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Selecione uma conversa para visualizar as mensagens e gerenciar o atendimento.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right: Control Panel - Collapsible */}
          {selectedConversationId && showPanel && (
            <div className="w-80 shrink-0 border-l border-border animate-in slide-in-from-right duration-200">
              <ConversationPanel conversationId={selectedConversationId} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
