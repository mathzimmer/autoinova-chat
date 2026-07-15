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
import Funnel from "./pages/Funnel";
import Settings from "./pages/Settings";
import Team from "./pages/Team";
import TeamLogin from "./pages/TeamLogin";
import AppLayout from "./components/AppLayout";
import AiAudit from "./pages/AiAudit";
import MetaAdsPage from "./pages/MetaAds";
import CampaignsPage from "./pages/Campaigns";
import RescuePage from "./pages/Rescue";
import ContactsPage from "./pages/Contacts";
import VendorApiKeys from "./pages/VendorApiKeys";
import Flows from "./pages/Flows";
import Agents from "./pages/Agents";
import Sellers from "./pages/Sellers";
import Performance from "./pages/Performance";
import EvolutionInstances from "./pages/EvolutionInstances";
import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";

/** Redireciona a tela antiga do inbox Evolution para o inbox unificado */
function RedirectToInbox() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const instance = params.get("instance");
    setLocation(instance ? `/inbox?instance=${encodeURIComponent(instance)}` : "/inbox");
  }, [searchString, setLocation]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/inbox"}>
        <AppLayout>
          <Inbox />
        </AppLayout>
      </Route>
      <Route path={"/funnel"}>
        <AppLayout>
          <Funnel />
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
      <Route path="/campaigns">
        <AppLayout>
          <CampaignsPage />
        </AppLayout>
      </Route>
      <Route path="/contacts">
        <AppLayout>
          <ContactsPage />
        </AppLayout>
      </Route>
      <Route path="/rescue">
        <AppLayout>
          <RescuePage />
        </AppLayout>
      </Route>
      <Route path="/vendor-keys">
        <AppLayout>
          <VendorApiKeys />
        </AppLayout>
      </Route>
      <Route path="/flows">
        <AppLayout>
          <Flows />
        </AppLayout>
      </Route>
      <Route path="/agents">
        <AppLayout>
          <Agents />
        </AppLayout>
      </Route>
      <Route path="/sellers">
        <AppLayout>
          <Sellers />
        </AppLayout>
      </Route>
      <Route path="/performance">
        <AppLayout>
          <Performance />
        </AppLayout>
      </Route>
      <Route path="/evolution-instances">
        <AppLayout>
          <EvolutionInstances />
        </AppLayout>
      </Route>
      {/* Tela antiga desativada — redireciona para o inbox unificado */}
      <Route path="/evolution-inbox">
        <RedirectToInbox />
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
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
