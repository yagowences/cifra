import "server-only";
import { Prisma, type TxSource } from "@prisma/client";
import { addMonths, cardCashDate, fromISODate, toISODate, todayISO, type ISODate } from "@/lib/dates";
import { fingerprint } from "@/lib/fingerprint";
import { signedAmount, splitEvenly } from "@/lib/money";
import type { UserDb } from "@/server/db";
import type { TransactionInput } from "@/server/schemas/transaction";
import { DuplicateTransactionError, getTransaction, NotFoundError } from "./transactions";

/**
 * Parcelamento: a primeira parcela é o registro-pai (parent_id nulo) e as
 * demais são filhas. Cada parcela cai no mês de competência seguinte, com
 * clamp de dia, e no cartão o caixa é o vencimento da fatura daquele mês.
 * As parcelas somam exatamente o total (centavos de resto nas primeiras).
 */
export async function createInstallments(
  tx: UserDb,
  userId: string,
  input: TransactionInput,
  count: number,
  source: TxSource = "MANUAL",
) {
  if (!Number.isInteger(count) || count < 2 || count > 120) throw new RangeError("Número de parcelas inválido.");
  if (input.type === "TRANSFER") throw new RangeError("Transferência não se parcela.");

  const account = await tx.account.findFirst({ where: { id: input.accountId, userId } });
  if (!account) throw new NotFoundError("Conta");
  const isCard = account.type === "CREDIT_CARD" && account.closingDay && account.dueDay;

  const total = signedAmount(input.type, input.amount);
  const parts = splitEvenly(total, count);
  const base = {
    userId,
    accountId: input.accountId,
    categoryId: input.categoryId ?? null,
    type: input.type,
    merchant: input.merchant ?? null,
    notes: input.notes ?? null,
    status: input.status ?? "CONFIRMED",
    source,
    installmentTotal: count,
  } as const;

  const rowFor = (i: number, parentId: string | null) => {
    const competenceDate = addMonths(input.competenceDate, i);
    const description = input.description;
    return {
      ...base,
      parentId,
      installmentNo: i + 1,
      amount: parts[i],
      competenceDate: fromISODate(competenceDate),
      cashDate: isCard ? fromISODate(cardCashDate(competenceDate, account.closingDay!, account.dueDay!)) : null,
      description,
      fingerprint: fingerprint({ accountId: input.accountId, competenceDate, amount: parts[i], description: `${description} ${i + 1}/${count}` }),
    };
  };

  try {
    const parent = await tx.transaction.create({ data: rowFor(0, null) });
    if (count > 1) {
      await tx.transaction.createMany({ data: Array.from({ length: count - 1 }, (_, k) => rowFor(k + 1, parent.id)) });
    }
    await tx.auditLog.create({
      data: { userId, entity: "transaction", entityId: parent.id, action: "CREATE", source, diff: { installments: count, total: total.toString() } },
    });
    return parent;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DuplicateTransactionError();
    throw e;
  }
}

/** Todas as parcelas da série a que `id` pertence, em ordem. */
export async function listInstallmentSeries(tx: UserDb, userId: string, id: string) {
  const one = await getTransaction(tx, userId, id);
  const parentId = one.parentId ?? one.id;
  return tx.transaction.findMany({
    where: { userId, OR: [{ id: parentId }, { parentId }] },
    orderBy: { installmentNo: "asc" },
  });
}

export type SeriesPatch = Partial<Pick<TransactionInput, "description" | "categoryId" | "notes" | "merchant">> & {
  /** Nova magnitude por parcela, em centavos. */
  amountPerInstallment?: bigint;
};

/**
 * Editar uma parcela propaga só para as parcelas futuras da série
 * (competência depois de `today`), nunca para as já vencidas.
 */
export async function updateFutureInstallments(
  tx: UserDb,
  userId: string,
  id: string,
  patch: SeriesPatch,
  today: ISODate = todayISO(),
) {
  const series = await listInstallmentSeries(tx, userId, id);
  const target = series.find((t) => t.id === id);
  if (!target) throw new NotFoundError("Parcela");
  const future = series.filter((t) => t.id === id || toISODate(t.competenceDate) > today);

  let changed = 0;
  for (const row of future) {
    const amount = patch.amountPerInstallment !== undefined ? signedAmount(row.type, patch.amountPerInstallment) : row.amount;
    const description = patch.description ?? row.description;
    const competenceDate = toISODate(row.competenceDate);
    await tx.transaction.update({
      where: { id: row.id },
      data: {
        amount,
        description,
        categoryId: patch.categoryId === undefined ? row.categoryId : patch.categoryId,
        notes: patch.notes === undefined ? row.notes : patch.notes,
        merchant: patch.merchant === undefined ? row.merchant : patch.merchant,
        fingerprint: fingerprint({ accountId: row.accountId, competenceDate, amount, description: `${description} ${row.installmentNo}/${row.installmentTotal}` }),
      },
    });
    changed++;
  }
  await tx.auditLog.create({
    data: { userId, entity: "transaction", entityId: id, action: "UPDATE", source: "MANUAL", diff: { futureInstallments: changed } },
  });
  return changed;
}
