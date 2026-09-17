import "server-only";
import type { Prisma } from "@prisma/client";
import { addDays, fromISODate, toISODate, type ISODate } from "@/lib/dates";
import type { UserDb } from "@/server/db";
import { createTransaction, getTransaction } from "./transactions";

export type DuplicateCandidate = {
  id: string;
  description: string;
  date: ISODate;
  amount: string;
  accountName: string;
  hasAttachment: boolean;
};

/**
 * Antes de criar uma transação a partir de um comprovante, procura lançamentos
 * com o mesmo valor em data próxima (±3 dias) em qualquer conta. É o que
 * permite "anexar à existente" em vez de duplicar o gasto do extrato.
 */
export async function findDuplicateCandidates(tx: UserDb, userId: string, input: { amount: bigint; date: ISODate; days?: number }): Promise<DuplicateCandidate[]> {
  const days = input.days ?? 3;
  const magnitude = input.amount < 0n ? -input.amount : input.amount;
  const rows = await tx.transaction.findMany({
    where: {
      userId,
      type: { not: "TRANSFER" },
      amount: { in: [magnitude, -magnitude] },
      competenceDate: { gte: fromISODate(addDays(input.date, -days)), lte: fromISODate(addDays(input.date, days)) },
    },
    include: { account: { select: { name: true } }, _count: { select: { attachments: true } } },
    orderBy: { competenceDate: "desc" },
    take: 5,
  });
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    date: toISODate(r.competenceDate),
    amount: r.amount.toString(),
    accountName: r.account.name,
    hasAttachment: r._count.attachments > 0,
  }));
}

export type ReceiptFile = { storageKey: string; mimeType: string; sizeBytes: number; ocrData: Prisma.InputJsonValue };

export type ReceiptTransactionInput = {
  accountId: string;
  /** Magnitude em centavos; comprovante é sempre despesa. */
  amount: bigint;
  date: ISODate;
  merchant: string;
  categoryId: string | null;
  /** Menor confiança entre os campos lidos, 0–1. */
  confidence: number | null;
};

/** Foto vira transação (source OCR) com o comprovante anexado e o que a IA leu em ocrData. */
export async function createFromReceipt(tx: UserDb, userId: string, input: ReceiptTransactionInput, file: ReceiptFile) {
  const transaction = await createTransaction(
    tx,
    userId,
    {
      accountId: input.accountId,
      type: "EXPENSE",
      amount: input.amount,
      competenceDate: input.date,
      description: input.merchant,
      merchant: input.merchant,
      categoryId: input.categoryId,
    },
    "OCR",
  );
  await tx.transaction.update({ where: { id: transaction.id }, data: { aiConfidence: input.confidence } });
  const attachment = await attachReceipt(tx, userId, transaction.id, file);
  return { transaction, attachment };
}

/** Anexa o comprovante a um lançamento existente (o do extrato) e guarda o OCR. */
export async function attachReceipt(tx: UserDb, userId: string, transactionId: string, file: ReceiptFile) {
  const transaction = await getTransaction(tx, userId, transactionId);
  const attachment = await tx.attachment.create({
    data: {
      userId,
      transactionId: transaction.id,
      storageKey: file.storageKey,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      kind: "RECEIPT",
      ocrData: file.ocrData,
    },
  });
  await tx.auditLog.create({ data: { userId, entity: "transaction", entityId: transaction.id, action: "UPDATE", source: "OCR", diff: { attachment: attachment.id } } });
  return attachment;
}
