import { describe, expect, it } from "vitest";
import { prepareCardRows } from "./card-installments";
import type { ParsedRow } from "./types";

const row = (over: Partial<ParsedRow>): ParsedRow => ({ externalId: null, date: "2026-08-29", amount: "-12829", description: "X", memo: null, balanceAfter: null, ...over });

describe("prepareCardRows", () => {
  it("parcela N cai N − 1 meses depois da compra, como na fatura real", () => {
    const out = prepareCardRows([
      row({ date: "2025-12-16", description: "CP PARC SHOPPING INTER (Parcela 09 de 10)" }),
      row({ date: "2026-06-16", description: "R 26 PNEUS (Parcela 03 de 03)" }),
      row({ date: "2026-07-19", description: "CENTAURO (Parcela 02 de 04)" }),
    ]);
    expect(out.map((r) => r.date)).toEqual(["2026-08-16", "2026-08-16", "2026-08-19"]);
    expect(out[0]).toMatchObject({ installmentNo: 9, installmentTotal: 10 });
    expect(out[0].memo).toBe("Compra em 16/12/2025 · parcela 9 de 10");
  });

  it("parcela 1 mantém a data e compra à vista passa intacta", () => {
    const [p1, avista, credito] = prepareCardRows([
      row({ date: "2026-08-29", description: "MADESAMO (Parcela 01 de 10)" }),
      row({ description: "MERCADO ZE" }),
      row({ amount: "6820", description: "RESGATE PONTOS (Parcela 01 de 02)" }),
    ]);
    expect(p1).toMatchObject({ date: "2026-08-29", installmentNo: 1, installmentTotal: 10 });
    expect(avista.installmentNo).toBeUndefined();
    expect(credito.installmentNo).toBeUndefined();
  });

  it("fim de mês faz clamp", () => {
    const [r] = prepareCardRows([row({ date: "2026-01-31", description: "LOJA (Parcela 02 de 03)" })]);
    expect(r.date).toBe("2026-02-28");
  });
});
