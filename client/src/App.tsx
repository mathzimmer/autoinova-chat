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
import AppLayout from "./components/AppLayout";

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
