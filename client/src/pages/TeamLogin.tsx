import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Loader2, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function TeamLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();

  // 2FA: quando o login exige código, guardamos o desafio e trocamos de etapa.
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [code, setCode] = useState("");

  const loginMutation = trpc.teamAuth.login.useMutation({
    onSuccess: (res: any) => {
      if (res?.otpRequired) {
        setChallengeId(res.challengeId);
        setError("");
        return;
      }
      window.location.href = "/inbox";
    },
    onError: (err) => {
      setError(err.message || "Email ou senha inválidos");
    },
  });

  const verifyMutation = trpc.teamAuth.verifyOtp.useMutation({
    onSuccess: () => {
      window.location.href = "/inbox";
    },
    onError: (err) => setError(err.message || "Código incorreto"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Preencha todos os campos");
      return;
    }
    loginMutation.mutate({ email, password });
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!challengeId || code.trim().length < 4) {
      setError("Digite o código recebido no WhatsApp");
      return;
    }
    verifyMutation.mutate({ challengeId, code: code.trim() });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Auto Inova - Matriz Chat</CardTitle>
          <CardDescription>
            {challengeId ? "Verificação em duas etapas" : "Login da equipe de atendimento"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3 mb-4">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {!challengeId ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  "Entrar"
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Um código de 6 dígitos foi enviado ao administrador responsável. Peça o código a ele e digite abaixo.
              </p>
              <div className="space-y-2">
                <Label htmlFor="code">Código de acesso</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoFocus
                  placeholder="______"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-lg tracking-[0.5em]"
                />
              </div>
              <Button type="submit" className="w-full" disabled={verifyMutation.isPending}>
                {verifyMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  "Verificar e entrar"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => { setChallengeId(null); setCode(""); setError(""); }}
                disabled={verifyMutation.isPending}
              >
                Voltar
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
