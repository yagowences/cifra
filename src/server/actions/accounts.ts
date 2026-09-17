"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { accountInputSchema } from "@/server/schemas/account";
import { createAccount, deleteAccount, setAccountArchived, updateAccount } from "@/server/services/accounts";
import type { ActionResult } from "./transactions";

const revalidate = () => ["/", "/transacoes", "/contas"].forEach((p) => revalidatePath(p));

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Error && ["NotFoundError", "AccountInUseError"].includes(e.name)) return { ok: false, message: e.message };
  console.error(e);
  return { ok: false, message: "Não consegui salvar agora. Tente de novo em instantes." };
}

export async function saveAccount(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  const envelope = z.object({ id: z.string().min(1).optional(), input: accountInputSchema }).safeParse(payload);
  if (!envelope.success) {
    const fieldErrors = Object.fromEntries(
      envelope.error.issues.map((i) => [String(i.path[1] ?? i.path[0] ?? "form"), i.message]),
    );
    return { ok: false, message: Object.values(fieldErrors)[0] ?? "Confira os campos.", fieldErrors };
  }
  try {
    const { id, input } = envelope.data;
    const saved = await forUser(userId, (tx) =>
      id ? updateAccount(tx, userId, id, input) : createAccount(tx, userId, input),
    );
    revalidate();
    return { ok: true, data: { id: saved.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function setAccountArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await forUser(userId, (tx) => setAccountArchived(tx, userId, id, archived));
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAccountAction(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await forUser(userId, (tx) => deleteAccount(tx, userId, id));
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
