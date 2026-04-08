import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { Bot, MessageSquare, Zap, Shield, Car, ArrowRight, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect authenticated users to inbox
  useEffect(() => {
    if (isAuthenticated && !loading) {
      setLocation("/inbox");
    }
  }, [isAuthenticated, loading, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/5" />
        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-primary">Atendimento Inteligente com IA</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 leading-tight">
            Auto Inova - Matriz
            <span className="text-primary"> Chat</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Central de atendimento inteligente para sua concessionária. Agente de IA para pré-venda, qualificação de leads e gestão de conversas em tempo real.
          </p>
          <Button
            size="lg"
            className="gap-2 px-8"
            onClick={() => window.location.href = getLoginUrl()}
          >
            Acessar Painel <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <FeatureCard
            icon={<Bot className="h-6 w-6" />}
            title="Agente de IA"
            description="Atendimento automático de pré-venda com inteligência artificial"
          />
          <FeatureCard
            icon={<MessageSquare className="h-6 w-6" />}
            title="Chat em Tempo Real"
            description="Inbox com WebSocket para atualizações instantâneas"
          />
          <FeatureCard
            icon={<Zap className="h-6 w-6" />}
            title="Handoff Inteligente"
            description="Transição suave entre IA e atendente humano"
          />
          <FeatureCard
            icon={<Car className="h-6 w-6" />}
            title="Gestão de Estoque"
            description="Busca inteligente de veículos integrada ao atendimento"
          />
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-5 rounded-xl bg-card border border-border hover:border-primary/20 transition-colors">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-card-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
