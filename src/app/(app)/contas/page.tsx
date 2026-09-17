import type { Metadata } from "next";
import { ListaContas } from "@/components/accounts/lista-contas";
import { PageHeader } from "@/components/page-header";
import type { AccountListItem } from "@/lib/accounts";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Contas" };

export default async function ContasPage() {
  const userId = await requireUserId();
  const rows = await forUser(userId, (tx) => listAccounts(tx, userId, { includeArchived: true }));

  const accounts: AccountListItem[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution,
    initialBalance: a.initialBalance.toString(),
    currentBalance: a.currentBalance.toString(),
    closingDay: a.closingDay,
    dueDay: a.dueDay,
    creditLimit: a.creditLimit?.toString() ?? null,
    archived: a.archived,
  }));

  return (
    <>
      <PageHeader title="Contas" />
      <ListaContas accounts={accounts} />
    </>
  );
}
