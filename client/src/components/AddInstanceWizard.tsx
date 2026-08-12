import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Smartphone, QrCode, Building2, MessageSquare, ArrowLeft, Loader2, CheckCircle2, ChevronRight,
} from "lucide-react";

// Mesmos IDs usados no Cadastro Incorporado da tela de Configurações.
const META_APP_ID = "1168218527728605";
const META_CONFIG_ID = "1294053642801963";

type InstanceType = "oficial" | "coexistencia" | "evolution" | "zernio";

const TYPES: { id: InstanceType; title: string; desc: string; icon: any; badge: string }[] = [
  { id: "coexistencia", title: "Coexistência", desc: "Número que segue no app WhatsApp Business + API oficial. Cadastro incorporado (1 clique).", icon: MessageSquare, badge: "Recomendado" },
  { id: "oficial", title: "API Oficial", desc: "Número dedicado à Cloud API da Meta. Você informa o Phone Number ID e a WABA.", icon: Building2, badge: "Cloud API" },
  { id: "evolution", title: "Evolution", desc: "Número via WhatsApp Web (QR code). Sem janela de 24h — ideal para automações.", icon: QrCode, badge: "QR" },
  { id: "zernio", title: "Zernio", desc: "Número já conectado na sua conta Zernio. Escolha a conta para vincular.", icon: Smartphone, badge: "Zernio" },
];

export default function AddInstanceWizard({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [type, setType] = useState<InstanceType | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => { if (!open) setType(null); }, [open]);

  const invalidateAll = () => {
    utils.evolution.listInstances.invalidate();
    utils.whatsappNumber.listInstances.invalidate();
    utils.zernio.listInstances.invalidate();
  };
  const close = () => { setType(null); onOpenChange(false); };
  const done = () => { invalidateAll(); close(); };

  const active = type ? TYPES.find(t => t.id === type) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type && (
              <button onClick={() => setType(null)} className="text-muted-foreground hover:text-foreground" title="Voltar">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {active ? active.title : "Adicionar instância"}
          </DialogTitle>
          <DialogDescription>
            {active ? active.desc : "Escolha o tipo de conexão. Cada instância é independente, com inbox, IA, fluxos e modelos próprios."}
          </DialogDescription>
        </DialogHeader>

        {!type && (
          <div className="grid gap-2">
            {TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <t.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.title}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t.badge}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}

        {type === "oficial" && <OficialForm onDone={done} />}
        {type === "coexistencia" && <CoexForm onDone={invalidateAll} onClose={close} />}
        {type === "evolution" && <EvolutionForm onDone={invalidateAll} onClose={close} />}
        {type === "zernio" && <ZernioForm onDone={done} />}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── API Oficial ───────────────────────────
function OficialForm({ onDone }: { onDone: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");

  const create = trpc.whatsappNumber.createInstance.useMutation({
    onSuccess: () => { toast.success("Número oficial cadastrado!"); onDone(); },
    onError: (e) => toast.error("Erro ao cadastrar: " + e.message),
  });

  const valid = phoneNumberId.trim().length >= 4 && displayName.trim().length >= 1;

  return (
    <div className="grid gap-3">
      <Field label="Phone Number ID *" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="ex.: 1313769041810789" mono />
      <Field label="WhatsApp Business Account ID (WABA)" value={wabaId} onChange={setWabaId} placeholder="ex.: 1288621130010474" mono />
      <Field label="Nome de exibição *" value={displayName} onChange={setDisplayName} placeholder="ex.: Auto Inova - Vendas" />
      <Field label="Telefone (visível)" value={phoneDisplay} onChange={setPhoneDisplay} placeholder="ex.: +55 51 3191-9081" />
      <Field label="Token (opcional)" value={accessToken} onChange={setAccessToken} placeholder="Deixe vazio para usar o token global" mono />
      <p className="text-[11px] text-muted-foreground">
        Sem token, usa o System User global. A WABA precisa estar acessível a esse token.
      </p>
      <DialogFooter>
        <Button
          disabled={!valid || create.isPending}
          onClick={() => create.mutate({
            phoneNumberId: phoneNumberId.trim(),
            displayName: displayName.trim(),
            phoneDisplay: phoneDisplay.trim() || undefined,
            wabaId: wabaId.trim() || undefined,
            accessToken: accessToken.trim() || undefined,
          })}
        >
          {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Cadastrar número
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─────────────────────────── Coexistência (Embedded Signup) ───────────────────────────
function CoexForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const connect = trpc.whatsappNumber.connectFromSignup.useMutation({
    onSuccess: (res: any) => {
      setSaved(true);
      if (res?.subscribed === false) {
        toast.warning("Número salvo, mas a assinatura do webhook falhou: " + (res?.subscribeError || "verifique o token do provedor"));
      } else {
        toast.success("Número conectado e ativo no inbox!");
      }
      onDone();
    },
    onError: (err: any) => toast.error("Falha ao salvar número: " + err.message),
  });

  // Carrega o SDK do Facebook (robusto: init por fbAsyncInit e por onload)
  useEffect(() => {
    let disposed = false;
    const w = window as any;
    const markReady = () => {
      if (disposed || !w.FB) return;
      try { w.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: true, version: "v25.0" }); } catch { /* já iniciado */ }
      setSdkReady(true); setSdkError(null);
    };
    if (w.FB) { markReady(); return; }
    w.fbAsyncInit = markReady;
    let script = document.getElementById("fb-sdk") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "fb-sdk";
      script.src = "https://connect.facebook.net/pt_BR/sdk.js";
      script.async = true; script.crossOrigin = "anonymous";
      script.onload = markReady;
      script.onerror = () => setSdkError("blocked");
      document.body.appendChild(script);
    } else {
      script.addEventListener("load", markReady);
    }
    const timer = setTimeout(() => { if (!disposed && !w.FB) setSdkError("timeout"); }, 8000);
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  // Escuta o retorno do popup da Meta
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
          const wabaId = data.data?.waba_id;
          const phoneNumberId = data.data?.phone_number_id;
          if (wabaId && phoneNumberId) connect.mutate({ wabaId, phoneNumberId });
        }
        if (data.event === "CANCEL" || data.event === "ERROR") {
          setLoading(false);
          toast.error("Fluxo cancelado ou erro: " + (data.data?.error_message || data.event));
        }
      } catch { /* ignora mensagens não-JSON */ }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const launch = () => {
    const w = window as any;
    if (!w.FB) { toast.error("Facebook SDK ainda carregando, aguarde..."); return; }
    setLoading(true);
    w.FB.login(
      (response: any) => { if (!response?.authResponse?.code) toast.error("Fluxo cancelado ou sem autorização."); setLoading(false); },
      {
        config_id: META_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3", version: "v4" },
      },
    );
  };

  if (saved) {
    return (
      <div className="grid gap-3 py-2">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">Número conectado!</span>
        </div>
        <p className="text-xs text-muted-foreground">Ele já aparece como instância própria no inbox.</p>
        <DialogFooter><Button onClick={onClose}>Concluir</Button></DialogFooter>
      </div>
    );
  }

  return (
    <div className="grid gap-3 py-1">
      <p className="text-xs text-muted-foreground">
        Conecte pelo Cadastro Incorporado da Meta. A WABA é assinada no app (recebimento) e o número é
        salvo automaticamente — sem colar token por número.
      </p>
      {sdkError && (
        <p className="text-xs text-red-500">
          Não foi possível carregar o SDK do Facebook ({sdkError === "blocked" ? "bloqueado pelo navegador" : "tempo esgotado"}).
          Desative bloqueadores de anúncio/rastreamento e tente novamente.
        </p>
      )}
      <DialogFooter>
        <Button onClick={launch} disabled={!sdkReady || loading || connect.isPending}>
          {(loading || connect.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {sdkReady ? "Conectar com a Meta" : "Carregando SDK..."}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─────────────────────────── Evolution (QR) ───────────────────────────
function EvolutionForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [instanceName, setInstanceName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  const create = trpc.evolution.createInstance.useMutation({
    onSuccess: (data: any) => {
      setCreatedName(data?.instanceName || instanceName);
      onDone();
      if (data?.qrCode) { setQr(data.qrCode); toast.success("Instância criada! Escaneie o QR code."); }
      else { toast.success("Instância criada!"); }
    },
    onError: (e) => toast.error("Erro ao criar instância: " + e.message),
  });

  // Enquanto o QR está aberto, verifica o status para fechar ao conectar.
  const status = trpc.evolution.getStatus.useQuery(
    { instanceName: createdName || "" },
    { enabled: !!createdName && !!qr, refetchInterval: 5000 },
  );
  useEffect(() => {
    if (status.data && (status.data as any).status === "connected") {
      toast.success("Número conectado!");
      onDone();
      onClose();
    }
  }, [status.data]);

  const valid = instanceName.trim().length >= 2;

  if (qr) {
    return (
      <div className="grid gap-3 py-1 text-center">
        <p className="text-xs text-muted-foreground">
          Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho, e escaneie:
        </p>
        <img src={qr} alt="QR code" className="mx-auto h-56 w-56 rounded-lg border border-border bg-white" />
        <p className="text-[11px] text-muted-foreground">A janela fecha sozinha quando conectar.</p>
        <DialogFooter><Button variant="outline" onClick={onClose}>Fechar</Button></DialogFooter>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <Field label="Identificador da instância *" value={instanceName} onChange={setInstanceName} placeholder="ex.: vendas-interno (sem espaços)" mono />
      <Field label="Nome de exibição" value={displayName} onChange={setDisplayName} placeholder="ex.: Vendas Interno" />
      <DialogFooter>
        <Button
          disabled={!valid || create.isPending}
          onClick={() => create.mutate({ instanceName: instanceName.trim(), displayName: displayName.trim() || undefined })}
        >
          {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Criar e gerar QR
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─────────────────────────── Zernio ───────────────────────────
function ZernioForm({ onDone }: { onDone: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [load, setLoad] = useState(false);

  const accounts = trpc.zernio.availableAccounts.useQuery(
    apiKey ? { apiKey } : undefined,
    { enabled: load },
  );
  const create = trpc.zernio.createInstance.useMutation({
    onSuccess: () => { toast.success("Instância Zernio cadastrada!"); onDone(); },
    onError: (e) => toast.error("Erro ao cadastrar Zernio: " + e.message),
  });

  return (
    <div className="grid gap-3">
      <Field label="API Key (opcional se já estiver no .env)" value={apiKey} onChange={setApiKey} placeholder="Chave da sua conta Zernio" mono />
      {!load && (
        <DialogFooter>
          <Button onClick={() => setLoad(true)}>Carregar contas</Button>
        </DialogFooter>
      )}
      {load && accounts.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando contas...
        </div>
      )}
      {load && accounts.data && accounts.data.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">Nenhuma conta WhatsApp encontrada nessa Zernio.</p>
      )}
      {load && accounts.data && accounts.data.length > 0 && (
        <div className="grid gap-2 max-h-64 overflow-y-auto">
          {accounts.data.map((a: any) => (
            <button
              key={a.accountId}
              disabled={create.isPending}
              onClick={() => create.mutate({ accountId: a.accountId, displayName: a.displayName || undefined, phone: a.phone || undefined, apiKey: apiKey || undefined })}
              className="flex items-center gap-3 rounded-lg border border-border p-2.5 text-left hover:bg-muted/50 disabled:opacity-50"
            >
              <Smartphone className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{a.displayName || a.phone || a.accountId}</p>
                {a.phone && <p className="text-xs text-muted-foreground truncate">{a.phone}</p>}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── util ───────────────────────────
function Field({
  label, value, onChange, placeholder, mono,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={mono ? "font-mono text-xs" : ""} />
    </div>
  );
}
