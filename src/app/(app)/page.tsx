import { Rows3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FluxoMensal } from "@/components/charts/fluxo-mensal";
import { EmptyState } from "@/components/empty-state";
import { InsightBanner } from "@/components/insights/insight-banner";
import { BarraCategoria } from "@/components/money/barra-categoria";
import { CardKPI } from "@/components/money/card-kpi";
import { Valor } from "@/components/money/valor";
import { Variacao } from "@/components/money/variacao";
import { MonthSwitcher } from "@/components/month-switcher";
import { formatMonthYear, todayISO } from "@/lib/dates";
import { formatPercent, percentChange } from "@/lib/money";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { getAccountsBalance, getByCategory, getMonthlyFlow, getSummary, periodForMonth, previousMonth } from "@/server/queries/summary";
import { generateInsights, listInsights } from "@/server/services/insights";
import { horizonFor, materializeRecurrences } from "@/server/services/recurrence";

export const metadata: Metadata = { title: "Início" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requireUserId();
  const sp = await searchParams;
  const today = todayISO();
  const mes = Array.isArray(sp.mes) ? sp.mes[0] : sp.mes;
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : today.slice(0, 7);
  const [year, m] = month.split("-").map(Number);
  const period = periodForMonth(month);
  const prev = previousMonth(month);

  const data = await forUser(userId, async (tx) => {
    await materializeRecurrences(tx, userId, { until: horizonFor(today), today });
    // Insights do mês corrente: detectores determinísticos, texto por template.
    if (month === today.slice(0, 7)) await generateInsights(tx, userId, today);
    const [summary, previous, categories, flow, balance, hasAny, insights] = await Promise.all([
      getSummary(tx, userId, period),
      getSummary(tx, userId, periodForMonth(prev)),
      getByCategory(tx, userId, period, "EXPENSE", 8),
      getMonthlyFlow(tx, userId, month, 6),
      getAccountsBalance(tx, userId),
      tx.transaction.count({ where: { userId } }).then((n) => n > 0),
      listInsights(tx, userId, month, 3),
    ]);
    return { summary, previous, categories, flow, balance, hasAny, insights };
  });

  const { summary, previous, categories, flow, balance, insights } = data;
  const monthName = formatMonthYear(year, m).split(" ")[0].toLowerCase();
  const prevName = formatMonthYear(...(prev.split("-").map(Number) as [number, number])).split(" ")[0].toLowerCase();
  const listHref = `/transacoes?mes=${month}`;

  return (
    <>
      <header className="flex items-center justify-between pb-6">
        <h1 className="text-heading">Início</h1>
        <MonthSwitcher month={month} />
      </header>

      {!data.hasAny ? (
        <EmptyState
          icon={Rows3}
          title="Nenhuma transação ainda"
          description={
            balance.count === 0
              ? "Cadastre uma conta e importe um extrato ou lance a primeira transação para ver quanto entrou, quanto saiu e o que sobrou."
              : "Importe um extrato ou lance a primeira transação para ver quanto entrou, quanto saiu e o que sobrou."
          }
          action={balance.count === 0 ? { href: "/contas", label: "Cadastrar conta" } : { href: "/importar", label: "Importar extrato" }}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {/* Número herói: um por tela. */}
          <Link href={listHref} className="block">
            <span className="block text-micro text-ink-muted uppercase">Sobrou em {monthName}</span>
            <Valor cents={summary.result} size="hero" sign className="mt-1.5 block" />
            <Variacao percent={percentChange(previous.result, summary.result)} suffix={`vs. ${prevName}`} className="mt-1.5" />
          </Link>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CardKPI
              label="Entradas"
              value={summary.income}
              tone="neutral"
              detail={<Variacao percent={percentChange(previous.income, summary.income)} />}
              href={`${listHref}&tipo=INCOME`}
            />
            <CardKPI
              label="Saídas"
              value={summary.expense}
              tone="neutral"
              detail={<Variacao percent={percentChange(previous.expense, summary.expense)} upIsGood={false} />}
              href={`${listHref}&tipo=EXPENSE`}
            />
            <CardKPI
              label="Saldo"
              value={balance.total}
              tone="neutral"
              detail={`${balance.count} ${balance.count === 1 ? "conta" : "contas"}`}
              href="/contas"
            />
            <CardKPI
              label="Poupança"
              value={<span className="tabular text-amount-lg text-ink-primary">{formatPercent(summary.savingsRate)}</span>}
              detail="do que entrou"
              href={listHref}
            />
          </div>

          {insights.length > 0 && (
            <div className="flex flex-col gap-3">
              {insights.map((i) => (
                <InsightBanner key={i.id} insight={i} />
              ))}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-card">
              <header className="flex items-baseline justify-between pb-4">
                <h2 className="text-title">Gastos por categoria</h2>
                <Link href={`${listHref}&tipo=EXPENSE`} className="text-caption text-brand hover:text-brand-strong">
                  ver todas
                </Link>
              </header>
              {categories.length === 0 ? (
                <p className="py-6 text-center text-body text-ink-secondary">Nenhuma saída em {monthName}.</p>
              ) : (
                <BarraCategoria items={categories} month={month} type="EXPENSE" />
              )}
            </section>

            <section className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-card">
              <header className="pb-4">
                <h2 className="text-title">Resultado por mês</h2>
                <p className="text-caption text-ink-secondary">Entradas menos saídas, últimos seis meses</p>
              </header>
              <FluxoMensal
                points={flow.map((f) => ({ month: f.month, income: f.income.toString(), expense: f.expense.toString(), result: f.result.toString() }))}
              />
            </section>
          </div>
        </div>
      )}
    </>
  );
}
