import { Upload } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { Dropzone } from "@/components/import/dropzone";
import { ListaLotes, type BatchListItem } from "@/components/import/lista-lotes";
import { PageHeader } from "@/components/page-header";
import { formatShortDate, toISODate } from "@/lib/dates";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Importar" };

export default async function ImportarPage() {
  const userId = await requireUserId();
  const { accounts, batches } = await forUser(userId, async (tx) => ({
    accounts: await listAccounts(tx, userId),
    batches: await tx.importBatch.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { account: { select: { name: true } } },
    }),
  }));

  const items: BatchListItem[] = batches.map((b) => ({
    id: b.id,
    fileName: b.fileName,
    accountName: b.account.name,
    status: b.status,
    readCount: b.readCount,
    createdCount: b.createdCount,
    duplicateCount: b.duplicateCount,
    createdAt: formatShortDate(toISODate(b.createdAt)),
  }));

  return (
    <>
      <PageHeader title="Importar" />
      {accounts.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="Comece por uma conta"
          description="Cadastre a conta ou o cartão do extrato antes de importar."
          action={{ href: "/contas", label: "Cadastrar conta" }}
        />
      ) : (
        <div className="flex flex-col gap-8">
          <Dropzone accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))} userId={userId} />
          <ListaLotes batches={items} />
        </div>
      )}
    </>
  );
}
