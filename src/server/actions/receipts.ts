"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAiClient } from "@/ai/client";
import type { Receipt } from "@/ai/schemas/receipt";
import { isISODate } from "@/lib/dates";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { attachReceipt, createFromReceipt, findDuplicateCandidates, type DuplicateCandidate } from "@/server/services/receipts";
import { downloadAsUser } from "@/server/storage";
import type { ActionResult } from "./transactions";

const KNOWN = ["NotFoundError", "ManualReviewError", "BudgetExceededError", "RateLimitedError", "ProviderUnavailableError", "DuplicateTransactionError"];

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Error && KNOWN.includes(e.name)) return { ok: false, message: e.message };
  console.error(e);
  return { ok: false, message: "Não consegui concluir agora. Tente de novo em instantes." };
}

const revalidate = () => ["/", "/transacoes", "/contas", "/comprovante"].forEach((p) => revalidatePath(p));

const readSchema = z.object({
  storageKey: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive(),
});

export type ReceiptReading = { receipt: Receipt; candidates: DuplicateCandidate[]; costCents: number; cached: boolean };

/** Lê a foto já enviada ao storage e devolve os campos com confiança mais os possíveis duplicados. */
export async function readReceiptAction(payload: unknown): Promise<ActionResult<ReceiptReading>> {
  const userId = await requireUserId();
  const parsed = readSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Envio inválido." };
  if (!parsed.data.storageKey.startsWith(`${userId}/`)) return { ok: false, message: "Arquivo fora da sua pasta." };

  try {
    const bytes = await downloadAsUser(parsed.data.storageKey);
    const extracted = await createAiClient().extractReceipt(userId, { kind: "image", mediaType: parsed.data.mimeType, base64: Buffer.from(bytes).toString("base64") });
    const candidates = await forUser(userId, (tx) => findDuplicateCandidates(tx, userId, { amount: BigInt(extracted.data.amount), date: extracted.data.date }));
    return { ok: true, data: { receipt: extracted.data, candidates, costCents: extracted.costCents, cached: extracted.cached } };
  } catch (e) {
    return fail(e);
  }
}

const confirmSchema = z.object({
  file: readSchema,
  ocrData: z.record(z.unknown()),
  /** Anexar a um lançamento existente… */
  attachTo: z.string().min(1).nullable(),
  /** …ou criar um novo com estes campos (já conferidos pela pessoa). */
  transaction: z
    .object({
      accountId: z.string().min(1),
      amount: z.string().regex(/^\d+$/).transform(BigInt),
      date: z.string().refine(isISODate, "Data inválida."),
      merchant: z.string().trim().min(1).max(120),
      categoryId: z.string().min(1).nullable(),
      confidence: z.number().min(0).max(1).nullable(),
    })
    .nullable(),
});

export async function confirmReceiptAction(payload: unknown): Promise<ActionResult<{ transactionId: string; attached: boolean }>> {
  const userId = await requireUserId();
  const parsed = confirmSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira os campos." };
  const { file, ocrData, attachTo, transaction } = parsed.data;
  if (!file.storageKey.startsWith(`${userId}/`)) return { ok: false, message: "Arquivo fora da sua pasta." };

  try {
    const receiptFile = { storageKey: file.storageKey, mimeType: file.mimeType, sizeBytes: file.sizeBytes, ocrData: ocrData as Record<string, never> };
    const result = await forUser(userId, async (tx) => {
      if (attachTo) {
        await attachReceipt(tx, userId, attachTo, receiptFile);
        return { transactionId: attachTo, attached: true };
      }
      if (!transaction) throw new Error("Nada para salvar.");
      const created = await createFromReceipt(tx, userId, transaction, receiptFile);
      return { transactionId: created.transaction.id, attached: false };
    });
    revalidate();
    return { ok: true, data: result };
  } catch (e) {
    return fail(e);
  }
}
