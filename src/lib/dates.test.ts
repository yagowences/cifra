import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  cardCashDate,
  formatDayHeader,
  formatMonthYear,
  formatShortDate,
  fromISODate,
  isISODate,
  monthPeriod,
  periodOf,
  todayISO,
  toISODate,
} from "./dates";

describe("ISO ↔ Date", () => {
  it("vai e volta pela meia-noite UTC, como o Prisma grava @db.Date", () => {
    expect(toISODate(fromISODate("2026-09-17"))).toBe("2026-09-17");
    expect(fromISODate("2026-09-17").toISOString()).toBe("2026-09-17T00:00:00.000Z");
  });

  it("valida datas reais", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("17/09/2026")).toBe(false);
  });

  it("hoje respeita o fuso de São Paulo", () => {
    // 01:30 UTC de 18/set ainda é 22:30 de 17/set em São Paulo.
    expect(todayISO(new Date("2026-09-18T01:30:00Z"))).toBe("2026-09-17");
    expect(todayISO(new Date("2026-09-18T03:30:00Z"))).toBe("2026-09-18");
  });
});

describe("aritmética de meses", () => {
  it("mantém o dia e faz clamp no fim do mês", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-10", 1)).toBe("2027-01-10");
  });

  it("addDays cruza o mês", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("período do mês é inclusivo nas duas pontas", () => {
    expect(monthPeriod(2026, 2)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodOf("2026-09-17")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });
});

describe("competência vs. caixa no cartão", () => {
  it("compra em 28/jan com fechamento dia 3 e vencimento dia 10 tem caixa em 10/fev", () => {
    expect(cardCashDate("2026-01-28", 3, 10)).toBe("2026-02-10");
  });

  it("compra depois do fechamento vai para a fatura seguinte", () => {
    expect(cardCashDate("2026-01-20", 20, 27)).toBe("2026-01-27");
    expect(cardCashDate("2026-01-21", 20, 27)).toBe("2026-02-27");
  });

  it("vencimento antes do fechamento cai no mês seguinte", () => {
    expect(cardCashDate("2026-01-10", 25, 5)).toBe("2026-02-05");
    expect(cardCashDate("2026-01-26", 25, 5)).toBe("2026-03-05");
  });

  it("vencimento dia 31 faz clamp em mês curto", () => {
    expect(cardCashDate("2026-01-15", 20, 31)).toBe("2026-01-31");
    expect(cardCashDate("2026-01-25", 20, 31)).toBe("2026-02-28");
  });
});

describe("formatação", () => {
  it("cabeçalho de dia", () => {
    expect(formatDayHeader("2026-09-17", "2026-09-17")).toBe("HOJE · 17 SET");
    expect(formatDayHeader("2026-09-16", "2026-09-17")).toBe("ONTEM · 16 SET");
    expect(formatDayHeader("2026-09-15", "2026-09-17")).toBe("TER · 15 SET");
    expect(formatDayHeader("2025-12-25", "2026-09-17")).toBe("QUI · 25 DEZ 2025");
  });

  it("datas curtas e mês por extenso", () => {
    expect(formatShortDate("2026-09-17")).toBe("17/09/2026");
    expect(formatMonthYear(2026, 9)).toBe("Setembro 2026");
    expect(formatMonthYear(2026, 3)).toBe("Março 2026");
  });
});
