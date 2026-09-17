import "server-only";
import { Prisma } from "@prisma/client";
import type { UserDb } from "@/server/db";
import type { AccountInput } from "@/server/schemas/account";
import { NotFoundError } from "./transactions";

export class AccountInUseError extends Error {
  constructor() {
    super("Esta conta tem lançamentos. Arquive em vez de excluir.");
    this.name = "AccountInUseError";
  }
}

function buildData(input: AccountInput) {
  const isCard = input.type === "CREDIT_CARD";
  return {
    name: input.name,
    type: input.type,
    institution: input.institution || null,
    initialBalance: input.initialBalance,
    closingDay: isCard ? (input.closingDay ?? null) : null,
    dueDay: isCard ? (input.dueDay ?? null) : null,
    creditLimit: isCard ? (input.creditLimit ?? null) : null,
  };
}

export function listAccounts(tx: UserDb, userId: string, opts: { includeArchived?: boolean } = {}) {
  return tx.account.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { archived: false }) },
    orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
  });
}

export function createAccount(tx: UserDb, userId: string, input: AccountInput) {
  return tx.account.create({ data: { userId, ...buildData(input) } });
}

export async function updateAccount(tx: UserDb, userId: string, id: string, input: AccountInput) {
  const found = await tx.account.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Conta");
  return tx.account.update({ where: { id }, data: buildData(input) });
}

export async function setAccountArchived(tx: UserDb, userId: string, id: string, archived: boolean) {
  const found = await tx.account.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Conta");
  return tx.account.update({ where: { id }, data: { archived } });
}

/** Exclui só conta sem lançamentos; com lançamentos, a FK (Restrict) barra e viramos AccountInUseError. */
export async function deleteAccount(tx: UserDb, userId: string, id: string) {
  const found = await tx.account.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Conta");
  try {
    await tx.account.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") throw new AccountInUseError();
    throw e;
  }
}
