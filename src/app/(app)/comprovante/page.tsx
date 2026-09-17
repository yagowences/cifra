import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { LeitorComprovante } from "@/components/receipts/leitor-comprovante";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Comprovante" };

export default async function ComprovantePage() {
  const userId = await requireUserId();
  const { accounts, categories } = await forUser(userId, async (tx) => ({
    accounts: await listAccounts(tx, userId),
    categories: await tx.category.findMany({
      where: { userId },
      orderBy: [{ type: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, type: true, icon: true, color: true },
    }),
  }));
  const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <>
      <PageHeader title="Comprovante" />
      {accounts.length === 0 ? (
        <EmptyState icon={Receipt} title="Comece por uma conta" description="Cadastre a conta ou o cartão em que o gasto saiu." action={{ href: "/contas", label: "Cadastrar conta" }} />
      ) : !aiEnabled ? (
        <EmptyState
          icon={Receipt}
          title="Leitura por IA desligada"
          description="Defina ANTHROPIC_API_KEY no servidor para fotografar comprovantes. Enquanto isso, lance à mão pelo botão +."
        />
      ) : (
        <LeitorComprovante accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))} categories={categories} userId={userId} />
      )}
    </>
  );
}
