import { useState, useEffect } from "react";
import ConversationList from "@/components/ConversationList";
import ChatView from "@/components/ChatView";
import ConversationPanel from "@/components/ConversationPanel";
import { MessageSquare, PanelRightOpen, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSearch } from "wouter";

export default function Inbox() {
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const searchString = useSearch();

  // Auto-select conversation from URL param ?conv=123
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const convId = params.get("conv");
    if (convId) {
      const id = parseInt(convId, 10);
      if (!isNaN(id) && id > 0) {
        setSelectedConversationId(id);
      }
    }
  }, [searchString]);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Conversation List */}
      <div className={`w-80 shrink-0 ${selectedConversationId ? "hidden lg:flex lg:flex-col" : "flex flex-col w-full lg:w-80"}`}>
        <ConversationList
          selectedId={selectedConversationId}
          onSelect={(id) => setSelectedConversationId(id)}
        />
      </div>

      {/* Center: Chat */}
      <div className={`flex-1 min-w-0 ${!selectedConversationId ? "hidden lg:flex" : "flex"} flex-col h-full`}>
        {selectedConversationId ? (
          <div className="flex flex-col h-full">
            {/* Chat area with toggle button in header */}
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
              <h2 className="text-lg font-semibold text-foreground mb-2">Auto Inova Chat</h2>
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
  );
}
