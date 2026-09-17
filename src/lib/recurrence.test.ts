import { describe, expect, it } from "vitest";
import { formatRRule, nextOccurrenceAfter, occurrencesBetween, parseRRule } from "./recurrence";

describe("parseRRule / formatRRule", () => {
  it("lê e escreve o subconjunto suportado", () => {
    expect(parseRRule("FREQ=MONTHLY")).toEqual({ freq: "MONTHLY", interval: 1 });
    expect(parseRRule("RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=10")).toEqual({ freq: "WEEKLY", interval: 2, count: 10 });
    expect(parseRRule("FREQ=YEARLY;UNTIL=20281231")).toEqual({ freq: "YEARLY", interval: 1, until: "2028-12-31" });
    expect(formatRRule({ freq: "MONTHLY", interval: 3, until: "2027-01-31" })).toBe("FREQ=MONTHLY;INTERVAL=3;UNTIL=20270131");
    expect(parseRRule(formatRRule({ freq: "WEEKLY", interval: 1, count: 4 }))).toEqual({ freq: "WEEKLY", interval: 1, count: 4 });
  });

  it("rejeita frequência ou parâmetros inválidos", () => {
    expect(() => parseRRule("FREQ=DAILY")).toThrow();
    expect(() => parseRRule("FREQ=MONTHLY;INTERVAL=0")).toThrow();
    expect(() => parseRRule("FREQ=MONTHLY;UNTIL=2026-13-40")).toThrow();
  });
});

describe("occurrencesBetween", () => {
  it("mensal mantém o dia e faz clamp no fim do mês", () => {
    expect(occurrencesBetween("2026-01-31", { freq: "MONTHLY", interval: 1 }, { until: "2026-04-30" })).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("respeita COUNT, UNTIL e o início do intervalo", () => {
    expect(occurrencesBetween("2026-09-05", { freq: "WEEKLY", interval: 1, count: 3 }, { until: "2026-12-31" })).toEqual([
      "2026-09-05",
      "2026-09-12",
      "2026-09-19",
    ]);
    expect(occurrencesBetween("2026-09-05", { freq: "MONTHLY", interval: 1, until: "2026-11-01" }, { until: "2027-01-01" })).toEqual([
      "2026-09-05",
      "2026-10-05",
    ]);
    expect(occurrencesBetween("2026-01-10", { freq: "MONTHLY", interval: 1 }, { from: "2026-03-01", until: "2026-04-30" })).toEqual([
      "2026-03-10",
      "2026-04-10",
    ]);
  });

  it("anual e com intervalo", () => {
    expect(occurrencesBetween("2024-02-29", { freq: "YEARLY", interval: 1 }, { until: "2028-12-31" })).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
    expect(occurrencesBetween("2026-01-01", { freq: "MONTHLY", interval: 3 }, { until: "2026-12-31" })).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
      "2026-10-01",
    ]);
  });
});

describe("nextOccurrenceAfter", () => {
  it("acha a próxima depois de uma data e null quando a regra acabou", () => {
    expect(nextOccurrenceAfter("2026-01-10", { freq: "MONTHLY", interval: 1 }, "2026-09-17")).toBe("2026-10-10");
    expect(nextOccurrenceAfter("2026-01-10", { freq: "MONTHLY", interval: 1, count: 3 }, "2026-09-17")).toBeNull();
    expect(nextOccurrenceAfter("2026-01-10", { freq: "MONTHLY", interval: 1, until: "2026-06-30" }, "2026-09-17")).toBeNull();
  });
});
