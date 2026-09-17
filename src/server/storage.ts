import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/server/supabase";

export const UPLOADS_BUCKET = process.env.STORAGE_BUCKET ?? "cifra-uploads";

/** Baixa um arquivo do bucket com a sessão do usuário (RLS garante que é dele). */
export async function downloadAsUser(storageKey: string): Promise<Uint8Array> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(UPLOADS_BUCKET).download(storageKey);
  if (error || !data) throw new Error(`Não consegui ler o arquivo enviado: ${error?.message ?? "vazio"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Para jobs sem sessão (fila). Exige SUPABASE_SERVICE_ROLE_KEY; nunca chega ao cliente. */
export async function downloadWithServiceRole(storageKey: string): Promise<Uint8Array> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente: a fila não consegue ler o storage.");
  const admin = createSupabaseClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false } });
  const { data, error } = await admin.storage.from(UPLOADS_BUCKET).download(storageKey);
  if (error || !data) throw new Error(`Não consegui ler o arquivo do storage: ${error?.message ?? "vazio"}`);
  return new Uint8Array(await data.arrayBuffer());
}
