import { describe, expect, it } from "vitest";
import { groupByDay, type TransactionListItem } from "./transactions";

const item = (over: Partial<TransactionListItem>): TransactionListItem => ({
  id: Math.random().toString(36).slice(2),
  accountId: "a",
  accountName: "Nubank",
  transferAccountId: null,
  transferAccountName: null,
  category: null,
  amount: "-100",
  type: "EXPENSE",
  status: "CONFIRMED",
  competenceDate: "2026-09-17",
  cashDate: null,
  description: "x",
  merchant: null,
  notes: null,
  reviewed: true,
  recurring: false,
  installment: null,
  attachments: 0,
  ...over,
});

describe("groupByDay", () => {
  it("agrupa dias consecutivos mantendo a ordem e soma o total do dia", () => {
    const groups = groupByDay([
      item({ amount: "-4890" }),
      item({ amount: "-2450" }),
      item({ competenceDate: "2026-09-16", amount: "520000", type: "INCOME" }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-09-17", "2026-09-16"]);
    expect(groups[0].total).toBe(-7340n);
    expect(groups[1].total).toBe(520000n);
  });

  it("transferência e lançamento ignorado não entram no total do dia", () => {
    const groups = groupByDay([
      item({ amount: "-4890" }),
      item({ amount: "-50000", type: "TRANSFER", transferAccountId: "b" }),
      item({ amount: "-999", status: "IGNORED" }),
    ]);
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].total).toBe(-4890n);
  });

  it("lista vazia vira nenhum grupo", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
