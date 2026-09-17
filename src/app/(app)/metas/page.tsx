import type { Metadata } from "next";
import { ListaMetas, type GoalListItem } from "@/components/goals/lista-metas";
import { PageHeader } from "@/components/page-header";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";
import { listGoals } from "@/server/services/goals";

export const metadata: Metadata = { title: "Metas" };

export default async function MetasPage() {
  const userId = await requireUserId();
  const { goals, accounts } = await forUser(userId, async (tx) => ({
    goals: await listGoals(tx, userId),
    accounts: await listAccounts(tx, userId),
  }));

  const items: GoalListItem[] = goals.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    status: g.status,
    targetAmount: g.targetAmount.toString(),
    currentAmount: g.currentAmount.toString(),
    deadline: g.deadline,
    accountId: g.accountId,
    accountName: g.accountName,
    monthlyPace: g.monthlyPace?.toString() ?? null,
    progress: { ...g.progress, remaining: g.progress.remaining.toString(), neededPerMonth: g.progress.neededPerMonth?.toString() ?? null },
  }));

  return (
    <>
      <PageHeader title="Metas" />
      <ListaMetas goals={items} accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))} />
    </>
  );
}
