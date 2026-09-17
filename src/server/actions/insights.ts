"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import type { ActionResult } from "./transactions";

export async function dismissInsightAction(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  await forUser(userId, (tx) => tx.insight.updateMany({ where: { id, userId }, data: { dismissed: true, read: true } }));
  revalidatePath("/");
  return { ok: true, data: undefined };
}
