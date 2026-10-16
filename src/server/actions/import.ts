"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/ai/models";
import { hasQueue, inngest } from "@/inngest/client";
import { requireUserId } from "@/server/auth";
import { db, forUser } from "@/server/db";
import { confirmImport, formatFromName, processImportBatch, startImport, undoImport } from "@/server/services/import";
import { csvMappingSchema, isStaleProcessing } from "@/server/services/import/types";
import { downloadAsUser } from "@/server/storage";
import type { ActionResult } from "./transactions";

const KNOWN = ["NotFoundError", "ImportError"];

const PDF_SEM_IA = "A leitura de PDF depende da IA, que está desligada neste servidor. Exporte o extrato em OFX ou CSV no app do banco e importe de novo.";

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
  // Autoridade do gating: o dropzone também bloqueia, mas é só cortesia (o cliente pode ser burlado).
  // Recusar aqui evita um lote que nasce, vira PROCESSING e morre em FAILED por falta de chave.
  if (format === "PDF" && !aiEnabled()) return { ok: false, message: PDF_SEM_IA };

  try {
    const bytes = await downloadAsUser(storageKey);
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, storageKey, fileName, format, bytes }));
    await dispatchProcessing(batch.id, bytes, format);
    revalidate();
    return { ok: true, data: { batchId: batch.id } };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Fila (Inngest) quando configurada. Sem fila, OFX/CSV (rápidos) rodam depois da resposta, no
 * próprio servidor. PDF roda dentro da requisição: a leitura por IA leva 15 s ou mais, e em produção
 * (Netlify) o `after()` foi cortado nesse intervalo — o lote ficou em "Lendo…" sem chamada ao Gemini
 * registrada e sem erro. Aguardar aqui mantém a function viva (a chamada tem teto de 30 s, dentro
 * dos 60 s da plataforma) e a pessoa só vê o resultado quando ele existe.
 */
async function dispatchProcessing(batchId: string, bytes: Uint8Array, format: string) {
  if (hasQueue()) {
    await inngest.send({ name: "import/batch.created", data: { batchId } });
    return;
  }
  const run = async () => {
    try {
      await processImportBatch(batchId, bytes);
    } catch (e) {
      console.error("processImportBatch", e);
    }
  };
  if (format === "PDF") await run();
  else after(run);
}

/**
 * Reprocessa um lote que falhou ou ficou preso, com o arquivo que já está no Storage — sem a pessoa
 * precisar escolher conta e arquivo de novo. Útil sobretudo para PDF: a leitura por IA depende de um
 * serviço gratuito que oscila, e a falha costuma passar em minutos.
 */
export async function retryImportAction(batchId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const batch = await db.importBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) return { ok: false, message: "Lote não encontrado." };
    if (batch.status !== "FAILED" && !isStaleProcessing(batch)) return { ok: false, message: "Este lote não está parado: aguarde ou recarregue a página." };
    if (batch.format === "PDF" && !aiEnabled()) return { ok: false, message: PDF_SEM_IA };

    const bytes = await downloadAsUser(batch.storageKey);
    // Volta para PENDING na hora: renova o updatedAt, senão a página ainda o veria como preso.
    await db.importBatch.update({ where: { id: batchId }, data: { status: "PENDING", error: null } });
    await dispatchProcessing(batch.id, bytes, batch.format);
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Troca a conta de um lote que ainda não foi confirmado e o relê: a conta decide o sinal dos valores
 * (cartão vs. corrente) e contra quais lançamentos procurar duplicatas, então não basta trocar o id.
 */
export async function changeBatchAccountAction(batchId: string, accountId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const batch = await db.importBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) return { ok: false, message: "Lote não encontrado." };
    if (batch.status === "CONFIRMED" || batch.status === "UNDONE") return { ok: false, message: "Este lote já foi concluído; desfaça a importação antes de mudar a conta." };
    if ((batch.status === "PENDING" || batch.status === "PROCESSING") && !isStaleProcessing(batch)) return { ok: false, message: "Aguarde a leitura terminar para trocar a conta." };
    const account = await db.account.findFirst({ where: { id: accountId, userId }, select: { id: true } });
    if (!account) return { ok: false, message: "Conta não encontrada." };
    if (batch.format === "PDF" && !aiEnabled()) return { ok: false, message: PDF_SEM_IA };

    const bytes = await downloadAsUser(batch.storageKey);
    await db.importBatch.update({ where: { id: batchId }, data: { accountId, status: "PENDING", error: null, rows: Prisma.JsonNull } });
    await dispatchProcessing(batch.id, bytes, batch.format);
    revalidate();
    return { ok: true, data: undefined };
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
  accepted: z.array(z.object({ key: z.string().min(1), categoryId: z.string().min(1).nullable(), counterAccountId: z.string().min(1).nullable().optional() })).min(1, "Selecione ao menos um lançamento."),
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
