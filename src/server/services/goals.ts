import "server-only";
import type { GoalType } from "@prisma/client";
import { addMonths, fromISODate, monthPeriod, todayISO, toISODate, type ISODate } from "@/lib/dates";
import { goalProgress, type GoalProgress } from "@/lib/goals";
import type { UserDb } from "@/server/db";
import { NotFoundError } from "./transactions";

export type GoalInput = {
  name: string;
  type: GoalType;
  targetAmount: bigint;
  currentAmount: bigint;
  deadline: ISODate | null;
  /** Conta vinculada: o valor atual passa a ser o saldo dela. */
  accountId: string | null;
  icon: string | null;
};

export function createGoal(tx: UserDb, userId: string, input: GoalInput) {
  return tx.goal.create({ data: { userId, ...input, deadline: input.deadline ? fromISODate(input.deadline) : null } });
}

export async function updateGoal(tx: UserDb, userId: string, id: string, input: GoalInput) {
  const found = await tx.goal.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Meta");
  return tx.goal.update({ where: { id }, data: { ...input, deadline: input.deadline ? fromISODate(input.deadline) : null } });
}

/** Aporte manual numa meta sem conta vinculada. */
export async function contributeToGoal(tx: UserDb, userId: string, id: string, amount: bigint) {
  const found = await tx.goal.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Meta");
  if (found.accountId) throw new Error("Esta meta segue o saldo da conta vinculada; movimente a conta.");
  return tx.goal.update({ where: { id }, data: { currentAmount: { increment: amount } } });
}

export async function setGoalStatus(tx: UserDb, userId: string, id: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
  const found = await tx.goal.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Meta");
  return tx.goal.update({ where: { id }, data: { status } });
}

export type GoalView = {
  id: string;
  name: string;
  type: GoalType;
  status: string;
  targetAmount: bigint;
  currentAmount: bigint;
  deadline: ISODate | null;
  accountId: string | null;
  accountName: string | null;
  icon: string | null;
  monthlyPace: bigint | null;
  progress: GoalProgress;
};

/**
 * Metas com valor atual (saldo da conta vinculada ou aporte manual) e ritmo:
 * média das entradas líquidas da conta vinculada nos últimos 3 meses.
 */
export async function listGoals(tx: UserDb, userId: string, today: ISODate = todayISO()): Promise<GoalView[]> {
  const goals = await tx.goal.findMany({
    where: { userId, status: { not: "ARCHIVED" } },
    include: { account: { select: { name: true, currentBalance: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  const [ty, tm] = today.split("-").map(Number);
  const from = fromISODate(monthPeriod(...(addMonths(`${today.slice(0, 7)}-01`, -3).split("-").map(Number).slice(0, 2) as [number, number])).start);
  const to = fromISODate(monthPeriod(...(addMonths(`${today.slice(0, 7)}-01`, -1).split("-").map(Number).slice(0, 2) as [number, number])).end);
  void ty;
  void tm;

  const views: GoalView[] = [];
  for (const g of goals) {
    let monthlyPace: bigint | null = null;
    if (g.accountId) {
      const [row] = await tx.$queryRaw<{ net: bigint }[]>`
        select coalesce(sum(case when t.transfer_account_id = ${g.accountId} then -t.amount else t.amount end), 0)::bigint as net
        from public.transactions t
        where t.user_id = ${userId}::uuid
          and (t.account_id = ${g.accountId} or t.transfer_account_id = ${g.accountId})
          and t.status in ('CONFIRMED', 'RECONCILED')
          and t.competence_date between ${from} and ${to}
      `;
      const net = BigInt(row?.net ?? 0);
      monthlyPace = net > 0n ? net / 3n : null;
    }
    const currentAmount = g.account ? g.account.currentBalance : g.currentAmount;
    const deadline = g.deadline ? toISODate(g.deadline) : null;
    views.push({
      id: g.id,
      name: g.name,
      type: g.type,
      status: g.status,
      targetAmount: g.targetAmount,
      currentAmount,
      deadline,
      accountId: g.accountId,
      accountName: g.account?.name ?? null,
      icon: g.icon,
      monthlyPace,
      progress: goalProgress({ targetAmount: g.targetAmount, currentAmount, deadline, monthlyPace, today }),
    });
  }
  return views;
}
