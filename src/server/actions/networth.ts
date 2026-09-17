"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { centsSchema } from "@/server/schemas/transaction";
import { archiveAsset, createAsset, takeMonthlySnapshot, updateAsset } from "@/server/services/networth";
import type { ActionResult } from "./transactions";

const revalidate = () => ["/patrimonio", "/"].forEach((p) => revalidatePath(p));

const assetSchema = z.object({
  id: z.string().min(1).optional(),
  input: z.object({
    name: z.string().trim().min(1, "Dê um nome.").max(80),
    class: z.enum(["CASH", "FIXED_INCOME", "VARIABLE_INCOME", "REAL_ESTATE", "CRYPTO", "VEHICLE", "OTHER"]),
    currentValue: centsSchema,
    isLiability: z.boolean(),
  }),
});

export async function saveAssetAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  const parsed = assetSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira os campos." };
  try {
    const saved = await forUser(userId, async (tx) => {
      const asset = parsed.data.id ? await updateAsset(tx, userId, parsed.data.id, parsed.data.input) : await createAsset(tx, userId, parsed.data.input);
      await takeMonthlySnapshot(tx, userId);
      return asset;
    });
    revalidate();
    return { ok: true, data: { id: saved.id } };
  } catch (e) {
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Não consegui salvar agora." };
  }
}

export async function archiveAssetAction(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await forUser(userId, async (tx) => {
      await archiveAsset(tx, userId, id);
      await takeMonthlySnapshot(tx, userId);
    });
    revalidate();
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Não consegui arquivar agora." };
  }
}
