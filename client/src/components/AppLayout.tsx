import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageSquare, LayoutDashboard, Car, Users, LogOut, Bot, Loader2, Settings, UsersRound, Brain, Megaphone, Zap, Key, Sun, Moon, GitBranch } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

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
  { icon: Zap, label: "Follow-Up", path: "/follow-up", allowedCargos: ["admin", "gerente"] },
  { icon: GitBranch, label: "Fluxos", path: "/flows", allowedCargos: ["admin", "gerente"] },
  { icon: Brain, label: "Auditoria IA", path: "/ai-audit", allowedCargos: ["admin"] },
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

  const teamMember = teamMeQuery.data?.teamMember;
  const isTeamMember = teamMeQuery.data?.isTeamMember ?? false;

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
          <h2 className="text-xl font-semibold text-foreground mb-2">Auto Inova Chat</h2>
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
