import type { ISODate } from "./dates";

/** Forma de uma transação na fronteira servidor → cliente (centavos como string). */
export type TransactionListItem = {
  id: string;
  accountId: string;
  accountName: string;
  transferAccountId: string | null;
  transferAccountName: string | null;
  category: { id: string; name: string; icon: string; color: string } | null;
  /** Centavos com sinal, como string decimal. */
  amount: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  status: "PENDING" | "CONFIRMED" | "RECONCILED" | "PROJECTED" | "IGNORED";
  competenceDate: ISODate;
  cashDate: ISODate | null;
  description: string;
  merchant: string | null;
  notes: string | null;
  reviewed: boolean;
  recurring: boolean;
  installment: string | null;
  attachments: number;
};

export type DayGroup = { date: ISODate; total: bigint; items: TransactionListItem[] };

/**
 * Agrupa por dia de competência, preservando a ordem recebida (mais recente primeiro).
 * O total do dia soma receitas e despesas efetivas; transferência e lançamento ignorado ficam fora.
 */
export function groupByDay(items: TransactionListItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const item of items) {
    if (!current || current.date !== item.competenceDate) {
      current = { date: item.competenceDate, total: 0n, items: [] };
      groups.push(current);
    }
    current.items.push(item);
    if (item.type !== "TRANSFER" && item.status !== "IGNORED") current.total += BigInt(item.amount);
  }
  return groups;
}
