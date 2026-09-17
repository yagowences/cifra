"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { centsSchema, isoDateSchema } from "@/server/schemas/transaction";
import { contributeToGoal, createGoal, setGoalStatus, updateGoal } from "@/server/services/goals";
import type { ActionResult } from "./transactions";

const revalidate = () => ["/metas", "/"].forEach((p) => revalidatePath(p));

const goalSchema = z.object({
  id: z.string().min(1).optional(),
  input: z.object({
    name: z.string().trim().min(1, "Dê um nome à meta.").max(80),
    type: z.enum(["EMERGENCY_FUND", "TARGET_AMOUNT", "RECURRING_CONTRIBUTION", "SPENDING_REDUCTION", "FREE"]),
    targetAmount: centsSchema.refine((v) => v > 0n, "Informe um valor alvo."),
    currentAmount: centsSchema.default("0"),
    deadline: isoDateSchema.nullable(),
    accountId: z.string().min(1).nullable(),
    icon: z.string().max(40).nullable(),
  }),
});

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Error && (e.name === "NotFoundError" || e.message.includes("conta vinculada"))) return { ok: false, message: e.message };
  console.error(e);
  return { ok: false, message: "Não consegui salvar agora." };
}

export async function saveGoalAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  const parsed = goalSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira os campos." };
  try {
    const saved = await forUser(userId, (tx) => (parsed.data.id ? updateGoal(tx, userId, parsed.data.id, parsed.data.input) : createGoal(tx, userId, parsed.data.input)));
    revalidate();
    return { ok: true, data: { id: saved.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function contributeToGoalAction(id: string, amount: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const cents = centsSchema.safeParse(amount);
  if (!cents.success || cents.data === 0n) return { ok: false, message: "Informe um valor." };
  try {
    await forUser(userId, (tx) => contributeToGoal(tx, userId, id, cents.data));
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function setGoalStatusAction(id: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED"): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await forUser(userId, (tx) => setGoalStatus(tx, userId, id, status));
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
