"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { transactionInputSchema } from "@/server/schemas/transaction";
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

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Error && ["DuplicateTransactionError", "NotFoundError", "AccountInUseError"].includes(e.name)) {
    return { ok: false, message: e.message };
  }
  console.error(e);
  return { ok: false, message: "Não consegui salvar agora. Tente de novo em instantes." };
}

const revalidate = () => ["/", "/transacoes", "/contas"].forEach((p) => revalidatePath(p));

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Cria (sem id) ou atualiza (com id) um lançamento a partir do formulário. */
export async function saveTransaction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  const envelope = z.object({ id: z.string().min(1).optional(), input: transactionInputSchema }).safeParse(payload);
  if (!envelope.success) {
    const fieldErrors = fieldErrorsOf(envelope.error);
    // Erros vêm com prefixo "input" no caminho; achata para o nome do campo.
    const flat = Object.fromEntries(
      envelope.error.issues.map((i) => [String(i.path[1] ?? i.path[0] ?? "form"), i.message]),
    );
    return { ok: false, message: Object.values(flat)[0] ?? "Confira os campos.", fieldErrors: { ...fieldErrors, ...flat } };
  }

  try {
    const { id, input } = envelope.data;
    const saved = await forUser(userId, (tx) =>
      id ? updateTransaction(tx, userId, id, input) : createTransaction(tx, userId, input),
    );
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
