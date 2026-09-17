import { createClient } from "./client";

export const UPLOADS_BUCKET = "cifra-uploads";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const safeName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-80);

/**
 * Envia o arquivo direto do navegador para a pasta do usuário no bucket privado.
 * A RLS do storage só aceita caminhos que começam com o próprio id.
 */
export async function uploadImportFile(file: File, userId: string): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Arquivo maior que 20 MB.");
  const key = `${userId}/imports/${crypto.randomUUID()}-${safeName(file.name)}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(UPLOADS_BUCKET).upload(key, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(`Falha no envio: ${error.message}`);
  return key;
}
