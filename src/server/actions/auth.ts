"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/server/supabase";

const credentialsSchema = z.object({
  email: z.string().trim().email("Digite um e-mail válido."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
});

export type AuthState =
  | { status: "idle" }
  | { status: "error"; message: string; email?: string }
  | { status: "confirm-email"; email: string };

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  email_address_invalid: "Este endereço de e-mail não é aceito. Use outro.",
  email_not_confirmed: "Confirme seu e-mail pelo link que enviamos antes de entrar.",
  user_already_exists: "Já existe uma conta com este e-mail. Entre com sua senha.",
  weak_password: "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.",
  over_email_send_rate_limit: "Muitos e-mails enviados em pouco tempo. Tente de novo em alguns minutos.",
  over_request_rate_limit: "Muitas tentativas em pouco tempo. Tente de novo em alguns minutos.",
};

const messageFor = (code: string | undefined) =>
  (code && AUTH_MESSAGES[code]) ?? "Não consegui concluir agora. Tente de novo em instantes.";

function parseCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message, email: String(formData.get("email") ?? "") };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: "error", message: messageFor(error.code), email: parsed.data.email };

  redirect("/");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message, email: String(formData.get("email") ?? "") };
  }

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { status: "error", message: messageFor(error.code), email: parsed.data.email };

  // Com confirmação de e-mail ligada, não há sessão até o link ser aberto.
  if (!data.session) return { status: "confirm-email", email: parsed.data.email };

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
