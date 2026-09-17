import "server-only";
import { Prisma, type Transaction, type TxSource } from "@prisma/client";
import { fromISODate, toISODate, todayISO, type ISODate } from "@/lib/dates";
import { fingerprint, normalizeDescription } from "@/lib/fingerprint";
import { signedAmount } from "@/lib/money";
import type { UserDb } from "@/server/db";
import type { TransactionInput } from "@/server/schemas/transaction";

export class DuplicateTransactionError extends Error {
  constructor() {
    super("Já existe um lançamento igual nesta conta, nesta data e com este valor.");
    this.name = "DuplicateTransactionError";
  }
}

export class NotFoundError extends Error {
  constructor(entity = "Registro") {
    super(`${entity} não encontrado.`);
    this.name = "NotFoundError";
  }
}

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

function buildData(userId: string, input: TransactionInput) {
  const amount = signedAmount(input.type, input.amount);
  return {
    userId,
    accountId: input.accountId,
    categoryId: input.type === "TRANSFER" ? null : (input.categoryId ?? null),
    transferAccountId: input.type === "TRANSFER" ? input.transferAccountId! : null,
    amount,
    type: input.type,
    competenceDate: fromISODate(input.competenceDate),
    cashDate: input.cashDate ? fromISODate(input.cashDate) : null,
    description: input.description,
    merchant: input.merchant ?? null,
    notes: input.notes ?? null,
    status: input.status ?? "CONFIRMED",
    fingerprint: fingerprint({
      accountId: input.accountId,
      competenceDate: input.competenceDate,
      amount,
      description: input.description,
    }),
  };
}

async function audit(
  tx: UserDb,
  userId: string,
  entityId: string,
  action: "CREATE" | "UPDATE" | "DELETE",
  source: TxSource,
  diff?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({ data: { userId, entity: "transaction", entityId, action, source, diff } });
}

export async function createTransaction(tx: UserDb, userId: string, input: TransactionInput, source: TxSource = "MANUAL") {
  try {
    const created = await tx.transaction.create({ data: { ...buildData(userId, input), source } });
    await audit(tx, userId, created.id, "CREATE", source);
    if (created.categoryId) await rememberMerchant(tx, userId, created.description, created.categoryId);
    return created;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateTransactionError();
    throw e;
  }
}

export async function getTransaction(tx: UserDb, userId: string, id: string) {
  const found = await tx.transaction.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Lançamento");
  return found;
}

export async function updateTransaction(tx: UserDb, userId: string, id: string, input: TransactionInput) {
  const before = await getTransaction(tx, userId, id);
  const data = buildData(userId, input);
  try {
    const updated = await tx.transaction.update({ where: { id }, data });
    await audit(tx, userId, id, "UPDATE", "MANUAL", {
      before: { amount: before.amount.toString(), categoryId: before.categoryId, description: before.description },
      after: { amount: updated.amount.toString(), categoryId: updated.categoryId, description: updated.description },
    });
    // Correção de categoria alimenta a memória de comerciante.
    if (updated.categoryId && updated.categoryId !== before.categoryId) {
      await rememberMerchant(tx, userId, updated.originalDesc ?? updated.description, updated.categoryId);
    }
    return updated;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateTransactionError();
    throw e;
  }
}

/** Copia um lançamento para a data de hoje, como novo lançamento manual. */
export async function duplicateTransaction(tx: UserDb, userId: string, id: string, today: ISODate = todayISO()) {
  const source = await getTransaction(tx, userId, id);
  const magnitude = source.amount < 0n ? -source.amount : source.amount;
  return createTransaction(tx, userId, {
    accountId: source.accountId,
    type: source.type,
    amount: magnitude,
    competenceDate: today,
    cashDate: null,
    description: source.description,
    categoryId: source.categoryId,
    transferAccountId: source.transferAccountId,
    notes: source.notes,
    merchant: source.merchant,
    status: "CONFIRMED",
  });
}

/** Snapshot serializável (bigint como string) para restaurar após exclusão com desfazer. */
export type TransactionSnapshot = Omit<Transaction, "amount" | "competenceDate" | "cashDate" | "createdAt" | "updatedAt"> & {
  amount: string;
  competenceDate: ISODate;
  cashDate: ISODate | null;
  tagIds: string[];
};

export async function deleteTransaction(tx: UserDb, userId: string, id: string): Promise<TransactionSnapshot> {
  const found = await getTransaction(tx, userId, id);
  const tags = await tx.transactionTag.findMany({ where: { transactionId: id }, select: { tagId: true } });
  await tx.transaction.delete({ where: { id } });
  await audit(tx, userId, id, "DELETE", "MANUAL");
  const { amount, competenceDate, cashDate, createdAt: _c, updatedAt: _u, ...rest } = found;
  void _c;
  void _u;
  return {
    ...rest,
    amount: amount.toString(),
    competenceDate: toISODate(competenceDate),
    cashDate: cashDate ? toISODate(cashDate) : null,
    tagIds: tags.map((t) => t.tagId),
  };
}

/** Desfazer exclusão: recria o lançamento com o mesmo id e as mesmas tags. */
export async function restoreTransaction(tx: UserDb, userId: string, snapshot: TransactionSnapshot) {
  if (snapshot.userId !== userId) throw new NotFoundError("Lançamento");
  const { tagIds, amount, competenceDate, cashDate, ...rest } = snapshot;
  try {
    const restored = await tx.transaction.create({
      data: {
        ...rest,
        amount: BigInt(amount),
        competenceDate: fromISODate(competenceDate),
        cashDate: cashDate ? fromISODate(cashDate) : null,
        tags: { create: tagIds.map((tagId) => ({ tagId, userId })) },
      },
    });
    await audit(tx, userId, restored.id, "CREATE", "MANUAL", { restored: true });
    return restored;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateTransactionError();
    throw e;
  }
}

async function rememberMerchant(tx: UserDb, userId: string, description: string, categoryId: string) {
  const normalizedDesc = normalizeDescription(description);
  if (!normalizedDesc) return;
  await tx.merchantMemory.upsert({
    where: { userId_normalizedDesc: { userId, normalizedDesc } },
    create: { userId, normalizedDesc, categoryId },
    update: { categoryId, hitCount: { increment: 1 } },
  });
}
