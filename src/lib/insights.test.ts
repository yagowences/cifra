import { describe, expect, it } from "vitest";
import { detectCategorySpikes, detectDailyPace, detectSubscriptions, previousMonths, spikeText, subscriptionsText, type MerchantRow } from "./insights";

const row = (merchantKey: string, date: string, amount: bigint, description = merchantKey): MerchantRow => ({ merchantKey, description, date, amount, categoryName: "Assinaturas" });

describe("detectSubscriptions", () => {
  it("mesmo comerciante, valor estável ±5%, mensal, 3+ ocorrências", () => {
    const subs = detectSubscriptions([
      row("netflix", "2026-06-06", -5590n, "NETFLIX.COM"),
      row("netflix", "2026-07-06", -5590n, "NETFLIX.COM"),
      row("netflix", "2026-08-06", -5790n, "NETFLIX.COM"), // +3,6%: dentro da tolerância
      row("netflix", "2026-09-06", -5590n, "NETFLIX.COM"),
      row("spotify", "2026-07-10", -2190n),
      row("spotify", "2026-08-10", -2190n),
      row("spotify", "2026-09-10", -2190n),
      row("uber", "2026-09-01", -2400n),
      row("uber", "2026-09-02", -1800n),
      row("uber", "2026-09-03", -3200n),
      row("salario", "2026-09-05", 500000n),
    ]);
    expect(subs.map((s) => [s.merchantKey, s.cadence, s.occurrences])).toEqual([
      ["netflix", "monthly", 4],
      ["spotify", "monthly", 3],
    ]);
    expect(subs[0].amount).toBe(5590n);
  });

  it("cadência quebrada ou valor instável não é assinatura; anual é", () => {
    expect(detectSubscriptions([row("a", "2026-01-01", -100n), row("a", "2026-03-01", -100n), row("a", "2026-04-01", -100n)])).toEqual([]);
    expect(detectSubscriptions([row("b", "2026-06-01", -100n), row("b", "2026-07-01", -150n), row("b", "2026-08-01", -100n)])).toEqual([]);
    const yearly = detectSubscriptions([row("dominio", "2024-02-01", -9900n), row("dominio", "2025-02-01", -9900n), row("dominio", "2026-02-01", -9900n)]);
    expect(yearly[0]?.cadence).toBe("yearly");
  });

  it("texto das assinaturas soma só as mensais", () => {
    const text = subscriptionsText([
      { merchantKey: "a", description: "Netflix", amount: 5590n, cadence: "monthly", occurrences: 3, lastDate: "2026-09-06", categoryName: null },
      { merchantKey: "b", description: "Spotify", amount: 2190n, cadence: "monthly", occurrences: 3, lastDate: "2026-09-10", categoryName: null },
      { merchantKey: "c", description: "Domínio", amount: 9900n, cadence: "yearly", occurrences: 3, lastDate: "2026-02-01", categoryName: null },
    ]);
    expect(text.title).toBe("2 assinaturas ativas somam R$ 77,80/mês");
    expect(text.body).toBe("Netflix, Spotify.");
  });
});

describe("detectCategorySpikes", () => {
  it("aumento acima de 2σ dos seis meses anteriores", () => {
    const spikes = detectCategorySpikes([
      { categoryId: "food", name: "Alimentação", current: 184000n, previous: [140000n, 145000n, 143000n, 141000n, 146000n, 147200n] },
      { categoryId: "home", name: "Moradia", current: 120000n, previous: [120000n, 120000n, 120000n, 120000n, 120000n, 120000n] },
      { categoryId: "fun", name: "Lazer", current: 50000n, previous: [10000n, 90000n, 40000n, 70000n, 20000n, 60000n] },
    ]);
    expect(spikes.map((s) => s.name)).toEqual(["Alimentação"]);
    expect(spikes[0].percentUp).toBe(28);
    expect(spikes[0].mean).toBe(143700n);
    expect(spikeText(spikes[0], "setembro").title).toBe("Alimentação subiu 28%");
    expect(spikeText(spikes[0], "setembro").body).toBe("R$ 1.840,00 em setembro contra média de R$ 1.437,00 nos meses anteriores.");
  });

  it("precisa de ao menos 3 meses de histórico", () => {
    expect(detectCategorySpikes([{ categoryId: "x", name: "X", current: 900n, previous: [100n, 100n] }])).toEqual([]);
  });
});

describe("detectDailyPace", () => {
  it("gasto diário 20% acima do padrão com 7+ dias corridos", () => {
    const pace = detectDailyPace({ monthExpense: 300000n, daysElapsed: 10, daysInMonth: 30, previousMonthsExpense: [600000n, 630000n, 570000n], previousMonthsDays: [30, 31, 30] });
    expect(pace).not.toBeNull();
    expect(pace!.averageDaily).toBe(30000n);
    expect(pace!.typicalDaily).toBe(19780n);
    expect(pace!.percentUp).toBe(51);
    expect(pace!.daysLeft).toBe(20);
  });

  it("cedo no mês ou dentro do padrão, nada", () => {
    expect(detectDailyPace({ monthExpense: 100000n, daysElapsed: 3, daysInMonth: 30, previousMonthsExpense: [600000n, 600000n], previousMonthsDays: [30, 30] })).toBeNull();
    expect(detectDailyPace({ monthExpense: 200000n, daysElapsed: 10, daysInMonth: 30, previousMonthsExpense: [600000n, 600000n], previousMonthsDays: [30, 30] })).toBeNull();
  });
});

describe("previousMonths", () => {
  it("lista os meses anteriores, do mais antigo ao mais recente", () => {
    expect(previousMonths("2026-09", 3)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(previousMonths("2026-01", 2)).toEqual(["2025-11", "2025-12"]);
  });
});
