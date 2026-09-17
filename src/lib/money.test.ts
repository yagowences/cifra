import { describe, expect, it } from "vitest";
import {
  formatBRL,
  formatPercent,
  MINUS,
  parseBRL,
  percentChange,
  percentOf,
  signedAmount,
  splitEvenly,
  sumCents,
} from "./money";

const NBSP = " ";

describe("formatBRL", () => {
  it("usa ponto no milhar, vírgula no decimal e R$ com espaço", () => {
    expect(formatBRL(184000n)).toBe(`R$${NBSP}1.840,00`);
    expect(formatBRL(284712030n)).toBe(`R$${NBSP}2.847.120,30`);
    expect(formatBRL(0n)).toBe(`R$${NBSP}0,00`);
  });

  it("sinal usa o menos tipográfico U+2212, nunca o hífen", () => {
    const out = formatBRL(-4890n, { sign: true });
    expect(out).toBe(`${MINUS}${NBSP}R$${NBSP}48,90`);
    expect(out).not.toContain("-");
    expect(formatBRL(4890n, { sign: true })).toBe(`+${NBSP}R$${NBSP}48,90`);
    expect(formatBRL(0n, { sign: true })).toBe(`R$${NBSP}0,00`);
  });

  it("sem símbolo, para o segundo nível da tela", () => {
    expect(formatBRL(-4890n, { sign: true, symbol: false })).toBe(`${MINUS}${NBSP}48,90`);
    expect(formatBRL(184000n, { symbol: false })).toBe("1.840,00");
  });

  it("sem centavos, arredondando para o real mais próximo", () => {
    expect(formatBRL(1240000n, { decimals: false })).toBe(`R$${NBSP}12.400`);
    expect(formatBRL(955349n, { decimals: false })).toBe(`R$${NBSP}9.553`);
    expect(formatBRL(955350n, { decimals: false })).toBe(`R$${NBSP}9.554`);
  });

  it("valor negativo sem sign não mostra sinal", () => {
    expect(formatBRL(-4890n)).toBe(`R$${NBSP}48,90`);
  });
});

describe("parseBRL", () => {
  it("lê os formatos que uma pessoa digita", () => {
    expect(parseBRL("1.840,00")).toBe(184000n);
    expect(parseBRL("R$ 48,90")).toBe(4890n);
    expect(parseBRL("1840")).toBe(184000n);
    expect(parseBRL("48,9")).toBe(4890n);
    expect(parseBRL("48.90")).toBe(4890n);
    expect(parseBRL("1,840.00")).toBe(184000n);
    expect(parseBRL("0,05")).toBe(5n);
  });

  it("aceita sinal com hífen ou U+2212", () => {
    expect(parseBRL("-48,90")).toBe(-4890n);
    expect(parseBRL(`${MINUS}48,90`)).toBe(-4890n);
    expect(parseBRL("+10")).toBe(1000n);
  });

  it("rejeita o que não é número", () => {
    expect(parseBRL("")).toBeNull();
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("1a")).toBeNull();
    expect(parseBRL("12,345")).toBe(1234500n); // vírgula seguida de 3 dígitos é milhar
    expect(parseBRL("R$")).toBeNull();
  });

  it("vai e volta com formatBRL", () => {
    for (const cents of [0n, 1n, 99n, 100n, 4890n, 184000n, 284712030n]) {
      expect(parseBRL(formatBRL(cents))).toBe(cents);
    }
  });
});

describe("signedAmount", () => {
  it("receita positiva; despesa e transferência negativas, qualquer que seja o sinal de entrada", () => {
    expect(signedAmount("INCOME", 100n)).toBe(100n);
    expect(signedAmount("INCOME", -100n)).toBe(100n);
    expect(signedAmount("EXPENSE", 100n)).toBe(-100n);
    expect(signedAmount("TRANSFER", -100n)).toBe(-100n);
  });
});

describe("splitEvenly", () => {
  it("as parcelas somam exatamente o total e o resto vai para as primeiras", () => {
    expect(splitEvenly(100000n, 3)).toEqual([33334n, 33333n, 33333n]);
    expect(splitEvenly(-100000n, 3)).toEqual([-33334n, -33333n, -33333n]);
    expect(splitEvenly(10n, 4)).toEqual([3n, 3n, 2n, 2n]);
    expect(sumCents(splitEvenly(123457n, 12))).toBe(123457n);
  });

  it("rejeita número de parcelas inválido", () => {
    expect(() => splitEvenly(100n, 0)).toThrow(RangeError);
    expect(() => splitEvenly(100n, 1.5)).toThrow(RangeError);
  });
});

describe("percentuais", () => {
  it("percentOf com uma casa decimal e total zero seguro", () => {
    expect(percentOf(184000n, 955300n)).toBe(19.3);
    expect(percentOf(-184000n, -955300n)).toBe(19.3);
    expect(percentOf(100n, 0n)).toBe(0);
  });

  it("percentChange inteiro, null sem base", () => {
    expect(percentChange(143700n, 184000n)).toBe(28);
    expect(percentChange(184000n, 143700n)).toBe(-21);
    expect(percentChange(0n, 100n)).toBeNull();
  });

  it("formatPercent com sinal tipográfico", () => {
    expect(formatPercent(18)).toBe("18%");
    expect(formatPercent(18, { sign: true })).toBe("+18%");
    expect(formatPercent(-21, { sign: true })).toBe(`${MINUS}21%`);
    expect(formatPercent(0, { sign: true })).toBe("0%");
    expect(formatPercent(19.34)).toBe("19,3%");
  });
});
