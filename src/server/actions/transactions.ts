"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { transactionCreateOptionsSchema, transactionInputSchema, updateScopeSchema } from "@/server/schemas/transaction";
import { createInstallments, updateFutureInstallments } from "@/server/services/installments";
import { createRecurrence, stopRecurrence } from "@/server/services/recurrence";
import {
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  restoreTransaction,
  updateTransaction,
  type TransactionSnapshot,
} from "@/server/services/transactions";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const KNOWN = ["DuplicateTransactionError", "NotFoundError", "AccountInUseError", "RangeError"];

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Error && KNOWN.includes(e.name)) return { ok: false, message: e.message };
  console.error(e);
  return { ok: false, message: "Não consegui salvar agora. Tente de novo em instantes." };
}

const revalidate = () => ["/", "/transacoes", "/contas"].forEach((p) => revalidatePath(p));

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  // Erros vêm com prefixo "input" no caminho; achata para o nome do campo.
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[issue.path.length - 1] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

const saveEnvelope = z.object({
  id: z.string().min(1).optional(),
  input: transactionInputSchema,
  options: transactionCreateOptionsSchema.optional(),
  scope: updateScopeSchema.optional(),
});

/**
 * Cria (sem id) ou atualiza (com id) um lançamento a partir do formulário.
 * Na criação, `options` pode parcelar ou repetir; na edição de parcela, `scope`
 * "future" propaga descrição, categoria, valor e observação para as parcelas futuras.
 */
export async function saveTransaction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  const envelope = saveEnvelope.safeParse(payload);
  if (!envelope.success) {
    const fieldErrors = fieldErrorsOf(envelope.error);
    return { ok: false, message: Object.values(fieldErrors)[0] ?? "Confira os campos.", fieldErrors };
  }

  try {
    const { id, input, options, scope } = envelope.data;
    const saved = await forUser(userId, async (tx) => {
      if (id) {
        if (scope === "future") {
          await updateFutureInstallments(tx, userId, id, {
            description: input.description,
            categoryId: input.categoryId ?? null,
            notes: input.notes ?? null,
            merchant: input.merchant ?? null,
            amountPerInstallment: input.amount,
          });
          return { id };
        }
        return updateTransaction(tx, userId, id, input);
      }
      if (options?.installments) return createInstallments(tx, userId, input, options.installments);
      if (options?.recurrence) {
        const rule = await createRecurrence(tx, userId, input, { freq: options.recurrence, interval: 1 });
        return { id: rule.id };
      }
      return createTransaction(tx, userId, input);
    });
    revalidate();
    return { ok: true, data: { id: saved.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function duplicateTransactionAction(id: string): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  try {
    const copy = await forUser(userId, (tx) => duplicateTransaction(tx, userId, id));
    revalidate();
    return { ok: true, data: { id: copy.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Exclui e devolve o snapshot que permite desfazer. */
export async function deleteTransactionAction(id: string): Promise<ActionResult<TransactionSnapshot>> {
  const userId = await requireUserId();
  try {
    const snapshot = await forUser(userId, (tx) => deleteTransaction(tx, userId, id));
    revalidate();
    return { ok: true, data: snapshot };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreTransactionAction(snapshot: TransactionSnapshot): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  try {
    const restored = await forUser(userId, (tx) => restoreTransaction(tx, userId, snapshot));
    revalidate();
    return { ok: true, data: { id: restored.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Encerra uma recorrência: apaga as previsões e mantém o que já aconteceu. */
export async function stopRecurrenceAction(ruleId: string): Promise<ActionResult<{ removed: number }>> {
  const userId = await requireUserId();
  try {
    const removed = await forUser(userId, (tx) => stopRecurrence(tx, userId, ruleId));
    revalidate();
    return { ok: true, data: { removed } };
  } catch (e) {
    return fail(e);
  }
}
