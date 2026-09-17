import Link from "next/link";
import { formatBRL, formatPercent } from "@/lib/money";

export type BarraItem = {
  categoryId: string | null;
  name: string;
  color: string | null;
  /** Centavos (magnitude). */
  total: bigint;
  percent: number;
  isOthers?: boolean;
};

type Props = { items: BarraItem[]; month: string; type: "EXPENSE" | "INCOME" };

/** Chave de cor da série pela posição: chart-1 a chart-5; da sexta em diante, chart-5. */
const seriesColor = (index: number, item: BarraItem) =>
  item.isOthers ? "chart-5" : ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"][Math.min(index, 4)];

/**
 * Ranking horizontal por categoria: comparar comprimentos é mais fácil que ângulos,
 * e rótulo e valor cabem na mesma linha. Cada linha leva à lista filtrada.
 */
export function BarraCategoria({ items, month, type }: Props) {
  const max = items.reduce((m, i) => (i.total > m ? i.total : m), 0n);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, index) => {
        const width = max > 0n ? Number((item.total * 1000n) / max) / 10 : 0;
        const color = seriesColor(index, item);
        const href = item.isOthers
          ? `/transacoes?mes=${month}&tipo=${type}`
          : `/transacoes?mes=${month}&tipo=${type}${item.categoryId ? `&categoria=${item.categoryId}` : "&categoria=nenhuma"}`;
        return (
          <li key={item.categoryId ?? item.name}>
            <Link href={href} className="group block rounded-xs">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  <span className="text-body">{item.name}</span>
                  <span className="ml-2 text-caption text-ink-secondary">{formatPercent(item.percent)}</span>
                </span>
                <span className="tabular shrink-0 text-amount-md text-ink-primary">{formatBRL(item.total, { symbol: false })}</span>
              </span>
              <span className="mt-2 block h-2 overflow-hidden rounded-xs bg-surface-sunken">
                <span
                  className="block h-full rounded-xs transition-[width] duration-[400ms] ease-out motion-reduce:transition-none"
                  style={{ width: `${width}%`, background: `var(--${color})` }}
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
