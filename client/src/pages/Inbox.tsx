import { useState } from "react";
import ConversationList from "@/components/ConversationList";
import ChatView from "@/components/ChatView";
import ConversationPanel from "@/components/ConversationPanel";
import { MessageSquare } from "lucide-react";

export default function Inbox() {
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [showPanel, setShowPanel] = useState(true);

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
      <div className={`flex-1 ${!selectedConversationId ? "hidden lg:flex" : "flex"} flex-col`}>
        {selectedConversationId ? (
          <ChatView
            conversationId={selectedConversationId}
            onBack={() => setSelectedConversationId(null)}
          />
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

      {/* Right: Control Panel */}
      {selectedConversationId && showPanel && (
        <div className="w-72 shrink-0 hidden xl:block">
          <ConversationPanel conversationId={selectedConversationId} />
        </div>
      )}
    </div>
  );
}
