"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { hasQueue, inngest } from "@/inngest/client";
import { requireUserId } from "@/server/auth";
import { db, forUser } from "@/server/db";
import { confirmImport, formatFromName, processImportBatch, startImport, undoImport } from "@/server/services/import";
import { csvMappingSchema } from "@/server/services/import/types";
import { downloadAsUser } from "@/server/storage";
import type { ActionResult } from "./transactions";

const KNOWN = ["NotFoundError", "ImportError"];

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Error && KNOWN.includes(e.name)) return { ok: false, message: e.message };
  console.error(e);
  return { ok: false, message: "Não consegui concluir agora. Tente de novo em instantes." };
}

const revalidate = () => ["/", "/transacoes", "/contas", "/importar"].forEach((p) => revalidatePath(p));

const startSchema = z.object({
  accountId: z.string().min(1),
  storageKey: z.string().min(1),
  fileName: z.string().min(1).max(200),
});

/**
 * Cria o lote e responde na hora; o processamento vai para a fila (Inngest)
 * ou, sem fila configurada, roda depois da resposta no próprio servidor.
 */
export async function startImportAction(payload: unknown): Promise<ActionResult<{ batchId: string }>> {
  const userId = await requireUserId();
  const parsed = startSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Envio inválido." };
  const { accountId, storageKey, fileName } = parsed.data;
  if (!storageKey.startsWith(`${userId}/`)) return { ok: false, message: "Arquivo fora da sua pasta." };
  const format = formatFromName(fileName);
  if (!format || format === "XLSX") return { ok: false, message: "Importe OFX, CSV ou PDF." };

  try {
    const bytes = await downloadAsUser(storageKey);
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, storageKey, fileName, format, bytes }));
    if (hasQueue()) {
      await inngest.send({ name: "import/batch.created", data: { batchId: batch.id } });
    } else {
      after(async () => {
        try {
          await processImportBatch(batch.id, bytes);
        } catch (e) {
          console.error("processImportBatch", e);
        }
      });
    }
    revalidate();
    return { ok: true, data: { batchId: batch.id } };
  } catch (e) {
    return fail(e);
  }
}

/** CSV sem colunas reconhecidas: a pessoa mapeia e o lote é reprocessado. */
export async function applyCsvMappingAction(batchId: string, payload: unknown): Promise<ActionResult> {
  const userId = await requireUserId();
  const mapping = csvMappingSchema.safeParse(payload);
  if (!mapping.success) return { ok: false, message: "Mapeamento inválido." };
  try {
    const batch = await db.importBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) return { ok: false, message: "Lote não encontrado." };
    const bytes = await downloadAsUser(batch.storageKey);
    await processImportBatch(batch.id, bytes, mapping.data);
    // Lembra o mapeamento por conta para a próxima vez.
    const preferences = { ...(await currentPreferences(userId)), csvMappings: { ...(await currentMappings(userId)), [batch.accountId]: mapping.data } };
    await db.user.update({ where: { id: userId }, data: { preferences: preferences as Prisma.InputJsonObject } });
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

async function currentPreferences(userId: string): Promise<Record<string, unknown>> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  const prefs = user?.preferences;
  return prefs && typeof prefs === "object" && !Array.isArray(prefs) ? (prefs as Record<string, unknown>) : {};
}

async function currentMappings(userId: string): Promise<Record<string, unknown>> {
  const prefs = await currentPreferences(userId);
  const m = prefs.csvMappings;
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

const confirmSchema = z.object({
  batchId: z.string().min(1),
  accepted: z.array(z.object({ key: z.string().min(1), categoryId: z.string().min(1).nullable() })).min(1, "Selecione ao menos um lançamento."),
});

export async function confirmImportAction(payload: unknown): Promise<ActionResult<{ created: number }>> {
  const userId = await requireUserId();
  const parsed = confirmSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Seleção inválida." };
  try {
    const batch = await forUser(userId, (tx) => confirmImport(tx, userId, parsed.data.batchId, parsed.data.accepted));
    revalidate();
    return { ok: true, data: { created: batch.createdCount } };
  } catch (e) {
    return fail(e);
  }
}

export async function undoImportAction(batchId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await forUser(userId, (tx) => undoImport(tx, userId, batchId));
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteImportBatchAction(batchId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const batch = await db.importBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) return { ok: false, message: "Lote não encontrado." };
    if (batch.status === "CONFIRMED") return { ok: false, message: "Desfaça a importação antes de apagar o lote." };
    await forUser(userId, (tx) => tx.importBatch.delete({ where: { id: batchId } }));
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
