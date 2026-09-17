import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/supabase";

/** Id do usuário autenticado, validado pelo Supabase. Sem sessão, redireciona para o login. */
export async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}
