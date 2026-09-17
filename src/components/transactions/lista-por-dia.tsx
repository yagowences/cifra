"use client";

import { Valor } from "@/components/money/valor";
import { formatDayHeader, type ISODate } from "@/lib/dates";
import { groupByDay, type TransactionListItem } from "@/lib/transactions";
import { useTransactionSheet } from "./transaction-sheet-provider";
import { LinhaTransacao } from "./linha-transacao";

type Props = { items: TransactionListItem[]; today: ISODate };

/** Lista agrupada por dia, com cabeçalho micro em caixa alta e o total do dia. */
export function ListaPorDia({ items, today }: Props) {
  const { openEdit } = useTransactionSheet();
  const groups = groupByDay(items);

  return (
    <div className="-mx-4 lg:mx-0 lg:overflow-hidden lg:rounded-lg lg:border lg:border-border-subtle lg:bg-surface-raised">
      {groups.map((group) => (
        <section key={group.date} aria-label={formatDayHeader(group.date, today)}>
          <header className="flex items-center justify-between px-4 py-2.5 text-micro text-ink-muted uppercase">
            <span>{formatDayHeader(group.date, today)}</span>
            <Valor cents={group.total} sign symbol={false} tone="neutral" className="text-micro text-ink-muted" />
          </header>
          {group.items.map((item) => (
            <LinhaTransacao key={item.id} item={item} onClick={openEdit} />
          ))}
        </section>
      ))}
    </div>
  );
}
