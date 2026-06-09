import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageSquare, LayoutDashboard, Car, Users, LogOut, Bot, Loader2, Settings, UsersRound, Brain, Megaphone, Send, Key, Sun, Moon, GitBranch, Power, BotOff, Cpu, UserCheck, LifeBuoy, BookUser, Smartphone, Inbox } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

type NavItem = {
  icon: typeof MessageSquare;
  label: string;
  path: string;
  /** Which cargos can see this item. undefined = all users */
  allowedCargos?: string[];
};

const navItems: NavItem[] = [
  { icon: MessageSquare, label: "Inbox", path: "/inbox" },
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", allowedCargos: ["admin", "gerente"] },
  { icon: Car, label: "Veículos", path: "/vehicles", allowedCargos: ["admin", "gerente"] },
  { icon: Users, label: "Leads", path: "/leads" },
  { icon: UsersRound, label: "Equipe", path: "/team", allowedCargos: ["admin", "gerente"] },
  { icon: Megaphone, label: "Meta Ads", path: "/meta-ads", allowedCargos: ["admin", "gerente"] },
  { icon: Send, label: "Campanhas", path: "/campaigns", allowedCargos: ["admin", "gerente"] },
  { icon: LifeBuoy, label: "Resgate", path: "/rescue", allowedCargos: ["admin", "gerente"] },
  { icon: BookUser, label: "Contatos", path: "/contacts", allowedCargos: ["admin", "gerente"] },
  { icon: GitBranch, label: "Fluxos", path: "/flows", allowedCargos: ["admin", "gerente"] },
  { icon: UserCheck, label: "Vendedores", path: "/sellers", allowedCargos: ["admin", "gerente"] },
  { icon: Cpu, label: "Agentes IA", path: "/agents", allowedCargos: ["admin"] },
  { icon: Brain, label: "Auditoria IA", path: "/ai-audit", allowedCargos: ["admin"] },
  { icon: Inbox, label: "Inbox Vendedores", path: "/evolution-inbox", allowedCargos: ["admin", "gerente", "vendedor"] },
  { icon: Key, label: "API Keys", path: "/vendor-keys", allowedCargos: ["admin"] },
  { icon: Settings, label: "Configurações", path: "/settings", allowedCargos: ["admin"] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { theme, toggleTheme, switchable } = useTheme();


  // Check if this is a team member
  const teamMeQuery = trpc.teamAuth.me.useQuery(undefined, {
    enabled: !!user,
  });

  // Global AI & Flows status
  const globalStatus = trpc.settings.getGlobalStatus.useQuery(undefined, {
    enabled: !!user,
  });
  const setGlobalAI = trpc.settings.setGlobalAI.useMutation({
    onSuccess: (data) => {
      globalStatus.refetch();
      toast.success(data.enabled ? "Robô IA Ativado" : "Robô IA Desativado", {
        description: data.enabled
          ? "O robô voltou a responder em todas as conversas."
          : "O robô parou de responder em todas as conversas.",
      });
    },
  });
  const setGlobalFlows = trpc.settings.setGlobalFlows.useMutation({
    onSuccess: (data) => {
      globalStatus.refetch();
      toast.success(data.enabled ? "Fluxos Ativados" : "Fluxos Desativados", {
        description: data.enabled
          ? "Os fluxos programados voltaram a funcionar."
          : "Todos os fluxos foram pausados em todas as conversas.",
      });
    },
  });

  const aiEnabled = globalStatus.data?.aiEnabled ?? true;
  const flowsEnabled = globalStatus.data?.flowsEnabled ?? true;
  const allActive = aiEnabled && flowsEnabled;
  const allInactive = !aiEnabled && !flowsEnabled;

  const teamMember = teamMeQuery.data?.teamMember;
  const isTeamMember = teamMeQuery.data?.isTeamMember ?? false;
  const isAdmin = !isTeamMember || teamMember?.cargo === "admin";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-sm">
          <Bot className="h-12 w-12 text-primary mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Auto Inova - Matriz Chat</h2>
          <p className="text-sm text-muted-foreground mb-6">Faça login para acessar o painel de atendimento.</p>
          <div className="space-y-3">
            <Button onClick={() => window.location.href = getLoginUrl()} size="lg" className="w-full">
              Entrar (Admin)
            </Button>
            <Button onClick={() => setLocation("/team-login")} variant="outline" size="lg" className="w-full">
              Login da Equipe
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Filter nav items based on team member cargo
  const visibleNavItems = navItems.filter((item) => {
    // Owner (non-team member) sees everything
    if (!isTeamMember) return true;
    // Team member: check allowed cargos
    if (!item.allowedCargos) return true;
    return teamMember ? item.allowedCargos.includes(teamMember.cargo) : false;
  });

  const displayName = isTeamMember && teamMember ? teamMember.name : (user?.name || "Usuário");
  const displayEmail = isTeamMember && teamMember ? teamMember.email : (user?.email || "");
  const cargoLabel = isTeamMember && teamMember ? teamMember.cargo.charAt(0).toUpperCase() + teamMember.cargo.slice(1) : "Admin";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Compact Sidebar */}
      <nav className="w-16 shrink-0 flex flex-col items-center py-4 bg-sidebar border-r border-border">
        {/* Logo */}
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
          <Bot className="h-5 w-5 text-primary" />
        </div>

        {/* Nav Items */}
        <div className="flex-1 flex flex-col gap-1">
          {visibleNavItems.map((item) => {
            const isActive = location === item.path;
            return (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setLocation(item.path)}
                    className={`h-10 w-10 rounded-lg flex items-center justify-center transition-all ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Global AI/Flows Power Button - Admin only */}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`h-10 w-10 rounded-lg flex items-center justify-center transition-all mb-2 relative ${
                  allActive
                    ? "text-emerald-400 hover:bg-emerald-500/10"
                    : allInactive
                      ? "text-red-400 hover:bg-red-500/10"
                      : "text-amber-400 hover:bg-amber-500/10"
                }`}
                title={allActive ? "Rob\u00f4 e Fluxos: Ativos" : allInactive ? "Rob\u00f4 e Fluxos: Inativos" : "Parcialmente ativo"}
              >
                <Power className="h-5 w-5" />
                {/* Status dot */}
                <span className={`absolute top-1 right-1 h-2 w-2 rounded-full ${
                  allActive ? "bg-emerald-400" : allInactive ? "bg-red-400" : "bg-amber-400"
                }`} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56">
              <div className="px-2 py-1.5 border-b border-border mb-1">
                <p className="text-sm font-semibold text-foreground">Controle Global</p>
                <p className="text-xs text-muted-foreground">Ativar/desativar em todas as conversas</p>
              </div>

              {/* AI Toggle */}
              <DropdownMenuItem
                onClick={() => setGlobalAI.mutate({ enabled: !aiEnabled })}
                disabled={setGlobalAI.isPending}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  <Bot className={`h-4 w-4 ${aiEnabled ? "text-emerald-400" : "text-red-400"}`} />
                  <span className="flex-1">Robô IA</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    aiEnabled
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-red-500/15 text-red-400"
                  }`}>
                    {aiEnabled ? "ON" : "OFF"}
                  </span>
                </div>
              </DropdownMenuItem>

              {/* Flows Toggle */}
              <DropdownMenuItem
                onClick={() => setGlobalFlows.mutate({ enabled: !flowsEnabled })}
                disabled={setGlobalFlows.isPending}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  <GitBranch className={`h-4 w-4 ${flowsEnabled ? "text-emerald-400" : "text-red-400"}`} />
                  <span className="flex-1">Fluxos</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    flowsEnabled
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-red-500/15 text-red-400"
                  }`}>
                    {flowsEnabled ? "ON" : "OFF"}
                  </span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {/* Quick toggle all */}
              <DropdownMenuItem
                onClick={() => {
                  if (allActive) {
                    setGlobalAI.mutate({ enabled: false });
                    setGlobalFlows.mutate({ enabled: false });
                  } else {
                    setGlobalAI.mutate({ enabled: true });
                    setGlobalFlows.mutate({ enabled: true });
                  }
                }}
                disabled={setGlobalAI.isPending || setGlobalFlows.isPending}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  {allActive ? (
                    <BotOff className="h-4 w-4 text-red-400" />
                  ) : (
                    <Power className="h-4 w-4 text-emerald-400" />
                  )}
                  <span className="flex-1 font-medium">
                    {allActive ? "Desativar Tudo" : "Ativar Tudo"}
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Theme Toggle */}
        {switchable && toggleTheme && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleTheme}
                className="h-10 w-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-2"
              >
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {theme === "dark" ? "Tema Claro" : "Tema Escuro"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-10 w-10 rounded-lg flex items-center justify-center hover:bg-accent transition-colors">
              <Avatar className="h-8 w-8 border border-border">
                <AvatarFallback className="text-xs font-medium bg-secondary text-secondary-foreground">
                  {displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-48">
            <div className="px-2 py-1.5 border-b border-border mb-1">
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{displayEmail}</p>
              <p className="text-xs text-primary mt-0.5">{cargoLabel}</p>
            </div>
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
