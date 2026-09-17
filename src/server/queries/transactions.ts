import "server-only";
import type { Prisma } from "@prisma/client";
import { fromISODate, monthPeriod, toISODate, todayISO } from "@/lib/dates";
import type { TransactionListItem } from "@/lib/transactions";
import type { UserDb } from "@/server/db";
import type { TransactionFilters } from "@/server/schemas/transaction";

export type TransactionPage = { items: TransactionListItem[]; nextCursor: string | null };

/** Lista paginada por cursor, mais recente primeiro. Os filtros são os mesmos da URL da tela. */
export async function listTransactions(tx: UserDb, userId: string, filters: TransactionFilters): Promise<TransactionPage> {
  const month = filters.month ?? todayISO().slice(0, 7);
  const [year, m] = month.split("-").map(Number);
  const period = monthPeriod(year, m);

  const where: Prisma.TransactionWhereInput = {
    userId,
    competenceDate: { gte: fromISODate(period.start), lte: fromISODate(period.end) },
    ...(filters.accountId && { OR: [{ accountId: filters.accountId }, { transferAccountId: filters.accountId }] }),
    // "nenhuma" é o link da barra "Sem categoria" do dashboard.
    ...(filters.categoryId && { categoryId: filters.categoryId === "nenhuma" ? null : filters.categoryId }),
    ...(filters.type && { type: filters.type }),
    ...(filters.q && { description: { contains: filters.q, mode: "insensitive" } }),
    ...((filters.minAmount !== undefined || filters.maxAmount !== undefined) && {
      amount: {
        ...(filters.minAmount !== undefined && { gte: filters.minAmount }),
        ...(filters.maxAmount !== undefined && { lte: filters.maxAmount }),
      },
    }),
  };

  const rows = await tx.transaction.findMany({
    where,
    orderBy: [{ competenceDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: filters.limit + 1,
    ...(filters.cursor && { cursor: { id: filters.cursor }, skip: 1 }),
    include: {
      account: { select: { name: true } },
      transferAccount: { select: { name: true } },
      category: { select: { id: true, name: true, icon: true, color: true } },
      _count: { select: { attachments: true } },
    },
  });

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    nextCursor: hasMore ? page[page.length - 1].id : null,
    items: page.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      accountName: r.account.name,
      transferAccountId: r.transferAccountId,
      transferAccountName: r.transferAccount?.name ?? null,
      category: r.category,
      amount: r.amount.toString(),
      type: r.type,
      status: r.status,
      competenceDate: toISODate(r.competenceDate),
      cashDate: r.cashDate ? toISODate(r.cashDate) : null,
      description: r.description,
      merchant: r.merchant,
      notes: r.notes,
      reviewed: r.reviewed,
      recurring: r.recurrenceId !== null,
      recurrenceId: r.recurrenceId,
      installment: r.installmentNo && r.installmentTotal ? `${r.installmentNo}/${r.installmentTotal}` : null,
      installmentTotal: r.installmentTotal,
      attachments: r._count.attachments,
    })),
  };
}
