import { useSearch, useLocation } from "wouter";
import { Cpu, GitBranch, BookOpen, BrainCircuit } from "lucide-react";
import Agents from "./Agents";
import Flows from "./Flows";
import KnowledgeBase from "./KnowledgeBase";
import CrmAiSettings from "./CrmAiSettings";

type TabKey = "agents" | "flows" | "knowledge" | "crm_ai";

const TABS: { key: TabKey; label: string; icon: typeof Cpu }[] = [
  { key: "agents", label: "Agentes de IA", icon: Cpu },
  { key: "flows", label: "Fluxos", icon: GitBranch },
  { key: "knowledge", label: "Base de conhecimento", icon: BookOpen },
  { key: "crm_ai", label: "Parametrização CRM", icon: BrainCircuit },
];

export default function Automation() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const active = (params.get("tab") as TabKey) || "agents";

  const setTab = (t: TabKey) => setLocation(`/automation?tab=${t}`);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-card/50 px-4 pt-3 shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const isActive = active === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {active === "agents" && <Agents />}
        {active === "flows" && <Flows />}
        {active === "knowledge" && <KnowledgeBase />}
        {active === "crm_ai" && <CrmAiSettings />}
      </div>
    </div>
  );
}
