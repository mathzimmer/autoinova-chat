import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Inbox from "./pages/Inbox";
import Dashboard from "./pages/Dashboard";
import Vehicles from "./pages/Vehicles";
import Leads from "./pages/Leads";
import Settings from "./pages/Settings";
import Team from "./pages/Team";
import TeamLogin from "./pages/TeamLogin";
import AppLayout from "./components/AppLayout";
import AiAudit from "./pages/AiAudit";
import MetaAdsPage from "./pages/MetaAds";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/inbox"}>
        <AppLayout>
          <Inbox />
        </AppLayout>
      </Route>
      <Route path={"/dashboard"}>
        <AppLayout>
          <Dashboard />
        </AppLayout>
      </Route>
      <Route path={"/vehicles"}>
        <AppLayout>
          <Vehicles />
        </AppLayout>
      </Route>
      <Route path={"/leads"}>
        <AppLayout>
          <Leads />
        </AppLayout>
      </Route>
      <Route path={"/team"}>
        <AppLayout>
          <Team />
        </AppLayout>
      </Route>
      <Route path={"/settings"}>
        <AppLayout>
          <Settings />
        </AppLayout>
      </Route>
      <Route path={"/ai-audit"}>
        <AppLayout>
          <AiAudit />
        </AppLayout>
      </Route>
      <Route path={"/meta-ads"}>
        <AppLayout>
          <MetaAdsPage />
        </AppLayout>
      </Route>
      <Route path="/team-login" component={TeamLogin} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
