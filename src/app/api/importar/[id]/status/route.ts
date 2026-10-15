import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth";
import { db } from "@/server/db";
import { isStaleProcessing } from "@/server/services/import/types";

export const dynamic = "force-dynamic";

/**
 * Estado do lote, mínimo e barato: o poller da página de revisão consulta isto em vez de pedir a
 * página inteira (que leva ~2 s para renderizar). `done` diz que a leitura acabou, bem ou mal.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ done: false }, { status: 401 });
  }
  const { id } = await params;
  const batch = await db.importBatch.findFirst({ where: { id, userId }, select: { status: true, updatedAt: true } });
  if (!batch) return NextResponse.json({ done: true }, { status: 404 });
  const running = (batch.status === "PENDING" || batch.status === "PROCESSING") && !isStaleProcessing(batch);
  return NextResponse.json({ done: !running }, { headers: { "Cache-Control": "no-store" } });
}
