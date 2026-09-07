import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Bot, Send, RotateCcw, Loader2, Wrench, Settings2, Save } from "lucide-react";
import { toast } from "sonner";

type Msg = {
  role: "user" | "assistant";
  content: string;
  images?: { url: string; caption: string }[];
  tools?: { name: string; args: any; resultSummary: string }[];
};

export default function AgentSandbox() {
  const [sessionId] = useState(() => `sim-${Date.now()}`);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const cfgQuery = trpc.agentV2.getConfig.useQuery();
  const [model, setModel] = useState("");
  const [persona, setPersona] = useState("");
  const [rules, setRules] = useState("");
  const [faq, setFaq] = useState("");
  const [temperature, setTemperature] = useState(0.5);
  useEffect(() => {
    if (cfgQuery.data) { setModel(cfgQuery.data.model); setPersona(cfgQuery.data.persona); setRules((cfgQuery.data as any).rules || ""); setFaq((cfgQuery.data as any).faq || ""); setTemperature(cfgQuery.data.temperature); }
  }, [cfgQuery.data]);

  const saveCfg = trpc.agentV2.setConfig.useMutation({
    onSuccess: () => { cfgQuery.refetch(); toast.success("Config salva."); },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  // Ferramentas (editar descrição + on/off, ao vivo)
  const toolsQuery = trpc.agentV2.getTools.useQuery();
  const [tools, setTools] = useState<{ name: string; enabled: boolean; description: string; defaultDescription: string }[]>([]);
  useEffect(() => { if (toolsQuery.data) setTools(toolsQuery.data as any); }, [toolsQuery.data]);
  const saveTools = trpc.agentV2.setTools.useMutation({
    onSuccess: () => { toolsQuery.refetch(); toast.success("Ferramentas atualizadas!"); },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const chat = trpc.agentV2.chat.useMutation();
  const resetM = trpc.agentV2.reset.useMutation();

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    try {
      const res = await chat.mutateAsync({ sessionId, message: text, history });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply, images: res.images, tools: res.toolTrace }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ " + (e?.message || "erro"), tools: [] }]);
    }
  };

  const clear = async () => {
    await resetM.mutateAsync({ sessionId }).catch(() => {});
    setMessages([]);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-primary/10"><Bot className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Simulador do Agente (novo)</h1>
            <p className="text-xs text-muted-foreground">Isolado do sistema · estoque real (só leitura) · não envia nada a clientes.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowConfig((v) => !v)}><Settings2 className="h-4 w-4 mr-1" /> Configurar</Button>
          <Button variant="outline" size="sm" onClick={clear}><RotateCcw className="h-4 w-4 mr-1" /> Nova conversa</Button>
        </div>
      </div>

      {/* Config */}
      {showConfig && (
        <Card className="m-4 mb-0 bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configuração do agente</CardTitle>
            <CardDescription>Modelo (OpenRouter, ex: <code>openai/gpt-4o-mini</code>, <code>anthropic/claude-3.5-sonnet</code>, <code>google/gemini-flash-1.5</code>), tom e criatividade.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Modelo</label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Temperatura ({temperature.toFixed(1)})</label>
                <input type="range" min={0} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-full accent-primary" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Persona / tom</label>
              <Textarea value={persona} onChange={(e) => setPersona(e.target.value)} rows={5} className="text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Regras de comportamento (quando transferir, mandar foto, o que perguntar...)</label>
              <Textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={7} className="text-xs font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">FAQ e contorno de objeções (dúvidas comuns + como responder quando o cliente objeta)</label>
              <Textarea value={faq} onChange={(e) => setFaq(e.target.value)} rows={7} className="text-xs" />
            </div>
            <div>
              <Button size="sm" disabled={saveCfg.isPending} onClick={() => saveCfg.mutate({ model: model.trim(), persona: persona.trim(), rules: rules.trim(), faq: faq.trim(), temperature })}>
                <Save className="h-3.5 w-3.5 mr-1" /> Salvar config
              </Button>
              <span className="ml-2 text-[11px] text-muted-foreground">Salvou → a próxima mensagem já usa. Sem deploy.</span>
            </div>

            {/* Ferramentas: editar descrição (quando usar) + ligar/desligar */}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center gap-2 mb-2">
                <Wrench className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Ferramentas</span>
                <span className="text-[11px] text-muted-foreground">edite a descrição (o agente usa isso pra decidir quando chamar) ou desligue</span>
              </div>
              <div className="grid gap-2">
                {tools.map((t, i) => (
                  <div key={t.name} className="p-2 rounded-md border border-border">
                    <label className="flex items-center gap-2 text-sm font-mono mb-1">
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={(e) => setTools((prev) => prev.map((x, k) => k === i ? { ...x, enabled: e.target.checked } : x))}
                        className="accent-primary"
                      />
                      {t.name}
                    </label>
                    <Textarea
                      value={t.description}
                      onChange={(e) => setTools((prev) => prev.map((x, k) => k === i ? { ...x, description: e.target.value } : x))}
                      rows={2}
                      className="text-xs"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <Button size="sm" variant="outline" disabled={saveTools.isPending} onClick={() => saveTools.mutate({ tools: tools.map((t) => ({ name: t.name, enabled: t.enabled, description: t.description.trim() })) })}>
                  <Save className="h-3.5 w-3.5 mr-1" /> Salvar ferramentas
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chat */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground mt-10">
            Comece a conversa como se fosse um cliente. Ex: “oi, quero um carro até 80 mil” ou “tem Corolla automático?”
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] space-y-2`}>
              <div className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"}`}>
                {m.content}
              </div>
              {m.images?.map((img, k) => (
                <div key={k} className="rounded-xl overflow-hidden border border-border max-w-[260px]">
                  <img src={img.url} alt="" className="w-full object-cover" />
                  {img.caption && <div className="px-2 py-1 text-xs bg-card whitespace-pre-wrap">{img.caption}</div>}
                </div>
              ))}
              {m.tools && m.tools.length > 0 && (
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  {m.tools.map((t, k) => (
                    <div key={k} className="flex items-start gap-1">
                      <Wrench className="h-3 w-3 mt-0.5 shrink-0" />
                      <span><b>{t.name}</b>({Object.keys(t.args || {}).length ? JSON.stringify(t.args) : ""}) → {t.resultSummary.slice(0, 120)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {chat.isPending && (
          <div className="flex justify-start"><div className="px-3 py-2 rounded-2xl bg-muted"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div></div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Escreva como um cliente..."
          rows={1}
          className="resize-none min-h-[40px] max-h-32"
        />
        <Button onClick={send} disabled={chat.isPending || !input.trim()}><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
