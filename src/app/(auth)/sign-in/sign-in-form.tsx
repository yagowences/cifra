"use client";

import { TriangleAlert } from "lucide-react";
import { useActionState, useState } from "react";
import { Botao } from "@/components/botao";
import { signIn, signUp, type AuthState } from "@/server/actions/auth";

type Mode = "entrar" | "criar";

const initial: AuthState = { status: "idle" };

export function SignInForm({ linkError }: { linkError: boolean }) {
  const [mode, setMode] = useState<Mode>("entrar");
  const [signInState, signInAction, signingIn] = useActionState(signIn, initial);
  const [signUpState, signUpAction, signingUp] = useActionState(signUp, initial);

  const state = mode === "entrar" ? signInState : signUpState;
  const pending = signingIn || signingUp;

  if (signUpState.status === "confirm-email" && mode === "criar") {
    return (
      <div className="mt-8 rounded-lg border border-border-subtle bg-surface-raised p-4" role="status">
        <p className="text-title">Confirme seu e-mail</p>
        <p className="mt-2 text-body text-ink-secondary">
          Enviamos um link para {signUpState.email}. Abra o link neste navegador para entrar.
        </p>
        <Botao className="mt-4 w-full" onClick={() => setMode("entrar")}>
          Voltar para entrar
        </Botao>
      </div>
    );
  }

  const error = state.status === "error" ? state.message : linkError ? "Este link expirou ou já foi usado. Entre com e-mail e senha." : null;
  const defaultEmail = state.status === "error" ? state.email : undefined;

  return (
    <form action={mode === "entrar" ? signInAction : signUpAction} className="mt-8 flex flex-col gap-4" noValidate>
      <Field label="E-mail" name="email" type="email" autoComplete="email" defaultValue={defaultEmail} />
      <Field
        label="Senha"
        name="password"
        type="password"
        autoComplete={mode === "entrar" ? "current-password" : "new-password"}
      />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md bg-negative-soft p-3 text-caption text-ink-primary">
          <TriangleAlert strokeWidth={1.5} className="mt-px size-4 shrink-0 text-negative" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <Botao type="submit" variant="primario" className="mt-2 w-full" carregando={pending}>
        {mode === "entrar" ? "Entrar" : "Criar conta"}
      </Botao>

      <Botao
        type="button"
        variant="sutil"
        className="w-full"
        onClick={() => setMode(mode === "entrar" ? "criar" : "entrar")}
      >
        {mode === "entrar" ? "Criar uma conta" : "Já tenho conta"}
      </Botao>
    </form>
  );
}

function Field({ label, name, ...input }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-caption text-ink-secondary">{label}</span>
      <input
        name={name}
        required
        className="h-11 rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary placeholder:text-ink-muted"
        {...input}
      />
    </label>
  );
}
