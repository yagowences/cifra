import { Rows3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { botaoVariants } from "@/components/botao";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { FiltroChips } from "@/components/transactions/filtro-chips";
import { ListaPorDia } from "@/components/transactions/lista-por-dia";
import { NovoLancamentoButton } from "@/components/transactions/novo-lancamento-button";
import { formatMonthYear, monthPeriod, todayISO } from "@/lib/dates";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { listTransactions } from "@/server/queries/transactions";
import { transactionFiltersSchema } from "@/server/schemas/transaction";
import { listAccounts } from "@/server/services/accounts";
import { horizonFor, materializeRecurrences } from "@/server/services/recurrence";

export const metadata: Metadata = { title: "Transações" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TransacoesPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requireUserId();
  const sp = await searchParams;
  const today = todayISO();

  const parsed = transactionFiltersSchema.safeParse({
    month: first(sp.mes),
    accountId: first(sp.conta),
    categoryId: first(sp.categoria),
    type: first(sp.tipo),
    q: first(sp.q),
    cursor: first(sp.cursor),
  });
  const filters = parsed.success ? parsed.data : transactionFiltersSchema.parse({});
  const month = filters.month ?? today.slice(0, 7);
  const [year, m] = month.split("-").map(Number);

  const { page, accounts } = await forUser(userId, async (tx) => {
    // Recorrências viram linhas até o fim do mês exibido (ou do mês seguinte, o que for maior).
    const horizon = horizonFor(today);
    const shown = monthPeriod(year, m).end;
    await materializeRecurrences(tx, userId, { until: shown > horizon ? shown : horizon, today });
    return {
      page: await listTransactions(tx, userId, filters),
      accounts: await listAccounts(tx, userId),
    };
  });

  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }));
  const filtered = Boolean(filters.accountId || filters.type || filters.q || filters.categoryId);

  return (
    <>
      <PageHeader title="Transações">
        <NovoLancamentoButton variant="secundario" className="hidden lg:inline-flex" />
      </PageHeader>

      <FiltroChips month={month} accounts={accountOptions} />

      {page.items.length === 0 ? (
        accounts.length === 0 ? (
          <EmptyState
            icon={Rows3}
            title="Comece por uma conta"
            description="Cadastre a conta ou o cartão por onde o dinheiro passa. Depois, importe um extrato ou lance à mão."
            action={{ href: "/contas", label: "Cadastrar conta" }}
          />
        ) : (
          <EmptyState
            icon={Rows3}
            title={filtered ? "Nada com esses filtros" : `Nenhuma transação em ${formatMonthYear(year, m).toLowerCase()}`}
            description={filtered ? "Tente outro mês, conta ou tipo." : "Importe um extrato ou lance a primeira."}
            action={filtered ? undefined : { href: "/importar", label: "Importar extrato" }}
          />
        )
      ) : (
        <ListaPorDia items={page.items} today={today} />
      )}

      {page.nextCursor && (
        <div className="flex justify-center pt-6">
          <Link
            href={`/transacoes?${new URLSearchParams({ ...(sp as Record<string, string>), cursor: page.nextCursor }).toString()}`}
            className={botaoVariants({ variant: "secundario" })}
          >
            Carregar mais
          </Link>
        </div>
      )}
    </>
  );
}
