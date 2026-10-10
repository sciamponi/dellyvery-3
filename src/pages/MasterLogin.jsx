import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { signInWithPassword } from "@/api/supabaseAuth";
import { useSupabaseAuth } from "@/lib/SupabaseAuthContext";
import { resolveMasterIdentifier, masterAuthMessage } from "@/lib/masterAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Mail, Lock, Loader2, Eye, EyeOff } from "lucide-react";

// Área Administrativa — login dedicado (compacto). Não reutiliza AuthLayout
// propositalmente: cartão menor, menos espaçamento, hierarquia própria.
export default function MasterLogin({ returnTo = "/master/planos" }) {
  const navigate = useNavigate();
  const { refresh: refreshSb } = useSupabaseAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const email = resolveMasterIdentifier(identifier);
    if (!email) {
      setError("Informe seu e-mail ou usuário administrativo.");
      return;
    }
    setLoading(true);
    try {
      await signInWithPassword(supabase, { email, password });
      await refreshSb();
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(masterAuthMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-xs">
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary mb-2">
            <span className="font-heading text-lg font-bold text-primary-foreground">D</span>
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Dellyvery</p>
          <h1 className="text-lg font-bold text-foreground mt-1 flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary" /> Área Administrativa
          </h1>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-5">
          {error && (
            <div className="mb-3 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="master-email" className="text-xs">E-mail ou usuário</Label>
              <div className="relative">
                <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="master-email"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  placeholder="voce@empresa.com ou usuário"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="pl-8 h-9 text-sm"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="master-password" className="text-xs">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="master-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-8 pr-8 h-9 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <Button type="submit" size="sm" className="w-full font-medium" disabled={loading}>
              {loading ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Entrando...</>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>
        </div>
        <p className="text-center text-[11px] text-muted-foreground mt-3">
          Acesso restrito à administração da plataforma.
        </p>
      </div>
    </div>
  );
}
